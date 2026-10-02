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

## Salvaging a TV sensor board

A sensor board out of a dead TV works well — often better than a bare TSOP,
because it already has a moulded lens and ESD protection. The catch is that
these boards are proprietary, carry four to eight unlabelled wires, and no
manufacturer publishes a pinout.

They are still easy to work out, because the part you care about needs only
three connections no matter how many pins its package has. A Samsung
BN41-02150A, for instance, carries a nine-lead module — but that is an IR
receiver and the TV's standby LED moulded together, and most of those leads
are die-attach and shield.

### Finding the wires

With the board **unpowered** and a multimeter:

1. **Ground** — continuity from each wire to the large copper pour, or to the
   plated ring around a mounting hole. Exactly one wire beeps.
2. **Supply** — find the decoupling capacitor nearest the sensor. It sits
   between the supply pin and ground; the wire feeding its non-ground side is
   Vcc.
3. **Separate the LED wires from the signal.** Put the meter in **diode
   mode** and probe each remaining wire against ground. An indicator LED
   shows a real diode drop of 1.8–2.2 V, and on many meters will visibly
   glow. **The IR output shows no diode drop.** That one test splits them.

Any wire left over is usually an ambient-light ("eco") sensor, which outputs
a slowly-varying analogue level rather than digital pulses — harmless, and
easy to spot because shading the board changes it.

### Finding the output without guessing

`build/irprobe.uf2` exists for this. It watches **GP2 to GP9 at once** and
reports which pin carries IR, so there is no rewire-and-reflash cycle per
candidate.

1. Flash `irprobe.uf2` the same way as the main firmware.
2. Power the sensor board from **3V3 and GND**.
3. Connect every unidentified wire to a different pin in GP2–GP9.
4. Open the USB serial port it creates (any terminal; baud rate is ignored).
5. Press a button on a remote.

```
GP5   67 edges  NEC        addr=0x0707 cmd=0x02  32b
--- idle levels: GP2=L(0) GP3=H(0) GP4=H(0) GP5=H(4) GP6=L(0) ...
```

The pin reporting bursts is the output. A pin idling HIGH with no bursts is
probably the supply or an unused line; one idling LOW is not the output.

Undecodable bursts get their raw timings printed, which is what to look at if
a board needs different biasing or a wire is picking up something else.

Then move that wire to GP3 and flash the real firmware — or keep it where it
is and rebuild with `.\build.ps1 -IrGpio 5`.

> ⚠️ **Power salvaged boards from 3V3, never VBUS.** RP2040 GPIOs are not 5 V
> tolerant. These receivers run happily at 3.3 V even if the TV fed them 5 V,
> and at 3.3 V their output is safe for the RP2040. Current draw should be
> around 1 mA; tens of mA means a wire is wrong — stop and recheck.

### Worked example: Samsung BN41-02150A (`UH5000_IR`)

The IR board from a UH5000-chassis Samsung — UE32J5100, UN58H5202, LT32E390
and others. Its sensor is a nine-lead module combining the IR receiver, a red
standby LED and an ambient-light sensor, with a 6-wire cable.

| Cable pin | Function | Connect to |
|---|---|---|
| 1 | Red indicator LED, anode | a GPIO, via a resistor — optional |
| 2 | Ground | GND |
| 3 | unidentified | leave disconnected |
| 4 | Ambient light sensor output | leave disconnected |
| 5 | Vcc | 3V3 |
| 6 | **IR output** | **GP3** |

Only pins 2, 5 and 6 are needed. Three of the nine module leads do the work;
the rest serve the LED, the light sensor and the lead frame.

Diode-mode readings against ground were 1.6–2.0 V on every signal pin, which
is why that test alone cannot finish the job here: forcing a meter's test
current into an IC supply pin partially powers the chip and lands in the same
range as an LED's forward voltage. What separates them is that **an LED
visibly glows** under the diode test and an IC pin does not.

To use the board's own LED as the activity indicator — the TV's standby light
blinking as codes arrive — wire pin 1 to a spare GPIO and build with:

```powershell
.\build.ps1 -IrGpio 3 -LedGpio 15
```

Check first whether the series resistor for that LED is on the sensor board or
was on the TV's main board. If pin 1 reads only a few ohms to the LED's anode
pad, there is no resistor on this side: add 220–470 Ω, or the GPIO will be
driving the LED at whatever its drive strength allows.

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
