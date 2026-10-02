# Handoff — 2 October 2026

First session. Project built from scratch to a working, verified state.

## State: working, not yet tested against real hardware

Everything builds and runs. The one thing that has **not** happened is a test
with an actual RP2040 and an actual remote — no hardware was connected during
this session. Everything else was verified, not assumed.

### Verified in this session

| What | How |
|---|---|
| IR decoders | 89 checks, all passing. Synthesised waveforms for every protocol, run on the host. |
| Firmware builds | `ir_usb_remote.uf2`, 62 KB. 31 KB flash, 16 KB RAM used. |
| Protocol sync | 45 checks comparing the C headers against the TypeScript mirror. |
| Database build | 8,901 source files → 5,199 remotes, 152,600 buttons, 3.1 MB. |
| Database lookups | Spot-checked in the running app: NEC `0x04` → LG/Vizio, NECext `0x7201` → Akai, Samsung32 `0x0E0E` → real TVs. |
| Renderer | Typechecks clean, builds, renders, zero console errors. |
| Packaged app | `release/win-unpacked` launches, opens its window, 4 Electron processes. |

### Not verified

- **Anything requiring hardware.** USB enumeration, the three HID interfaces,
  WebHID actually opening the vendor interface, flash commit, real IR
  reception, and whether held-button behaviour feels right.

Installer artifacts now build and were verified:

```
79.4 MB  IR Remote Configurator Setup 1.0.0.exe      (NSIS)
79.1 MB  IR Remote Configurator Portable 1.0.0.exe
```

## Next steps, in order

1. **Flash a board and plug it in.** `cd firmware; .\build.ps1 -Test`, then
   hold BOOTSEL and copy the `.uf2`. Check Windows enumerates a keyboard and
   that Device Manager shows three HID interfaces.
2. **Connect from the configurator.** This is the highest-risk untested path:
   the `select-hid-device` handler in `app/electron/main.js` must pick the
   `0xFF00` collection, and `setDevicePermissionHandler` must grant it. If
   connect silently fails, that is where to look first.
3. **Wire a TSOP38238 to GP3** and check Diagnostics shows decoded frames.
4. **Run through a real remote end to end** — identify, correct the layout,
   map, save permanently, unplug, replug, confirm it still works.
5. **Tune `release_timeout_ms`** against a real remote. The 250 ms default is
   reasoned from protocol repeat intervals, not measured.

## Known issues

**npm 11 blocks postinstall scripts.** Already approved on this machine. On a
fresh clone: `npm install-scripts approve electron esbuild`.

**The ARM toolchain winget package would not install.** Its elevated installer
returned `0x800704c7` (cancelled) twice. Installed from the portable zip into
`C:\Users\joelw\arm-toolchain` instead; `build.ps1` looks there. Documented in
docs/flashing.md.

## Decisions taken that differ from the original brief

**One For All codes are not used.** UEI's setup-code database is proprietary
and not licensed for redistribution, so it could not safely ship in a product
for sale. Replaced with protocol-level decoding plus the CC0-licensed
Flipper-IRDB. You confirmed this direction, with the requirement that the
button layout be correctable and kept separate from the keyboard mapping —
which is how it is built.

**Electron, not a web app.** Your call. Driven through Chromium's WebHID
rather than `node-hid`, so there are no native modules to compile.

## Things deliberately left for later

- Sharp, Denon and RCA decoders. Reserved in the enum, not implemented — all
  three are headerless and risk false positives. Those remotes work via the
  raw timing hash today.
- Held JVC buttons do not auto-repeat (JVC omits the header on repeat frames).
  Documented in docs/ir-protocols.md.
- macOS and Linux builds of the configurator. The renderer is portable; only
  electron-builder targets would need adding.
- Code signing. See docs/branding.md.
- **A real USB VID/PID.** The build defaults to the pid.codes test pair
  `1209:0001`, which must not ship. The app shows a warning banner whenever it
  sees it.
