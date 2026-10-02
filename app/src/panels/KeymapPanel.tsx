/*
 * KeymapPanel - what each button does.
 *
 * Entirely separate from the remote's layout. This screen never touches IR
 * codes; it only assigns actions to button ids. That is what lets one mapping
 * be reused across remotes, and lets a remote be re-learned without losing
 * the mapping.
 */
import { useState, useSyncExternalStore } from 'react';
import {
  activeKeymap,
  activeProfile,
  addKeymap,
  deleteKeymap,
  emptyKeymap,
  getSnapshot,
  keymapFromPreset,
  PRESETS,
  setActiveKeymap,
  subscribe,
  updateKeymap,
} from '../shared/store';
import { actionToText } from '../shared/actions';
import { ActionType } from '../shared/wire';
import type { Action } from '../shared/types';
import { ActionPicker } from './ActionPicker';

export function KeymapPanel({ onNext }: { onNext: () => void }) {
  const data = useSyncExternalStore(subscribe, getSnapshot);
  const profile = activeProfile();
  const keymap = activeKeymap();
  const [editing, setEditing] = useState<string | null>(null);
  const [view, setView] = useState<'grid' | 'list'>('grid');

  if (!profile) {
    return (
      <>
        <h1>Keyboard mapping</h1>
        <div className="banner warn">Set up a remote first.</div>
      </>
    );
  }

  if (!keymap) {
    return (
      <>
        <h1>Keyboard mapping</h1>
        <p className="lede">
          Start from a preset — it fills in every button this remote's layout named, and you can
          change any of them afterwards.
        </p>

        {data.keymaps.length > 0 && (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Existing mappings</h2>
            <div className="chips">
              {data.keymaps.map((k) => (
                <button key={k.id} className="chip" onClick={() => setActiveKeymap(k.id)}>
                  {k.name} · {Object.keys(k.bindings).length} buttons
                </button>
              ))}
            </div>
            <p className="hint" style={{ marginBottom: 0 }}>
              A mapping can be reused on any remote. Buttons it does not recognise are simply left
              unmapped.
            </p>
          </div>
        )}

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Presets</h2>
          {PRESETS.map((p) => {
            const willFill = profile.buttons.filter((b) => b.canon && p.map[b.canon]).length;
            return (
              <div key={p.id} className="row" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ flex: '1 1 300px' }}>
                  <strong>{p.name}</strong>
                  <div className="hint">{p.description}</div>
                </div>
                <span className={`pill ${willFill ? 'good' : 'warn'}`}>
                  fills {willFill} of {profile.buttons.length}
                </span>
                <button className="primary sm" onClick={() => addKeymap(keymapFromPreset(p, profile))}>
                  Use
                </button>
              </div>
            );
          })}
          <div className="row" style={{ marginTop: 14 }}>
            <button onClick={() => addKeymap(emptyKeymap(`Custom — ${profile.name}`))}>
              Start from an empty mapping
            </button>
          </div>
        </div>
      </>
    );
  }

  function setAction(buttonId: string, action: Action, noRepeat: boolean) {
    const bindings = { ...keymap!.bindings };
    const nr = { ...keymap!.noRepeat };
    if (action.type === ActionType.None) {
      delete bindings[buttonId];
      delete nr[buttonId];
    } else {
      bindings[buttonId] = action;
      if (noRepeat) nr[buttonId] = true;
      else delete nr[buttonId];
    }
    updateKeymap({ ...keymap!, bindings, noRepeat: nr });
  }

  const sorted = [...profile.buttons].sort((a, b) => a.row - b.row || a.col - b.col);
  const mapped = sorted.filter((b) => keymap.bindings[b.id]).length;
  /* Same column count the remote editor uses, so both views line up. */
  const cols = Math.max(2, ...profile.buttons.map((b) => b.col + 1));
  const editingButton = sorted.find((b) => b.id === editing) ?? null;

  return (
    <>
      <h1>Keyboard mapping</h1>
      <p className="lede">
        Click any button to choose what it sends. This does not change the remote's layout — only
        what each button does.
      </p>

      <div className="card">
        <div className="row">
          <label className="field" style={{ margin: 0, flex: '1 1 280px' }}>
            <span>Mapping name</span>
            <input
              type="text"
              value={keymap.name}
              onChange={(e) => updateKeymap({ ...keymap, name: e.target.value })}
            />
          </label>
          <span className={`pill ${mapped ? 'good' : 'warn'}`} style={{ alignSelf: 'end' }}>
            {mapped} of {sorted.length} buttons mapped
          </span>
          <div className="spacer" />
          <div className="row tight" style={{ alignSelf: 'end' }}>
            <div className="chips">
              <button
                className={`chip ${view === 'grid' ? 'on' : ''}`}
                onClick={() => setView('grid')}
              >
                Remote layout
              </button>
              <button
                className={`chip ${view === 'list' ? 'on' : ''}`}
                onClick={() => setView('list')}
              >
                List
              </button>
            </div>
            <button onClick={() => setActiveKeymap(null)}>Switch mapping</button>
            <button
              className="danger"
              onClick={() => { if (confirm(`Delete the mapping "${keymap.name}"?`)) deleteKeymap(keymap.id); }}
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      {/*
        * The visual layout mirrors the remote's own grid, so a mapping can be
        * checked at a glance against the thing in your hand. The table below
        * stays available because it shows the repeat setting and the IR code,
        * which do not fit legibly on a button.
        */}
      {view === 'grid' && (
        <div className="card">
          <div className="remote-grid" style={{ ['--cols' as string]: cols }}>
            {sorted.map((b) => {
              const a = keymap.bindings[b.id];
              return (
                <button
                  key={b.id}
                  className={`rbtn ${a ? '' : 'unlearned'}`}
                  onClick={() => setEditing(b.id)}
                  title={b.key ? 'Click to change what this sends' : 'No IR code learned yet'}
                >
                  <span>{b.label}</span>
                  <span className="act">{actionToText(a)}</span>
                  {!b.key && <span className="sub">no IR code</span>}
                </button>
              );
            })}
          </div>
          <p className="hint" style={{ marginBottom: 0, marginTop: 14 }}>
            Click any button to change it. Dashed outlines are unmapped; a
            button marked “no IR code” will not be written to the receiver
            until it is learned on the Remote screen.
          </p>
        </div>
      )}

      {view === 'list' && (
      <div className="card pad0">
        <div className="scroll" style={{ maxHeight: 'none' }}>
          <table>
            <thead>
              <tr>
                <th>Button</th>
                <th>Sends</th>
                <th>Repeat while held</th>
                <th>IR code</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((b) => {
                const a = keymap.bindings[b.id];
                return (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.label}</strong>
                      {!b.key && <div className="hint">no IR code learned</div>}
                    </td>
                    <td style={{ color: a ? 'var(--text)' : 'var(--text-faint)' }}>
                      {actionToText(a)}
                    </td>
                    <td className="hint">
                      {!a ? '—' : keymap.noRepeat[b.id] ? 'no, once per press' : 'yes'}
                    </td>
                    <td className="hint mono">{b.key ? '0x' + (BigInt(b.key) & 0xffn).toString(16).toUpperCase().padStart(2, '0') : '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="sm" onClick={() => setEditing(b.id)}>
                        {a ? 'Change' : 'Assign'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <button className="primary" onClick={onNext} disabled={mapped === 0}>
          Save to the receiver →
        </button>
        {mapped === 0 && <span className="hint">Map at least one button.</span>}
      </div>

      {editingButton && (
        <ActionPicker
          buttonLabel={editingButton.label}
          initial={keymap.bindings[editingButton.id]}
          initialNoRepeat={!!keymap.noRepeat[editingButton.id]}
          onCancel={() => setEditing(null)}
          onSave={(a, nr) => {
            setAction(editingButton.id, a, nr);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
