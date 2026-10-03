/*
 * config_iface.c - command handling on the vendor HID interface.
 *
 * Replies and events are queued rather than sent directly, for the same
 * reason as in hid_out.c: a report only goes out when the host polls. The
 * queue is deep enough to hold the eight chunks of a raw timing capture plus
 * the event that describes it.
 *
 * Flash writes are deferred out of the report callback into
 * config_iface_task(). Erasing a sector takes tens of milliseconds with
 * interrupts disabled, and doing that partway through TinyUSB's own
 * processing of an incoming report is asking for trouble.
 */
#include <string.h>
#include "config_iface.h"
#include "wire_protocol.h"
#include "usb_descriptors.h"
#include "keymap.h"
#include "hid_out.h"
#include "ir_capture.h"
#include "ir_decode.h"
#include "led.h"
#include "board_config.h"
#include "tusb.h"
#include "pico/time.h"
#include "pico/bootrom.h"
#include "hardware/watchdog.h"

#define TXQ_LEN 16

static ir_config_t *s_cfg;

static wire_packet_t s_txq[TXQ_LEN];
static uint8_t       s_tx_head, s_tx_tail;

static uint8_t  s_mode       = WIRE_MODE_NORMAL;
static uint8_t  s_mode_flags = 0;
static bool     s_dirty      = false;

/* Deferred work, set from the report callback and run from the task. */
static uint8_t  s_deferred      = 0; /* wire_cmd_t, 0 = nothing pending */
static uint8_t  s_deferred_seq  = 0;
static uint8_t  s_deferred_arg  = 0;
static uint32_t s_reboot_at_ms  = 0;
static uint8_t  s_reboot_to_bootsel = 0;

static wire_stats_t s_stats;

static inline uint32_t now_ms(void)
{
    return to_ms_since_boot(get_absolute_time());
}

/* ------------------------------------------------------------------------- */
/* Outbound queue                                                            */
/* ------------------------------------------------------------------------- */
static wire_packet_t *tx_alloc(void)
{
    const uint8_t next = (uint8_t)((s_tx_head + 1u) % TXQ_LEN);
    if (next == s_tx_tail) return NULL; /* full */
    wire_packet_t *p = &s_txq[s_tx_head];
    memset(p, 0, sizeof(*p));
    s_tx_head = next;
    return p;
}

static void tx_push(uint8_t id, uint8_t seq, uint8_t status,
                    const void *payload, uint8_t len)
{
    if (!tud_mounted()) return;
    wire_packet_t *p = tx_alloc();
    if (!p) return;
    p->id     = id;
    p->seq    = seq;
    p->status = status;
    p->len    = len;
    if (payload && len) memcpy(p->payload, payload, len);
}

void config_iface_init(ir_config_t *cfg)
{
    s_cfg = cfg;
    s_tx_head = s_tx_tail = 0;
    s_mode = WIRE_MODE_NORMAL;
    s_mode_flags = 0;
    s_dirty = false;
    memset(&s_stats, 0, sizeof(s_stats));
}

bool config_iface_raw_enabled(void)
{
    return (s_mode_flags & WIRE_MODEF_RAW_CAPTURE) != 0;
}

void config_iface_note_frame(ir_protocol_t p, bool unknown)
{
    s_stats.frames_decoded++;
    if (unknown) s_stats.frames_unknown++;
    s_stats.last_protocol = (uint8_t)p;
}

/* ------------------------------------------------------------------------- */
/* Command handling                                                          */
/* ------------------------------------------------------------------------- */
static void handle_get_info(uint8_t seq)
{
    wire_info_t info;
    memset(&info, 0, sizeof(info));
    info.wire_version   = WIRE_VERSION;
    info.fw_major       = FW_VERSION_MAJOR;
    info.fw_minor       = FW_VERSION_MINOR;
    info.fw_patch       = FW_VERSION_PATCH;
    info.max_bindings   = CFG_MAX_BINDINGS;
    info.binding_count  = s_cfg->binding_count;
    info.vid            = USB_VID;
    info.pid            = USB_PID;
    info.mode           = s_mode;
    info.mode_flags     = s_mode_flags;
    info.ir_gpio        = IR_GPIO;
    info.dirty          = s_dirty ? 1 : 0;
    info.protocols_mask = ir_decode_protocols_mask();
    strncpy(info.board, BOARD_NAME, sizeof(info.board) - 1);
    tx_push(CMD_GET_INFO, seq, WIRE_OK, &info, sizeof(info));
}

