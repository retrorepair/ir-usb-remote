import { useState } from 'react';
import type { useDevice } from '../useDevice';
import { USING_DEV_IDS } from '../useDevice';
import { decodedProtocols } from '../shared/irProtocol';

export function DevicePanel({
  dev,
  onNext,
}: {
  dev: ReturnType<typeof useDevice>;
  onNext: () => void;
}) {
  const { info, connected, busy, error, connect, run, device } = dev;
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <>
      <h1>Receiver</h1>
      <p className="lede">
        Plug the receiver into a USB port. It appears as a keyboard, so there is no driver to
        install.
      </p>

      {error && <div className="banner bad">{error}</div>}

      {!connected && (
        <div className="card">
          <div className="row">
            <button className="primary" onClick={connect} disabled={busy}>
              {busy ? 'Looking…' : 'Connect receiver'}
            </button>
            <span className="hint">
              Not detected? Make sure it is running this firmware — see the flashing guide.
            </span>
          </div>
        </div>
      )}

      {connected && info && (
        <>
          {USING_DEV_IDS(info) && (
            <div className="banner warn">
              <strong>This unit uses the development USB ID (1209:0001).</strong> That pair is
              reserved for testing and must not ship on hardware you sell. See{' '}
              <code>docs/branding.md</code> for the three legitimate ways to get your own.
            </div>
          )}

          <div className="card">
            <dl className="kv">
              <dt>Firmware</dt><dd>{info.firmware}</dd>
              <dt>Board</dt><dd>{info.board || 'unknown'}</dd>
              <dt>USB ID</dt>
              <dd>
                {info.vid.toString(16).padStart(4, '0')}:
                {info.pid.toString(16).padStart(4, '0')}
              </dd>
              <dt>IR input pin</dt><dd>GPIO {info.irGpio}</dd>
              <dt>Buttons stored</dt><dd>{info.bindingCount} of {info.maxBindings}</dd>
              <dt>Unsaved changes</dt><dd>{info.dirty ? 'yes' : 'no'}</dd>
            </dl>

            <h2>Protocols decoded by name</h2>
            <p className="hint" style={{ marginTop: -4 }}>
              {decodedProtocols(info.protocolsMask).join(', ')}. Any remote using something else
              still works — it is identified by its timing pattern instead, so it can be learned
              and mapped like any other.
            </p>

            <div className="row" style={{ marginTop: 14 }}>
              <button className="primary" onClick={onNext}>Set up a remote →</button>
              <button onClick={() => run(() => device.identify())} disabled={busy}>
                Flash the LED
              </button>
              <div className="spacer" />
              <button
                onClick={() => run(() => device.reboot(true))}
                disabled={busy}
                title="Reboots into the UF2 bootloader so you can drag on new firmware"
              >
                Firmware update mode
              </button>
              <button className="danger" onClick={() => setConfirmReset(true)} disabled={busy}>
                Factory reset
              </button>
            </div>
          </div>
        </>
      )}

      {confirmReset && (
        <div className="scrim" onClick={() => setConfirmReset(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header>Erase everything on the receiver?</header>
            <div className="body">
              <p>
                This clears all {info?.bindingCount ?? 0} stored buttons from the receiver and
                restores its default timings. The remote will stop working until you save a
                mapping again.
              </p>
              <p className="hint">
                Your saved remotes and mappings in this app are not affected.
              </p>
            </div>
            <footer>
              <button onClick={() => setConfirmReset(false)}>Cancel</button>
              <button
                className="danger"
                onClick={() => {
                  setConfirmReset(false);
                  void run(() => device.factoryReset());
                }}
              >
                Erase receiver
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
