/*
 * test_decode.c - host-side tests for the IR decoders.
 *
 * The decoders are pure functions over timing arrays, so they can be tested
 * on the build machine with synthesised waveforms. Each encoder below builds
 * the mark/space sequence a real remote would emit, including the detail that
 * the trailing idle space is never captured, and the test asserts the decoder
 * recovers the original address and command.
 *
 * Two properties matter as much as plain round-tripping and are tested
 * explicitly:
 *   - identity must be stable across a protocol's toggle bit, or every second
 *     press of a button would miss its binding;
 *   - protocols whose header windows overlap must not claim each other's
 *     frames.
 *
 * Build and run: firmware/test/run-tests.ps1
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdarg.h>

#include "ir_decode.h"
#include "ir_protocol.h"
#include "wire_protocol.h"

/* ------------------------------------------------------------------------- */
/* Minimal test harness                                                      */
/* ------------------------------------------------------------------------- */
static int g_checks, g_fails;
static const char *g_case = "";

#define CASE(name) (g_case = (name))

static void okf(int cond, const char *fmt, ...)
{
    g_checks++;
    if (cond) return;
    g_fails++;
    va_list ap;
    fprintf(stderr, "FAIL [%s] ", g_case);
    va_start(ap, fmt);
    vfprintf(stderr, fmt, ap);
    va_end(ap);
    fputc('\n', stderr);
}

#define CHECK(cond, ...) okf((cond), __VA_ARGS__)

/* ------------------------------------------------------------------------- */
/* Encoders                                                                  */
/* ------------------------------------------------------------------------- */

/* Pulse-distance: one mark per bit, space length carries the value. LSB first. */
static int pd_frame(uint16_t *d, uint32_t hdr_mark, uint32_t hdr_space,
                    uint32_t bit_mark, uint32_t zero_space, uint32_t one_space,
                    uint64_t value, int nbits)
{
    int k = 0;
    d[k++] = (uint16_t)hdr_mark;
    d[k++] = (uint16_t)hdr_space;
    for (int i = 0; i < nbits; i++) {
        d[k++] = (uint16_t)bit_mark;
        d[k++] = (uint16_t)(((value >> i) & 1u) ? one_space : zero_space);
    }
    d[k++] = (uint16_t)bit_mark; /* trailing mark, which IS captured */
    return k;
}

static int nec_frame(uint16_t *d, uint8_t a0, uint8_t a1, uint8_t cmd)
{
    const uint64_t v = (uint64_t)a0 | ((uint64_t)a1 << 8) |
                       ((uint64_t)cmd << 16) |
                       ((uint64_t)(uint8_t)~cmd << 24);
    return pd_frame(d, 9000, 4500, 560, 560, 1690, v, 32);
}

static int nec_repeat_frame(uint16_t *d)
{
    d[0] = 9000; d[1] = 2250; d[2] = 560;
    return 3;
}

static int samsung_frame(uint16_t *d, uint8_t a0, uint8_t a1, uint8_t cmd)
{
    const uint64_t v = (uint64_t)a0 | ((uint64_t)a1 << 8) |
                       ((uint64_t)cmd << 16) |
                       ((uint64_t)(uint8_t)~cmd << 24);
    return pd_frame(d, 4500, 4500, 560, 560, 1690, v, 32);
}

static int kaseikyo_frame(uint16_t *d, uint64_t v48)
{
    return pd_frame(d, 3456, 1728, 432, 432, 1296, v48, 48);
}

static int jvc_frame(uint16_t *d, uint8_t addr, uint8_t cmd)
{
    const uint64_t v = (uint64_t)addr | ((uint64_t)cmd << 8);
    return pd_frame(d, 8400, 4200, 525, 525, 1575, v, 16);
}

/* Sony SIRC: mark length carries the value, fixed 600 us spaces. */
static int sony_frame(uint16_t *d, uint32_t addr, uint32_t cmd7, int nbits)
{
    const uint32_t v = (cmd7 & 0x7Fu) | (addr << 7);
    int k = 0;
    d[k++] = 2400;
    d[k++] = 600;
    for (int i = 0; i < nbits; i++) {
        d[k++] = (uint16_t)(((v >> i) & 1u) ? 1200 : 600);
        if (i < nbits - 1) d[k++] = 600;
    }
    return k;
}

