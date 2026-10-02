# Host ↔ device protocol

The configurator talks to the receiver over a **vendor-defined HID interface**
(usage page `0xFF00`) carrying fixed 64-byte reports in both directions, with
no report ID.

That choice is deliberate. Windows, macOS and Linux all bind vendor HID
collections to their generic HID driver, so the configurator needs no driver,
no WinUSB INF and no administrator rights — and Chromium's WebHID, which is
what the Electron app uses, can talk to it directly. Chromium refuses to open
collections on protected usage pages, which is exactly why the configuration
channel is its own interface rather than sharing the keyboard's.

The definitions live in `firmware/include/wire_protocol.h` and are mirrored in
`app/src/shared/wire.ts`. `tools/check-protocol-sync.mjs` parses both and
fails if they disagree — identity keys end up in device flash and in saved
user profiles, so a silent divergence would corrupt existing configurations
rather than fail loudly.

## USB interfaces

| # | Interface | Why separate |
|---|---|---|
| 0 | Boot keyboard, no report ID | Boot protocol is all a BIOS or boot menu understands. A remote that cannot navigate them would be a poor showing for a "USB keyboard". |
| 1 | Consumer control (report 1) + system control (report 2) | Media keys on the boot interface would break its boot-protocol compatibility. |
| 2 | Vendor config channel, 64-byte in/out | See above. |

## Packet framing

```c
typedef struct {
    uint8_t id;      // command or event id
    uint8_t seq;     // echoed by the device so the host can match replies
    uint8_t status;  // wire_status_t in replies, 0 in host->device packets
    uint8_t len;     // valid bytes in payload
    uint8_t payload[60];
} wire_packet_t;      // 64 bytes
```

`seq` runs 1–254 on the host; `0` is reserved so unsolicited events can never
be mistaken for a reply.

## Commands

| id | Command | Payload | Reply |
|---|---|---|---|
| `0x01` | GET_INFO | — | `wire_info_t` |
| `0x02` | GET_BINDINGS | `u16 index` | `wire_binding_page_t` |
| `0x03` | SET_BINDINGS | `wire_binding_page_t` | status |
| `0x04` | SET_COUNT | `u16 count` | status |
| `0x05` | COMMIT | — | status |
| `0x06` | GET_SETTINGS | — | `wire_settings_t` |
| `0x07` | SET_SETTINGS | `wire_settings_t` | status |
| `0x08` | SET_MODE | `u8 mode, u8 flags` | status |
| `0x09` | FACTORY_RESET | — | status |
| `0x0A` | REBOOT | `u8 bootsel` | status |
| `0x0B` | IDENTIFY | — | status |
| `0x0C` | GET_STATS | — | `wire_stats_t` |

## Events

| id | Event | Payload |
|---|---|---|
| `0x80` | IR | `wire_ir_event_t` — a decoded or hashed frame |
| `0x81` | RAW | `wire_raw_event_t` — mark/space timings, 26 per chunk |
| `0x82` | STATUS | mode or dirty flag changed |

## Modes

`WIRE_MODE_LEARN` decodes and reports frames but emits **no HID output**. The
configurator selects it whenever it is capturing, so that pressing remote
buttons during setup cannot fire keystrokes into the window being used to
configure them. Switching out of learn mode releases anything held.

## Structure layout

Every structure is explicitly sized, little-endian, and padded to natural
alignment, with the padding spelled out as real fields rather than left to the
compiler. That way there is exactly one layout, visible in both languages.

| Structure | Size | Note |
|---|---|---|
| `wire_binding_t` | 16 | Power of two; three fit in one report |
| `wire_binding_page_t` | 56 | Array starts at offset **8**, not 4 — the `uint64_t` key forces 8-byte alignment |
| `wire_settings_t` | 44 | Toggle rules start at offset 12 |
| `wire_info_t` | 36 | |
| `wire_ir_event_t` | 32 | `uint64_t` first, so there is no padding hole |
| `wire_raw_event_t` | 60 | 26 durations per chunk, not 28 — 28 would overflow the payload |
| `wire_stats_t` | 24 | |

The decoder test suite asserts all of these sizes, because they are memcpy'd
straight into HID reports and into flash.

## The identity key

A button is identified by one 64-bit value:

```
bits 63..56   protocol id
bits 55..32   address (24 bits)
bits 31..0    command (32 bits)
```

Lookup on the device is a flat scan of 8-byte comparisons over at most 128
entries — trivial next to the 100 ms between IR frames.

In saved profiles the key is stored as fixed-width hex (`"0x0287ee0000000b"`),
not as the human-readable `NEC:87EE:0B` form shown in the UI. The display form
contains a protocol *name*, so round-tripping it would depend on a name table
that could never change; and JSON has no integer type wide enough for 64 bits.

## Writing a configuration

1. `SET_BINDINGS` in pages of three.
2. `SET_COUNT` last — if the write is interrupted, the device keeps its
   previous, smaller table rather than exposing half-written entries.
3. `COMMIT` to persist to flash.

Bindings take effect in RAM immediately, which is what "Try without saving"
uses. `COMMIT` is the only slow command: erasing a flash sector takes tens of
milliseconds with interrupts disabled, so the firmware defers it out of the
USB report callback into the main loop and the host allows 6 seconds.

## Storage

The configuration lives in the last 4 KB flash sector behind a magic number, a
version and a CRC-32. A commit interrupted by unplugging fails the CRC on next
boot and defaults are loaded — the alternative, interpreting garbage as
keystrokes, is a far worse failure.
