/*
 * ir_protocol.h — IR protocol identifiers and the 64-bit "button identity" key.
 *
 * This header is the single source of truth shared by:
 *   - the RP2040 firmware (decoder + keymap lookup),
 *   - the host-side decoder unit tests,
 *   - the desktop configurator (mirrored in app/src/shared/irProtocol.ts,
 *     kept honest by tools/db-build/check-protocol-sync.mjs).
 *
 * It deliberately depends on nothing but <stdint.h> so it can be compiled for
 * the host as-is.
 */
#ifndef IR_PROTOCOL_H
#define IR_PROTOCOL_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ------------------------------------------------------------------------- */
/* Protocol identifiers                                                      */
/* ------------------------------------------------------------------------- */
/*
 * Stable on-the-wire values: they are stored inside saved bindings in flash
 * and inside user profile files on the PC. NEVER renumber an existing entry;
 * only append.
 */
typedef enum {
    IR_PROTO_NONE      = 0,

    IR_PROTO_NEC       = 1,  /* 32-bit, 8-bit address verified against ~address */
    IR_PROTO_NEC_EXT   = 2,  /* 32-bit, 16-bit address (address check fails)    */
    IR_PROTO_RC5       = 3,  /* 14-bit biphase, 6-bit command                   */
    IR_PROTO_RC5X      = 4,  /* RC5 with S2 used as command bit 6 (7-bit cmd)   */
    IR_PROTO_RC6_0     = 5,  /* RC6 mode 0: 8-bit control + 8-bit information   */
    IR_PROTO_RC6_6A    = 6,  /* RC6 mode 6 "6A": Windows MCE / Media Center     */
    IR_PROTO_SONY12    = 7,  /* SIRC 12-bit: 7-bit cmd + 5-bit addr             */
    IR_PROTO_SONY15    = 8,  /* SIRC 15-bit: 7-bit cmd + 8-bit addr             */
    IR_PROTO_SONY20    = 9,  /* SIRC 20-bit: 7-bit cmd + 13-bit addr            */
    IR_PROTO_SAMSUNG32 = 10, /* 4.5ms/4.5ms header, 16-bit addr + cmd/~cmd      */
    IR_PROTO_KASEIKYO  = 11, /* 48-bit Panasonic/Kaseikyo                       */
    IR_PROTO_JVC       = 12, /* 16-bit, 8-bit addr + 8-bit cmd                  */
    IR_PROTO_SHARP     = 13, /* 15-bit, 5-bit addr + 8-bit cmd + expansion/chk  */
    IR_PROTO_DENON     = 14, /* 15-bit, 5-bit addr + 8-bit cmd + 2-bit frame    */
    IR_PROTO_RCA       = 15, /* 24-bit, 4-bit addr + 8-bit cmd + inverses       */

    /*
     * Fallback: an unrecognised but self-consistent burst, identified by a
     * tolerance-bucketed hash of its mark/space pattern (see ir_raw_hash()).
     * This is what makes the receiver genuinely universal: a remote whose
     * protocol we do not model can still be learned and mapped reliably.
     */
    IR_PROTO_RAW_HASH  = 255
} ir_protocol_t;

#define IR_PROTO_COUNT_MODELLED 15

/* Human-readable, stable short names (also used as JSON keys on the host). */
const char *ir_protocol_name(ir_protocol_t p);

/* ------------------------------------------------------------------------- */
/* Decode result                                                             */
/* ------------------------------------------------------------------------- */

/* Flags on a decoded frame. */
#define IR_FLAG_REPEAT     (1u << 0) /* NEC/NEC-ext ditto frame, or held key  */
#define IR_FLAG_TOGGLE     (1u << 1) /* protocol toggle bit was set in frame  */
#define IR_FLAG_AUTOREPEAT (1u << 2) /* synthesised by the firmware's repeater*/

typedef struct {
    ir_protocol_t protocol;
    uint32_t      address;  /* device / customer code, protocol dependent */
    uint32_t      command;  /* function code                              */
    uint8_t       flags;    /* IR_FLAG_*                                  */
    uint8_t       nbits;    /* payload bits actually decoded              */
} ir_frame_t;

/* ------------------------------------------------------------------------- */
/* Button identity key                                                       */
/* ------------------------------------------------------------------------- */
/*
 * A button is identified by protocol + address + command, packed into one
 * 64-bit value so lookup is a flat scan of 8-byte comparisons:
 *
 *   bits 63..56  protocol id        (8 bits)
 *   bits 55..32  address            (24 bits, truncated)
 *   bits 31..0   command            (32 bits)
 *
 * Toggle/parity bits that change between presses of the SAME button must be
 * cleared before the key is built, otherwise one button yields two keys.
 * ir_key_normalise() does that using a per-protocol mask plus an optional
 * user-supplied extra mask (see IR_TOGGLE_MASK_* and keymap settings).
 */
#define IR_KEY(proto, addr, cmd)                                   \
    ((((uint64_t)(uint8_t)(proto)) << 56) |                        \
     (((uint64_t)((addr) & 0x00FFFFFFu)) << 32) |                  \
     ((uint64_t)(uint32_t)(cmd)))

#define IR_KEY_PROTO(k)   ((ir_protocol_t)(uint8_t)((k) >> 56))
#define IR_KEY_ADDRESS(k) ((uint32_t)(((k) >> 32) & 0x00FFFFFFu))
#define IR_KEY_COMMAND(k) ((uint32_t)((k) & 0xFFFFFFFFu))
#define IR_KEY_NONE       ((uint64_t)0)

/*
 * Build the normalised identity key for a decoded frame.
 *
 * extra_cmd_mask: additional command bits to clear, discovered by the
 * configurator when "learn" sees one physical button produce two alternating
 * codes (classic RC6-6A / Denon / Sharp toggle behaviour). 0 = none.
 */
uint64_t ir_frame_key(const ir_frame_t *f, uint32_t extra_cmd_mask);

/*
 * Per-protocol mask of command bits that are known to alternate between
 * presses of the same button, and so must not take part in identity.
 */
uint32_t ir_protocol_toggle_mask(ir_protocol_t p);

#ifdef __cplusplus
}
#endif
#endif /* IR_PROTOCOL_H */