/*
 * Collapses a run-length level stream into durations, dropping a trailing
 * space run exactly as a receiver would (no edge ends it, so nothing is
 * timed). The stream must begin with a mark.
 */
static int levels_to_durations(const uint8_t *lv, int n, uint32_t unit,
                               uint16_t *d)
{
    int k = 0, i = 0;
    while (i < n) {
        int run = 1;
        while (i + run < n && lv[i + run] == lv[i]) run++;
        if (lv[i] == 0 && i + run >= n) break; /* trailing space: not captured */
        d[k++] = (uint16_t)(unit * (uint32_t)run);
        i += run;
    }
    return k;
}

/* RC5: 14 biphase bits, 1 = space-then-mark. */
static int rc5_frame(uint16_t *d, uint8_t s2, uint8_t toggle,
                     uint8_t addr5, uint8_t cmd6)
{
    uint8_t bits[14];
    bits[0] = 1;
    bits[1] = s2;
    bits[2] = toggle;
    for (int i = 0; i < 5; i++) bits[3 + i] = (addr5 >> (4 - i)) & 1u;
    for (int i = 0; i < 6; i++) bits[8 + i] = (cmd6 >> (5 - i)) & 1u;

    uint8_t hb[28];
    for (int i = 0; i < 14; i++) {
        hb[i * 2]     = bits[i] ? 0 : 1;
        hb[i * 2 + 1] = bits[i] ? 1 : 0;
    }
    /* hb[0] is the start bit's leading space, which is never transmitted. */
    return levels_to_durations(hb + 1, 27, 889, d);
}

/* RC6: 1 = mark-then-space, and the trailer bit is twice as wide. */
static int rc6_frame(uint16_t *d, uint32_t mode, uint8_t trailer,
                     uint64_t payload, int nbits)
{
    uint8_t lv[128];
    int k = 0;

    lv[k++] = 1; lv[k++] = 0;                      /* start bit, always 1   */
    for (int i = 2; i >= 0; i--) {                 /* 3 mode bits, MSB first*/
        const uint8_t b = (mode >> i) & 1u;
        lv[k++] = b ? 1 : 0;
        lv[k++] = b ? 0 : 1;
    }
    /* Trailer: two samples per half. */
    lv[k++] = trailer ? 1 : 0; lv[k++] = trailer ? 1 : 0;
    lv[k++] = trailer ? 0 : 1; lv[k++] = trailer ? 0 : 1;

    for (int i = nbits - 1; i >= 0; i--) {         /* data, MSB first       */
        const uint8_t b = (payload >> i) & 1u;
        lv[k++] = b ? 1 : 0;
        lv[k++] = b ? 0 : 1;
    }

    d[0] = 2664; /* 6 units */
    d[1] = 888;  /* 2 units */
    return 2 + levels_to_durations(lv, k, 444, d + 2);
}

/* Multiplies every duration, to model a remote whose clock is off. */
static void scale(uint16_t *d, int n, double factor)
{
    for (int i = 0; i < n; i++) d[i] = (uint16_t)(d[i] * factor + 0.5);
}

/* Alternating over- and under-shoot, to model demodulator mark stretching. */
static void jitter(uint16_t *d, int n, double pct)
{
    for (int i = 0; i < n; i++) {
        const double f = 1.0 + ((i & 1) ? pct : -pct) / 100.0;
        d[i] = (uint16_t)(d[i] * f + 0.5);
    }
}

/* ------------------------------------------------------------------------- */
/* Tests                                                                     */
/* ------------------------------------------------------------------------- */
static uint16_t d[512];

