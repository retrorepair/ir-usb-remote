/*
 * ir_decode.c - mark/space bursts to protocol frames.
 *
 * Conventions used throughout:
 *   - d[] holds durations in microseconds, alternating mark, space, mark, ...
 *     d[0] is always a mark, because the demodulator idles high and capture
 *     starts on the first falling edge.
 *   - The trailing idle space is never present: no edge ends it, so nothing is
 *     recorded. Decoders therefore tolerate the final space being absent.
 *   - Structural timings (headers, bit marks) are checked with a tolerance
 *     window. Bit *values* are decided with a midpoint threshold instead,
 *     because a window wide enough for cheap remotes would make the short and
 *     long symbols overlap (notably Sony's 600/1200 us marks).
 */
#include "ir_decode.h"
#include "board_config.h"

/* ------------------------------------------------------------------------- */
/* Timing helpers                                                            */
/* ------------------------------------------------------------------------- */

static inline bool near_us(uint16_t v, uint32_t expect, uint32_t pct, uint32_t abs_us)
{
    const uint32_t tol = expect * pct / 100u + abs_us;
    return (uint32_t)v + tol >= expect && (uint32_t)v <= expect + tol;
}

/* Headers are long and far apart, so a wide window is safe. */
#define HDR_MATCH(v, e) near_us((v), (e), 20, 150)
/* Bit marks are short; the demodulator stretches them by a few tens of us. */
#define BIT_MATCH(v, e) near_us((v), (e), 30, 80)

/* Plausible range for any single symbol; rejects noise early. */
static inline bool sane(uint16_t v, uint32_t lo, uint32_t hi)
{
    return (uint32_t)v >= lo && (uint32_t)v <= hi;
}

/* ------------------------------------------------------------------------- */
/* NEC and NEC extended                                                      */
/* ------------------------------------------------------------------------- */
#define NEC_HDR_MARK   9000
#define NEC_HDR_SPACE  4500
#define NEC_RPT_SPACE  2250
#define NEC_BIT_MARK    560
#define NEC_ZERO_SPACE  560
#define NEC_ONE_SPACE  1690
#define NEC_SPACE_MID  ((NEC_ZERO_SPACE + NEC_ONE_SPACE) / 2)

/*
 * Reads 32 pulse-distance bits LSB-first from d[off..]. Returns false if any
 * mark is the wrong length or any space is implausible.
 */
static bool read_pd_bits(const uint16_t *d, uint16_t off, int nbits,
                         uint32_t bit_mark, uint32_t space_mid, uint64_t *out)
{
    uint64_t v = 0;
    for (int i = 0; i < nbits; i++) {
        const uint16_t mark  = d[off + i * 2];
        const uint16_t space = d[off + i * 2 + 1];
        if (!BIT_MATCH(mark, bit_mark))      return false;
        if (!sane(space, 200, 3000))         return false;
        if ((uint32_t)space > space_mid) v |= (uint64_t)1 << i;
    }
    *out = v;
    return true;
}

static ir_decode_result_t decode_nec(const uint16_t *d, uint16_t n, ir_frame_t *out)
{
    if (n < 3 || !HDR_MATCH(d[0], NEC_HDR_MARK)) return IR_DECODE_NONE;

    /* Ditto frame: 9 ms mark, 2.25 ms space, single 560 us mark. */
    if (HDR_MATCH(d[1], NEC_RPT_SPACE) && n <= 4) return IR_DECODE_REPEAT;

    if (!HDR_MATCH(d[1], NEC_HDR_SPACE)) return IR_DECODE_NONE;
    if (n < 2 + 64) return IR_DECODE_NONE; /* needs d[2]..d[65] */

    uint64_t v;
    if (!read_pd_bits(d, 2, 32, NEC_BIT_MARK, NEC_SPACE_MID, &v))
        return IR_DECODE_NONE;

    const uint8_t a0 = (uint8_t)(v), a1 = (uint8_t)(v >> 8);
    const uint8_t c0 = (uint8_t)(v >> 16), c1 = (uint8_t)(v >> 24);

    /* The command check is mandatory: it is what separates NEC from the
     * several 32-bit pulse-distance protocols that share its header. */
    if ((uint8_t)(c0 ^ c1) != 0xFF) return IR_DECODE_NONE;

    if ((uint8_t)(a0 ^ a1) == 0xFF) {
        out->protocol = IR_PROTO_NEC;
        out->address  = a0;
    } else {
        /* Address check failed by design: this is the 16-bit address variant
         * used by, among others, Apple remotes. */
        out->protocol = IR_PROTO_NEC_EXT;
        out->address  = (uint32_t)a0 | ((uint32_t)a1 << 8);
    }
    out->command = c0;
    out->nbits   = 32;
    out->flags   = 0;
    return IR_DECODE_FRAME;
}

