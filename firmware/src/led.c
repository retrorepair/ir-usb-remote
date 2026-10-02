/*
 * led.c - status LED driver.
 */
#include "led.h"
#include "board_config.h"

#if IR_LED_GPIO >= 0

#include "hardware/gpio.h"
#include "pico/time.h"

#define BLINK_MS    40
#define IDENTIFY_HZ 8

static uint8_t  s_mode = 1;
static uint32_t s_blink_until;
static uint32_t s_identify_until;

static inline uint32_t now_ms(void)
{
    return to_ms_since_boot(get_absolute_time());
}

void led_init(void)
{
    gpio_init(IR_LED_GPIO);
    gpio_set_dir(IR_LED_GPIO, GPIO_OUT);
    gpio_put(IR_LED_GPIO, 0);
}

void led_set_mode(uint8_t mode) { s_mode = mode; }

void led_blink(void)
{
    s_blink_until = now_ms() + BLINK_MS;
}

void led_identify(uint32_t ms)
{
    s_identify_until = now_ms() + ms;
}

void led_task(void)
{
    const uint32_t now = now_ms();
    bool on;

    if ((int32_t)(s_identify_until - now) > 0) {
        /* Identify overrides the mode, including "off". */
        on = ((now / (1000 / (2 * IDENTIFY_HZ))) & 1u) != 0;
    } else if (s_mode == 2) {
        on = true;
    } else if (s_mode == 1) {
        on = (int32_t)(s_blink_until - now) > 0;
    } else {
        on = false;
    }

    gpio_put(IR_LED_GPIO, on);
}

#else /* no LED pin on this board */

void led_init(void) {}
void led_task(void) {}
void led_blink(void) {}
void led_identify(uint32_t ms) { (void)ms; }
void led_set_mode(uint8_t mode) { (void)mode; }

#endif
