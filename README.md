# IR USB Remote

Turn almost any infrared remote control into a USB keyboard, using an RP2040
and a three-pin IR receiver.

The receiver plugs into a PC and appears as an ordinary USB keyboard — no
driver, no service, nothing running in the background. A Windows app is used
once to tell it which remote you have and what each button should do; after
that the receiver works on its own, including in BIOS and boot menus.

```
  ┌──────────────┐        ┌──────────┐        ┌──────────────┐
  │  any remote  │ ─IR──▶ │  RP2040  │ ─USB─▶ │  PC: it is a │
  │              │        │ + TSOP   │        │   keyboard   │
  └──────────────┘        └──────────┘        └──────────────┘
                                ▲
                                │ configured once, over USB
                        ┌───────────────┐
                        │ Configurator  │
                        └───────────────┘
```

## What makes it universal

Two mechanisms, so there is no remote it simply cannot handle:

1. **Protocol decoding.** NEC, NEC extended, RC5, RC5X, RC6, RC6-6A (Windows
   Media Center), Sony SIRC 12/15/20, Samsung32, Kaseikyo/Panasonic and JVC are
   decoded by name, giving a stable device address and command.
2. **Timing-pattern identity.** Anything else is identified by a hash of its
   mark/space pattern, computed so it is immune to a remote's clock being off.
   An unmodelled protocol is still learned and mapped exactly like a known one.

On top of that, a bundled database of **5,199 remotes / 152,600 buttons**
(from [Flipper-IRDB](https://github.com/Lucaslhm/Flipper-IRDB), CC0-1.0) is
matched on protocol + address, so pressing one button usually identifies the
remote and fills in every other button's code without any learning at all.

## Repository layout

| Path | What it is |
|---|---|
| `firmware/` | RP2040 firmware (C, Pico SDK 2.1.1 + TinyUSB) |
| `firmware/test/` | Host-side decoder tests — real waveforms, run on your PC |
| `firmware/tools/irprobe.c` | Finds the IR output on a salvaged sensor board by watching GP2–GP9 at once |
| `app/` | Windows configurator (Electron + React + TypeScript) |
| `tools/db-build/` | Builds the bundled remote database from Flipper-IRDB |
| `tools/check-protocol-sync.mjs` | Proves the C and TypeScript protocol definitions agree |
| `docs/` | Wiring, flashing, user guide, protocol reference, selling notes |

## Quick start

**Hardware** — an RP2040 board and a 38 kHz IR receiver module. Three wires.
See [docs/hardware.md](docs/hardware.md).

**Flash** — hold BOOTSEL, plug in, drag `ir_usb_remote.uf2` onto the
`RPI-RP2` drive. See [docs/flashing.md](docs/flashing.md).

**Configure** — open the configurator, press a button on your remote, pick
your remote from the matches, choose a preset, save.
See [docs/user-guide.md](docs/user-guide.md).

## Building

```powershell
# Firmware: produces firmware/build/ir_usb_remote.uf2
cd firmware
.\build.ps1 -Test
```

```powershell
# Configurator
cd app
npm install
npm run dist
```

That produces both:

```
IR Remote Configurator Setup 1.0.0.exe      installer, ~79 MB
IR Remote Configurator Portable 1.0.0.exe   single-file, no install
```

If `npm install` warns that install scripts were skipped (npm 11 blocks them
by default), run `npm install-scripts approve electron esbuild` — Electron's
binary is downloaded by one of them.

`npm run icon` regenerates `app/resources/icon.ico` from
`tools/make-icon.mjs`, which draws it rather than storing a binary nobody can
edit.

`build.ps1` locates CMake, Ninja, arm-none-eabi-gcc, Python and a host GCC
rather than requiring them on PATH, and tells you exactly what is missing.
`-Test` builds and runs the decoder test suite first.

The app build needs no Developer Mode and no administrator rights.
`scripts/prepare-wincodesign.mjs` runs automatically beforehand and works
around electron-builder discarding a good extraction because two macOS
symlinks inside its support bundle cannot be created on Windows.

## Design notes worth knowing

- **The remote's layout and the keyboard mapping are separate.** A remote
  profile records which IR code each physical button sends; a keymap records
  what each button does. Keymaps reference buttons by id, so correcting a
  wrong layout — renaming, re-learning, moving, adding a button — never
  disturbs the mapping, and one mapping can be reused across remotes.
- **The configurator suppresses keystrokes while it is listening.** Otherwise
  pressing remote buttons to configure them would fire the keys they are
  already bound to into the window being used to configure them.
- **Keyboard actions are held; media actions are tapped.** Holding a key lets
  the PC apply the user's own repeat delay and rate. Hosts do not repeat
  consumer-control usages, so a held volume button is ramped by the firmware
  instead.
- **Config lives in flash with a CRC.** A commit interrupted by unplugging
  loads defaults on next boot rather than interpreting garbage as keystrokes.

## Before selling this

Read [docs/branding.md](docs/branding.md). In short: the default USB ID is the
pid.codes **test** pair `1209:0001` and must not ship, and an unsigned
installer will trip SmartScreen. Both have straightforward fixes; the
configurator warns you about the USB ID on screen so it cannot ship unnoticed.

## Licence

MIT — see [LICENSE](LICENSE). The bundled remote database is CC0-1.0 and is
redistributable without conditions; see [docs/database.md](docs/database.md)
for provenance and for why a second well-known database was deliberately left
out.
