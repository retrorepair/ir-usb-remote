/*
 * keymap.c - binding lookup, and the behaviour of a held button.
 *
 * Two different repeat strategies are used, because the host treats the two
 * kinds of output differently:
 *
 *   Keyboard actions are HELD. The key stays in the report for as long as IR
 *   frames keep arriving and is released once they stop. The host then
 *   applies the user's own repeat delay and rate, so arrow keys on the remote
 *   behave exactly like arrow keys on their keyboard.
 *
 *   Consumer and system actions are TAPPED, because hosts do not apply key
 *   repeat to them -- a held volume key would move the volume exactly one
 *   step. The ramp is therefore synthesised here from repeat_delay_ms and
 *   repeat_rate_ms.
 */
#include "keymap.h"
#include "hid_out.h"
#include "wire_protocol.h"
#include "pico/time.h"

static ir_config_t *s_cfg;
static bool     s_emit = true;

static uint64_t s_active_key = IR_KEY_NONE;
static int      s_active     = -1;   /* binding index for s_active_key, or -1 */
static uint32_t s_last_ms    = 0;
static uint16_t s_repeats    = 0;
static bool     s_key_held   = false;
static bool     s_suppress   = false;/* BIND_NO_REPEAT: ignore held frames   */
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

static void release_held(void)
{
    if (s_key_held) {
        hid_out_key_release();
        s_key_held = false;
    }
}

static void engage(const wire_binding_t *b)
{
    switch (b->action) {
    case ACTION_KEY:
        if (b->flags & BIND_NO_REPEAT) {
            hid_out_key_tap(b->mods, (uint8_t)b->code);
            s_suppress = true;
        } else {
            hid_out_key_hold(b->mods, (uint8_t)b->code);
            s_key_held = true;
        }
        break;
    case ACTION_CONSUMER:
        hid_out_consumer_tap(b->code);
        s_suppress = (b->flags & BIND_NO_REPEAT) != 0;
        s_next_tap_ms = now_ms() + s_cfg->settings.repeat_delay_ms;
        break;
    case ACTION_SYSTEM:
        /*
         * Never repeated regardless of the flag: a ramp of sleep requests is
         * not a thing any user wants.
         */
        hid_out_system_tap(b->code);
        s_suppress = true;
        break;
    default:
        break;
    }
}

int keymap_handle_frame(const ir_frame_t *f)
{
    const uint64_t key = ir_frame_key(f, extra_mask_for(f->protocol));
    const uint32_t now = now_ms();

    const int idx = find_binding(key);

    /*
     * "Same button still held" means the same identity arriving before the
     * release timeout expires. Anything else is a new press, even if it is
     * the same button after a gap.
     */
    const bool continuing = (key == s_active_key) &&
                            (now - s_last_ms <= s_cfg->settings.release_timeout_ms);
    s_last_ms = now;

    if (continuing) {
        if (s_repeats < 0xFFFFu) s_repeats++;
        /*
         * Nothing to do for a continuing press: a held keyboard key is
         * already down, and consumer ramping is driven by keymap_tick() so
         * that its rate follows the configured interval rather than whatever
         * rate the remote happens to resend at.
         */
        return idx;
    }

    release_held();
    s_active_key = key;
    s_active     = idx;
    s_repeats    = 0;
    s_suppress   = false;

    if (idx >= 0 && s_emit) engage(&s_cfg->bindings[idx]);
    return idx;
}

void keymap_tick(void)
{
    if (s_active_key == IR_KEY_NONE) return;

    const uint32_t now = now_ms();

    if (now - s_last_ms > s_cfg->settings.release_timeout_ms) {
        release_held();
        s_active_key = IR_KEY_NONE;
        s_active     = -1;
        s_repeats    = 0;
        s_suppress   = false;
        return;
    }

    if (!s_emit || s_suppress || s_active < 0) return;

    const wire_binding_t *b = &s_cfg->bindings[s_active];
    if (b->action != ACTION_CONSUMER) return;

    /* Signed comparison so the 49-day wrap of now_ms() cannot stall a ramp. */
    if ((int32_t)(now - s_next_tap_ms) >= 0) {
        hid_out_consumer_tap(b->code);
        s_next_tap_ms = now + s_cfg->settings.repeat_rate_ms;
    }
}

void keymap_set_emit(bool emit)
{
    if (!emit) {
        release_held();
        hid_out_reset();
        /*
         * Forget the active press as well. Otherwise returning from learn
         * mode mid-press would treat the next frame as "still held" and never
         * engage the binding.
         */
        s_active_key = IR_KEY_NONE;
        s_active = -1;
        s_suppress = false;
    }
    s_emit = emit;
}

uint64_t keymap_last_key(void)    { return s_active_key; }
uint16_t keymap_repeat_count(void){ return s_repeats; }