static void test_nec(void)
{
    CASE("NEC");
    ir_frame_t f;

    int n = nec_frame(d, 0x04, 0xFB, 0x08); /* address check passes */
    CHECK(ir_decode(d, (uint16_t)n, &f) == IR_DECODE_FRAME, "did not decode");
    CHECK(f.protocol == IR_PROTO_NEC, "protocol %s", ir_protocol_name(f.protocol));
    CHECK(f.address == 0x04, "address 0x%X", f.address);
    CHECK(f.command == 0x08, "command 0x%X", f.command);

    CASE("NEC extended");
    n = nec_frame(d, 0xEE, 0x87, 0x0B); /* 0xEE ^ 0x87 != 0xFF -> extended */
    CHECK(ir_decode(d, (uint16_t)n, &f) == IR_DECODE_FRAME, "did not decode");
    CHECK(f.protocol == IR_PROTO_NEC_EXT, "protocol %s", ir_protocol_name(f.protocol));
    CHECK(f.address == 0x87EE, "address 0x%X", f.address);
    CHECK(f.command == 0x0B, "command 0x%X", f.command);

    CASE("NEC ditto frame");
    n = nec_repeat_frame(d);
    CHECK(ir_decode(d, (uint16_t)n, &f) == IR_DECODE_REPEAT, "not reported as repeat");

    CASE("NEC rejects a corrupt command");
    n = nec_frame(d, 0x04, 0xFB, 0x08);
    d[2 + 16 * 2 + 1] = 1690; /* flip one command bit, breaking cmd ^ ~cmd */
    CHECK(ir_decode(d, (uint16_t)n, &f) == IR_DECODE_FRAME, "should still hash");
    CHECK(f.protocol == IR_PROTO_RAW_HASH,
          "accepted a frame failing its own checksum as %s",
          ir_protocol_name(f.protocol));

    CASE("NEC survives 8% jitter");
    n = nec_frame(d, 0x20, 0xDF, 0x47);
    jitter(d, n, 8.0);
    CHECK(ir_decode(d, (uint16_t)n, &f) == IR_DECODE_FRAME, "did not decode");
    CHECK(f.protocol == IR_PROTO_NEC && f.command == 0x47,
          "got %s cmd 0x%X", ir_protocol_name(f.protocol), f.command);
}

static void test_samsung(void)
{
    CASE("Samsung32");
    ir_frame_t f;
    const int n = samsung_frame(d, 0x07, 0x07, 0x02);
    CHECK(ir_decode(d, (uint16_t)n, &f) == IR_DECODE_FRAME, "did not decode");
    CHECK(f.protocol == IR_PROTO_SAMSUNG32, "protocol %s", ir_protocol_name(f.protocol));
    CHECK(f.address == 0x0707, "address 0x%X", f.address);
    CHECK(f.command == 0x02, "command 0x%X", f.command);
}

static void test_sony(void)
{
    ir_frame_t f;

    CASE("SIRC 12");
    int n = sony_frame(d, 0x01, 0x15, 12);
    CHECK(ir_decode(d, (uint16_t)n, &f) == IR_DECODE_FRAME, "did not decode");
    CHECK(f.protocol == IR_PROTO_SONY12, "protocol %s", ir_protocol_name(f.protocol));
    CHECK(f.address == 0x01 && f.command == 0x15,
          "addr 0x%X cmd 0x%X", f.address, f.command);

    CASE("SIRC 15");
    n = sony_frame(d, 0x97, 0x12, 15);
    CHECK(ir_decode(d, (uint16_t)n, &f) == IR_DECODE_FRAME, "did not decode");
    CHECK(f.protocol == IR_PROTO_SONY15, "protocol %s", ir_protocol_name(f.protocol));
    CHECK(f.address == 0x97 && f.command == 0x12,
          "addr 0x%X cmd 0x%X", f.address, f.command);

    CASE("SIRC 20");
    n = sony_frame(d, 0x1A2B & 0x1FFF, 0x33, 20);
    CHECK(ir_decode(d, (uint16_t)n, &f) == IR_DECODE_FRAME, "did not decode");
    CHECK(f.protocol == IR_PROTO_SONY20, "protocol %s", ir_protocol_name(f.protocol));
    CHECK(f.command == 0x33, "cmd 0x%X", f.command);
}

