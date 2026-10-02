/*
 * RemotePanel - identify a remote, then correct its button layout.
 *
 * This screen is only ever about which IR code each physical button sends.
 * What those buttons DO is the next screen's business, and the two are kept
 * apart on purpose: re-learning a code or renaming a button here cannot
 * disturb a keyboard mapping, because mappings refer to buttons by id.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { useDevice } from '../useDevice';
import { useIrStream } from '../useDevice';
import type { IrEventWithRaw } from '../shared/device';
import {
  formatKey,
  encodeKey,
  decodeKey,
  protocolName,
  keyCommand,
  IR_FLAG_REPEAT,
} from '../shared/irProtocol';
import { identify, searchRemotes, profileFromDb, prettify, type DbRemote } from '../shared/db';
import { TEMPLATES, profileFromTemplate } from '../shared/templates';
import {
  addProfile,
  updateProfile,
  deleteProfile,
  getSnapshot,
  subscribe,
  activeProfile,
  setActiveProfile,
} from '../shared/store';
import { buttonIdFor, type RemoteButton, type RemoteProfile } from '../shared/types';

/*
 * How long a learn capture listens before deciding on a code. Long enough to
 * catch a protocol that alternates between two codes, short enough not to
 * feel sluggish.
 */
const LEARN_WINDOW_MS = 1300;

export function RemotePanel({
  dev,
  onNext,
}: {
  dev: ReturnType<typeof useDevice>;
  onNext: () => void;
}) {
  const data = useSyncExternalStore(subscribe, getSnapshot);
  const profile = activeProfile();

  if (!dev.connected) {
    return (
      <>
        <h1>Remote</h1>
        <div className="banner warn">
          Connect the receiver first — setting up a remote means listening to it.
        </div>
      </>
    );
  }

  if (!profile) {
    return <Setup savedCount={data.profiles.length} />;
  }
  return <LayoutEditor dev={dev} profile={profile} onNext={onNext} />;
}

/* ====================================================================== */
/* Step A: work out which remote this is                                   */
/* ====================================================================== */

