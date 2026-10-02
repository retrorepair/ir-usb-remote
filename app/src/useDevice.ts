/*
 * useDevice.ts - React bindings for the device link.
 *
 * One module-level Device instance is shared by every panel, so switching
 * tabs never drops the connection or the learn-mode state.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { device, DEV_VID, DEV_PID } from './shared/device';
import { WireMode, MODEF_RAW_CAPTURE, type WireInfo, type WireSettings } from './shared/wire';
import type { IrEventWithRaw } from './shared/device';

export interface DeviceState {
  connected: boolean;
  info: WireInfo | null;
  settings: WireSettings | null;
  error: string | null;
  busy: boolean;
}

export function useDevice() {
  const [state, setState] = useState<DeviceState>({
    connected: false,
    info: null,
    settings: null,
    error: null,
    busy: false,
  });

  const refresh = useCallback(async () => {
    if (!device.connected) {
      setState((s) => ({ ...s, connected: false, info: null, settings: null }));
      return;
    }
    try {
      const info = await device.getInfo();
      const settings = await device.getSettings();
      setState((s) => ({ ...s, connected: true, info, settings, error: null }));
    } catch (e) {
      setState((s) => ({ ...s, error: (e as Error).message }));
    }
  }, []);

  /* Reconnect silently to a unit the user has already granted access to. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ok = await device.tryAutoConnect();
        if (ok && !cancelled) await refresh();
      } catch {
        /* No prior grant, or no device plugged in. Not an error. */
      }
    })();
    const un = device.onStateChange(() => void refresh());
    const unHid = window.host?.onHidChanged(() => {
      void device.tryAutoConnect().then((ok) => (ok ? refresh() : undefined));
    });
    return () => {
      cancelled = true;
      un();
      unHid?.();
    };
  }, [refresh]);

  const connect = useCallback(async () => {
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const ok = await device.requestConnect();
      if (!ok) {
        setState((s) => ({
          ...s,
          busy: false,
          error:
            'No receiver was selected. Check the unit is plugged in and running this firmware.',
        }));
        return;
      }
      await refresh();
    } catch (e) {
      setState((s) => ({ ...s, error: (e as Error).message }));
    } finally {
      setState((s) => ({ ...s, busy: false }));
    }
  }, [refresh]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setState((s) => ({ ...s, busy: true, error: null }));
      try {
        await fn();
        await refresh();
      } catch (e) {
        setState((s) => ({ ...s, error: (e as Error).message }));
      } finally {
        setState((s) => ({ ...s, busy: false }));
      }
    },
    [refresh]
  );

  return { ...state, connect, refresh, run, device };
}

/**
 * Subscribe to IR frames, putting the device into learn mode for as long as
 * the component is mounted.
 *
 * Learn mode suppresses HID output, which is essential: without it, pressing
 * remote buttons to configure them would also fire the keystrokes they are
 * already bound to, straight into this window.
 */
export function useIrStream(
  enabled: boolean,
  onFrame: (e: IrEventWithRaw) => void,
  withRaw = false
) {
  /*
   * The callback is held in a ref rather than used as an effect dependency.
   *
   * Callers legitimately rebuild it whenever their state changes -- the
   * layout editor's depends on the button list, so it changes on every
   * keystroke in a label field. As a dependency that tore the stream down and
   * rebuilt it each time, sending the device a SET_MODE(normal) followed by a
   * SET_MODE(learn) per character, and dropping any frame that arrived in
   * between.
   */
  const cb = useRef(onFrame);
  useEffect(() => {
    cb.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    if (!enabled || !device.connected) return;

    const un = device.onIr((e) => cb.current(e));

    void device
      .setMode(WireMode.Learn, withRaw ? MODEF_RAW_CAPTURE : 0)
      .catch(() => undefined);

    return () => {
      un();
      /* Always hand the device back in a state where the remote works. */
      void device.setMode(WireMode.Normal, 0).catch(() => undefined);
    };
  }, [enabled, withRaw]);
}

export const USING_DEV_IDS = (info: WireInfo | null) =>
  !!info && info.vid === DEV_VID && info.pid === DEV_PID;
