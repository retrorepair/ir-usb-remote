/*
 * ir_capture.h - edge-timing capture from the IR demodulator.
 *
 * A GPIO interrupt timestamps every edge on IR_GPIO and records the duration
 * of each mark and space. A burst ends when the line has been idle for
 * IR_FRAME_GAP_US. Two buffers are used so the decoder can work on a complete
 * burst while the next one is still arriving.
 */
#ifndef IR_CAPTURE_H
#define IR_CAPTURE_H

#include <stdint.h>
#include <stdbool.h>
#include "board_config.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    uint16_t us[IR_MAX_DURATIONS]; /* alternating mark, space, mark, ...   */
    uint16_t count;
    bool     overrun;              /* burst was longer than the buffer     */
} ir_burst_t;

/* Install the GPIO interrupt handler. Call once at start-up. */
void ir_capture_init(void);

/*
 * Finalise a burst whose trailing gap has now elapsed. Call frequently from
 * the main loop; it is cheap when nothing is pending.
 */
void ir_capture_poll(void);

/*
 * Returns a completed burst, or NULL if none is pending. The returned pointer
 * stays valid until the next ir_capture_release() call.
 */
const ir_burst_t *ir_capture_take(void);

/* Hand the buffer back so it can be reused. */
void ir_capture_release(void);

/* Count of bursts that completed while an earlier one was still unread. */
uint32_t ir_capture_dropped(void);

#ifdef __cplusplus
}
#endif
#endif /* IR_CAPTURE_H */
