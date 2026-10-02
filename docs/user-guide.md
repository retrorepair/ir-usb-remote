# User guide

## Setting up a remote

### 1. Receiver

Plug the receiver in and press **Connect receiver**. Windows needs no driver —
it is a standard USB keyboard, plus a vendor channel the configurator uses to
talk to it.

The page shows the firmware version, which GPIO the IR receiver is wired to,
and how many buttons are currently stored.

### 2. Remote

Press any button on your remote. The receiver decodes it and shows the
protocol, address and command.

The app then matches that protocol and address against the bundled database of
5,199 remotes. Several models usually share one address, so you get a short
list of candidates rather than a single answer — pick the closest. Every
button in that entry arrives with its IR code already filled in, so there is
nothing to learn.

If nothing matches, or none of them are right, choose **Start from a blank
layout** and pick a size. You then press each button once to teach it.

> While you are on this screen the receiver sends no keystrokes. Without that,
> pressing buttons to configure them would also fire whatever they are already
> bound to, into this window.

### 3. Correcting the layout

This is the screen for fixing a database entry that was only a close guess.

Press buttons on the remote and watch which on-screen button lights up. If the
wrong one lights up, or none does:

- **Select a button** to rename it, move it, delete it, or learn it again.
- **Learn this button** listens for about 1.3 seconds. Press the button on the
  remote once and hold it briefly.
- **Add button** creates a new entry for something the database missed.

Nothing you do here affects the keyboard mapping. Buttons are referenced by
identity, not by position or name, so you can rearrange freely.

#### "This button sent several different codes"

Some protocols flip a bit between consecutive presses, so a TV can tell a real
second press from a held key. If that bit reaches the identity, one button
produces two codes and its mapping works only half the time.

When learning sees this, it offers to **tell the receiver to ignore those
bits**. Accept it, then learn the button again. The fix is stored on the
receiver and applies to every button of that protocol.

### 4. Keyboard mapping

Separate from the layout, on purpose: this screen never touches IR codes.

Start from a preset. Presets fill in every button whose name the database or
template recognised, which is usually most of them:

| Preset | For |
|---|---|
| Generic media keys | Any player. Transport and volume as system media keys. |
| Kodi | Kodi's default keyboard controls. |
| VLC | VLC's defaults, including track cycling and fullscreen. |
| Slide presenter | PowerPoint, Google Slides, PDFs. |
| RetroArch | RetroArch's defaults. |

Then click any button to change what it sends. Three kinds of output:

- **Keyboard key** — an ordinary keystroke, with optional Ctrl/Shift/Alt/Win.
  Press **Press a key to capture** and hit the key you want.
- **Media key** — volume, mute, play/pause, next/previous, browser keys. These
  reach the active player without it needing focus, so volume belongs here.
- **System** — sleep, wake, power down.

#### Repeat while held

Leave repeat **on** for arrows, volume and channel — anything you want to
scroll. Turn it **off** for power, play/pause, digits and menu buttons, where
a stray repeat is a nuisance. The presets already set this sensibly.

Keyboard keys repeat at whatever rate your PC is configured for, because the
receiver simply holds the key down. Media keys are repeated by the receiver
itself, since Windows does not auto-repeat them; their timing is adjustable
under Diagnostics.

### 5. Save to receiver

**Try without saving** loads the mapping into the receiver's memory so you can
test it immediately. Unplugging discards it.

**Save permanently** writes it to flash. The receiver then works on its own,
on any PC, with no software installed.

Before writing, the app tells you about anything that will not work: buttons
with an action but no learned code, and two buttons sharing one IR code.

**Export to file** saves the layout and the mapping together, for backup or
for sharing a profile with someone who has the same remote.

## Troubleshooting

**A button does nothing.** Diagnostics → Start listening, then press it. If a
line appears saying `-> unmapped`, the code is reaching the receiver but no
binding matches — re-learn that button. If no line appears at all, the remote
is not being received: see [hardware.md](hardware.md).

**A button works only every other press.** The remote toggles a bit between
presses. Learn the button again on the Remote screen and accept the offer to
ignore those bits.

**A held button stutters, or repeats when it should not.** Adjust **Release
after silence** under Diagnostics. Too low and the receiver thinks you let go
between the remote's repeat frames; too high and keys linger after you release.
250 ms suits most remotes.

**Volume moves one step and stops.** That binding is a keyboard key rather
than a media key, or it has repeat switched off. Media keys ramp while held.

**Two buttons do the same thing.** Some remotes send one code for two physical
buttons. The Save screen lists these; there is no way around it in software.

**The protocol shows as `Raw`.** The firmware does not model that protocol by
name, so it identifies the button by its timing pattern instead. Everything
still works — only automatic database matching is unavailable, so learn the
buttons from a blank layout.
