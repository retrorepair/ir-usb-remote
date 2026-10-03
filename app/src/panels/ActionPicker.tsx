/*
 * ActionPicker - choose what a button does.
 *
 * Three kinds of output, because they behave differently on the host:
 *   Keyboard   an ordinary keystroke, repeats while held at the user's own
 *              OS repeat rate.
 *   Media      consumer-control usages; work without the target application
 *              having focus, which is why volume belongs here.
 *   System     sleep, wake, power down.
 */
import { useEffect, useMemo, useState } from 'react';
import { ActionType, KMOD } from '../shared/wire';
import {
  KEY_USAGES,
  CONSUMER_USAGES,
  SYSTEM_USAGES,
  actionToText,
  modsToText,
} from '../shared/actions';
import type { Action } from '../shared/types';

/* Maps a browser KeyboardEvent.code to a HID usage, so the user can simply
 * press the key they want instead of hunting for it in a list. */
const CODE_TO_USAGE: Record<string, number> = (() => {
  const m: Record<string, number> = {
    Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c,
    Minus: 0x2d, Equal: 0x2e, BracketLeft: 0x2f, BracketRight: 0x30,
    Backslash: 0x31, Semicolon: 0x33, Quote: 0x34, Backquote: 0x35,
    Comma: 0x36, Period: 0x37, Slash: 0x38, CapsLock: 0x39,
    PrintScreen: 0x46, ScrollLock: 0x47, Pause: 0x48, Insert: 0x49,
    Home: 0x4a, PageUp: 0x4b, Delete: 0x4c, End: 0x4d, PageDown: 0x4e,
    ArrowRight: 0x4f, ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52,
    NumLock: 0x53, NumpadDivide: 0x54, NumpadMultiply: 0x55,
    NumpadSubtract: 0x56, NumpadAdd: 0x57, NumpadEnter: 0x58,
    NumpadDecimal: 0x63, ContextMenu: 0x65,
  };
  for (let i = 0; i < 26; i++) m[`Key${String.fromCharCode(65 + i)}`] = 0x04 + i;
  for (let i = 1; i <= 9; i++) m[`Digit${i}`] = 0x1e + i - 1;
  m['Digit0'] = 0x27;
  for (let i = 1; i <= 12; i++) m[`F${i}`] = 0x3a + i - 1;
  for (let i = 1; i <= 9; i++) m[`Numpad${i}`] = 0x59 + i - 1;
  m['Numpad0'] = 0x62;
  return m;
})();

type Kind = 'key' | 'media' | 'system';

