/*
 * keymap.h - turning decoded frames into host input.
 *
 * This is where "button held down" is interpreted, which is most of what
 * separates a receiver that feels right from one that does not.
 */
#ifndef KEYMAP_H
#define KEYMAP_H

#include <stdint.h>
#include <stdbool.h>
#include "ir_protocol.h"
#include "storage.h"

#ifdef __cplusplus
extern "C" {
#endif

/* The engine works directly on the live RAM config, so edits from the
 * configurator take effect on the next button press without a commit. */
void keymap_init(ir_config_t *cfg);

/*
 * Whether to actually emit HID. False in learn mode, so a user pressing
 * remote buttons to configure them cannot type into the configurator.
 * Switching to false releases anything currently held.
 */
void keymap_set_emit(bool emit);

/*
 * Feed a decoded frame. Returns the index of the binding that matched, or -1.
 * Call for genuine frames and for protocol repeat frames alike; pass the
 * previous frame again for the latter, with IR_FLAG_REPEAT set.
 */
int keymap_handle_frame(const ir_frame_t *f);

/* Release timeouts and consumer-key ramping. Call every main loop pass. */
void keymap_tick(void);

/* Normalised identity of the most recent frame, for the host's live monitor. */
uint64_t keymap_last_key(void);
uint16_t keymap_repeat_count(void);

#ifdef __cplusplus
}
#endif
#endif /* KEYMAP_H */
