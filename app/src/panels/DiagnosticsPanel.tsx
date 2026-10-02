/*
 * DiagnosticsPanel - see what the receiver is actually receiving, and tune it.
 *
 * This is the screen that answers "why isn't my remote working?": it shows
 * every frame with its protocol and whether a binding matched, and it can
 * stream the raw mark/space timings for a code that fails to decode at all.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { useDevice } from '../useDevice';
import { useIrStream } from '../useDevice';
import type { IrEventWithRaw } from '../shared/device';
import { protocolName, IR_FLAG_REPEAT, IR_FLAG_TOGGLE } from '../shared/irProtocol';
import { SETF_REPORT_UNMAPPED, type WireSettings, type WireStats } from '../shared/wire';

interface LogLine {
  n: number;
  text: string;
  matched: boolean;
  raw?: number[];
}

export function DiagnosticsPanel({ dev }: { dev: ReturnType<typeof useDevice> }) {
  const [listening, setListening] = useState(false);
  const [withRaw, setWithRaw] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [stats, setStats] = useState<WireStats | null>(null);
  const [draft, setDraft] = useState<WireSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const counter = useRef(0);

  useEffect(() => setDraft(dev.settings), [dev.settings]);

  const onFrame = useCallback((e: IrEventWithRaw) => {
    counter.current += 1;
    const flags = [
      e.flags & IR_FLAG_REPEAT ? 'repeat' : '',
      e.flags & IR_FLAG_TOGGLE ? 'toggle' : '',
    ].filter(Boolean).join(',');

    const text =
      `${protocolName(e.protocol).padEnd(10)} ` +
      `addr 0x${e.address.toString(16).toUpperCase().padStart(4, '0')} ` +
      `cmd 0x${e.command.toString(16).toUpperCase().padStart(2, '0')} ` +
      `${e.nbits ? `${e.nbits}b ` : ''}` +
      `${e.matched ? `-> binding #${e.bindingIndex}` : '-> unmapped'} ` +
      `${flags ? `[${flags}] ` : ''}` +
      `${e.rawCount} edges`;

    setLog((l) => [{ n: counter.current, text, matched: e.matched, raw: e.raw }, ...l].slice(0, 200));
  }, []);

  useIrStream(listening, onFrame, withRaw);

  async function refreshStats() {
    try {
      setStats(await dev.device.getStats());
    } catch {
      /* Disconnected mid-click; the connection pill already shows it. */
    }
  }

  async function saveSettings() {
    if (!draft) return;
    setSaved(false);
    await dev.run(() => dev.device.setSettings(draft));
    await dev.run(() => dev.device.commit());
    setSaved(true);
  }

  if (!dev.connected) {
    return (
      <>
        <h1>Diagnostics</h1>
        <div className="banner warn">Connect the receiver to see what it is receiving.</div>
      </>
    );
  }

  return (
    <>
      <h1>Diagnostics</h1>
      <p className="lede">
        Watch every code the receiver decodes, including ones nothing is mapped to.
      </p>

      <div className="card">
        <div className="row">
          <button className={listening ? 'primary' : ''} onClick={() => setListening((v) => !v)}>
            {listening ? 'Stop listening' : 'Start listening'}
          </button>
          <label className="check">
            <input type="checkbox" checked={withRaw} onChange={(e) => setWithRaw(e.target.checked)} />
            <span>Capture raw timings</span>
          </label>
          <button onClick={() => setLog([])} disabled={!log.length}>Clear</button>
          <div className="spacer" />
          <button onClick={refreshStats}>Read counters</button>
        </div>
        {listening && (
          <p className="hint" style={{ marginBottom: 0 }}>
            Keystrokes are suppressed while listening, so pressing buttons here is safe.
          </p>
        )}
      </div>

      {stats && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Counters since power-on</h2>
          <dl className="kv">
            <dt>Frames decoded</dt><dd>{stats.framesDecoded}</dd>
            <dt>Unrecognised protocol</dt><dd>{stats.framesUnknown}</dd>
            <dt>Frames dropped</dt><dd>{stats.framesDropped}</dd>
            <dt>Reports sent to the PC</dt><dd>{stats.keysSent}</dd>
            <dt>Uptime</dt><dd>{(stats.uptimeMs / 1000).toFixed(1)} s</dd>
            <dt>Last protocol</dt><dd>{protocolName(stats.lastProtocol)}</dd>
          </dl>
          {stats.framesDropped > 0 && (
            <p className="hint">
              Dropped frames mean a burst arrived before the previous one was processed. A few
              during heavy button-mashing are harmless.
            </p>
          )}
        </div>
      )}

      <div className="card pad0">
        <div style={{ padding: '12px 16px 0' }}>
          <h2 style={{ margin: 0 }}>Live log</h2>
        </div>
        <div className="log" style={{ padding: '8px 16px 14px' }}>
          {log.length === 0 && <div className="miss">Nothing yet.</div>}
          {log.map((l) => (
            <div key={l.n} className={l.matched ? '' : 'miss'}>
              {l.text}
              {l.raw && l.raw.length > 0 && (
                <div className="miss" style={{ paddingLeft: 12 }}>
                  {l.raw.join(' ')}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {draft && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Timing and behaviour</h2>

          <div className="row" style={{ alignItems: 'flex-start' }}>
            <label className="field" style={{ flex: '1 1 180px' }}>
              <span>Release after silence (ms)</span>
              <input
                type="number"
                min={60}
                max={2000}
                value={draft.releaseTimeoutMs}
                onChange={(e) => setDraft({ ...draft, releaseTimeoutMs: +e.target.value })}
              />
              <div className="hint">
                How long after the last frame a held key is let go. Too low makes held buttons
                stutter; too high leaves keys pressed after you release.
              </div>
            </label>

            <label className="field" style={{ flex: '1 1 180px' }}>
              <span>Media repeat delay (ms)</span>
              <input
                type="number"
                min={0}
                max={5000}
                value={draft.repeatDelayMs}
                onChange={(e) => setDraft({ ...draft, repeatDelayMs: +e.target.value })}
              />
              <div className="hint">Before a held volume button starts ramping.</div>
            </label>

            <label className="field" style={{ flex: '1 1 180px' }}>
              <span>Media repeat rate (ms)</span>
              <input
                type="number"
                min={20}
                max={2000}
                value={draft.repeatRateMs}
                onChange={(e) => setDraft({ ...draft, repeatRateMs: +e.target.value })}
              />
              <div className="hint">
                Keyboard keys ignore this — the PC applies its own repeat rate to those.
              </div>
            </label>
          </div>

          <label className="field" style={{ maxWidth: 260 }}>
            <span>Status LED</span>
            <select
              value={draft.ledMode}
              onChange={(e) => setDraft({ ...draft, ledMode: +e.target.value })}
            >
              <option value={0}>Off</option>
              <option value={1}>Flash when a code is received</option>
              <option value={2}>Always on</option>
            </select>
          </label>

          <label className="check" style={{ marginBottom: 14 }}>
            <input
              type="checkbox"
              checked={!!(draft.flags & SETF_REPORT_UNMAPPED)}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  flags: e.target.checked
                    ? draft.flags | SETF_REPORT_UNMAPPED
                    : draft.flags & ~SETF_REPORT_UNMAPPED,
                })
              }
            />
            <span>Report unmapped codes to this app</span>
          </label>

          {draft.toggleRules.some((r) => r.cmdMask) && (
            <>
              <h2>Toggle rules</h2>
              <p className="hint" style={{ marginTop: -6 }}>
                Bits the receiver ignores when identifying a button, because this remote flips
                them between presses.
              </p>
              <table>
                <thead><tr><th>Protocol</th><th>Ignored bits</th><th /></tr></thead>
                <tbody>
                  {draft.toggleRules.map((r, i) =>
                    r.cmdMask ? (
                      <tr key={i}>
                        <td>{protocolName(r.protocol)}</td>
                        <td className="mono">0x{r.cmdMask.toString(16).toUpperCase()}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="sm danger"
                            onClick={() => {
                              const rules = [...draft.toggleRules];
                              rules[i] = { protocol: 0, cmdMask: 0 };
                              setDraft({ ...draft, toggleRules: rules });
                            }}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ) : null
                  )}
                </tbody>
              </table>
            </>
          )}

          <div className="row" style={{ marginTop: 16 }}>
            <button className="primary" onClick={saveSettings} disabled={dev.busy}>
              Save settings to receiver
            </button>
            <button onClick={() => setDraft(dev.settings)} disabled={dev.busy}>Revert</button>
            {saved && <span className="pill good">saved</span>}
          </div>
        </div>
      )}

      <p className="hint">
        A code that shows as <code>Raw</code> uses a protocol this firmware does not model by
        name. It still works — it is identified by its timing pattern — so learn and map it as
        usual.
      </p>
    </>
  );
}
