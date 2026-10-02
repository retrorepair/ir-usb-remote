/*
 * WritePanel - send the resolved bindings to the receiver and persist them.
 *
 * Writing happens in two stages, matching the firmware: the table goes into
 * RAM (taking effect immediately, so it can be tested), then a commit writes
 * it to flash so it survives unplugging.
 */
import { useState, useSyncExternalStore } from 'react';
import type { useDevice } from '../useDevice';
import {
  activeKeymap,
  activeProfile,
  exportProfile,
  getSnapshot,
  importBundle,
  addProfile,
  addKeymap,
  resolveBindings,
  subscribe,
} from '../shared/store';

export function WritePanel({ dev }: { dev: ReturnType<typeof useDevice> }) {
  useSyncExternalStore(subscribe, getSnapshot);
  const profile = activeProfile();
  const keymap = activeKeymap();

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  if (!profile || !keymap) {
    return (
      <>
        <h1>Save to receiver</h1>
        <div className="banner warn">Choose a remote and a mapping first.</div>
      </>
    );
  }

  const resolved = resolveBindings(profile, keymap);
  const overCapacity =
    dev.info != null && resolved.bindings.length > dev.info.maxBindings;

  async function write(persist: boolean) {
    setResult(null);
    setFailure(null);
    setProgress({ done: 0, total: resolved.bindings.length });
    try {
      await dev.device.writeBindings(resolved.bindings, (done, total) =>
        setProgress({ done, total })
      );
      if (persist) await dev.device.commit();
      await dev.refresh();
      setResult(
        persist
          ? `Saved ${resolved.bindings.length} buttons to the receiver. It will keep working with no PC attached.`
          : `Loaded ${resolved.bindings.length} buttons for testing. They will be lost when the receiver is unplugged.`
      );
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setProgress(null);
    }
  }

  async function doExport() {
    const text = exportProfile(profile!, keymap);
    const name = `${profile!.name.replace(/[^\w.-]+/g, '-')}.json`;
    if (window.host) {
      const r = await window.host.saveFile(name, text);
      if (r.ok) setResult(`Exported to ${r.filePath}`);
    } else {
      /* Dev server in a plain browser: fall back to a download. */
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  async function doImport() {
    if (!window.host) return;
    const r = await window.host.openFile();
    if (!r.ok || !r.contents) return;
    try {
      const { profile: p, keymap: k } = importBundle(r.contents);
      addProfile(p);
      if (k) addKeymap(k);
      setResult(`Imported "${p.name}".`);
    } catch (e) {
      setFailure((e as Error).message);
    }
  }

  return (
    <>
      <h1>Save to receiver</h1>
      <p className="lede">
        {profile.name} → {keymap.name}
      </p>

      {!dev.connected && <div className="banner bad">The receiver is not connected.</div>}
      {failure && <div className="banner bad">{failure}</div>}
      {result && <div className="banner good">{result}</div>}

      <div className="card">
        <div className="row">
          <span className="pill good">{resolved.bindings.length} buttons will be written</span>
          {dev.info && (
            <span className="hint">capacity {dev.info.maxBindings}</span>
          )}
        </div>

        {overCapacity && (
          <div className="banner bad" style={{ marginTop: 12 }}>
            That is more buttons than this firmware can store ({dev.info?.maxBindings}). Remove
            some mappings, or raise <code>CFG_MAX_BINDINGS</code> and rebuild.
          </div>
        )}

        {resolved.unlearned.length > 0 && (
          <div className="banner warn" style={{ marginTop: 12 }}>
            <strong>{resolved.unlearned.length} mapped buttons have no IR code</strong> and will
            not be written: {resolved.unlearned.join(', ')}. Learn them on the Remote screen.
          </div>
        )}

        {resolved.duplicates.length > 0 && (
          <div className="banner warn" style={{ marginTop: 12 }}>
            <strong>Duplicate IR codes.</strong> Only the first of each is written:{' '}
            {resolved.duplicates.join('; ')}. Two buttons sending the same code cannot do two
            different things.
          </div>
        )}

        {resolved.unmapped.length > 0 && (
          <p className="hint" style={{ marginTop: 12 }}>
            {resolved.unmapped.length} learned buttons have no action assigned. They will simply
            do nothing, which is fine.
          </p>
        )}

        {progress && (
          <p className="hint" style={{ marginTop: 12 }}>
            Writing {progress.done} of {progress.total}…
          </p>
        )}

        <div className="row" style={{ marginTop: 16 }}>
          <button
            className="primary"
            disabled={!dev.connected || !!progress || overCapacity || resolved.bindings.length === 0}
            onClick={() => write(true)}
          >
            Save permanently
          </button>
          <button
            disabled={!dev.connected || !!progress || overCapacity || resolved.bindings.length === 0}
            onClick={() => write(false)}
            title="Loads the mapping without writing flash, so you can try it first"
          >
            Try without saving
          </button>
          {dev.info?.dirty && (
            <span className="pill warn">receiver has unsaved changes</span>
          )}
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Backup</h2>
        <p className="hint">
          A configuration file holds the remote's layout and the mapping together, so it can be
          restored or shared.
        </p>
        <div className="row">
          <button onClick={doExport}>Export to file…</button>
          <button onClick={doImport} disabled={!window.host}>Import from file…</button>
        </div>
      </div>
    </>
  );
}
