/*
 * keymap.c - binding lookup, and the behaviour of a pressed button.
 *
 * ONE TAP PER PRESS, AND WE OWN THE REPEAT.
 *
 * An earlier version held the key down for as long as frames kept arriving
 * and let the host auto-repeat it. That felt mushy, for two reasons that are
 * really the same reason:
 *
 *   - A single tap holds the key for the frame duration plus the release
 *     timeout, around 320 ms. A typical host repeat delay is 250 ms, so one
 *     tap crossed it and the host started firing at up to 30 per second.
 *   - Two taps closer together than the release timeout merged into one long
 *     hold, so the second press produced no keystroke at all.
 *
 * Worse, the feel depended entirely on the user's own keyboard repeat
 * settings, which we neither control nor can see.
 *
 * So a press now emits exactly one discrete keystroke, and repeating while
 * held is generated here, at a rate this firmware decides. Keyboard, consumer
 * and system actions all behave the same way. BIND_HOLD remains for the cases
 * that genuinely want a key held down, such as a direction in an emulator.
 *
 * DETECTING A NEW PRESS
 *
 * Timing alone cannot tell a fast double-tap from a held button, but the
 * protocols already carry the answer and the old code ignored it:
 *
 *   NEC         sends one full frame, then "ditto" frames every 110 ms while
 *               held. A full frame after a ditto is therefore a new press.
 *   RC5 / RC6   repeat the whole frame every ~114 ms with the toggle bit
 *               UNCHANGED. The toggle flipping is the protocol explicitly
 *               saying "this is a new press".
 *   Sony etc.   resend the identical frame every 45 ms with no marker, so
 *               there is nothing to do but time it.
 */
#include "keymap.h"
#include "hid_out.h"
#include "wire_protocol.h"
#include "pico/time.h"

static ir_config_t *s_cfg;
static bool     s_emit = true;

static uint64_t s_active_key  = IR_KEY_NONE;
static int      s_active      = -1;
static uint32_t s_last_ms     = 0;    /* arrival of the most recent frame   */
static uint32_t s_interval_ms = 0;    /* measured gap between held frames   */
static uint8_t  s_last_toggle = 0;
static bool     s_seen_ditto  = false;/* this remote uses ditto repeats     */
static uint16_t s_repeats     = 0;
static bool     s_key_held    = false;/* a BIND_HOLD key is currently down  */
static bool     s_suppress    = false;/* no repeating for this press        */
static uint32_t s_next_tap_ms = 0;

static inline uint32_t now_ms(void)
{
    return to_ms_since_boot(get_absolute_time());
}

void keymap_init(ir_config_t *cfg)
{
    s_cfg = cfg;
    s_emit = true;
    s_active_key = IR_KEY_NONE;
    s_active = -1;
    s_key_held = false;
    s_suppress = false;
    s_repeats = 0;
    s_interval_ms = 0;
    s_seen_ditto = false;
}

/* Extra toggle mask the configurator discovered for this protocol, if any. */
static uint32_t extra_mask_for(ir_protocol_t p)
{
    for (int i = 0; i < CFG_MAX_TOGGLE_RULES; i++) {
        const wire_toggle_rule_t *r = &s_cfg->settings.toggle_rules[i];
        if (r->cmd_mask && r->protocol == (uint8_t)p) return r->cmd_mask;
    }
    return 0;
}

static int find_binding(uint64_t key)
{
    if (key == IR_KEY_NONE) return -1;
    const uint16_t n = s_cfg->binding_count;
    for (uint16_t i = 0; i < n; i++)
        if (s_cfg->bindings[i].key == key) return (int)i;
    return -1;
}

static bool protocol_has_toggle(ir_protocol_t p)
{
    return p == IR_PROTO_RC5 || p == IR_PROTO_RC5X ||
           p == IR_PROTO_RC6_0 || p == IR_PROTO_RC6_6A;
}

/*
 * How long after the last frame the button is considered released.
 *
 * Derived from the interval this remote is actually using rather than a fixed
 * timeout sized for the slowest protocol: a Sony remote repeating every 45 ms
 * should not need the 250 ms a NEC remote does. 2.2x tolerates one dropped
 * frame without a spurious release. The configured value is the ceiling, so
 * raising it still helps a remote with poor reception.
 */
static uint32_t release_threshold_ms(void)
{
    const uint32_t configured = s_cfg->settings.release_timeout_ms;
    if (!s_interval_ms) return configured;

    uint32_t t = s_interval_ms * 2u + s_interval_ms / 5u;
    if (t < 60u) t = 60u;
    if (t > configured) t = configured;
    return t;
}

