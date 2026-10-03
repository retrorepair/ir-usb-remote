/*
 * hid_out.h - emitting keystrokes and media keys to the host.
 *
 * Reports cannot be sent at an arbitrary moment: the host polls the interrupt
 * endpoint, so a report can only go out when TinyUSB says the endpoint is
 * free. Everything here is therefore queued and drained by hid_out_task().
 * Without that queue a tap (press immediately followed by release) would lose
 * one of its two reports.
 */
#ifndef HID_OUT_H
#define HID_OUT_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

void hid_out_init(void);

/* Send at most one queued report. Call from the main loop. */
void hid_out_task(void);

/*
 * Hold a key down until hid_out_key_release(). Holding is how auto-repeat
 * works for keyboard actions: the host applies the user's own repeat delay
 * and rate, which is both free and more correct than inventing our own.
 */
void hid_out_key_hold(uint8_t mods, uint8_t usage);
void hid_out_key_release(void);

/* Press and release in one go, for actions that must not repeat. */
void hid_out_key_tap(uint8_t mods, uint8_t usage);

/*
 * Consumer and system usages are tapped rather than held: hosts do not apply
 * key repeat to them, so a held volume button is ramped by re-tapping from
 * keymap_tick() instead.
 */
void hid_out_consumer_tap(uint16_t usage);
void hid_out_system_tap(uint16_t usage);

/* Drop everything pending and release any held key (used when going idle). */
void hid_out_reset(void);

/* Total reports delivered, for the diagnostics panel. */
uint32_t hid_out_sent(void);

#ifdef __cplusplus
}
#endif
#endif /* HID_OUT_H */