static void test_rc5(void)
{
    ir_frame_t f0, f1;

    CASE("RC5");
    int n = rc5_frame(d, 1, 0, 0x05, 0x35);
    CHECK(ir_decode(d, (uint16_t)n, &f0) == IR_DECODE_FRAME, "did not decode");
    CHECK(f0.protocol == IR_PROTO_RC5, "protocol %s", ir_protocol_name(f0.protocol));
    CHECK(f0.address == 0x05, "address 0x%X", f0.address);
    CHECK(f0.command == 0x35, "command 0x%X", f0.command);

    CASE("RC5 identity ignores the toggle bit");
    n = rc5_frame(d, 1, 1, 0x05, 0x35);
    CHECK(ir_decode(d, (uint16_t)n, &f1) == IR_DECODE_FRAME, "did not decode");
    CHECK(f1.flags & IR_FLAG_TOGGLE, "toggle not flagged");
    CHECK(ir_frame_key(&f0, 0) == ir_frame_key(&f1, 0),
          "same button gives two identities across the toggle");

    CASE("RC5X");
    n = rc5_frame(d, 0, 0, 0x05, 0x0A);
    CHECK(ir_decode(d, (uint16_t)n, &f0) == IR_DECODE_FRAME, "did not decode");
    CHECK(f0.protocol == IR_PROTO_RC5X, "protocol %s", ir_protocol_name(f0.protocol));
    CHECK(f0.command == 0x4A, "command 0x%X (expected 0x0A | 0x40)", f0.command);
}

static void test_rc6(void)
{
    ir_frame_t f0, f1;

    CASE("RC6 mode 0");
    int n = rc6_frame(d, 0, 0, 0x1234, 16);
    CHECK(ir_decode(d, (uint16_t)n, &f0) == IR_DECODE_FRAME, "did not decode");
    CHECK(f0.protocol == IR_PROTO_RC6_0, "protocol %s", ir_protocol_name(f0.protocol));
    CHECK(f0.address == 0x12, "address 0x%X", f0.address);
    CHECK(f0.command == 0x34, "command 0x%X", f0.command);

    CASE("RC6 mode 0 identity ignores the trailer toggle");
    n = rc6_frame(d, 0, 1, 0x1234, 16);
    CHECK(ir_decode(d, (uint16_t)n, &f1) == IR_DECODE_FRAME, "did not decode");
    CHECK(ir_frame_key(&f0, 0) == ir_frame_key(&f1, 0),
          "trailer toggle changed the identity");

    CASE("RC6-6A (Media Center), 32-bit");
    n = rc6_frame(d, 6, 0, 0x800F0400ull | 0x0Cull, 32);
    CHECK(ir_decode(d, (uint16_t)n, &f0) == IR_DECODE_FRAME, "did not decode");
    CHECK(f0.protocol == IR_PROTO_RC6_6A, "protocol %s", ir_protocol_name(f0.protocol));
    CHECK(f0.command == 0x0C, "command 0x%X", f0.command);

    CASE("RC6-6A identity ignores the payload toggle at bit 15");
    n = rc6_frame(d, 6, 0, 0x800F8400ull | 0x0Cull, 32); /* bit 15 set */
    CHECK(ir_decode(d, (uint16_t)n, &f1) == IR_DECODE_FRAME, "did not decode");
    CHECK(f1.flags & IR_FLAG_TOGGLE, "toggle not flagged");
    CHECK(ir_frame_key(&f0, 0) == ir_frame_key(&f1, 0),
          "payload toggle changed the identity (0x%llX vs 0x%llX)",
          (unsigned long long)ir_frame_key(&f0, 0),
          (unsigned long long)ir_frame_key(&f1, 0));
}