static void handle_get_bindings(uint8_t seq, const uint8_t *pl, uint8_t len)
{
    if (len < 2) { tx_push(CMD_GET_BINDINGS, seq, WIRE_ERR_LEN, NULL, 0); return; }

    uint16_t index;
    memcpy(&index, pl, 2);
    if (index >= CFG_MAX_BINDINGS) {
        tx_push(CMD_GET_BINDINGS, seq, WIRE_ERR_RANGE, NULL, 0);
        return;
    }

    wire_binding_page_t page;
    memset(&page, 0, sizeof(page));
    page.index = index;
    page.total_hint = (uint8_t)((s_cfg->binding_count > 255)
                                ? 255 : s_cfg->binding_count);

    uint8_t n = 0;
    while (n < CFG_BINDINGS_PER_PKT && (index + n) < s_cfg->binding_count) {
        page.bindings[n] = s_cfg->bindings[index + n];
        n++;
    }
    page.count = n;
    tx_push(CMD_GET_BINDINGS, seq, WIRE_OK, &page, sizeof(page));
}

static void handle_set_bindings(uint8_t seq, const uint8_t *pl, uint8_t len)
{
    if (len < sizeof(wire_binding_page_t)) {
        tx_push(CMD_SET_BINDINGS, seq, WIRE_ERR_LEN, NULL, 0);
        return;
    }

    wire_binding_page_t page;
    memcpy(&page, pl, sizeof(page));

    if (page.count > CFG_BINDINGS_PER_PKT ||
        (uint32_t)page.index + page.count > CFG_MAX_BINDINGS) {
        tx_push(CMD_SET_BINDINGS, seq, WIRE_ERR_RANGE, NULL, 0);
        return;
    }

    for (uint8_t i = 0; i < page.count; i++)
        s_cfg->bindings[page.index + i] = page.bindings[i];

    /* Writing past the end grows the table; shrinking is CMD_SET_COUNT. */
    const uint16_t end = (uint16_t)(page.index + page.count);
    if (end > s_cfg->binding_count) s_cfg->binding_count = end;

    s_dirty = true;
    tx_push(CMD_SET_BINDINGS, seq, WIRE_OK, NULL, 0);
}

static void handle_set_count(uint8_t seq, const uint8_t *pl, uint8_t len)
{
    if (len < 2) { tx_push(CMD_SET_COUNT, seq, WIRE_ERR_LEN, NULL, 0); return; }

    uint16_t count;
    memcpy(&count, pl, 2);
    if (count > CFG_MAX_BINDINGS) {
        tx_push(CMD_SET_COUNT, seq, WIRE_ERR_RANGE, NULL, 0);
        return;
    }

    /* Zero the tail so a shrunk table leaves no stale keys behind. */
    for (uint16_t i = count; i < s_cfg->binding_count; i++)
        memset(&s_cfg->bindings[i], 0, sizeof(s_cfg->bindings[i]));

    s_cfg->binding_count = count;
    s_dirty = true;
    tx_push(CMD_SET_COUNT, seq, WIRE_OK, NULL, 0);
}

static void handle_set_settings(uint8_t seq, const uint8_t *pl, uint8_t len)
{
    if (len < sizeof(wire_settings_t)) {
        tx_push(CMD_SET_SETTINGS, seq, WIRE_ERR_LEN, NULL, 0);
        return;
    }

    wire_settings_t s;
    memcpy(&s, pl, sizeof(s));

    /*
     * Clamp rather than reject. A release timeout shorter than the gap
     * between a remote's repeat frames would make every held button stutter,
     * and a zero repeat rate would spin the consumer ramp as fast as the
     * queue drains.
     */
    if (s.release_timeout_ms < 60)   s.release_timeout_ms = 60;
    if (s.release_timeout_ms > 2000) s.release_timeout_ms = 2000;
    if (s.repeat_rate_ms < 60)       s.repeat_rate_ms = 60;
    if (s.repeat_rate_ms > 2000)     s.repeat_rate_ms = 2000;
    if (s.repeat_delay_ms > 5000)    s.repeat_delay_ms = 5000;
    if (s.led_mode > 2)              s.led_mode = 1;
    if (s.min_press_ms != 0) {
        if (s.min_press_ms < MIN_PRESS_MS_FLOOR)   s.min_press_ms = MIN_PRESS_MS_FLOOR;
        if (s.min_press_ms > MIN_PRESS_MS_CEILING) s.min_press_ms = MIN_PRESS_MS_CEILING;
    }
    /*
     * A repeat cannot arrive faster than a tap takes to complete, or taps
     * queue up behind one another and the button lags further behind the
     * longer it is held.
     */
    if (s.repeat_rate_ms < s.min_press_ms + 20u)
        s.repeat_rate_ms = (uint16_t)(s.min_press_ms + 20u);

    s_cfg->settings = s;
    led_set_mode(s.led_mode);
    hid_out_set_min_press(s.min_press_ms);
    s_dirty = true;
    tx_push(CMD_SET_SETTINGS, seq, WIRE_OK, NULL, 0);
}

