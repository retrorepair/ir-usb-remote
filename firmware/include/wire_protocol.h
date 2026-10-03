/*
 * wire_protocol.h - host <-> device configuration protocol.
 *
 * Transport: a vendor-defined HID interface (usage page 0xFF00) carrying
 * fixed 64-byte reports in both directions, with no report ID. That choice is
 * deliberate: Windows, macOS and Linux all bind vendor HID collections to
 * their generic HID driver, so the configurator needs no driver, no WinUSB
 * INF and no administrator rights, and Chromium's WebHID (which is what the
 * Electron app uses) can talk to it directly.
 *
 * Every structure here is explicitly sized, little-endian, and padded to
 * natural alignment so host and device agree without packing pragmas.
 * app/src/shared/wire.ts mirrors this file; tools/check-protocol-sync.mjs
 * fails the build if the two drift apart.
 */
#ifndef WIRE_PROTOCOL_H
#define WIRE_PROTOCOL_H

#include <stdint.h>
#include "ir_protocol.h"

#ifdef __cplusplus
extern "C" {
#endif

#define WIRE_REPORT_SIZE      64
#define WIRE_PAYLOAD_SIZE     60
#define WIRE_VERSION          1

/* Firmware version, reported by CMD_GET_INFO. */
#define FW_VERSION_MAJOR      1
#define FW_VERSION_MINOR      0
#define FW_VERSION_PATCH      0

/* ------------------------------------------------------------------------- */
/* Capacity limits (advertised in CMD_GET_INFO so the host never guesses)    */
/* ------------------------------------------------------------------------- */
#define CFG_MAX_BINDINGS      128
#define CFG_MAX_TOGGLE_RULES  4
#define CFG_BINDINGS_PER_PKT  3    /* 3 * 16 bytes = 48, plus 4 header bytes */

/* ------------------------------------------------------------------------- */
/* Commands (host -> device). Replies reuse the same id with status set.      */
/* ------------------------------------------------------------------------- */
typedef enum {
    CMD_GET_INFO      = 0x01, /* -> wire_info_t                              */
    CMD_GET_BINDINGS  = 0x02, /* u16 index -> wire_binding_page_t            */
    CMD_SET_BINDINGS  = 0x03, /* wire_binding_page_t -> status               */
    CMD_SET_COUNT     = 0x04, /* u16 count: truncate/extend the active table */
    CMD_COMMIT        = 0x05, /* persist the RAM config to flash             */
    CMD_GET_SETTINGS  = 0x06, /* -> wire_settings_t                          */
    CMD_SET_SETTINGS  = 0x07, /* wire_settings_t -> status                   */
    CMD_SET_MODE      = 0x08, /* u8 mode, u8 flags                           */
    CMD_FACTORY_RESET = 0x09, /* erase config, reload defaults               */
    CMD_REBOOT        = 0x0A, /* u8 0 = normal, 1 = UF2 bootloader (BOOTSEL) */
    CMD_IDENTIFY      = 0x0B, /* blink the LED so the user can spot the unit  */
    CMD_GET_STATS     = 0x0C  /* -> wire_stats_t (diagnostics panel)         */
} wire_cmd_t;

/* ------------------------------------------------------------------------- */
/* Events (device -> host, unsolicited)                                      */
/* ------------------------------------------------------------------------- */
typedef enum {
    EVT_IR     = 0x80, /* wire_ir_event_t: a decoded (or hashed) frame       */
    EVT_RAW    = 0x81, /* wire_raw_event_t: raw mark/space timings           */
    EVT_STATUS = 0x82  /* wire_status_event_t: mode/config changed on device */
} wire_evt_t;

/* Status codes returned in the reply header. */
typedef enum {
    WIRE_OK          = 0x00,
    WIRE_ERR_CMD     = 0x01, /* unknown command id                          */
    WIRE_ERR_LEN     = 0x02, /* payload length wrong for this command        */
    WIRE_ERR_RANGE   = 0x03, /* index/count outside the advertised capacity  */
    WIRE_ERR_STORAGE = 0x04, /* flash write or verify failed                 */
    WIRE_ERR_BUSY    = 0x05, /* cannot service the request right now         */
    WIRE_ERR_VERSION = 0x06  /* host wire version not supported              */
} wire_status_t;

/* Operating modes. */
typedef enum {
    /* Decode, emit HID to the OS, and also report frames to the host. */
    WIRE_MODE_NORMAL = 0,
    /*
     * Decode and report frames to the host but emit NO HID output. The
     * configurator selects this whenever it is capturing, so that pressing
     * remote buttons during setup cannot fire keystrokes into the very UI
     * being used to configure them.
     */
    WIRE_MODE_LEARN  = 1
} wire_mode_t;

/* Mode flags (second byte of CMD_SET_MODE). */
#define WIRE_MODEF_RAW_CAPTURE (1u << 0) /* also stream EVT_RAW timings */

/* ------------------------------------------------------------------------- */
/* Actions a button can be bound to                                          */
/* ------------------------------------------------------------------------- */
typedef enum {
    ACTION_NONE     = 0,
    /*
     * Keyboard usage from HID usage page 0x07 plus a modifier byte, delivered
     * on the boot-protocol keyboard interface (so it works in BIOS/boot menus).
     */
    ACTION_KEY      = 1,
    /* Consumer control usage, page 0x0C: volume, transport, browser keys.   */
    ACTION_CONSUMER = 2,
    /* System control usage, page 0x01: sleep / wake / power down.           */
    ACTION_SYSTEM   = 3
} wire_action_t;

/* Keyboard modifier bits, matching HID boot keyboard report byte 0. */
#define KMOD_LCTRL  (1u << 0)
#define KMOD_LSHIFT (1u << 1)
#define KMOD_LALT   (1u << 2)
#define KMOD_LGUI   (1u << 3)
#define KMOD_RCTRL  (1u << 4)
#define KMOD_RSHIFT (1u << 5)
#define KMOD_RALT   (1u << 6)
#define KMOD_RGUI   (1u << 7)

/*
 * Per-binding flags, selecting one of three behaviours:
 *
 *   (neither)        tap once per press, then auto-repeat at the configured
 *                    delay and rate while the button is held. The default.
 *   BIND_NO_REPEAT   tap exactly once per press, never repeat.
 *   BIND_HOLD        hold the key down for as long as the button is held.
 *
 * BIND_HOLD exists for emulators and games, where a direction genuinely needs
 * to stay pressed. It is NOT the default: handing the host a long key-down
 * makes the feel depend on the user's own OS repeat settings, and a single
 * tap is easily long enough to cross a typical 250 ms repeat delay and set
 * the host repeating at 30/sec.
 */
#define BIND_NO_REPEAT (1u << 0)
#define BIND_HOLD      (1u << 1)

/* 16 bytes. A power of two, and three fit in one report with room spare. */
typedef struct {
    uint64_t key;        /* normalised IR identity, see IR_KEY()             */
    uint8_t  action;     /* wire_action_t                                    */
    uint8_t  mods;       /* KMOD_* bits (ACTION_KEY only)                    */
    uint16_t code;       /* HID usage within the action's usage page         */
    uint8_t  flags;      /* BIND_* bits                                      */
    uint8_t  reserved[3];
} wire_binding_t;

/* ------------------------------------------------------------------------- */
/* Payload structures                                                        */
/* ------------------------------------------------------------------------- */

typedef struct {
    uint8_t  wire_version;
    uint8_t  fw_major, fw_minor, fw_patch;
    uint16_t max_bindings;
    uint16_t binding_count;
    uint16_t vid, pid;
    uint8_t  mode;            /* current wire_mode_t                         */
    uint8_t  mode_flags;
    uint8_t  ir_gpio;         /* which pin the receiver is wired to          */
    uint8_t  dirty;           /* RAM config differs from what is in flash    */
    uint32_t protocols_mask;  /* bit N set => protocol id N is compiled in   */
    char     board[16];       /* e.g. "pico", "pico_w", "waveshare_rp2040"   */
} wire_info_t;

/*
 * 56 bytes. The explicit pad is load-bearing: wire_binding_t contains a
 * uint64_t, so the array is 8-byte aligned and the compiler would insert this
 * hole anyway. Spelling it out keeps the TypeScript serialiser honest.
 */
typedef struct {
    uint16_t       index;      /* index of bindings[0] within the table      */
    uint8_t        count;      /* how many entries are valid (max 3)         */
    uint8_t        total_hint; /* device binding_count, for host progress    */
    uint32_t       pad;
    wire_binding_t bindings[CFG_BINDINGS_PER_PKT];
} wire_binding_page_t;

typedef struct {
    uint8_t  protocol;  /* ir_protocol_t this rule applies to                */
    uint8_t  reserved;
    uint32_t cmd_mask;  /* command bits to clear before identity is built    */
} wire_toggle_rule_t;

/* 44 bytes, no holes. */
typedef struct {
    uint16_t repeat_delay_ms;    /* hold this long before auto-repeat starts */
    uint16_t repeat_rate_ms;     /* interval between auto-repeats            */
    uint16_t release_timeout_ms; /* silence after which the key is released  */
    uint8_t  led_mode;           /* 0 off, 1 blink on receive, 2 always on   */
    uint8_t  flags;              /* SETF_* bits                              */
    /*
     * How long a tapped key stays down before the release report is sent.
     * 0 means use the firmware default.
     *
     * This matters more than it sounds. Reports go out one per USB poll, so
     * without a floor a tap lasts a millisecond or two -- shorter than any
     * real keypress, and invisible to anything that samples keyboard state
     * once per video frame rather than handling events. A MiSTer running a
     * core at 60 Hz has 16.7 ms between samples and misses such a press
     * entirely, while a PC catches it, which is a confusing way to fail.
     *
     * Occupies what was explicit padding, so the structure size and every
     * other field offset are unchanged and existing saved configurations
     * still load -- they simply read 0 here and get the default.
     */
    uint16_t min_press_ms;
    uint16_t reserved;           /* keeps toggle_rules at offset 12          */
    wire_toggle_rule_t toggle_rules[CFG_MAX_TOGGLE_RULES];
} wire_settings_t;

/* Default and permitted range for min_press_ms. */
#define MIN_PRESS_MS_DEFAULT 48u
#define MIN_PRESS_MS_FLOOR   8u
#define MIN_PRESS_MS_CEILING 250u

/* Settings flags. */
#define SETF_REPORT_UNMAPPED (1u << 0) /* send EVT_IR for unmapped codes too */

/*
 * 32 bytes exactly. The uint64_t is first so that no padding hole appears
 * between it and the 32-bit fields; the single-byte fields sit at the end.
 */
typedef struct {
    uint64_t key;           /* normalised identity, what bindings store      */
    uint32_t address;
    uint32_t command;
    uint16_t binding_index; /* valid when matched is 1                       */
    uint16_t repeat_count;  /* consecutive repeats of this key               */
    uint16_t raw_count;     /* number of mark/space durations captured       */
    uint16_t reserved;
    uint32_t frame_seq;     /* monotonic, lets the host spot dropped events  */
    uint8_t  protocol;
    uint8_t  flags;         /* IR_FLAG_* bits                               */
    uint8_t  nbits;
    uint8_t  matched;       /* 1 if a binding fired                         */
} wire_ir_event_t;

/*
 * 26 durations per chunk, not 28: the 8-byte header plus 28 uint16_t would be
 * 64 bytes and overflow the 60-byte payload.
 */
#define WIRE_RAW_PER_PKT 26

typedef struct {
    uint8_t  chunk;     /* 0-based chunk index                              */
    uint8_t  chunks;    /* total chunks for this frame                       */
    uint16_t total;     /* total durations in the frame                      */
    uint32_t frame_seq; /* ties these chunks to an EVT_IR                    */
    uint16_t us[WIRE_RAW_PER_PKT]; /* alternating mark, space, ... in us     */
} wire_raw_event_t;

typedef struct {
    uint32_t frames_decoded;
    uint32_t frames_unknown; /* fell through to the raw hash                 */
    uint32_t frames_dropped; /* capture buffer overran                       */
    uint32_t keys_sent;
    uint32_t uptime_ms;
    uint8_t  last_protocol;
    uint8_t  reserved[3];
} wire_stats_t;

typedef struct {
    uint8_t mode;
    uint8_t mode_flags;
    uint8_t dirty;
    uint8_t reserved;
} wire_status_event_t;

/* ------------------------------------------------------------------------- */
/* Packet framing                                                            */
/* ------------------------------------------------------------------------- */
typedef struct {
    uint8_t id;     /* wire_cmd_t or wire_evt_t                              */
    uint8_t seq;    /* echoed by the device so the host can match replies     */
    uint8_t status; /* wire_status_t in replies, 0 in host->device packets     */
    uint8_t len;    /* valid bytes in payload                                 */
    uint8_t payload[WIRE_PAYLOAD_SIZE];
} wire_packet_t;

#ifdef __cplusplus
}
#endif
#endif /* WIRE_PROTOCOL_H */