static void test_kaseikyo_jvc(void)
{
    ir_frame_t f;

    CASE("Kaseikyo 48-bit");
    int n = kaseikyo_frame(d, 0x0123456789ABull);
    CHECK(ir_decode(d, (uint16_t)n, &f) == IR_DECODE_FRAME, "did not decode");
    CHECK(f.protocol == IR_PROTO_KASEIKYO, "protocol %s", ir_protocol_name(f.protocol));
    /* Lossless split: low 24 bits as address, high 24 as command. */
    CHECK(f.address == 0x6789ABu, "address 0x%X", f.address);
    CHECK(f.command == 0x012345u, "command 0x%X", f.command);

    CASE("JVC 16-bit");
    n = jvc_frame(d, 0x03, 0x1D);
    CHECK(ir_decode(d, (uint16_t)n, &f) == IR_DECODE_FRAME, "did not decode");
    CHECK(f.protocol == IR_PROTO_JVC, "protocol %s", ir_protocol_name(f.protocol));
    CHECK(f.address == 0x03 && f.command == 0x1D,
          "addr 0x%X cmd 0x%X", f.address, f.command);
}

/*
 * Regression test for a real hazard: RC6's 2664 us leader mark sits inside
 * the tolerance window of Sony's 2400 us header mark, and vice versa. Only
 * the leader space separates them, so both decoders must reject the other's
 * frames outright.
 */
static void test_no_cross_claiming(void)
{
    ir_frame_t f;

    CASE("a Sony frame is not claimed by RC6");
    int n = sony_frame(d, 0x01, 0x15, 12);
    CHECK(ir_decode(d, (uint16_t)n, &f) == IR_DECODE_FRAME, "did not decode");
    CHECK(f.protocol == IR_PROTO_SONY12,
          "Sony frame decoded as %s", ir_protocol_name(f.protocol));

    CASE("an RC6 frame is not claimed by Sony");
    n = rc6_frame(d, 0, 0, 0x1234, 16);
    CHECK(ir_decode(d, (uint16_t)n, &f) == IR_DECODE_FRAME, "did not decode");
    CHECK(f.protocol == IR_PROTO_RC6_0,
          "RC6 frame decoded as %s", ir_protocol_name(f.protocol));

    CASE("a Samsung frame is not claimed by NEC or Kaseikyo");
    n = samsung_frame(d, 0x07, 0x07, 0x02);
    CHECK(ir_decode(d, (uint16_t)n, &f) == IR_DECODE_FRAME, "did not decode");
    CHECK(f.protocol == IR_PROTO_SAMSUNG32,
          "Samsung frame decoded as %s", ir_protocol_name(f.protocol));

    CASE("a JVC frame is not claimed by NEC");
    n = jvc_frame(d, 0x03, 0x1D);
    CHECK(ir_decode(d, (uint16_t)n, &f) == IR_DECODE_FRAME, "did not decode");
    CHECK(f.protocol == IR_PROTO_JVC,
          "JVC frame decoded as %s", ir_protocol_name(f.protocol));
}

/*
 * The fallback that makes the receiver universal. An unmodelled protocol must
 * still produce one stable identity per button, including when the remote's
 * clock is off by 10%.
 */
static void test_raw_hash(void)
{
    CASE("unknown protocol falls back to a raw hash");

    /* Opens with a 7000 us mark, which no modelled header window accepts. */
    static const uint16_t pattern[] = {
        7000, 1500, 400, 1500, 400, 900, 400, 1500, 400, 900, 400, 900
    };
    const int n = (int)(sizeof(pattern) / sizeof(pattern[0]));

    ir_frame_t f;
    memcpy(d, pattern, sizeof(pattern));
    CHECK(ir_decode(d, (uint16_t)n, &f) == IR_DECODE_FRAME, "did not produce a frame");
    CHECK(f.protocol == IR_PROTO_RAW_HASH,
          "claimed by %s", ir_protocol_name(f.protocol));
    const uint32_t h1 = f.command;
    CHECK(h1 != 0, "hash is zero");

    CASE("the raw hash is immune to a 10% clock error");
    memcpy(d, pattern, sizeof(pattern));
    scale(d, n, 1.10);
    CHECK(ir_decode(d, (uint16_t)n, &f) == IR_DECODE_FRAME, "did not produce a frame");
    CHECK(f.protocol == IR_PROTO_RAW_HASH, "protocol changed under scaling");
    CHECK(f.command == h1, "hash changed: 0x%08X vs 0x%08X", f.command, h1);

    CASE("a different pattern hashes differently");
    static const uint16_t other[] = {
        7000, 900, 400, 900, 400, 1500, 400, 900, 400, 1500, 400, 1500
    };
    memcpy(d, other, sizeof(other));
    CHECK(ir_decode(d, (uint16_t)n, &f) == IR_DECODE_FRAME, "did not produce a frame");
    CHECK(f.command != h1, "two different patterns collided on 0x%08X", h1);

    CASE("noise is rejected");
    d[0] = 300; d[1] = 400; d[2] = 300;
    CHECK(ir_decode(d, 3, &f) == IR_DECODE_NONE, "accepted a 3-edge noise burst");
}