static void handle_set_mode(uint8_t seq, const uint8_t *pl, uint8_t len)
{
    if (len < 2) { tx_push(CMD_SET_MODE, seq, WIRE_ERR_LEN, NULL, 0); return; }

    s_mode       = (pl[0] == WIRE_MODE_LEARN) ? WIRE_MODE_LEARN : WIRE_MODE_NORMAL;
    s_mode_flags = pl[1];
    keymap_set_emit(s_mode == WIRE_MODE_NORMAL);

    tx_push(CMD_SET_MODE, seq, WIRE_OK, NULL, 0);

    wire_status_event_t ev = { s_mode, s_mode_flags, s_dirty ? 1u : 0u, 0 };
    tx_push(EVT_STATUS, 0, WIRE_OK, &ev, sizeof(ev));
}

static void handle_get_stats(uint8_t seq)
{
    s_stats.frames_dropped = ir_capture_dropped();
    s_stats.keys_sent      = hid_out_sent();
    s_stats.uptime_ms      = now_ms();
    tx_push(CMD_GET_STATS, seq, WIRE_OK, &s_stats, sizeof(s_stats));
}

/* ------------------------------------------------------------------------- */
/* TinyUSB callbacks                                                         */
/* ------------------------------------------------------------------------- */

/*
 * Reports arriving on the OUT endpoint. TinyUSB passes report_id 0 and
 * report_type HID_REPORT_TYPE_INVALID for an interface whose descriptor
 * declares no report IDs, which is the case here, so the type is not checked.
 */
void tud_hid_set_report_cb(uint8_t instance, uint8_t report_id,
                           hid_report_type_t report_type,
                           uint8_t const *buffer, uint16_t bufsize)
{
    (void)report_id;
    (void)report_type;

    if (instance != HID_ITF_CONFIG) return;
    if (bufsize < 4) return;

    const uint8_t id  = buffer[0];
    const uint8_t seq = buffer[1];
    const uint8_t len = buffer[3];
    const uint8_t *pl = buffer + 4;

    const uint8_t avail = (uint8_t)((bufsize - 4 > WIRE_PAYLOAD_SIZE)
                                    ? WIRE_PAYLOAD_SIZE : bufsize - 4);
    const uint8_t plen = (len > avail) ? avail : len;

    switch (id) {
    case CMD_GET_INFO:     handle_get_info(seq); break;
    case CMD_GET_BINDINGS: handle_get_bindings(seq, pl, plen); break;
    case CMD_SET_BINDINGS: handle_set_bindings(seq, pl, plen); break;
    case CMD_SET_COUNT:    handle_set_count(seq, pl, plen); break;
    case CMD_GET_SETTINGS:
        tx_push(CMD_GET_SETTINGS, seq, WIRE_OK,
                &s_cfg->settings, sizeof(s_cfg->settings));
        break;
    case CMD_SET_SETTINGS: handle_set_settings(seq, pl, plen); break;
    case CMD_SET_MODE:     handle_set_mode(seq, pl, plen); break;
    case CMD_GET_STATS:    handle_get_stats(seq); break;
    case CMD_IDENTIFY:
        led_identify(2000);
        tx_push(CMD_IDENTIFY, seq, WIRE_OK, NULL, 0);
        break;

    /* Slow or terminal operations run from the task, not from here. */
    case CMD_COMMIT:
    case CMD_FACTORY_RESET:
    case CMD_REBOOT:
        if (s_deferred) {
            tx_push(id, seq, WIRE_ERR_BUSY, NULL, 0);
        } else {
            s_deferred     = id;
            s_deferred_seq = seq;
            s_deferred_arg = (plen > 0) ? pl[0] : 0;
        }
        break;

    default:
        tx_push(id, seq, WIRE_ERR_CMD, NULL, 0);
        break;
    }
}

/* Required by TinyUSB. Nothing here supports GET_REPORT over the control pipe. */
uint16_t tud_hid_get_report_cb(uint8_t instance, uint8_t report_id,
                               hid_report_type_t report_type,
                               uint8_t *buffer, uint16_t reqlen)
{
    (void)instance; (void)report_id; (void)report_type; (void)buffer; (void)reqlen;
    return 0;
}

