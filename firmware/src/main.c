/*
 * main.c - IR USB Remote receiver.
 *
 * Capture edges, decode a frame, look up a binding, emit a keystroke. The
 * device is fully functional with no PC attached: the configurator only
 * exists to put bindings into flash.
 */
#include <string.h>
#include "pico/stdlib.h"
#include "tusb.h"

#include "board_config.h"
#include "ir_capture.h"
#include "ir_decode.h"
#include "keymap.h"
#include "storage.h"
#include "hid_out.h"
#include "config_iface.h"
#include "led.h"

/* The live configuration. The keymap engine and the config channel both hold
 * a pointer to this, so an edit from the app takes effect immediately and a
 * commit merely makes it survive a power cycle. */
static ir_config_t g_cfg;

int main(void)
{
    /*
     * Deliberately no stdio_init_all(): the SDK's USB stdio would create a
     * second USB device alongside ours and fight TinyUSB for the peripheral.
     * Diagnostics go to the configurator over the config interface instead,
     * which is more useful anyway -- it works on a sealed unit.
     */
    storage_load(&g_cfg);

    hid_out_init();
    keymap_init(&g_cfg);
    led_init();
    led_set_mode(g_cfg.settings.led_mode);
    config_iface_init(&g_cfg);
    ir_capture_init();

    tusb_init();

    ir_frame_t last_frame;
    bool       have_last = false;
    uint32_t   frame_seq = 0;

    memset(&last_frame, 0, sizeof(last_frame));

    while (true) {
        tud_task();
        ir_capture_poll();

        const ir_burst_t *burst = ir_capture_take();
        if (burst) {
            ir_frame_t f;
            ir_decode_result_t r = ir_decode(burst->us, burst->count, &f);

            /*
             * A ditto frame carries no payload, so the previous frame stands
             * in for it. Without a previous frame there is nothing sensible to
             * do -- it means capture started midway through a held button.
             */
            if (r == IR_DECODE_REPEAT) {
                if (have_last) {
                    f = last_frame;
                    f.flags |= IR_FLAG_REPEAT;
                    r = IR_DECODE_FRAME;
                } else {
                    r = IR_DECODE_NONE;
                }
            }

            /*
             * A truncated burst cannot be hashed: the hash covers the whole
             * timing pattern, so a cut-off frame would produce an identity
             * that no binding matches and that changes with where the cut
             * fell. Decoded protocols are unaffected, since they validate
             * their own length.
             */
            if (r == IR_DECODE_FRAME && f.protocol == IR_PROTO_RAW_HASH &&
                burst->overrun)
                r = IR_DECODE_NONE;

            if (r == IR_DECODE_FRAME) {
                frame_seq++;

                const int idx = keymap_handle_frame(&f);

                config_iface_note_frame(f.protocol,
                                        f.protocol == IR_PROTO_RAW_HASH);
                config_iface_report_raw(burst->us, burst->count, frame_seq);
                config_iface_report_ir(&f, keymap_last_key(), idx,
                                       burst->count, keymap_repeat_count(),
                                       frame_seq);
                led_blink();

                last_frame = f;
                have_last  = true;
            }

            ir_capture_release();
        }

        keymap_tick();
        hid_out_task();
        config_iface_task();
        led_task();
    }
}