function Setup({ savedCount }: { savedCount: number }) {
  const data = useSyncExternalStore(subscribe, getSnapshot);
  const [frame, setFrame] = useState<IrEventWithRaw | null>(null);
  const [candidates, setCandidates] = useState<DbRemote[] | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DbRemote[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [busy, setBusy] = useState(false);

  const onFrame = useCallback((e: IrEventWithRaw) => {
    /* Ignore held-button repeats: the first press is what identifies it. */
    if (e.flags & IR_FLAG_REPEAT) return;
    setFrame(e);
    setCandidates(null);
    identify(e.protocol, e.address)
      .then(setCandidates)
      .catch((err) => setDbError((err as Error).message));
  }, []);

  useIrStream(true, onFrame);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    let live = true;
    searchRemotes(query)
      .then((r) => live && setResults(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [query]);

  async function useDbRemote(r: DbRemote) {
    setBusy(true);
    try {
      addProfile(await profileFromDb(r));
    } catch (e) {
      setDbError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function useTemplate(templateId: string) {
    const t = TEMPLATES.find((x) => x.id === templateId);
    if (!t || !frame) return;
    addProfile(
      profileFromTemplate(
        t,
        frame.protocol,
        frame.address,
        `My ${protocolName(frame.protocol)} remote`
      )
    );
  }

  return (
    <>
      <h1>Which remote is this?</h1>
      <p className="lede">
        Point your remote at the receiver and press any button. The receiver is listening and will
        not send any keystrokes while you are on this screen.
      </p>

      {savedCount > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Saved remotes</h2>
          <div className="chips">
            {data.profiles.map((p) => (
              <button key={p.id} className="chip" onClick={() => setActiveProfile(p.id)}>
                {p.name} · {p.buttons.length} buttons
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`capture ${frame ? '' : 'armed'}`}>
        {!frame ? (
          <>
            <div style={{ fontSize: 16, marginBottom: 6 }}>Listening — press a button now</div>
            <div className="hint">Any button will do. Power or OK are good choices.</div>
          </>
        ) : (
          <dl className="kv" style={{ justifyContent: 'center', textAlign: 'left' }}>
            <dt>Protocol</dt>
            <dd>{protocolName(frame.protocol)}</dd>
            <dt>Address</dt>
            <dd>0x{frame.address.toString(16).toUpperCase()}</dd>
            <dt>Command</dt>
            <dd>0x{frame.command.toString(16).toUpperCase()}</dd>
            <dt>Identity</dt>
            <dd>{formatKey(frame.key)}</dd>
          </dl>
        )}
      </div>

      {dbError && <div className="banner bad">Remote database: {dbError}</div>}

      {frame && candidates && candidates.length > 0 && (
        <div className="card pad0">
          <div style={{ padding: '14px 18px 4px' }}>
            <h2 style={{ margin: 0 }}>
              {candidates.length === 1 ? 'One match' : `${candidates.length} possible matches`}
            </h2>
            <p className="hint">
              Matched on protocol and address, which every button on a remote shares. Several
              models often share one address, so pick the closest — you can correct the layout
              afterwards, and every button comes pre-filled with its code.
            </p>
          </div>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Brand</th>
                  <th>Model</th>
                  <th>Type</th>
                  <th>Buttons</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {candidates.map((r) => (
                  <tr key={r.i}>
                    <td>{r.b}</td>
                    <td>{prettify(r.m)}</td>
                    <td className="hint">{r.c.replace(/_/g, ' ')}</td>
                    <td className="num">{r.n}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="sm primary" disabled={busy} onClick={() => useDbRemote(r)}>
                        Use this
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {frame && candidates && candidates.length === 0 && (
        <div className="banner info">
          No database entry uses {protocolName(frame.protocol)} address 0x
          {frame.address.toString(16).toUpperCase()}. That is perfectly normal — start from a
          layout below and press each button once to teach it.
        </div>
      )}

      {frame && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Not listed, or none of them right?</h2>
          <div className="row">
            <button onClick={() => setShowTemplates((v) => !v)}>
              {showTemplates ? 'Hide layouts' : 'Start from a blank layout'}
            </button>
            <span className="hint">Then press each button once to learn its code.</span>
          </div>

          {showTemplates && (
            <div className="chips" style={{ marginTop: 12 }}>
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  className="chip"
                  onClick={() => useTemplate(t.id)}
                  title={t.description}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}

          <label className="field" style={{ marginTop: 16, maxWidth: 420 }}>
            <span>Or search the database by brand and model</span>
            <input
              type="text"
              value={query}
              placeholder="samsung ue48 …"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>

          {results.length > 0 && (
            <div className="scroll" style={{ maxHeight: 240 }}>
              <table>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.i}>
                      <td>{r.b}</td>
                      <td>{prettify(r.m)}</td>
                      <td className="hint">
                        {protocolName(r.p)} · 0x{r.a.toString(16).toUpperCase()}
                      </td>
                      <td className="num">{r.n}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="sm" disabled={busy} onClick={() => useDbRemote(r)}>
                          Use
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/* ====================================================================== */
/* Step B: correct the layout                                              */
/* ====================================================================== */

interface LearnOutcome {
  buttonId: string;
  key: bigint;
  /** Additional distinct codes seen during one learn capture. */
  alternates: bigint[];
}

function LayoutEditor({
  dev,
  profile,
  onNext,
}: {
  dev: ReturnType<typeof useDevice>;
  profile: RemoteProfile;
  onNext: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [learning, setLearning] = useState<string | null>(null);
  const [litButton, setLitButton] = useState<string | null>(null);
  const [unknownPress, setUnknownPress] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<LearnOutcome | null>(null);
  const [ruleMsg, setRuleMsg] = useState<string | null>(null);

  /* Codes collected during the current learn window, with hit counts. */
  const collected = useRef<Map<string, number>>(new Map());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cols = Math.max(2, ...profile.buttons.map((b) => b.col + 1));

  const finishLearn = useCallback(
    (buttonId: string) => {
      const counts = [...collected.current.entries()].sort((a, b) => b[1] - a[1]);
      collected.current = new Map();
      timer.current = null;
      setLearning(null);
      if (!counts.length) return;

      const keys = counts.map(([k]) => decodeKey(k));
      const winner = keys[0]!;

      updateProfile({
        ...profile,
        buttons: profile.buttons.map((b) =>
          b.id === buttonId ? { ...b, key: encodeKey(winner) } : b
        ),
      });
      setOutcome({ buttonId, key: winner, alternates: keys.slice(1) });
    },
    [profile]
  );

  const onFrame = useCallback(
    (e: IrEventWithRaw) => {
      if (learning) {
        /*
         * Collect every code the button emits, repeats included: a remote
         * that alternates between two codes only reveals it across frames.
         */
        const k = encodeKey(e.key);
        collected.current.set(k, (collected.current.get(k) ?? 0) + 1);
        return;
      }

      /*
       * Not learning: light up whichever button this code belongs to. That
       * doubles as a way to check the layout is actually right, which matters
       * most for database entries that were only a close guess.
       */
      const hit = profile.buttons.find((b) => b.key && decodeKey(b.key) === e.key);
      if (hit) {
        setLitButton(hit.id);
        setUnknownPress(null);
        setTimeout(() => setLitButton((cur) => (cur === hit.id ? null : cur)), 400);
      } else if (!(e.flags & IR_FLAG_REPEAT)) {
        setUnknownPress(formatKey(e.key));
      }
    },
    [learning, profile.buttons]
  );

  useIrStream(true, onFrame);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  function startLearn(buttonId: string) {
    collected.current = new Map();
    setOutcome(null);
    setRuleMsg(null);
    setLearning(buttonId);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => finishLearn(buttonId), LEARN_WINDOW_MS);
  }

  function patch(id: string, changes: Partial<RemoteButton>) {
    updateProfile({
      ...profile,
      buttons: profile.buttons.map((b) => (b.id === id ? { ...b, ...changes } : b)),
    });
  }

  function removeButton(id: string) {
    updateProfile({ ...profile, buttons: profile.buttons.filter((b) => b.id !== id) });
    if (selected === id) setSelected(null);
  }

  function addButton() {
    const taken = new Set(profile.buttons.map((b) => b.id));
    const maxRow = Math.max(-1, ...profile.buttons.map((b) => b.row));
    const id = buttonIdFor('new button', taken);
    updateProfile({
      ...profile,
      buttons: [
        ...profile.buttons,
        { id, label: 'New button', row: maxRow + 1, col: 0, key: null },
      ],
    });
    setSelected(id);
  }

  /*
   * Teach the receiver to ignore the bits that alternate on this remote.
   *
   * Some protocols flip a bit between consecutive presses so a device can
   * tell a genuine second press from a held key. If that bit reaches the
   * identity, one physical button produces two codes and its binding only
   * matches half the time. Masking it fixes the remote for good.
   */
  async function addToggleRule(key: bigint, alternates: bigint[]) {
    const settings = dev.settings;
    if (!settings) return;

    let mask = 0;
    for (const alt of alternates) mask |= keyCommand(key) ^ keyCommand(alt);
    if (!mask) return;

    const rules = [...settings.toggleRules];
    const existing = rules.findIndex((r) => r.protocol === profile.protocol && r.cmdMask);
    const slot = existing >= 0 ? existing : rules.findIndex((r) => !r.cmdMask);
    if (slot < 0) {
      setRuleMsg('All four toggle rules are in use. Remove one in Diagnostics first.');
      return;
    }
    rules[slot] = {
      protocol: profile.protocol,
      cmdMask: mask | (rules[slot]?.cmdMask ?? 0),
    };

    await dev.run(() => dev.device.setSettings({ ...settings, toggleRules: rules }));
    setRuleMsg(
      `The receiver will now ignore bits 0x${mask
        .toString(16)
        .toUpperCase()} for ${protocolName(profile.protocol)}. Learn this button again to store ` +
        `the settled code.`
    );
    setOutcome(null);
  }

  const learned = profile.buttons.filter((b) => b.key).length;
  const sorted = [...profile.buttons].sort((a, b) => a.row - b.row || a.col - b.col);
  const sel = profile.buttons.find((b) => b.id === selected) ?? null;

  return (
    <>
      <h1>{profile.name}</h1>
      <p className="lede">
        Check each button is where you expect. Press a button on the remote and it lights up
        below — if the wrong one lights up, select it and learn it again.
      </p>

      <div className="card">
        <div className="row">
          <label className="field" style={{ margin: 0, flex: '1 1 260px' }}>
            <span>Remote name</span>
            <input
              type="text"
              value={profile.name}
              onChange={(e) => updateProfile({ ...profile, name: e.target.value })}
            />
          </label>
          <div style={{ alignSelf: 'end' }}>
            <span className={`pill ${learned === profile.buttons.length ? 'good' : 'warn'}`}>
              {learned} of {profile.buttons.length} buttons have a code
            </span>
          </div>
          <div className="spacer" />
          <div className="row tight" style={{ alignSelf: 'end' }}>
            <button onClick={addButton}>Add button</button>
            <button
              className="danger"
              onClick={() => {
                if (confirm(`Delete the remote "${profile.name}"? Mappings that use it are kept.`))
                  deleteProfile(profile.id);
              }}
            >
              Delete remote
            </button>
          </div>
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>
          Source:{' '}
          {profile.source === 'database'
            ? 'remote database'
            : profile.source === 'template'
            ? 'blank layout'
            : 'learned'}{' '}
          · {protocolName(profile.protocol)} · address 0x
          {profile.address.toString(16).toUpperCase()}
        </p>
      </div>

      {unknownPress && (
        <div className="banner info">
          That code is not in this layout yet: <code>{unknownPress}</code>. Add a button, then
          learn it.
        </div>
      )}

      {outcome && (
        <div className={`banner ${outcome.alternates.length ? 'warn' : 'good'}`}>
          Learned <code>{formatKey(outcome.key)}</code>.
          {outcome.alternates.length > 0 && (
            <>
              {' '}
              This button sent {outcome.alternates.length + 1} different codes, which usually
              means the remote flips a bit between presses.{' '}
              <button
                className="link"
                onClick={() => addToggleRule(outcome.key, outcome.alternates)}
              >
                Tell the receiver to ignore those bits
              </button>
            </>
          )}
        </div>
      )}

      {ruleMsg && <div className="banner good">{ruleMsg}</div>}

      <div className="row" style={{ alignItems: 'flex-start', gap: 24 }}>
        <div className="remote-grid" style={{ ['--cols' as string]: cols }}>
          {sorted.map((b) => (
            <button
              key={b.id}
              className={[
                'rbtn',
                selected === b.id || litButton === b.id ? 'selected' : '',
                !b.key ? 'unlearned' : '',
                learning === b.id ? 'learning' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setSelected(b.id)}
            >
              <span>{b.label}</span>
              <span className="sub">
                {learning === b.id
                  ? 'press now…'
                  : b.key
                  ? '0x' +
                    keyCommand(decodeKey(b.key)).toString(16).toUpperCase().padStart(2, '0')
                  : 'not learned'}
              </span>
            </button>
          ))}
          <button className="rbtn empty" onClick={addButton}>
            + add
          </button>
        </div>

        <div style={{ flex: '1 1 280px', minWidth: 260 }}>
          {!sel ? (
            <div className="card">
              <p className="hint" style={{ margin: 0 }}>
                Select a button to rename it, learn its code again, move it or delete it.
              </p>
            </div>
          ) : (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>{sel.label}</h2>

              <label className="field">
                <span>Label</span>
                <input
                  type="text"
                  value={sel.label}
                  onChange={(e) => patch(sel.id, { label: e.target.value })}
                />
              </label>

              <div className="row tight">
                <label className="field" style={{ flex: 1, margin: 0 }}>
                  <span>Row</span>
                  <input
                    type="number"
                    min={0}
                    value={sel.row}
                    onChange={(e) => patch(sel.id, { row: Math.max(0, +e.target.value) })}
                  />
                </label>
                <label className="field" style={{ flex: 1, margin: 0 }}>
                  <span>Column</span>
                  <input
                    type="number"
                    min={0}
                    value={sel.col}
                    onChange={(e) => patch(sel.id, { col: Math.max(0, +e.target.value) })}
                  />
                </label>
              </div>

              <dl className="kv" style={{ margin: '14px 0' }}>
                <dt>IR code</dt>
                <dd>{sel.key ? formatKey(decodeKey(sel.key)) : '— not learned —'}</dd>
                {sel.canon && (
                  <>
                    <dt>Known as</dt>
                    <dd>{sel.canon}</dd>
                  </>
                )}
              </dl>

              {sel.canon && (
                <p className="hint" style={{ marginTop: -6 }}>
                  Recognised button names let a mapping preset fill itself in on the next screen.
                </p>
              )}

              <div className="row tight">
                <button
                  className="primary"
                  onClick={() => startLearn(sel.id)}
                  disabled={!!learning}
                >
                  {learning === sel.id ? 'Press the button…' : 'Learn this button'}
                </button>
                {sel.key && <button onClick={() => patch(sel.id, { key: null })}>Clear code</button>}
                <button className="danger sm" onClick={() => removeButton(sel.id)}>
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="row" style={{ marginTop: 18 }}>
        <button className="primary" onClick={onNext} disabled={learned === 0}>
          Map buttons to keys →
        </button>
        {learned === 0 && <span className="hint">Learn at least one button first.</span>}
        <div className="spacer" />
        <button onClick={() => setActiveProfile(null)}>Choose a different remote</button>
      </div>
    </>
  );
}
