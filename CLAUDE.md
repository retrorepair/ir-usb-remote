# IR USB Remote — project rules

An RP2040 that receives infrared and presents as a USB keyboard, plus a
Windows configurator. See README.md for what it is; this file is how to work
on it.

## Non-negotiables

**The firmware must keep working with no PC attached.** The configurator
exists only to put bindings into flash. Never introduce a runtime dependency
on the host.

**Never break the wire protocol silently.** Identity keys live in device flash
and in users' saved profile files. Changing a protocol id, a structure size or
a field offset invalidates existing configurations. If a change is genuinely
needed, bump `WIRE_VERSION` and `CONFIG_VERSION` and handle the old form.
`node tools/check-protocol-sync.mjs` must pass — it compares the C headers
against the TypeScript mirror and is cheap to run.

**The remote's layout and the keyboard mapping stay separate.** A
`RemoteProfile` says which IR code each button sends; a `Keymap` says what
each button does, keyed by button id. This is a requirement, not an
implementation detail: correcting a layout must never disturb a mapping.

**The decoders stay free of SDK dependencies.** `ir_decode.c` and
`ir_protocol.c` are pure functions over a timing array, which is what lets
them be tested on the build machine. If a decoder needs something from the
Pico SDK, the design is wrong.

**Learn mode must suppress HID output.** Without it, configuring a remote
fires the keystrokes it is already bound to into the configurator.

## Before committing

```powershell
cd firmware; .\build.ps1 -Test     # 89 decoder checks, then the firmware
cd ..\app;   npm run typecheck
node ..\tools\check-protocol-sync.mjs
```

Add a test to `firmware/test/test_decode.c` for any decoder change. The suite
has already caught real bugs that manual testing would have missed: a
minimum-length guard that silently discarded every NEC repeat frame, and a raw
hash that collided two different buttons.

When a remote misbehaves, capture it rather than reasoning about it.
`build/irprobe.uf2` watches GP2–GP9 at once and prints the raw timings of
every burst in a form that pastes straight into the test file. That is how the
20-bit RC6 bug was found — a Sky remote decoded as address 0, command 0 on
every button, and only the waveform showed why. Two real captures are now
regression tests, and they carry receiver jitter that synthesised frames do
not.

## Toolchain locations on this machine

Nothing is on PATH; `firmware/build.ps1` finds all of it. For reference:

| Tool | Path |
|---|---|
| Pico SDK 2.1.1 | `C:\Users\joelw\pico-sdk` |
| arm-none-eabi-gcc 14.2 | `C:\Users\joelw\arm-toolchain\bin` |
| CMake 4.4.3 | `C:\Program Files\CMake\bin` |
| Ninja | `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Ninja-build.Ninja*` |
| Host gcc (for picotool) | `%LOCALAPPDATA%\Microsoft\WinGet\Packages\BrechtSanders.WinLibs*\mingw64\bin` |
| Python 3.12 | `%LOCALAPPDATA%\Programs\Python\Python312` |

CMake 4 needs `-DCMAKE_POLICY_VERSION_MINIMUM=3.5` to configure the SDK.
The SDK builds `picotool` as a **host** program to produce the `.uf2`, so a
native compiler is needed alongside the cross compiler.

## Things that will bite you

**npm 11 blocks postinstall scripts.** Electron and esbuild will install
without their binaries and fail at build time. `npm install-scripts approve
electron esbuild` fixes it.

**electron-builder's winCodeSign bundle contains macOS symlinks** that Windows
will not create without Developer Mode, so 7-Zip exits 2 and electron-builder
discards a perfectly good extraction. `app/scripts/prepare-wincodesign.mjs`
works around it by extracting the bundle itself and putting it where
electron-builder looks; it runs automatically from `predist`. Do not remove
it, and note this is not an NSIS problem — rcedit lives in the same bundle, so
every Windows target hits it.

**The nsis and portable targets need different `artifactName` templates.**
With a shared one they resolve to the same filename and the portable build
silently overwrites the installer, leaving one file where two were expected.

**Do not use `sed -i '/^$/d'`-style blank-line stripping on source files.** It
destroys readability across the whole file.

## Deliberate decisions worth not re-litigating

- **GPIO interrupt capture, not PIO.** An IR frame is at most a couple of
  hundred edges over 70 ms. The CPU has four orders of magnitude of headroom
  and an ISR is far easier to reason about.
- **Three HID interfaces, not one with report IDs.** The keyboard is alone on
  interface 0 with no report ID so it is boot-protocol compatible and works in
  BIOS menus. The config channel is on a vendor usage page because Chromium
  refuses to open protected ones.
- **WebHID inside Electron, not `node-hid`.** No native module, so no
  node-gyp, no Visual Studio Build Tools, no rebuild per Electron version.
- **Keyboard actions held, media actions tapped.** Holding lets the host apply
  the user's own repeat rate. Hosts do not repeat consumer usages, so a held
  volume key would move the volume exactly one step.
- **One For All codes are not used.** UEI's database is proprietary and not
  redistributable. Protocol-level decoding plus the CC0 Flipper-IRDB delivers
  the same feature legally. See docs/database.md.
