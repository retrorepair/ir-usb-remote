# Handoff — 2 October 2026

Built from scratch and **validated end to end on real hardware** in one session.

## State: working

A salvaged Samsung BN41-02150A sensor board on a Pico, driven by a Sky remote
and a Sony remote, configured through the desktop app, with the TV's own
indicator LED as the activity light.

### Verified on hardware

| What | Evidence |
|---|---|
| IR reception | Sony SIRC12 and Sky RC6-6-20 decoded live |
| Salvaged sensor board | pinout mapped; pins 2/5/6 are GND/Vcc/IR out |
| USB enumeration | all three HID interfaces, serial `5303284748AB2E1C` |
| Hand-written system-control descriptor | Windows parsed it |
| WebHID connect | works from the packaged app |
| Status LED | blinks on receive, on the TV's own LED via GP15 |
| Decoders | 95 host checks, including two real captured waveforms |
| Protocol sync | 45 checks, C headers against the TypeScript mirror |
| Installer | NSIS + portable, both build, app launches |

### Bugs real hardware found that nothing else would have

1. **WebHID connect never worked.** `setDevicePermissionHandler` tested
   `details.device.collections`, which Electron does not populate there, so
   every device was denied on every machine.
2. **The status LED compiled away entirely.** `led.c` resolved `IR_LED_GPIO`
   from `PICO_DEFAULT_LED_PIN` without including the SDK header that defines
   it, so the file became do-nothing stubs. `main.c` saw the right value, so
   nothing warned.
3. **20-bit RC6 was truncated to 16.** Sky remotes use RC6-6-20; rounding the
   bit count down to a byte boundary discarded the only four bits carrying the
   command, and every button decoded as address 0, command 0.
4. **The search box vanished** after deleting a remote, because it sat inside
   a `frame && ...` block.
5. **`build.ps1` could not run at all** — `$Pid` is a read-only PowerShell
   automatic variable, `Get-Command` rejects a null name, and Python resolved
   to the Microsoft Store alias stub.

## Still outstanding

- **A real USB VID/PID.** Still the pid.codes test pair `1209:0001`. The app
  warns on screen. See docs/branding.md. Note it now appears in two places:
  the firmware build and `ALLOWED_VENDOR_IDS` in `app/electron/main.js`.
- **Code signing.** Unsigned installers trip SmartScreen.
- **Sky remotes do not match the database.** Flipper parses Sky as RC6 mode 0
  address `0xF3`; we decode mode 6 with a 20-bit payload. Learning works
  perfectly, so only the pre-filled layout is lost. Worth reconciling if Sky
  support matters commercially.
- Sharp, Denon and RCA decoders — reserved, unimplemented, covered by the raw
  hash.
- Held JVC buttons do not auto-repeat (JVC omits the header on repeats).
- macOS and Linux packaging.

## Notes for next time

- `irprobe.uf2` finds the IR output on an unknown board by watching GP2–GP9 at
  once and printing raw timings for every burst. It also accepts the
  1200-baud BOOTSEL reset, so reflashing needs no button press.
- The decoder tests take real captured waveforms, not just synthesised ones.
  Add captures when a new remote misbehaves; `irprobe` prints them in a form
  that pastes straight into `test_decode.c`.