/* ------------------------------------------------------------------------- */
/* Samsung 32-bit                                                            */
/* ------------------------------------------------------------------------- */
#define SAM_HDR_MARK  4500
#define SAM_HDR_SPACE 4500

static ir_decode_result_t decode_samsung(const uint16_t *d, uint16_t n, ir_frame_t *out)
{
    if (n < 2 + 64) return IR_DECODE_NONE;
    if (!HDR_MATCH(d[0], SAM_HDR_MARK) || !HDR_MATCH(d[1], SAM_HDR_SPACE))
        return IR_DECODE_NONE;

    uint64_t v;
    if (!read_pd_bits(d, 2, 32, NEC_BIT_MARK, NEC_SPACE_MID, &v))
        return IR_DECODE_NONE;

    const uint8_t a0 = (uint8_t)(v), a1 = (uint8_t)(v >> 8);
    const uint8_t c0 = (uint8_t)(v >> 16), c1 = (uint8_t)(v >> 24);
    if ((uint8_t)(c0 ^ c1) != 0xFF) return IR_DECODE_NONE;

    out->protocol = IR_PROTO_SAMSUNG32;
    out->address  = (uint32_t)a0 | ((uint32_t)a1 << 8);
    out->command  = c0;
    out->nbits    = 32;
    out->flags    = 0;
    return IR_DECODE_FRAME;
}

/* ------------------------------------------------------------------------- */
/* Kaseikyo / Panasonic, 48-bit                                              */
/* ------------------------------------------------------------------------- */
#define KAS_HDR_MARK   3456
#define KAS_HDR_SPACE  1728
#define KAS_BIT_MARK    432
#define KAS_SPACE_MID  ((432 + 1296) / 2)

static ir_decode_result_t decode_kaseikyo(const uint16_t *d, uint16_t n, ir_frame_t *out)
{
    if (n < 2 + 96) return IR_DECODE_NONE;
    if (!HDR_MATCH(d[0], KAS_HDR_MARK) || !HDR_MATCH(d[1], KAS_HDR_SPACE))
        return IR_DECODE_NONE;

    uint64_t v;
    if (!read_pd_bits(d, 2, 48, KAS_BIT_MARK, KAS_SPACE_MID, &v))
        return IR_DECODE_NONE;

    /*
     * The 48 bits are split losslessly into the 24-bit address and 32-bit
     * command fields of the identity key: low 24 bits (vendor code and vendor
     * parity) as the address, the remaining 24 (genre, data, id, parity) as
     * the command. This is a packing choice, not the Kaseikyo field layout --
     * it is stable and collision-free, which is all identity requires. Code
     * database entries for Panasonic are matched on the vendor code in the
     * address, which this preserves exactly.
     */
    out->protocol = IR_PROTO_KASEIKYO;
    out->address  = (uint32_t)(v & 0xFFFFFFu);
    out->command  = (uint32_t)((v >> 24) & 0xFFFFFFu);
    out->nbits    = 48;
    out->flags    = 0;
    return IR_DECODE_FRAME;
}

/* ------------------------------------------------------------------------- */
/* JVC, 16-bit                                                               */
/* ------------------------------------------------------------------------- */
#define JVC_HDR_MARK  8400
#define JVC_HDR_SPACE 4200
#define JVC_BIT_MARK   525
#define JVC_SPACE_MID ((525 + 1575) / 2)

