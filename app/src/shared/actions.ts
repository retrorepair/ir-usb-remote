/*
 * actions.ts - what a button can be mapped to, and the ready-made presets.
 *
 * Keyboard usages are HID usage page 0x07, consumer usages page 0x0C, system
 * usages page 0x01. These are sent verbatim to the firmware, which forwards
 * them to the OS; nothing here is translated or emulated.
 */
import { ActionType, KMOD } from './wire';
import type { Action } from './types';

export interface UsageDef {
  usage: number;
  label: string;
  group: string;
}

/* ------------------------------------------------------------------ */
/* Keyboard (HID page 0x07)                                           */
/* ------------------------------------------------------------------ */
export const KEY_USAGES: UsageDef[] = [
  { usage: 0x28, label: 'Enter', group: 'Navigation' },
  { usage: 0x29, label: 'Escape', group: 'Navigation' },
  { usage: 0x2a, label: 'Backspace', group: 'Navigation' },
  { usage: 0x2b, label: 'Tab', group: 'Navigation' },
  { usage: 0x2c, label: 'Space', group: 'Navigation' },
  { usage: 0x52, label: 'Arrow Up', group: 'Navigation' },
  { usage: 0x51, label: 'Arrow Down', group: 'Navigation' },
  { usage: 0x50, label: 'Arrow Left', group: 'Navigation' },
  { usage: 0x4f, label: 'Arrow Right', group: 'Navigation' },
  { usage: 0x4a, label: 'Home', group: 'Navigation' },
  { usage: 0x4d, label: 'End', group: 'Navigation' },
  { usage: 0x4b, label: 'Page Up', group: 'Navigation' },
  { usage: 0x4e, label: 'Page Down', group: 'Navigation' },
  { usage: 0x49, label: 'Insert', group: 'Navigation' },
  { usage: 0x4c, label: 'Delete', group: 'Navigation' },
  { usage: 0x65, label: 'Menu (context)', group: 'Navigation' },

  ...Array.from({ length: 26 }, (_, i) => ({
    usage: 0x04 + i,
    label: String.fromCharCode(65 + i),
    group: 'Letters',
  })),

  ...Array.from({ length: 9 }, (_, i) => ({
    usage: 0x1e + i,
    label: String(i + 1),
    group: 'Digits',
  })),
  { usage: 0x27, label: '0', group: 'Digits' },

  ...Array.from({ length: 12 }, (_, i) => ({
    usage: 0x3a + i,
    label: `F${i + 1}`,
    group: 'Function' as const,
  })),

  { usage: 0x2d, label: '- (minus)', group: 'Symbols' },
  { usage: 0x2e, label: '= (equals)', group: 'Symbols' },
  { usage: 0x36, label: ', (comma)', group: 'Symbols' },
  { usage: 0x37, label: '. (period)', group: 'Symbols' },
  { usage: 0x38, label: '/ (slash)', group: 'Symbols' },
  { usage: 0x33, label: '; (semicolon)', group: 'Symbols' },
  { usage: 0x35, label: '` (grave)', group: 'Symbols' },
  { usage: 0x2f, label: '[', group: 'Symbols' },
  { usage: 0x30, label: ']', group: 'Symbols' },

  { usage: 0x57, label: 'Keypad +', group: 'Keypad' },
  { usage: 0x56, label: 'Keypad -', group: 'Keypad' },
  { usage: 0x58, label: 'Keypad Enter', group: 'Keypad' },
];

export const KEY_LABEL = new Map(KEY_USAGES.map((k) => [k.usage, k.label]));

/* ------------------------------------------------------------------ */
/* Consumer control (HID page 0x0C)                                   */
/* ------------------------------------------------------------------ */
/*
 * These work regardless of which window has focus, which is why volume and
 * transport controls default to them rather than to keystrokes.
 */
