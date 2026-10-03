/*
 * store.ts - app state, persistence, and turning a profile plus a keymap into
 * the flat binding table the device wants.
 */
import { ActionType, BIND_NO_REPEAT, BIND_HOLD, type WireBinding } from './wire';
import { decodeKey } from './irProtocol';
import {
  EMPTY_APP_DATA,
  newId,
  type Action,
  type AppData,
  type Keymap,
  type RemoteProfile,
} from './types';
import { NO_REPEAT_BY_DEFAULT, PRESETS, type Preset } from './actions';

const STORAGE_KEY = 'ir-remote-configurator.v1';

let data: AppData = load();
const listeners = new Set<() => void>();

function load(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_APP_DATA };
    const parsed = JSON.parse(raw) as AppData;
    if (parsed.version !== 1) return { ...EMPTY_APP_DATA };
    return parsed;
  } catch {
    /* Corrupt or unreadable storage must not stop the app from opening. */
    return { ...EMPTY_APP_DATA };
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* Out of quota: the session still works, it just will not be remembered. */
  }
}

function commit(next: AppData) {
  data = next;
  persist();
  for (const fn of listeners) fn();
}

// --- React integration (useSyncExternalStore) -----------------------------
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function getSnapshot(): AppData {
  return data;
}

// --- Profiles -------------------------------------------------------------
export function addProfile(p: RemoteProfile) {
  commit({
    ...data,
    profiles: [...data.profiles, p],
    activeProfileId: p.id,
  });
}

export function updateProfile(p: RemoteProfile) {
  commit({
    ...data,
    profiles: data.profiles.map((x) => (x.id === p.id ? { ...p, updated: new Date().toISOString() } : x)),
  });
}

export function deleteProfile(id: string) {
  commit({
    ...data,
    profiles: data.profiles.filter((p) => p.id !== id),
    activeProfileId: data.activeProfileId === id ? null : data.activeProfileId,
  });
}

export function setActiveProfile(id: string | null) {
  commit({ ...data, activeProfileId: id });
}

export function activeProfile(): RemoteProfile | null {
  return data.profiles.find((p) => p.id === data.activeProfileId) ?? null;
}

// --- Keymaps --------------------------------------------------------------
export function addKeymap(k: Keymap) {
  commit({ ...data, keymaps: [...data.keymaps, k], activeKeymapId: k.id });
}

export function updateKeymap(k: Keymap) {
  commit({
    ...data,
    keymaps: data.keymaps.map((x) => (x.id === k.id ? { ...k, updated: new Date().toISOString() } : x)),
  });
}

export function deleteKeymap(id: string) {
  commit({
    ...data,
    keymaps: data.keymaps.filter((k) => k.id !== id),
    activeKeymapId: data.activeKeymapId === id ? null : data.activeKeymapId,
  });
}

export function setActiveKeymap(id: string | null) {
  commit({ ...data, activeKeymapId: id });
}

export function activeKeymap(): Keymap | null {
  return data.keymaps.find((k) => k.id === data.activeKeymapId) ?? null;
}

/**
 * A keymap built from a preset for a given profile.
 *
 * The preset is keyed by canonical button name, so it only fills in buttons
 * the database or template recognised. Anything unrecognised is left unmapped
 * rather than guessed at, and shows up in the editor for the user to assign.
 */
export function keymapFromPreset(preset: Preset, profile: RemoteProfile): Keymap {
  const bindings: Record<string, Action> = {};
  const noRepeat: Record<string, boolean> = {};

  for (const b of profile.buttons) {
    if (!b.canon) continue;
    const action = preset.map[b.canon];
    if (!action) continue;
    bindings[b.id] = action;
    if (NO_REPEAT_BY_DEFAULT.has(b.canon)) noRepeat[b.id] = true;
  }

  return {
    id: newId('keymap'),
    name: `${preset.name} — ${profile.name}`,
    bindings,
    noRepeat,
    updated: new Date().toISOString(),
  };
}

export function emptyKeymap(name: string): Keymap {
  return { id: newId('keymap'), name, bindings: {}, noRepeat: {}, updated: new Date().toISOString() };
}

export { PRESETS };

// --- Resolving to device bindings ----------------------------------------

export interface ResolveResult {
  bindings: WireBinding[];
  /** Buttons that have an action but no learned IR code. */
  unlearned: string[];
  /** Buttons with a code but no action; harmless, reported for clarity. */
  unmapped: string[];
  /** Two buttons sharing one IR code, so only the first could be written. */
  duplicates: string[];
}

/**
 * Flatten a profile and keymap into the device's binding table.
 *
 * Only buttons with BOTH a learned code and an action produce a binding --
 * everything else is reported so the UI can say exactly what will not work
 * rather than writing a table that silently does less than expected.
 */
export function resolveBindings(profile: RemoteProfile, keymap: Keymap): ResolveResult {
  const bindings: WireBinding[] = [];
  const unlearned: string[] = [];
  const unmapped: string[] = [];
  const duplicates: string[] = [];
  const seen = new Map<string, string>();

  for (const b of profile.buttons) {
    const action = keymap.bindings[b.id];
    const hasAction = action && action.type !== ActionType.None;

    if (!hasAction) {
      if (b.key) unmapped.push(b.label);
      continue;
    }
    if (!b.key) {
      unlearned.push(b.label);
      continue;
    }
    if (seen.has(b.key)) {
      duplicates.push(`${b.label} (same code as ${seen.get(b.key)})`);
      continue;
    }
    seen.set(b.key, b.label);

    /* hasAction above has already excluded ActionType.None, so `usage` is
     * present on every remaining variant. */
    bindings.push({
      key: decodeKey(b.key),
      action: action.type,
      mods: action.type === ActionType.Key ? action.mods : 0,
      code: action.usage,
      flags:
        (keymap.noRepeat[b.id] ? BIND_NO_REPEAT : 0) |
        (keymap.hold?.[b.id] ? BIND_HOLD : 0),
    });
  }

  return { bindings, unlearned, unmapped, duplicates };
}

// --- Import / export ------------------------------------------------------
export function exportProfile(profile: RemoteProfile, keymap: Keymap | null): string {
  return JSON.stringify(
    { kind: 'ir-remote-config', version: 1, profile, keymap },
    null,
    2
  );
}

export function importBundle(text: string): { profile: RemoteProfile; keymap: Keymap | null } {
  const parsed = JSON.parse(text);
  if (parsed?.kind !== 'ir-remote-config' || parsed.version !== 1) {
    throw new Error('Not an IR Remote configuration file.');
  }
  if (!parsed.profile?.buttons?.length) throw new Error('File contains no remote profile.');

  /* New ids, so importing never collides with what is already stored. */
  const profile: RemoteProfile = { ...parsed.profile, id: newId('profile') };
  const keymap: Keymap | null = parsed.keymap ? { ...parsed.keymap, id: newId('keymap') } : null;
  return { profile, keymap };
}