/*
 * Only the header-bearing frame is decoded. JVC omits the header on the
 * repeat frames of a held key, which leaves them indistinguishable from an
 * arbitrary pulse-distance burst; those fall through to the raw hash. The
 * practical effect is that a held JVC button does not auto-repeat. This is
 * noted in docs/ir-protocols.md rather than worked around, because guessing
 * that a headerless burst "must" belong to the last frame would mis-attribute
 * genuinely unknown remotes.
 */
static ir_decode_result_t decode_jvc(const uint16_t *d, uint16_t n, ir_frame_t *out)
{
    if (n < 2 + 32 || n > 2 + 34) return IR_DECODE_NONE;
    if (!HDR_MATCH(d[0], JVC_HDR_MARK) || !HDR_MATCH(d[1], JVC_HDR_SPACE))
        return IR_DECODE_NONE;

    uint64_t v;
    if (!read_pd_bits(d, 2, 16, JVC_BIT_MARK, JVC_SPACE_MID, &v))
        return IR_DECODE_NONE;

    out->protocol = IR_PROTO_JVC;
    out->address  = (uint32_t)(v & 0xFF);
    out->command  = (uint32_t)((v >> 8) & 0xFF);
    out->nbits    = 16;
    out->flags    = 0;
    return IR_DECODE_FRAME;
}

/* ------------------------------------------------------------------------- */
/* Sony SIRC, 12 / 15 / 20-bit                                               */
/* ------------------------------------------------------------------------- */
#define SIRC_HDR_MARK  2400
#define SIRC_SPACE      600
#define SIRC_ZERO_MARK  600
#define SIRC_ONE_MARK  1200
#define SIRC_MARK_MID  ((SIRC_ZERO_MARK + SIRC_ONE_MARK) / 2)

static ir_decode_result_t decode_sony(const uint16_t *d, uint16_t n, ir_frame_t *out)
{
    if (n < 2 + 23) return IR_DECODE_NONE;
    if (!HDR_MATCH(d[0], SIRC_HDR_MARK)) return IR_DECODE_NONE;
    /*
     * Deliberately tighter than BIT_MATCH: Sony's 2400 us header mark falls
     * inside RC6's 2664 us leader window, so this 600 us space is the only
     * thing separating the two protocols. BIT_MATCH would accept RC6's 888 us
     * leader space with just 28 us to spare.
     */
    if (!near_us(d[1], SIRC_SPACE, 20, 50)) return IR_DECODE_NONE;

    /* Each bit is mark+space; the final space may be missing. */
    const int nbits = (n - 1) / 2;
    if (nbits != 12 && nbits != 15 && nbits != 20) return IR_DECODE_NONE;

    uint32_t v = 0;
    for (int i = 0; i < nbits; i++) {
        const uint16_t mark = d[2 + i * 2];
        if (!sane(mark, 300, 2000)) return IR_DECODE_NONE;
        /* The space after the last bit is optional, all others must be there. */
        if (i < nbits - 1) {
            const uint16_t space = d[3 + i * 2];
            if (!BIT_MATCH(space, SIRC_SPACE)) return IR_DECODE_NONE;
        }
        if ((uint32_t)mark > SIRC_MARK_MID) v |= (1u << i);
    }

    /* SIRC sends the 7-bit command first, LSB-first, then the address. */
    out->command = v & 0x7F;
    out->address = v >> 7;
    out->nbits   = (uint8_t)nbits;
    out->flags   = 0;
    out->protocol = (nbits == 12) ? IR_PROTO_SONY12
                  : (nbits == 15) ? IR_PROTO_SONY15
                                  : IR_PROTO_SONY20;
    return IR_DECODE_FRAME;
}

/* ------------------------------------------------------------------------- */
/* Biphase (Manchester) expansion, shared by RC5 and RC6                     */
/* ------------------------------------------------------------------------- */
/*
 * Expands durations into a run of fixed-width level samples, one per protocol
 * time unit. Marks sit at even indices of d[] because capture always starts on
 * a falling edge. Returns the number of samples written, or -1 if any duration
 * is not close enough to a whole number of units (1 to 3 of them -- no
 * biphase code can hold one level for longer than three half-bits).
 */
