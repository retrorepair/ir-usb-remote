/*
 * ir_decode.h - turn a captured mark/space burst into a button identity.
 *
 * The decoders are deliberately free of any SDK dependency: they are pure
 * functions over an array of microsecond durations. That is what lets
 * firmware/test/test_decode.c compile and run them on the build machine and
 * assert real protocol waveforms decode to the right values, rather than the
 * correctness of the decoders resting on manual testing with a remote.
 */
#ifndef IR_DECODE_H
#define IR_DECODE_H

#include <stdint.h>
#include <stdbool.h>
#include "ir_protocol.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    /* Burst was too short, or malformed in a way no decoder accepted. */
    IR_DECODE_NONE   = 0,
    /* out is filled in with a complete frame. */
    IR_DECODE_FRAME  = 1,
    /*
     * A protocol-level "same again" frame that carries no payload of its own
     * (the NEC/Samsung ditto frame). The caller must substitute the previously
     * decoded frame; the decoder has nothing to report but the fact of it.
     */
    IR_DECODE_REPEAT = 2
} ir_decode_result_t;

/*
 * Decode a burst.
 *
 * Tries each modelled protocol in turn. A burst that no decoder claims but
 * which is long enough to be a real transmission is reported as
 * IR_PROTO_RAW_HASH with command set to a timing hash, so that unknown
 * protocols remain learnable and mappable.
 */
ir_decode_result_t ir_decode(const uint16_t *us, uint16_t n, ir_frame_t *out);

/*
 * Timing-pattern hash used for IR_PROTO_RAW_HASH.
 *
 * Only the ordering relationship between adjacent durations is hashed, never
 * their absolute lengths, so the same button yields the same hash despite the
 * clock tolerance of cheap remotes and the latency of the demodulator.
 */
uint32_t ir_raw_hash(const uint16_t *us, uint16_t n);

/* Bitmask of ir_protocol_t ids this build can decode (for CMD_GET_INFO). */
uint32_t ir_decode_protocols_mask(void);

#ifdef __cplusplus
}
#endif
#endif /* IR_DECODE_H */
