/*
 * ir_capture.c - GPIO edge timing capture.
 *
 * The receiver's output is timestamped on both edges and the gap between
 * edges recorded, giving the alternating mark/space durations the decoders
 * expect. There is no PIO program here on purpose: an IR frame contains at
 * most a couple of hundred edges spread over 70 ms, which a Cortex-M0+ at
 * 125 MHz handles with four orders of magnitude to spare, and an interrupt
 * handler is far easier to reason about than a state machine.
 */
#include "ir_capture.h"
#include "hardware/gpio.h"
#include "hardware/sync.h"
#include "pico/time.h"

static ir_burst_t       s_buf[2];
static volatile uint8_t s_cap = 0;     /* buffer the interrupt writes into   */
static volatile bool    s_ready = false;/* s_buf[s_cap ^ 1] holds a frame    */
static volatile bool    s_in_burst = false;
static volatile uint32_t s_last_edge_us = 0;
static volatile uint32_t s_dropped = 0;

static inline void start_burst(uint32_t now)
{
    s_in_burst = true;
    s_buf[s_cap].count = 0;
    s_buf[s_cap].overrun = false;
    s_last_edge_us = now;
}

/*
 * Publish the burst the interrupt has been filling. Must be called with
 * interrupts disabled, or from the interrupt handler itself.
 *
 * If the previous burst has not been collected yet, the NEW one is discarded
 * rather than overwriting it. That ordering matters: it means the buffer the
 * main loop is reading is never also the buffer the interrupt writes to, so
 * no lock is needed on the read side.
 */
static void publish_burst(void)
{
    ir_burst_t *b = &s_buf[s_cap];

    if (b->count < IR_MIN_DURATIONS) { /* noise spike, not a transmission */
        b->count = 0;
        b->overrun = false;
        return;
    }
    if (s_ready) {
        s_dropped++;
        b->count = 0;
        b->overrun = false;
        return;
    }
    s_cap ^= 1;
    s_buf[s_cap].count = 0;
    s_buf[s_cap].overrun = false;
    s_ready = true;
}

static void ir_gpio_isr(uint gpio, uint32_t events)
{
    const uint32_t now = time_us_32();
    if (gpio != IR_GPIO) return;

    if (!s_in_burst) {
        /* The line idles high; a mark begins on the falling edge. */
        if (events & GPIO_IRQ_EDGE_FALL) start_burst(now);
        return;
    }

    const uint32_t delta = now - s_last_edge_us;
    s_last_edge_us = now;

    /*
     * A gap this long cannot occur inside a frame (the longest intra-frame
     * space modelled is NEC's 4.5 ms header), so this edge belongs to the
     * next transmission. Close the current burst and begin again.
     */
    if (delta > IR_FRAME_GAP_US) {
        publish_burst();
        if (events & GPIO_IRQ_EDGE_FALL) start_burst(now);
        else                             s_in_burst = false;
        return;
    }

    ir_burst_t *b = &s_buf[s_cap];
    if (b->count < IR_MAX_DURATIONS)
        b->us[b->count++] = (delta > 0xFFFFu) ? 0xFFFFu : (uint16_t)delta;
    else
        b->overrun = true;
}

void ir_capture_init(void)
{
    gpio_init(IR_GPIO);
    gpio_set_dir(IR_GPIO, GPIO_IN);
    /*
     * Receivers of this family have an active pull-up built in, but enabling
     * the internal one too costs nothing and keeps the input defined if the
     * module is unplugged -- otherwise a floating pin generates a continuous
     * stream of phantom edges.
     */
    gpio_pull_up(IR_GPIO);
    gpio_set_irq_enabled_with_callback(IR_GPIO,
                                       GPIO_IRQ_EDGE_FALL | GPIO_IRQ_EDGE_RISE,
                                       true, &ir_gpio_isr);
}

/*
 * Without this, a burst would only be closed when the NEXT transmission
 * arrived, so a single button press would appear to do nothing until the user
 * pressed something else.
 */
void ir_capture_poll(void)
{
    if (!s_in_burst) return;
    if (time_us_32() - s_last_edge_us <= IR_FRAME_GAP_US) return;

    const uint32_t save = save_and_disable_interrupts();
    if (s_in_burst && (time_us_32() - s_last_edge_us) > IR_FRAME_GAP_US) {
        publish_burst();
        s_in_burst = false;
    }
    restore_interrupts(save);
}

const ir_burst_t *ir_capture_take(void)
{
    if (!s_ready) return NULL;
    return &s_buf[s_cap ^ 1];
}

void ir_capture_release(void)
{
    s_ready = false;
}

uint32_t ir_capture_dropped(void)
{
    return s_dropped;
}