/* ------------------------------------------------------------------------- */
/* Events                                                                    */
/* ------------------------------------------------------------------------- */
void config_iface_report_ir(const ir_frame_t *f, uint64_t key, int binding_idx,
                            uint16_t raw_count, uint16_t repeats,
                            uint32_t frame_seq)
{
    const bool matched = binding_idx >= 0;

    /*
     * In learn mode every frame is reported, because the whole purpose is to
     * see codes that have no binding yet. In normal mode an unmapped code is
     * only reported if the user asked for it, so a remote for some other
     * appliance in the room does not flood the live monitor.
     */
    if (s_mode != WIRE_MODE_LEARN && !matched &&
        !(s_cfg->settings.flags & SETF_REPORT_UNMAPPED))
        return;

    wire_ir_event_t ev;
    memset(&ev, 0, sizeof(ev));
    ev.key           = key;
    ev.address       = f->address;
    ev.command       = f->command;
    ev.binding_index = matched ? (uint16_t)binding_idx : 0xFFFFu;
    ev.repeat_count  = repeats;
    ev.raw_count     = raw_count;
    ev.frame_seq     = frame_seq;
    ev.protocol      = (uint8_t)f->protocol;
    ev.flags         = f->flags;
    ev.nbits         = f->nbits;
    ev.matched       = matched ? 1 : 0;

    tx_push(EVT_IR, 0, WIRE_OK, &ev, sizeof(ev));
}

void config_iface_report_raw(const uint16_t *us, uint16_t n, uint32_t frame_seq)
{
    if (!config_iface_raw_enabled() || n == 0) return;

    const uint16_t chunks = (uint16_t)((n + WIRE_RAW_PER_PKT - 1) / WIRE_RAW_PER_PKT);
    for (uint16_t c = 0; c < chunks; c++) {
        wire_raw_event_t ev;
        memset(&ev, 0, sizeof(ev));
        ev.chunk     = (uint8_t)c;
        ev.chunks    = (uint8_t)chunks;
        ev.total     = n;
        ev.frame_seq = frame_seq;

        const uint16_t off = (uint16_t)(c * WIRE_RAW_PER_PKT);
        uint16_t take = (uint16_t)(n - off);
        if (take > WIRE_RAW_PER_PKT) take = WIRE_RAW_PER_PKT;
        memcpy(ev.us, us + off, take * sizeof(uint16_t));

        tx_push(EVT_RAW, 0, WIRE_OK, &ev, sizeof(ev));
    }
}

/* ------------------------------------------------------------------------- */
/* Task                                                                      */
/* ------------------------------------------------------------------------- */
static void run_deferred(void)
{
    const uint8_t id  = s_deferred;
    const uint8_t seq = s_deferred_seq;
    const uint8_t arg = s_deferred_arg;

    switch (id) {
    case CMD_COMMIT: {
        const bool ok = storage_save(s_cfg);
        if (ok) s_dirty = false;
        tx_push(CMD_COMMIT, seq, ok ? WIRE_OK : WIRE_ERR_STORAGE, NULL, 0);
        break;
    }
    case CMD_FACTORY_RESET: {
        storage_defaults(s_cfg);
        const bool ok = storage_erase();
        keymap_init(s_cfg);
        keymap_set_emit(s_mode == WIRE_MODE_NORMAL);
        led_set_mode(s_cfg->settings.led_mode);
        s_dirty = false;
        tx_push(CMD_FACTORY_RESET, seq, ok ? WIRE_OK : WIRE_ERR_STORAGE, NULL, 0);
        break;
    }
    case CMD_REBOOT:
        /*
         * Reply first and reboot a moment later, so the app sees the
         * acknowledgement instead of the device vanishing mid-request.
         */
        tx_push(CMD_REBOOT, seq, WIRE_OK, NULL, 0);
        s_reboot_to_bootsel = arg;
        s_reboot_at_ms = now_ms() + 120;
        break;
    default:
        break;
    }
    s_deferred = 0;
}

void config_iface_task(void)
{
    /* Send at most one queued report per pass. */
    if (s_tx_head != s_tx_tail && tud_mounted() &&
        tud_hid_n_ready(HID_ITF_CONFIG)) {
        const wire_packet_t *p = &s_txq[s_tx_tail];
        if (tud_hid_n_report(HID_ITF_CONFIG, 0, p, WIRE_REPORT_SIZE))
            s_tx_tail = (uint8_t)((s_tx_tail + 1u) % TXQ_LEN);
    }

    if (s_deferred) run_deferred();

    if (s_reboot_at_ms && (int32_t)(now_ms() - s_reboot_at_ms) >= 0) {
        if (s_reboot_to_bootsel) {
            /* Present the UF2 drive so the app can push a firmware update. */
            reset_usb_boot(0, 0);
        } else {
            /* Watchdog reset: no SDK call reboots the chip more plainly. */
            watchdog_reboot(0, 0, 10);
        }
        s_reboot_at_ms = 0;
    }
}