export const CONSUMER_USAGES: UsageDef[] = [
  { usage: 0x00cd, label: 'Play / Pause', group: 'Transport' },
  { usage: 0x00b0, label: 'Play', group: 'Transport' },
  { usage: 0x00b1, label: 'Pause', group: 'Transport' },
  { usage: 0x00b7, label: 'Stop', group: 'Transport' },
  { usage: 0x00b5, label: 'Next Track', group: 'Transport' },
  { usage: 0x00b6, label: 'Previous Track', group: 'Transport' },
  { usage: 0x00b3, label: 'Fast Forward', group: 'Transport' },
  { usage: 0x00b4, label: 'Rewind', group: 'Transport' },
  { usage: 0x00b2, label: 'Record', group: 'Transport' },

  { usage: 0x00e2, label: 'Mute', group: 'Volume' },
  { usage: 0x00e9, label: 'Volume Up', group: 'Volume' },
  { usage: 0x00ea, label: 'Volume Down', group: 'Volume' },

  { usage: 0x0223, label: 'Browser Home', group: 'Applications' },
  { usage: 0x0224, label: 'Browser Back', group: 'Applications' },
  { usage: 0x0225, label: 'Browser Forward', group: 'Applications' },
  { usage: 0x0221, label: 'Search', group: 'Applications' },
  { usage: 0x0183, label: 'Media Player', group: 'Applications' },
  { usage: 0x018a, label: 'Mail', group: 'Applications' },
  { usage: 0x0192, label: 'Calculator', group: 'Applications' },
  { usage: 0x0194, label: 'File Browser', group: 'Applications' },

  { usage: 0x006f, label: 'Brightness Up', group: 'Display' },
  { usage: 0x0070, label: 'Brightness Down', group: 'Display' },
];

export const CONSUMER_LABEL = new Map(CONSUMER_USAGES.map((k) => [k.usage, k.label]));

/* ------------------------------------------------------------------ */
/* System control (HID page 0x01)                                     */
/* ------------------------------------------------------------------ */
export const SYSTEM_USAGES: UsageDef[] = [
  { usage: 0x81, label: 'Power Down', group: 'System' },
  { usage: 0x82, label: 'Sleep', group: 'System' },
  { usage: 0x83, label: 'Wake Up', group: 'System' },
];

export const SYSTEM_LABEL = new Map(SYSTEM_USAGES.map((k) => [k.usage, k.label]));

/* ------------------------------------------------------------------ */
/* Formatting                                                         */
/* ------------------------------------------------------------------ */
export function modsToText(mods: number): string {
  const parts: string[] = [];
  if (mods & KMOD.LCTRL) parts.push('Ctrl');
  if (mods & KMOD.LSHIFT) parts.push('Shift');
  if (mods & KMOD.LALT) parts.push('Alt');
  if (mods & KMOD.LGUI) parts.push('Win');
  if (mods & KMOD.RCTRL) parts.push('RCtrl');
  if (mods & KMOD.RSHIFT) parts.push('RShift');
  if (mods & KMOD.RALT) parts.push('AltGr');
  if (mods & KMOD.RGUI) parts.push('RWin');
  return parts.join(' + ');
}

export function actionToText(a: Action | undefined): string {
  if (!a || a.type === ActionType.None) return '—';
  switch (a.type) {
    case ActionType.Key: {
      const m = modsToText(a.mods);
      /*
       * A chord of modifiers with no ordinary key is a real binding, not an
       * incomplete one: MiSTer's USER button is Left Ctrl + Left Alt + Right
       * Alt and nothing else. The firmware sends it correctly already --
       * usage 0 simply leaves the keycode slot empty.
       */
      if (a.usage === 0) return m ? `${m} (modifiers only)` : '—';
      const name = KEY_LABEL.get(a.usage) ?? `0x${a.usage.toString(16)}`;
      return m ? `${m} + ${name}` : name;
    }
    case ActionType.Consumer:
      return CONSUMER_LABEL.get(a.usage) ?? `Consumer 0x${a.usage.toString(16)}`;
    case ActionType.System:
      return SYSTEM_LABEL.get(a.usage) ?? `System 0x${a.usage.toString(16)}`;
  }
}