/*
 * Wire structures are memcpy'd straight into HID reports and into flash, and
 * mirrored by hand in TypeScript. If any of these sizes move, both the host
 * serialiser and previously saved configurations are invalidated.
 */
static void test_wire_layout(void)
{
    CASE("wire structure sizes");
    CHECK(sizeof(wire_binding_t) == 16, "wire_binding_t is %u", (unsigned)sizeof(wire_binding_t));
    CHECK(sizeof(wire_binding_page_t) == 56, "wire_binding_page_t is %u", (unsigned)sizeof(wire_binding_page_t));
    CHECK(sizeof(wire_settings_t) == 44, "wire_settings_t is %u", (unsigned)sizeof(wire_settings_t));
    CHECK(sizeof(wire_ir_event_t) == 32, "wire_ir_event_t is %u", (unsigned)sizeof(wire_ir_event_t));
    CHECK(sizeof(wire_raw_event_t) == 60, "wire_raw_event_t is %u", (unsigned)sizeof(wire_raw_event_t));
    CHECK(sizeof(wire_stats_t) == 24, "wire_stats_t is %u", (unsigned)sizeof(wire_stats_t));
    CHECK(sizeof(wire_packet_t) == 64, "wire_packet_t is %u", (unsigned)sizeof(wire_packet_t));

    CASE("every payload fits in one report");
    CHECK(sizeof(wire_info_t) <= WIRE_PAYLOAD_SIZE, "wire_info_t is %u", (unsigned)sizeof(wire_info_t));
    CHECK(sizeof(wire_binding_page_t) <= WIRE_PAYLOAD_SIZE, "binding page too big");
    CHECK(sizeof(wire_settings_t) <= WIRE_PAYLOAD_SIZE, "settings too big");
    CHECK(sizeof(wire_ir_event_t) <= WIRE_PAYLOAD_SIZE, "ir event too big");
    CHECK(sizeof(wire_raw_event_t) <= WIRE_PAYLOAD_SIZE, "raw event too big");

    CASE("identity key packing");
    ir_frame_t f = { IR_PROTO_NEC_EXT, 0x87EE, 0x0B, 0, 32 };
    const uint64_t k = ir_frame_key(&f, 0);
    CHECK(IR_KEY_PROTO(k) == IR_PROTO_NEC_EXT, "protocol lost in packing");
    CHECK(IR_KEY_ADDRESS(k) == 0x87EE, "address lost in packing");
    CHECK(IR_KEY_COMMAND(k) == 0x0B, "command lost in packing");

    CASE("an extra toggle mask is applied to identity");
    ir_frame_t a = { IR_PROTO_RAW_HASH, 0, 0x1234, 0, 0 };
    ir_frame_t b = { IR_PROTO_RAW_HASH, 0, 0x1234 | 0x8000, 0, 0 };
    CHECK(ir_frame_key(&a, 0x8000) == ir_frame_key(&b, 0x8000),
          "masked bit still affects identity");
    CHECK(ir_frame_key(&a, 0) != ir_frame_key(&b, 0),
          "unmasked bit does not affect identity");
}

int main(void)
{
    test_nec();
    test_samsung();
    test_sony();
    test_rc5();
    test_rc6();
    test_kaseikyo_jvc();
    test_no_cross_claiming();
    test_raw_hash();
    test_wire_layout();

    printf("\n%d checks, %d failed\n", g_checks, g_fails);
    if (g_fails == 0) printf("ALL TESTS PASSED\n");
    return g_fails ? 1 : 0;
}
