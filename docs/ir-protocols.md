# IR protocols

What the firmware decodes, how, and where the limits are.

All timings are microseconds. `d[0]` is always a mark, because the demodulator
idles high and capture starts on the first falling edge. The trailing idle
space is never recorded — no edge ends it — so every decoder tolerates the
final space being absent.

## Decoded by name

| Protocol | Header mark / space | Bit encoding | Bits | Address | Command |
|---|---|---|---|---|---|
| NEC | 9000 / 4500 | space 560 = 0, 1690 = 1 | 32 | 8-bit | 8-bit |
| NEC extended | 9000 / 4500 | as NEC | 32 | 16-bit | 8-bit |
| Samsung32 | 4500 / 4500 | as NEC | 32 | 16-bit | 8-bit |
| Kaseikyo / Panasonic | 3456 / 1728 | space 432 = 0, 1296 = 1 | 48 | low 24 bits | high 24 bits |
| JVC | 8400 / 4200 | space 525 = 0, 1575 = 1 | 16 | 8-bit | 8-bit |
| Sony SIRC 12/15/20 | 2400 / 600 | mark 600 = 0, 1200 = 1 | 12/15/20 | 5/8/13-bit | 7-bit |
| RC5 | none (biphase) | 889 half-bit | 14 | 5-bit | 6-bit |
| RC5X | none (biphase) | 889 half-bit | 14 | 5-bit | 7-bit |
| RC6 mode 0 | 2664 / 888 | 444 unit, biphase | 16 | 8-bit | 8-bit |
| RC6-6A (Media Center) | 2664 / 888 | 444 unit, biphase | 8–32 | 24-bit | 8-bit |

### How a bit value is decided

Structural timings — headers, bit marks — are checked against a tolerance
window. Bit *values* are decided with a midpoint threshold instead. A window
wide enough for a cheap remote's clock would make the short and long symbols
overlap: Sony's 600 and 1200 µs marks are only a factor of two apart, and a
30% window on each already touches.

### Protocols whose headers overlap

Two pairs are separated by a single timing, which the decoders check more
tightly than they check anything else:

- **RC6 vs Sony.** RC6's 2664 µs leader mark falls inside Sony's 2400 µs
  header window. Only the leader space tells them apart — 888 vs 600 µs — so
  both decoders check it with a deliberately narrow tolerance. A regression
  test asserts neither claims the other's frames.
- **NEC vs JVC.** Both open with roughly 9000 / 4500. They are separated by
  frame length: NEC requires 66 durations, JVC accepts 34 to 36.

### Toggle bits

Several protocols flip a bit between consecutive presses so a device can tell
a real second press from a held key. If that bit reached the identity key, one
physical button would produce two codes and its binding would match only half
the time. Each decoder strips its own:

- **RC5 / RC5X** — frame bit 2. Never folded into the command.
- **RC6 mode 0** — the double-width trailer bit.
- **RC6-6A** — payload bit 15, which lands inside the address field.

For anything not covered, the configurator notices one button producing two
codes during learning and offers to store a mask on the device.

## Identified by timing pattern

Anything not claimed above is hashed. This is what makes the receiver
genuinely universal rather than limited to the table.

Every IR protocol builds its symbols from whole multiples of one time unit,
because they all come from a single clock. So the hash expresses each duration
as a multiple of the shortest symbol in the frame, and hashes those multiples
with FNV-1a.

That is scale-invariant — a remote whose crystal runs 10% fast scales the unit
by the same 10% and produces identical multiples — while still distinguishing
symbols of different lengths.

> An earlier version compared each duration only with its neighbour, recording
> "longer", "shorter" or "similar". The decoder tests caught the flaw: a
> protocol with a 400 µs mark and both 900 µs and 1500 µs spaces hashed
> identically either way, because both spaces are merely "longer" than the
> mark, so two different buttons collided.

Bursts shorter than 8 durations are never hashed, so electrical noise and
fluorescent-lamp flicker cannot invent an identity. A truncated burst is
discarded for the same reason — its hash would depend on where the cut fell.

## Known limitations

**JVC repeats.** JVC omits the header on the repeat frames of a held key,
which makes them indistinguishable from an arbitrary pulse-distance burst.
They fall through to the raw hash, so a held JVC button does not auto-repeat.
Guessing that a headerless burst "must" belong to the previous frame would
mis-attribute genuinely unknown remotes, so it is left alone.

**Sharp, Denon and RCA.** Reserved in the protocol enum but not decoded. All
three are headerless, which makes them hard to separate from each other and
from noise without a false-positive rate that would hurt more than it helps.
Remotes using them work through the raw hash.

**Kaseikyo field layout.** The 48 bits are split losslessly into the identity
key's 24-bit address and 24-bit command fields, which is a packing choice
rather than the protocol's actual field layout. It is stable and
collision-free, which is all identity needs. Database matching for Panasonic
is on the vendor code, which this preserves exactly.

**Air conditioners.** AC remotes send long state frames encoding the whole
unit state, not a button code. They decode as `Raw` and each distinct state
hashes differently, so they are a poor fit for key mapping. The database
contains many of them; they are matched and shown, but mapping them is not
useful.

## Testing

`firmware/test/test_decode.c` synthesises the waveform a real remote would
emit for each protocol — including the detail that the trailing space is never
captured — and asserts the decoder recovers the original address and command.

It also asserts the two properties that matter as much as round-tripping:

- identity is stable across each protocol's toggle bit;
- protocols with overlapping header windows do not claim each other's frames.

Plus NEC under 8% jitter, NEC rejecting a frame that fails its own checksum,
raw-hash stability under a 10% clock error, and that the wire structures are
still the exact sizes both sides assume.

```powershell
cd firmware
.\build.ps1 -Test
```

89 checks. They run on your PC, not on the board, because the decoders are
pure functions over a timing array with no SDK dependency — which is also why
`firmware/test/CMakeLists.txt` links only `ir_decode.c` and `ir_protocol.c`.