export function ActionPicker({
  buttonLabel,
  initial,
  initialNoRepeat,
  onCancel,
  onSave,
}: {
  buttonLabel: string;
  initial: Action | undefined;
  initialNoRepeat: boolean;
  onCancel: () => void;
  onSave: (a: Action, noRepeat: boolean) => void;
}) {
  const [kind, setKind] = useState<Kind>(
    initial?.type === ActionType.Consumer ? 'media'
    : initial?.type === ActionType.System ? 'system'
    : 'key'
  );
  const [usage, setUsage] = useState(initial && initial.type !== ActionType.None ? initial.usage : 0);
  const [mods, setMods] = useState(initial?.type === ActionType.Key ? initial.mods : 0);
  const [noRepeat, setNoRepeat] = useState(initialNoRepeat);
  const [capturing, setCapturing] = useState(false);
  const [filter, setFilter] = useState('');

  /* Capture the key the user actually presses, modifiers included. */
  useEffect(() => {
    if (!capturing) return;
    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      const u = CODE_TO_USAGE[e.code];
      let m = 0;
      if (e.ctrlKey) m |= KMOD.LCTRL;
      if (e.shiftKey) m |= KMOD.LSHIFT;
      if (e.altKey) m |= KMOD.LALT;
      if (e.metaKey) m |= KMOD.LGUI;
      /* A bare modifier press is the user reaching for a chord, not the
       * chord itself -- keep listening. */
      if (!u) { setMods(m); return; }
      setUsage(u);
      setMods(m);
      setCapturing(false);
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capturing]);

  const list = kind === 'key' ? KEY_USAGES : kind === 'media' ? CONSUMER_USAGES : SYSTEM_USAGES;
  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const out = new Map<string, typeof list>();
    for (const u of list) {
      if (f && !u.label.toLowerCase().includes(f)) continue;
      if (!out.has(u.group)) out.set(u.group, []);
      out.get(u.group)!.push(u);
    }
    return out;
  }, [list, filter]);

  /*
   * A keyboard action with no key but some modifiers is valid: MiSTer's USER
   * button is Left Ctrl + Left Alt + Right Alt with no ordinary key at all.
   * Only the total absence of both counts as "nothing bound".
   */
  const action: Action =
    kind === 'key'
      ? usage === 0 && mods === 0
        ? { type: ActionType.None }
        : { type: ActionType.Key, usage, mods }
      : usage === 0
      ? { type: ActionType.None }
      : kind === 'media'
      ? { type: ActionType.Consumer, usage }
      : { type: ActionType.System, usage };

  return (
    <div className="scrim" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>What should “{buttonLabel}” do?</header>

        <div className="body">
          <div className="chips" style={{ marginBottom: 14 }}>
            <button className={`chip ${kind === 'key' ? 'on' : ''}`} onClick={() => { setKind('key'); setUsage(0); }}>Keyboard key</button>
            <button className={`chip ${kind === 'media' ? 'on' : ''}`} onClick={() => { setKind('media'); setUsage(0); setMods(0); }}>Media key</button>
            <button className={`chip ${kind === 'system' ? 'on' : ''}`} onClick={() => { setKind('system'); setUsage(0); setMods(0); }}>System</button>
          </div>

          {kind === 'media' && (
            <p className="hint" style={{ marginTop: -6 }}>
              Media keys reach the active player without needing it focused, so volume and
              transport are usually better here than as keystrokes.
            </p>
          )}

          {kind === 'key' && (
            <>
              <div className="row" style={{ marginBottom: 12 }}>
                <button className={capturing ? 'primary' : ''} onClick={() => setCapturing((v) => !v)}>
                  {capturing ? 'Listening — press a key' : 'Press a key to capture'}
                </button>
                <span className="hint">or choose from the list below</span>
              </div>

              <div className="chips" style={{ marginBottom: 12 }}>
                {([['Ctrl', KMOD.LCTRL], ['Shift', KMOD.LSHIFT], ['Alt', KMOD.LALT], ['Win', KMOD.LGUI]] as const).map(
                  ([label, bit]) => (
                    <button
                      key={label}
                      className={`chip ${mods & bit ? 'on' : ''}`}
                      onClick={() => setMods((m) => m ^ bit)}
                    >
                      {label}
                    </button>
                  )
                )}
              </div>
            </>
          )}

          <input
            type="text"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ marginBottom: 12 }}
          />

          <div className="scroll" style={{ maxHeight: 260 }}>
            {[...groups.entries()].map(([group, items]) => (
              <div key={group} style={{ marginBottom: 10 }}>
                <div className="hint" style={{ marginBottom: 4 }}>{group}</div>
                <div className="chips">
                  {items.map((u) => (
                    <button
                      key={u.usage}
                      className={`chip ${usage === u.usage ? 'on' : ''}`}
                      onClick={() => setUsage(u.usage)}
                    >
                      {u.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {groups.size === 0 && <p className="hint">Nothing matches “{filter}”.</p>}
          </div>

          <label className="check" style={{ marginTop: 16 }}>
            <input type="checkbox" checked={noRepeat} onChange={(e) => setNoRepeat(e.target.checked)} />
            <span>
              Fire once per press, never repeat
              <div className="hint">
                Right for power, play/pause and digits. Leave off for arrows and volume so
                holding the button repeats.
              </div>
            </span>
          </label>

          <div className="banner info" style={{ marginTop: 14, marginBottom: 0 }}>
            Will send: <strong>{actionToText(action)}</strong>
            {kind === 'key' && mods !== 0 && usage === 0 && ` (${modsToText(mods)} + …choose a key)`}
          </div>
        </div>

        <footer>
          <button onClick={() => onSave({ type: ActionType.None }, false)}>Clear mapping</button>
          <div className="spacer" />
          <button onClick={onCancel}>Cancel</button>
          <button
            className="primary"
            disabled={action.type === ActionType.None}
            onClick={() => onSave(action, noRepeat)}
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
