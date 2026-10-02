# Hardware

Two parts and three wires.

## Bill of materials

| Part | Notes | Typical cost |
|---|---|---|
| RP2040 board | Raspberry Pi Pico, Pico W, RP2040-Zero, XIAO RP2040 — any of them | £4 – £7 |
| 38 kHz IR receiver module | TSOP38238, TSOP4838, VS1838B, or equivalent | £0.50 – £2 |
| USB cable | Whatever the board takes | — |

Optional, and only if you see unreliable reception: a 100 nF ceramic capacitor
across the receiver's VS and GND pins, and a 100 Ω resistor in series with VS.
Most modules have this filtering on board already.

## Which receiver

You need a **demodulating** receiver — a three-pin module with a metal can that
outputs a clean digital signal. These strip the 38 kHz carrier and give you the
mark/space pattern directly.

Do **not** use a bare IR photodiode or phototransistor. Those output the raw
modulated carrier, which this firmware does not demodulate.

Common part numbers that work: TSOP38238, TSOP4838, TSOP1838, TSOP34838,
VS1838B, HX1838 (the usual cheap module on a small PCB).

36 kHz and 40 kHz receivers also work with most remotes — carrier mismatch
costs range, not correctness — but 38 kHz suits the widest set.

## Wiring

**Check your module's pinout before wiring.** Pin order is not standardised and
reversing VS and GND will destroy the receiver. With the dome facing you, the
TSOP38238 is `OUT · GND · VS`, but the cheap HX1838 PCB modules are often
labelled `S · VCC · GND` or `OUT · GND · VCC` instead — go by the silkscreen.

| Receiver pin | RP2040 pin | Pico physical pin |
|---|---|---|
| OUT / S | GP3 | 5 |
| GND | GND | 3, 8, 13, 18, 23, 28, 33, 38 |
| VS / VCC | 3V3(OUT) | 36 |

```
        TSOP38238 (dome facing you)
         ┌───────────┐
         │   ▄▄▄▄▄   │
         │  ███████  │
         └─┬──┬──┬───┘
           │  │  │
         OUT GND VS
           │  │  └──────── 3V3(OUT), pin 36
           │  └─────────── GND, pin 38
           └────────────── GP3, pin 5
```

These receivers run happily at 3.3 V, so use the board's 3V3 output rather than
VBUS. The output is already logic level and needs no divider.

### Using a different pin

The firmware defaults to GP3 but takes any GPIO:

```powershell
.\build.ps1 -IrGpio 2
```

The configurator shows which pin the connected unit was built for, under
**Receiver**, so there is never any doubt about a board you flashed months ago.

## Placement

- Keep the receiver's dome facing out of the enclosure with line of sight to
  where you will sit. Range is typically 5–10 m.
- Keep it away from the RP2040's USB connector and any switching regulator.
  Some cheap USB chargers and CFL/LED lamps emit enough infrared noise to
  trigger phantom edges; the firmware discards bursts shorter than 8 edges, so
  this shows up as nothing happening rather than as wrong keystrokes.
- Direct sunlight on the receiver saturates it. If reception dies near a
  window, that is usually why.

## Checking it works before configuring anything

Flash the firmware, open the configurator, go to **Diagnostics** and press
**Start listening**. Any button on any remote should produce a line. If
nothing appears:

1. **Status LED.** With the default settings the on-board LED flashes on every
   received code. No flash means nothing is reaching the firmware — suspect
   wiring or the pin number.
2. **Wrong pin.** Check the GPIO shown under **Receiver** matches where you
   actually wired OUT.
3. **VS and GND swapped.** The module will be warm to the touch. Replace it.
4. **A bare photodiode instead of a demodulating module.** See above.
