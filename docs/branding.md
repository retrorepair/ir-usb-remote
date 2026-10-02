# Before you sell this

Three things stand between this repository and a product you can charge for.
None is hard, but all three are easy to miss until a customer hits them.

## 1. USB vendor and product ID — required

The firmware defaults to **`1209:0001`**, which is the
[pid.codes](https://pid.codes/) *test* pair. It is explicitly reserved for
development and must never ship. Two devices on one PC sharing it will collide,
and it marks the product as unfinished to anyone who looks.

The configurator shows a warning banner whenever it sees that pair, so this
cannot ship unnoticed.

Three legitimate routes:

| Route | Cost | Notes |
|---|---|---|
| **pid.codes allocation** | free | For open-source hardware. Request a PID under VID `0x1209` by pull request. Requires the design to be open. |
| **Raspberry Pi PID sublicence** | free | Raspberry Pi allocates PIDs under their VID `0x2E8A` for RP2040 products. Apply to them directly. |
| **Your own USB-IF vendor ID** | US$6,000 one-off | Only worth it for a product line, but it is yours outright. |

Build with your allocation:

```powershell
.\build.ps1 -UsbVid 0x1209 -UsbPid 0xC0DE
```

Then update `DEV_VID` / `DEV_PID` in `app/src/shared/device.ts` so the
configurator's warning stops firing on your own hardware.

Also set a real manufacturer and product string, which appear in Device
Manager:

```powershell
cmake -DUSB_MANUFACTURER="Your Company" -DUSB_PRODUCT="Model Name" ...
```

The USB serial number is derived from the RP2040's unique flash id, so every
unit is already distinguishable without you doing anything.

## 2. Code signing — strongly recommended

An unsigned installer triggers SmartScreen's "Windows protected your PC"
dialog, which most buyers read as "this is malware". Reputation accrues per
certificate, so a cheap certificate still starts from zero and takes downloads
to warm up.

| Option | Cost per year | SmartScreen |
|---|---|---|
| OV code signing certificate | ~£200–£400 | Warns until reputation builds |
| EV code signing certificate | ~£300–£600 | Trusted immediately |
| Ship unsigned | free | Warns indefinitely |

EV is worth it if you are selling. Once you have a certificate, electron-builder
signs automatically from environment variables:

```powershell
$env:CSC_LINK = 'C:\path\to\certificate.pfx'
$env:CSC_KEY_PASSWORD = '...'
npm run dist
```

The firmware `.uf2` needs no signing — it is copied to a mass-storage device,
not executed by Windows.

## 3. Licences you are redistributing

| Component | Licence | Obligation |
|---|---|---|
| This project | MIT | Include the copyright notice |
| Pico SDK | BSD-3-Clause | Include the notice |
| TinyUSB | MIT | Include the notice |
| Flipper-IRDB (remote database) | CC0-1.0 | None — public domain |
| Electron, React, Vite | MIT | Include the notices |

Nothing here is copyleft and nothing requires you to publish your changes. Ship
a combined third-party notices file with the installer and you are done.

See [database.md](database.md) for why the remote database is specifically the
CC0 one, and what was deliberately left out.

## A checklist before the first batch

- [ ] Own VID/PID built in, configurator warning gone
- [ ] Manufacturer and product strings set to your branding
- [ ] Installer signed, or the SmartScreen warning documented for buyers
- [ ] Third-party notices shipped
- [ ] `IR_GPIO` matches the pin your PCB actually uses
- [ ] Decoder tests pass on the exact commit you are shipping (`build.ps1 -Test`)
- [ ] `npm run check:protocol` passes, so firmware and app agree
- [ ] A unit flashed from the release `.uf2` tested end to end with a real remote
- [ ] Decide whether to ship FCC/CE-relevant documentation — a USB HID device
      with no radio is low-risk, but selling in the EU/UK still implies a
      declaration of conformity