static int expand_biphase(const uint16_t *d, uint16_t n, uint32_t unit,
                          uint8_t *lv, int max_lv)
{
    int k = 0;
    for (uint16_t i = 0; i < n; i++) {
        const uint32_t units = ((uint32_t)d[i] + unit / 2) / unit;
        if (units < 1 || units > 3) return -1;

        const uint32_t expect = units * unit;
        const uint32_t diff   = (d[i] > expect) ? (uint32_t)d[i] - expect
                                                : expect - (uint32_t)d[i];
        /* Reject anything further than 35% of a unit from a whole multiple. */
        if (diff * 100u > unit * 35u) return -1;

        if (k + (int)units > max_lv) return -1;
        const uint8_t level = ((i & 1) == 0) ? 1 : 0; /* even index = mark */
        for (uint32_t u = 0; u < units; u++) lv[k++] = level;
    }
    return k;
}

/* ------------------------------------------------------------------------- */
/* RC5 and RC5X                                                              */
/* ------------------------------------------------------------------------- */
#define RC5_HALFBIT 889

static ir_decode_result_t decode_rc5(const uint16_t *d, uint16_t n, ir_frame_t *out)
{
    /* 14 bits of 2 half-bits each; fewer than 10 durations cannot be RC5. */
    if (n < 10) return IR_DECODE_NONE;

    uint8_t lv[32];
    /*
     * RC5 encodes a 1 as space-then-mark, and the frame opens with the start
     * bit S1 which is always 1. Its leading space is therefore never
     * transmitted -- the burst begins with S1's mark. lv[0] supplies that
     * missing half-bit so the pairs below line up.
     */
    lv[0] = 0;
    const int got = expand_biphase(d, n, RC5_HALFBIT, lv + 1, (int)sizeof(lv) - 1);
    if (got < 0) return IR_DECODE_NONE;

    int k = got + 1;
    /* A frame ending in a 0 ends on a space, which is not transmitted. */
    if (k == 27) lv[k++] = 0;
    if (k != 28) return IR_DECODE_NONE;

    uint8_t bits[14];
    for (int i = 0; i < 14; i++) {
        const uint8_t a = lv[i * 2], b = lv[i * 2 + 1];
        if (a == 0 && b == 1)      bits[i] = 1;
        else if (a == 1 && b == 0) bits[i] = 0;
        else return IR_DECODE_NONE; /* no mid-bit transition: not biphase */
    }

    if (bits[0] != 1) return IR_DECODE_NONE; /* S1 is always 1 */

    const uint8_t s2     = bits[1];
    const uint8_t toggle = bits[2];

    uint32_t addr = 0, cmd = 0;
    for (int i = 3; i < 8; i++)  addr = (addr << 1) | bits[i]; /* 5 bits, MSB first */
    for (int i = 8; i < 14; i++) cmd  = (cmd  << 1) | bits[i]; /* 6 bits, MSB first */

    /*
     * In classic RC5 the second start bit is 1. Philips later redefined it as
     * the inverted seventh command bit, giving the 7-bit command space known
     * as RC5X; s2 == 0 therefore means "command + 64".
     */
    if (s2) {
        out->protocol = IR_PROTO_RC5;
    } else {
        out->protocol = IR_PROTO_RC5X;
        cmd |= 0x40;
    }
    out->address = addr;
    out->command = cmd;        /* toggle deliberately excluded from identity */
    out->nbits   = 14;
    out->flags   = toggle ? IR_FLAG_TOGGLE : 0;
    return IR_DECODE_FRAME;
}

/* ------------------------------------------------------------------------- */
/* RC6 mode 0 and mode 6 ("RC6-6A", Windows Media Center remotes)            */
/* ------------------------------------------------------------------------- */
#define RC6_UNIT        444
#define RC6_LEADER_MARK (6 * RC6_UNIT) /* 2664 */
#define RC6_LEADER_SPC  (2 * RC6_UNIT) /* 888  */