/* ------------------------------------------------------------------ */
/* Presets                                                            */
/* ------------------------------------------------------------------ */
const key = (usage: number, mods = 0): Action => ({ type: ActionType.Key, usage, mods });
const con = (usage: number): Action => ({ type: ActionType.Consumer, usage });
const sys = (usage: number): Action => ({ type: ActionType.System, usage });

/** Mapped by canonical button name, so a preset applies to any remote. */
export type PresetMap = Record<string, Action>;

export interface Preset {
  id: string;
  name: string;
  description: string;
  map: PresetMap;
}

/* Volume, mute and transport are consumer usages in every preset: they work
 * without the target application having focus. */
const MEDIA_CORE: PresetMap = {
  vol_up: con(0x00e9),
  vol_down: con(0x00ea),
  mute: con(0x00e2),
  power: sys(0x82),
};

const ARROWS: PresetMap = {
  up: key(0x52),
  down: key(0x51),
  left: key(0x50),
  right: key(0x4f),
  ok: key(0x28),
};

const DIGITS: PresetMap = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [`num_${i}`, key(i === 0 ? 0x27 : 0x1e + i - 1)])
);

export const PRESETS: Preset[] = [
  {
    id: 'media',
    name: 'Generic media keys',
    description:
      'Transport and volume as system media keys, arrows for navigation. Works in any player without configuration.',
    map: {
      ...MEDIA_CORE,
      ...ARROWS,
      play_pause: con(0x00cd),
      play: con(0x00b0),
      pause: con(0x00b1),
      stop: con(0x00b7),
      next: con(0x00b5),
      prev: con(0x00b6),
      fast_forward: con(0x00b3),
      rewind: con(0x00b4),
      back: key(0x29),
      home: con(0x0223),
      menu: key(0x65),
    },
  },
  {
    id: 'kodi',
    name: 'Kodi',
    description: "Kodi's default keyboard controls. A good starting point for a media centre.",
    map: {
      ...MEDIA_CORE,
      ...ARROWS,
      ...DIGITS,
      back: key(0x2a), // Backspace
      home: key(0x29), // Escape
      menu: key(0x06), // C, context menu
      info: key(0x0c), // I
      play_pause: key(0x2c), // Space
      play: key(0x13), // P
      stop: key(0x1b), // X
      next: key(0x37), // .
      prev: key(0x36), // ,
      fast_forward: key(0x09), // F
      rewind: key(0x15), // R
      subtitle: key(0x17), // T
      audio: key(0x04), // A
      guide: key(0x08), // E, playlist
      exit: key(0x29),
    },
  },
  {
    id: 'vlc',
    name: 'VLC',
    description: "VLC's default shortcuts, including frame step and fullscreen.",
    map: {
      ...MEDIA_CORE,
      ...ARROWS,
      play_pause: key(0x2c), // Space
      stop: key(0x16), // S
      next: key(0x11), // N
      prev: key(0x13), // P
      fast_forward: key(0x4f), // Right, seek forward
      rewind: key(0x50), // Left, seek back
      subtitle: key(0x1a), // V, cycle subtitle track
      audio: key(0x05), // B, cycle audio track
      info: key(0x0c), // I
      menu: key(0x09), // F, fullscreen
      back: key(0x29),
    },
  },
  {
    id: 'presenter',
    name: 'Slide presenter',
    description: 'Drive PowerPoint, Google Slides or a PDF from across the room.',
    map: {
      up: key(0x4b), // Page Up
      down: key(0x4e), // Page Down
      left: key(0x4b),
      right: key(0x4e),
      ok: key(0x4e),
      next: key(0x4e),
      prev: key(0x4b),
      play_pause: key(0x3e), // F5, start slideshow
      back: key(0x29), // Escape, end slideshow
      exit: key(0x29),
      home: key(0x4a),
      info: key(0x05), // B, blank screen
      vol_up: con(0x00e9),
      vol_down: con(0x00ea),
      mute: con(0x00e2),
    },
  },
  {
    id: 'mister',
    name: 'MiSTer FPGA',
    description:
      "MiSTer's OSD and global hotkeys: F12 opens the menu, arrows navigate, and the two reset chords sit on the colour keys.",
    map: {
      ...ARROWS,
      ...DIGITS,
      menu: key(0x45), // F12, open the OSD
      home: key(0x45),
      back: key(0x29), // Escape
      exit: key(0x29),
      play_pause: key(0x2c), // Space
      source: key(0x45, KMOD.LALT), // Alt+F12, quick core select
      /*
       * MiSTer's USER button -- reset within the emulated system -- is a
       * chord of modifiers with no ordinary key. The firmware sends that
       * correctly; the keycode slot is simply left empty.
       */
      red: key(0, KMOD.LCTRL | KMOD.LALT | KMOD.RALT),
      /* Full MiSTer reset, back to the Menu core. */
      green: key(0, KMOD.LSHIFT | KMOD.LCTRL | KMOD.LALT | KMOD.RALT),
      vol_up: con(0x00e9),
      vol_down: con(0x00ea),
      mute: con(0x00e2),
    },
  },
  {
    id: 'mister-dvd',
    name: 'MiSTer DVD player',
    description:
      "The DVD core's own keys, from its manual: transport, disc/title/chapter menus, and subtitle, audio and angle cycling.",
    map: {
      ...ARROWS,
      ...DIGITS, // 0-9 select menu buttons by number
      play_pause: key(0x2c), // Space
      play: key(0x2c),
      pause: key(0x2c),
      stop: key(0x14), // Q
      prev: key(0x4b), // Page Up, previous chapter
      next: key(0x4e), // Page Down, next chapter
      rewind: key(0x15), // R
      fast_forward: key(0x09), // F
      back: key(0x29), // Escape, go up
      exit: key(0x29),
      menu: key(0x10), // M, disc menu
      home: key(0x17), // T, title menu
      guide: key(0x3e), // F5, chapter menu
      subtitle: key(0x16), // S
      audio: key(0x04), // A
      info: key(0x07), // D, toggle the status line
      source: key(0x1d), // Z, cycle aspect ratio
      /*
       * The core's own volume keys rather than media keys: these change the
       * player's output directly, which is what you want on the core itself.
       */
      vol_up: key(0x57), // Keypad +
      vol_down: key(0x56), // Keypad -
      mute: con(0x00e2),
    },
  },
  {
    id: 'retroarch',
    name: 'RetroArch',
    description: "RetroArch's default bindings: arrows to move, Enter to confirm, F1 for the menu.",
    map: {
      ...ARROWS,
      ...DIGITS,
      back: key(0x2a),
      menu: key(0x3a), // F1
      exit: key(0x29),
      play_pause: key(0x13), // P, pause
      stop: key(0x3a),
      info: key(0x0c),
      vol_up: con(0x00e9),
      vol_down: con(0x00ea),
      mute: con(0x00e2),
      fast_forward: key(0x1c), // Y, hold fast-forward
      record: key(0x3d), // F4
    },
  },
];

/** Buttons where auto-repeat is unhelpful or harmful. */
export const NO_REPEAT_BY_DEFAULT = new Set([
  'power',
  'power_on',
  'power_off',
  'play_pause',
  'play',
  'pause',
  'stop',
  'mute',
  'record',
  'source',
  'menu',
  'home',
  'exit',
  'subtitle',
  'audio',
  'text',
  ...Array.from({ length: 10 }, (_, i) => `num_${i}`),
]);
