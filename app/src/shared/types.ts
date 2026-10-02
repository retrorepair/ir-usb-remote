/*
 * types.ts - the app's data model.
 *
 * The central design point, and the thing that makes the two editors
 * independent: a RemoteProfile says which IR code each physical button sends,
 * and a Keymap says what each button should DO. A Keymap refers to buttons by
 * id, never by IR code.
 *
 * So correcting a wrong layout -- renaming a button, re-learning its code,
 * moving it, adding one the database missed -- leaves the keyboard mapping
 * untouched. And one Keymap can be reused across different remotes.
 */
import { ActionType } from './wire';

export type Action =
  | { type: ActionType.None }
  | { type: ActionType.Key; usage: number; mods: number }
  | { type: ActionType.Consumer; usage: number }
  | { type: ActionType.System; usage: number };

export const NO_ACTION: Action = { type: ActionType.None };

export interface RemoteButton {
  /** Stable within the profile. Keymaps key off this, so it must never change. */
  id: string;
  /** Shown in the UI. Freely editable; purely cosmetic. */
  label: string;
  /**
   * Canonical name ('vol_up', 'ok', 'num_7', ...) when recognised. This is
   * what lets a keymap preset fill itself in automatically.
   */
  canon?: string;
  /** Position on the editable grid. */
  row: number;
  col: number;
  /** Identity key as text, or null when this button has not been learned. */
  key: string | null;
}

export interface RemoteProfile {
  id: string;
  name: string;
  brand?: string;
  model?: string;
  /** ir_protocol_t id and address shared by the whole remote. */
  protocol: number;
  address: number;
  /** Where the layout came from, so the UI can say so honestly. */
  source: 'database' | 'template' | 'learned';
  /** Row in the bundled database this started from, if any. */
  dbIndex?: number;
  buttons: RemoteButton[];
  updated: string;
}

export interface Keymap {
  id: string;
  name: string;
  /** buttonId -> action. Buttons absent from here simply do nothing. */
  bindings: Record<string, Action>;
  /** buttonId -> suppress auto-repeat (power, play/pause, digits). */
  noRepeat: Record<string, boolean>;
  updated: string;
}

/** Everything the app persists between runs. */
export interface AppData {
  version: 1;
  profiles: RemoteProfile[];
  keymaps: Keymap[];
  activeProfileId: string | null;
  activeKeymapId: string | null;
}

export const EMPTY_APP_DATA: AppData = {
  version: 1,
  profiles: [],
  keymaps: [],
  activeProfileId: null,
  activeKeymapId: null,
};

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Deterministic button id from a name, kept readable for debugging. */
export function buttonIdFor(name: string, taken: Set<string>): string {
  const base =
    'btn_' +
    (name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'x');
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}_${n++}`;
  taken.add(id);
  return id;
}