static ir_decode_result_t decode_rc6(const uint16_t *d, uint16_t n, ir_frame_t *out)
{
    if (n < 6) return IR_DECODE_NONE;
    if (!HDR_MATCH(d[0], RC6_LEADER_MARK)) return IR_DECODE_NONE;
    /*
     * Tighter than HDR_MATCH, and for the same reason as in decode_sony():
     * the leader mark windows of RC6 and Sony SIRC overlap, so this space is
     * the real discriminator. HDR_MATCH would admit Sony's 600 us space.
     */
    if (!near_us(d[1], RC6_LEADER_SPC, 15, 60)) return IR_DECODE_NONE;

    /*
     * Sample the rest at one sample per time unit. d[2] is a mark, and since
     * expand_biphase() decides polarity from index parity, passing d + 2
     * keeps even/odd aligned correctly.
     */
    uint8_t lv[96];
    int k = expand_biphase(d + 2, (uint16_t)(n - 2), RC6_UNIT, lv, (int)sizeof(lv));
    if (k < 0) return IR_DECODE_NONE;

    /* start bit (2) + 3 mode bits (6) + double-width trailer (4) = 12 */
    if (k < 12) return IR_DECODE_NONE;

    /* RC6 encodes 1 as mark-then-space, so a trailing 1 loses its space. */
    if (((k - 12) & 1) && k < (int)sizeof(lv)) lv[k++] = 0;

    if (lv[0] != 1 || lv[1] != 0) return IR_DECODE_NONE; /* start bit must be 1 */

    uint32_t mode = 0;
    for (int i = 0; i < 3; i++) {
        const uint8_t a = lv[2 + i * 2], b = lv[3 + i * 2];
        if (a == 1 && b == 0)      mode = (mode << 1) | 1u;
        else if (a == 0 && b == 1) mode = (mode << 1);
        else return IR_DECODE_NONE;
    }

    /* The trailer bit is twice as wide, so each half spans two samples. */
    if (lv[8] != lv[9] || lv[10] != lv[11]) return IR_DECODE_NONE;
    uint8_t trailer;
    if (lv[8] == 1 && lv[10] == 0)      trailer = 1;
    else if (lv[8] == 0 && lv[10] == 1) trailer = 0;
    else return IR_DECODE_NONE;

    int nbits = (k - 12) / 2;
    nbits -= nbits % 8;                 /* payloads are whole bytes */
    if (nbits != 8 && nbits != 16 && nbits != 24 && nbits != 32)
        return IR_DECODE_NONE;

    uint64_t payload = 0;
    for (int i = 0; i < nbits; i++) {
        const uint8_t a = lv[12 + i * 2], b = lv[13 + i * 2];
        if (a == 1 && b == 0)      payload = (payload << 1) | 1u;
        else if (a == 0 && b == 1) payload = (payload << 1);
        else return IR_DECODE_NONE;     /* RC6 is MSB-first */
    }

    uint32_t addr    = (uint32_t)((payload >> 8) & 0xFFFFFFu);
    const uint32_t cmd = (uint32_t)(payload & 0xFFu);
    uint8_t flags    = trailer ? IR_FLAG_TOGGLE : 0;

    if (mode == 0) {
        if (nbits != 16) return IR_DECODE_NONE; /* mode 0 is 8 + 8 */
        out->protocol = IR_PROTO_RC6_0;
    } else if (mode == 6) {
        out->protocol = IR_PROTO_RC6_6A;
        /*
         * On a 32-bit mode-6 payload (what Media Center remotes send) the
         * toggle is payload bit 15 rather than the trailer, which puts it at
         * bit 7 of the address field above. Strip it there, or every other
         * press of a button would produce a different identity.
         *
         * If some remote turns out to place it elsewhere, the configurator
         * notices one button producing two codes and offers a toggle rule for
         * the protocol -- no firmware change needed.
         */
        if (nbits == 32) {
            if (addr & 0x80u) flags |= IR_FLAG_TOGGLE;
            addr &= ~0x80u;
        }
    } else {
        return IR_DECODE_NONE; /* other modes fall through to the raw hash */
    }

    out->address = addr;
    out->command = cmd;
    out->nbits   = (uint8_t)nbits;
    out->flags   = flags;
    return IR_DECODE_FRAME;
}