/*
 * Repeating stops much sooner than the key is released. The release threshold
 * has to tolerate a dropped frame, but carrying on repeating for that long
 * after the user lets go is exactly the overshoot that makes navigation feel
 * like it slides past the item you wanted.
 */
static uint32_t repeat_stale_ms(void)
{
    if (!s_interval_ms) return 150u;
    return s_interval_ms + s_interval_ms / 3u;
}

static void release_held(void)
{
    if (s_key_held) {
        hid_out_key_release();
        s_key_held = false;
    }
}

/* One discrete activation of a binding. */
static void fire(const wire_binding_t *b)
{
    switch (b->action) {
    case ACTION_KEY:
        if (b->flags & BIND_HOLD) {
            hid_out_key_hold(b->mods, (uint8_t)b->code);
            s_key_held = true;
        } else {
            hid_out_key_tap(b->mods, (uint8_t)b->code);
        }
        break;
    case ACTION_CONSUMER:
        hid_out_consumer_tap(b->code);
        break;
    case ACTION_SYSTEM:
        hid_out_system_tap(b->code);
        break;
    default:
        break;
    }
}

static void clear_active(void)
{
    release_held();
    s_active_key  = IR_KEY_NONE;
    s_active      = -1;
    s_repeats     = 0;
    s_suppress    = false;
    s_interval_ms = 0;
    s_seen_ditto  = false;
}

int keymap_handle_frame(const ir_frame_t *f)
{
    const uint64_t key = ir_frame_key(f, extra_mask_for(f->protocol));
    const uint32_t now = now_ms();
    const int      idx = find_binding(key);

    const bool    is_ditto = (f->flags & IR_FLAG_REPEAT) != 0;
    const uint8_t toggle   = (f->flags & IR_FLAG_TOGGLE) ? 1u : 0u;

    bool new_press;
    if (key != s_active_key) {
        new_press = true;
    } else if (is_ditto) {
        /* The protocol is stating outright that the button is still down. */
        new_press = false;
    } else if (s_seen_ditto) {
        /*
         * This remote has already shown it signals "held" with dittos, so a
         * full frame can only mean the button was released and pressed again,
         * however quickly that happened.
         */
        new_press = true;
    } else if (protocol_has_toggle(f->protocol)) {
        new_press = (toggle != s_last_toggle);
    } else {
        new_press = (now - s_last_ms) > release_threshold_ms();
    }

    if (new_press) {
        clear_active();
        s_active_key = key;
        s_active     = idx;

        if (idx >= 0 && s_emit) {
            const wire_binding_t *b = &s_cfg->bindings[idx];
            fire(b);
            /*
             * System actions never repeat regardless of the flag: a stream of
             * sleep requests is not something anyone wants.
             */
            s_suppress = (b->flags & BIND_NO_REPEAT) != 0 ||
                         b->action == ACTION_SYSTEM;
            s_next_tap_ms = now + s_cfg->settings.repeat_delay_ms;
        }
    } else {
        if (s_repeats < 0xFFFFu) s_repeats++;
        if (is_ditto) s_seen_ditto = true;

        /* Learn this remote's repeat cadence from the remote itself. */
        const uint32_t gap = now - s_last_ms;
        if (gap >= 20u && gap <= 500u) s_interval_ms = gap;
    }

    s_last_ms     = now;
    s_last_toggle = toggle;
    return idx;
}

void keymap_tick(void)
{
    if (s_active_key == IR_KEY_NONE) return;

    const uint32_t now = now_ms();

    if (now - s_last_ms > release_threshold_ms()) {
        clear_active();
        return;
    }

    if (!s_emit || s_suppress || s_active < 0) return;

    const wire_binding_t *b = &s_cfg->bindings[s_active];

    /* A held key is already down; there is nothing to repeat. */
    if (b->action == ACTION_KEY && (b->flags & BIND_HOLD)) return;

    /* Only repeat while frames are genuinely still arriving. */
    if (now - s_last_ms > repeat_stale_ms()) return;

    /* Signed comparison so the 49-day wrap of now_ms() cannot stall a ramp. */
    if ((int32_t)(now - s_next_tap_ms) >= 0) {
        fire(b);
        s_next_tap_ms = now + s_cfg->settings.repeat_rate_ms;
    }
}

void keymap_set_emit(bool emit)
{
    if (!emit) {
        clear_active();
        hid_out_reset();
    }
    s_emit = emit;
}

uint64_t keymap_last_key(void)     { return s_active_key; }
uint16_t keymap_repeat_count(void) { return s_repeats; }
