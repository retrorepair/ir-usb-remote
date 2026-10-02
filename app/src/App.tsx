import { useSyncExternalStore, useState } from 'react';
import { getSnapshot, subscribe, activeProfile, activeKeymap } from './shared/store';
import { useDevice } from './useDevice';
import { DevicePanel } from './panels/DevicePanel';
import { RemotePanel } from './panels/RemotePanel';
import { KeymapPanel } from './panels/KeymapPanel';
import { WritePanel } from './panels/WritePanel';
import { DiagnosticsPanel } from './panels/DiagnosticsPanel';

type Tab = 'device' | 'remote' | 'keymap' | 'write' | 'diag';

const TABS: { id: Tab; label: string; step: string }[] = [
  { id: 'device', label: 'Receiver', step: '1' },
  { id: 'remote', label: 'Remote', step: '2' },
  { id: 'keymap', label: 'Keyboard mapping', step: '3' },
  { id: 'write', label: 'Save to receiver', step: '4' },
  { id: 'diag', label: 'Diagnostics', step: '•' },
];

export function App() {
  const data = useSyncExternalStore(subscribe, getSnapshot);
  const dev = useDevice();
  const [tab, setTab] = useState<Tab>('device');

  const profile = activeProfile();
  const keymap = activeKeymap();

  /*
   * The steps are ordered because they depend on each other: you cannot map
   * buttons you have not identified, and you cannot save a mapping that does
   * not exist. Disabling them is clearer than letting someone reach an empty
   * screen and wonder what went wrong.
   */
  const enabled: Record<Tab, boolean> = {
    device: true,
    remote: true,
    keymap: !!profile,
    write: !!profile && !!keymap,
    diag: true,
  };

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          IR Remote Configurator
          <small>{data.profiles.length} remote{data.profiles.length === 1 ? '' : 's'} saved</small>
        </div>

        {TABS.map((t) => (
          <button
            key={t.id}
            className={`navitem ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
            disabled={!enabled[t.id]}
            title={enabled[t.id] ? undefined : 'Complete the previous step first'}
          >
            <span className="step">{t.step}</span>
            {t.label}
          </button>
        ))}

        <div className="sidebar-foot">
          {dev.connected ? (
            <span className="pill good"><span className="dot" />Receiver connected</span>
          ) : (
            <span className="pill bad"><span className="dot" />Not connected</span>
          )}
          {profile && <div style={{ marginTop: 8 }}>Remote: {profile.name}</div>}
          {keymap && <div>Mapping: {keymap.name}</div>}
        </div>
      </nav>

      <main className="main">
        {tab === 'device' && <DevicePanel dev={dev} onNext={() => setTab('remote')} />}
        {tab === 'remote' && <RemotePanel dev={dev} onNext={() => setTab('keymap')} />}
        {tab === 'keymap' && <KeymapPanel onNext={() => setTab('write')} />}
        {tab === 'write' && <WritePanel dev={dev} />}
        {tab === 'diag' && <DiagnosticsPanel dev={dev} />}
      </main>
    </div>
  );
}