/* ------------------------------------------------------------------------- */
/* Raw timing hash                                                           */
/* ------------------------------------------------------------------------- */
uint32_t ir_raw_hash(const uint16_t *d, uint16_t n)
{
    if (n < IR_MIN_HASH_DURATIONS) return 0;

    /*
     * Every IR protocol builds its symbols from whole multiples of a single
     * time unit, because they all come out of one clock. So the frame is
     * described by expressing each duration as a multiple of the shortest
     * symbol in it, and hashing those multiples.
     *
     * That is scale-invariant -- a remote whose crystal runs 10% fast scales
     * the unit by the same 10% and produces identical multiples -- while
     * still preserving how long each symbol is relative to the others.
     *
     * An earlier version compared each duration only with its neighbour,
     * recording merely "longer", "shorter" or "similar". That discards too
     * much: a protocol using a 400 us mark with 900 us and 1500 us spaces
     * reduced to the same hash either way, because both spaces are simply
     * "longer" than the mark, so two different buttons collided.
     *
     * The final duration is excluded. Whether a trailing symbol gets captured
     * at all depends on the last bit's polarity, so including it would make
     * the hash depend on where the frame happened to stop.
     */
    uint32_t unit = 0xFFFFFFFFu;
    for (uint16_t i = 0; i + 1 < n; i++)
        if (d[i] && (uint32_t)d[i] < unit) unit = d[i];

    /* Keeps a stray short spike from scaling the whole frame into clamps. */
    if (unit < 100u) unit = 100u;

    uint32_t h = 2166136261u;
    for (uint16_t i = 0; i + 1 < n; i++) {
        uint32_t q = ((uint32_t)d[i] * 2u + unit) / (2u * unit); /* round() */
        if (q < 1u)  q = 1u;
        if (q > 15u) q = 15u;
        h = (h ^ (uint8_t)q) * 16777619u;
    }

    /* 0 means "no hash", so never return it as a real value. */
    return h ? h : 1u;
}

/* ------------------------------------------------------------------------- */
/* Entry point                                                               */
/* ------------------------------------------------------------------------- */
ir_decode_result_t ir_decode(const uint16_t *us, uint16_t n, ir_frame_t *out)
{
    out->protocol = IR_PROTO_NONE;
    out->address  = 0;
    out->command  = 0;
    out->flags    = 0;
    out->nbits    = 0;

    if (n < IR_MIN_DURATIONS) return IR_DECODE_NONE;

    /*
     * Order matters where headers overlap within tolerance. NEC is tried
     * before JVC (both have a ~9 ms/4.5 ms header, separated here by frame
     * length), and RC6 before Sony (RC6's 2664 us leader falls inside Sony's
     * 2400 us header window, and is rejected only by the leader space).
     */
    ir_decode_result_t r;
    if ((r = decode_nec(us, n, out))      != IR_DECODE_NONE) return r;
    if ((r = decode_samsung(us, n, out))  != IR_DECODE_NONE) return r;
    if ((r = decode_kaseikyo(us, n, out)) != IR_DECODE_NONE) return r;
    if ((r = decode_jvc(us, n, out))      != IR_DECODE_NONE) return r;
    if ((r = decode_rc6(us, n, out))      != IR_DECODE_NONE) return r;
    if ((r = decode_sony(us, n, out))     != IR_DECODE_NONE) return r;
    if ((r = decode_rc5(us, n, out))      != IR_DECODE_NONE) return r;

    /* Unknown but plausible transmission: identify it by its timing pattern. */
    out->protocol = IR_PROTO_RAW_HASH;
    out->address  = 0;
    out->command  = ir_raw_hash(us, n);
    out->nbits    = 0;
    out->flags    = 0;
    return (out->command != 0) ? IR_DECODE_FRAME : IR_DECODE_NONE;
}

uint32_t ir_decode_protocols_mask(void)
{
    return (1u << IR_PROTO_NEC)       | (1u << IR_PROTO_NEC_EXT)
         | (1u << IR_PROTO_RC5)       | (1u << IR_PROTO_RC5X)
         | (1u << IR_PROTO_RC6_0)     | (1u << IR_PROTO_RC6_6A)
         | (1u << IR_PROTO_SONY12)    | (1u << IR_PROTO_SONY15)
         | (1u << IR_PROTO_SONY20)    | (1u << IR_PROTO_SAMSUNG32)
         | (1u << IR_PROTO_KASEIKYO)  | (1u << IR_PROTO_JVC);
}
