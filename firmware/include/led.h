/*
 * led.h - status LED.
 *
 * Compiles to nothing when the board has no usable LED pin (a Pico W drives
 * its LED from the wireless chip, not a GPIO).
 */
#ifndef LED_H
#define LED_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

void led_init(void);
void led_task(void);

/* Brief flash to acknowledge a received frame. */
void led_blink(void);

/* Rapid flashing for a fixed period, so the user can tell units apart. */
void led_identify(uint32_t ms);

/* 0 off, 1 blink on receive, 2 always on. Mirrors wire_settings_t.led_mode. */
void led_set_mode(uint8_t mode);

#ifdef __cplusplus
}
#endif
#endif /* LED_H */
