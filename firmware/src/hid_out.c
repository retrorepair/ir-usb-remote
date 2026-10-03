/*
 * hid_out.c - queued HID report delivery.
 */
#include <string.h>
#include "hid_out.h"
#include "usb_descriptors.h"
#include "wire_protocol.h"
#include "tusb.h"
#include "pico/time.h"

typedef enum {
    HQ_KEYBOARD,
    HQ_CONSUMER,
    HQ_SYSTEM
} hq_kind_t;

typedef struct {
    hq_kind_t kind;
    uint8_t   mods;
    uint16_t  code; /* keyboard usage, consumer usage, or system usage; 0 = release */
} hq_item_t;

/*
 * 32 entries. A burst of IR frames arriving faster than the host polls can
 * queue two reports each (press and release); 32 is several frames' worth,
 * and anything beyond that is a stuck remote rather than a backlog worth
 * preserving.
 */
#define HQ_LEN 32

static hq_item_t s_q[HQ_LEN];
static uint8_t   s_head, s_tail;
static uint32_t  s_sent;

/*
 * Nothing is sent before this time. Set after every report so a tapped key
 * stays down for a realistic interval instead of the single USB poll it would
 * otherwise last. See hid_out.h for why that matters.
 */
static uint32_t s_gate_until;
static uint16_t s_min_press_ms = MIN_PRESS_MS_DEFAULT;

/* Minimum quiet time after a release, so two quick taps stay distinguishable. */
#define HID_MIN_GAP_MS 20u

static inline uint32_t now_ms(void)
{
    return to_ms_since_boot(get_absolute_time());
}

/* Mirrors what the host currently believes is pressed. */
static uint8_t s_cur_mods, s_cur_key;

static inline bool q_empty(void) { return s_head == s_tail; }

static void q_push(hq_kind_t kind, uint8_t mods, uint16_t code)
{
    const uint8_t next = (uint8_t)((s_head + 1u) % HQ_LEN);
    if (next == s_tail) return; /* full: drop, see note above */
    s_q[s_head].kind = kind;
    s_q[s_head].mods = mods;
    s_q[s_head].code = code;
    s_head = next;
}

void hid_out_init(void)
{
    s_head = s_tail = 0;
    s_sent = 0;
    s_cur_mods = s_cur_key = 0;
    s_gate_until = 0;
}

void hid_out_set_min_press(uint16_t ms)
{
    if (ms == 0) ms = MIN_PRESS_MS_DEFAULT;
    if (ms < MIN_PRESS_MS_FLOOR) ms = MIN_PRESS_MS_FLOOR;
    if (ms > MIN_PRESS_MS_CEILING) ms = MIN_PRESS_MS_CEILING;
    s_min_press_ms = ms;
}

bool hid_out_idle(void)
{
    return q_empty() && (int32_t)(now_ms() - s_gate_until) >= 0;
}

void hid_out_key_hold(uint8_t mods, uint8_t usage)
{
    q_push(HQ_KEYBOARD, mods, usage);
}

void hid_out_key_release(void)
{
    q_push(HQ_KEYBOARD, 0, 0);
}

void hid_out_key_tap(uint8_t mods, uint8_t usage)
{
    q_push(HQ_KEYBOARD, mods, usage);
    q_push(HQ_KEYBOARD, 0, 0);
}

void hid_out_consumer_tap(uint16_t usage)
{
    q_push(HQ_CONSUMER, 0, usage);
    q_push(HQ_CONSUMER, 0, 0);
}

void hid_out_system_tap(uint16_t usage)
{
    q_push(HQ_SYSTEM, 0, usage);
    q_push(HQ_SYSTEM, 0, 0);
}

void hid_out_reset(void)
{
    s_head = s_tail = 0;
    s_gate_until = 0;
    if (s_cur_key || s_cur_mods) q_push(HQ_KEYBOARD, 0, 0);
}

uint32_t hid_out_sent(void) { return s_sent; }

static uint8_t system_usage_to_bit(uint16_t usage)
{
    switch (usage) {
    case SYSTEM_USAGE_POWER_DOWN: return 1u << 0;
    case SYSTEM_USAGE_SLEEP:      return 1u << 1;
    case SYSTEM_USAGE_WAKE_UP:    return 1u << 2;
    default:                      return 0;
    }
}

void hid_out_task(void)
{
    if (q_empty()) return;
    if (!tud_mounted()) { /* nothing can be delivered; discard */
        s_head = s_tail = 0;
        return;
    }

    /* Hold the current report for its minimum duration before moving on. */
    const uint32_t now = now_ms();
    if ((int32_t)(now - s_gate_until) < 0) return;

    const hq_item_t *it = &s_q[s_tail];

    switch (it->kind) {
    case HQ_KEYBOARD: {
        if (!tud_hid_n_ready(HID_ITF_KEYBOARD)) return;
        uint8_t keys[6] = {0};
        if (it->code) keys[0] = (uint8_t)it->code;
        if (!tud_hid_n_keyboard_report(HID_ITF_KEYBOARD, 0, it->mods, keys))
            return; /* endpoint claimed between the check and here; retry */
        s_cur_mods = it->mods;
        s_cur_key  = (uint8_t)it->code;
        break;
    }
    case HQ_CONSUMER: {
        if (!tud_hid_n_ready(HID_ITF_CONTROL)) return;
        const uint16_t usage = it->code;
        if (!tud_hid_n_report(HID_ITF_CONTROL, REPORT_ID_CONSUMER, &usage, 2))
            return;
        break;
    }
    case HQ_SYSTEM: {
        if (!tud_hid_n_ready(HID_ITF_CONTROL)) return;
        const uint8_t bits = system_usage_to_bit(it->code);
        if (!tud_hid_n_report(HID_ITF_CONTROL, REPORT_ID_SYSTEM, &bits, 1))
            return;
        break;
    }
    }

    /*
     * A report that presses something must stay in effect for the minimum
     * press time; a release only needs a short gap so the next tap is seen
     * as a separate press.
     */
    s_gate_until = now + ((it->code || it->mods) ? s_min_press_ms : HID_MIN_GAP_MS);

    s_tail = (uint8_t)((s_tail + 1u) % HQ_LEN);
    s_sent++;
}
