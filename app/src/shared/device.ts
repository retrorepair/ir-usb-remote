/*
 * device.ts - WebHID transport to the receiver.
 *
 * Electron's Chromium provides WebHID, so there is no native module to
 * compile and nothing to rebuild per Electron version. The main process
 * grants permission for our vendor interface (see electron/main.ts); here we
 * just open it and exchange 64-byte reports.
 */
import {
  Cmd,
  Evt,
  WIRE_VERSION,
  WireMode,
  STATUS_TEXT,
  WireStatus,
  buildPacket,
  parsePacket,
  parseInfo,
  parseSettings,
  buildSettings,
  parseBindingPage,
  buildBindingPage,
  parseIrEvent,
  parseRawEvent,
  parseStats,
  u16le,
  type WireBinding,
  type WireInfo,
  type WireSettings,
  type WireIrEvent,
  type WireStats,
} from './wire';

/** Development-only USB id. Shipping hardware must have its own. */
export const DEV_VID = 0x1209;
export const DEV_PID = 0x0001;
export const CONFIG_USAGE_PAGE = 0xff00;

export interface IrEventWithRaw extends WireIrEvent {
  /** Populated only while raw capture is enabled. */
  raw?: number[];
}

type IrListener = (e: IrEventWithRaw) => void;
type StateListener = (connected: boolean) => void;

interface Pending {
  resolve: (p: ReturnType<typeof parsePacket>) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class Device {
  private hid: HIDDevice | null = null;
  private seq = 1;
  private pending = new Map<number, Pending>();
  private irListeners = new Set<IrListener>();
  private stateListeners = new Set<StateListener>();

  /** Raw chunks arriving before their EVT_IR, keyed by frame sequence. */
  private rawByFrame = new Map<number, { total: number; us: number[] }>();

  get connected(): boolean {
    return !!this.hid?.opened;
  }

  onIr(fn: IrListener): () => void {
    this.irListeners.add(fn);
    return () => this.irListeners.delete(fn);
  }

  onStateChange(fn: StateListener): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  private emitState() {
    for (const fn of this.stateListeners) fn(this.connected);
  }

  /** Reconnect to a device the user already granted access to. */
  async tryAutoConnect(): Promise<boolean> {
    if (!navigator.hid) return false;
    const devices = await navigator.hid.getDevices();
    const match = devices.find((d) => this.isConfigInterface(d));
    if (!match) return false;
    await this.attach(match);
    return true;
  }

  /** Show the OS/Chromium device picker. */
  async requestConnect(): Promise<boolean> {
    if (!navigator.hid) throw new Error('WebHID is unavailable in this build');
    const devices = await navigator.hid.requestDevice({
      filters: [{ usagePage: CONFIG_USAGE_PAGE }],
    });
    const match = devices.find((d) => this.isConfigInterface(d));
    if (!match) return false;
    await this.attach(match);
    return true;
  }

  /*
   * The firmware exposes three HID interfaces. Chromium refuses to open the
   * keyboard and consumer ones because their usage pages are protected, which
   * is precisely why the configuration channel is a separate interface on a
   * vendor usage page.
   */
  private isConfigInterface(d: HIDDevice): boolean {
    return d.collections.some((c) => c.usagePage === CONFIG_USAGE_PAGE);
  }

  private async attach(d: HIDDevice) {
    if (!d.opened) await d.open();
    this.hid = d;
    d.addEventListener('inputreport', this.onInputReport);
    navigator.hid.addEventListener('disconnect', this.onDisconnect);
    this.emitState();
  }

  private onDisconnect = (e: HIDConnectionEvent) => {
    if (e.device === this.hid) {
      this.hid = null;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error('device disconnected'));
      }
      this.pending.clear();
      this.emitState();
    }
  };

  async disconnect() {
    if (this.hid?.opened) await this.hid.close();
    this.hid = null;
    this.emitState();
  }

  private onInputReport = (event: HIDInputReportEvent) => {
    const pkt = parsePacket(event.data);

    if (pkt.id === Evt.Raw) {
      const ev = parseRawEvent(pkt.payload);
      const slot = this.rawByFrame.get(ev.frameSeq) ?? { total: ev.total, us: [] };
      slot.us.push(...ev.us);
      this.rawByFrame.set(ev.frameSeq, slot);
      /* Chunks arrive before the EVT_IR that describes them; bound the map in
       * case a frame's event never turns up. */
      if (this.rawByFrame.size > 8) {
        const oldest = Math.min(...this.rawByFrame.keys());
        this.rawByFrame.delete(oldest);
      }
      return;
    }

    if (pkt.id === Evt.Ir) {
      const ev = parseIrEvent(pkt.payload) as IrEventWithRaw;
      const raw = this.rawByFrame.get(ev.frameSeq);
      if (raw) {
        ev.raw = raw.us.slice(0, raw.total);
        this.rawByFrame.delete(ev.frameSeq);
      }
      for (const fn of this.irListeners) fn(ev);
      return;
    }

    if (pkt.id === Evt.Status) return;

    const p = this.pending.get(pkt.seq);
    if (p) {
      clearTimeout(p.timer);
      this.pending.delete(pkt.seq);
      p.resolve(pkt);
    }
  };

  private async send(id: Cmd, payload?: Uint8Array, timeoutMs = 2000) {
    const dev = this.hid;
    if (!dev?.opened) throw new Error('not connected');

    const seq = this.seq;
    this.seq = (this.seq % 254) + 1; /* 0 is reserved for events */

    const promise = new Promise<ReturnType<typeof parsePacket>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`command 0x${id.toString(16)} timed out`));
      }, timeoutMs);
      this.pending.set(seq, { resolve, reject, timer });
    });

    await dev.sendReport(0, buildPacket(id, seq, payload));
    const reply = await promise;

    if (reply.status !== WireStatus.Ok) {
      throw new Error(
        `device rejected 0x${id.toString(16)}: ${STATUS_TEXT[reply.status] ?? reply.status}`
      );
    }
    return reply;
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  async getInfo(): Promise<WireInfo> {
    const r = await this.send(Cmd.GetInfo);
    const info = parseInfo(r.payload);
    if (info.wireVersion !== WIRE_VERSION) {
      throw new Error(
        `firmware speaks protocol v${info.wireVersion}, this app speaks v${WIRE_VERSION}. Update whichever is older.`
      );
    }
    return info;
  }

  async getSettings(): Promise<WireSettings> {
    const r = await this.send(Cmd.GetSettings);
    return parseSettings(r.payload);
  }

  async setSettings(s: WireSettings): Promise<void> {
    await this.send(Cmd.SetSettings, buildSettings(s));
  }

  async setMode(mode: WireMode, flags = 0): Promise<void> {
    await this.send(Cmd.SetMode, new Uint8Array([mode, flags]));
  }

  async identify(): Promise<void> {
    await this.send(Cmd.Identify);
  }

  async getStats(): Promise<WireStats> {
    const r = await this.send(Cmd.GetStats);
    return parseStats(r.payload);
  }

  /** Flash erase plus program; slower than every other command. */
  async commit(): Promise<void> {
    await this.send(Cmd.Commit, undefined, 6000);
  }

  async factoryReset(): Promise<void> {
    await this.send(Cmd.FactoryReset, undefined, 6000);
  }

  async reboot(toBootloader: boolean): Promise<void> {
    await this.send(Cmd.Reboot, new Uint8Array([toBootloader ? 1 : 0]));
  }

  async readBindings(count: number): Promise<WireBinding[]> {
    const out: WireBinding[] = [];
    for (let i = 0; i < count; i += 3) {
      const r = await this.send(Cmd.GetBindings, u16le(i));
      const page = parseBindingPage(r.payload);
      out.push(...page.bindings);
      if (page.bindings.length === 0) break;
    }
    return out.slice(0, count);
  }

  /**
   * Replaces the whole table. The count is set last: if the write is
   * interrupted the device keeps its previous, smaller table rather than
   * exposing half-written entries.
   */
  async writeBindings(
    bindings: WireBinding[],
    onProgress?: (done: number, total: number) => void
  ): Promise<void> {
    for (let i = 0; i < bindings.length; i += 3) {
      const slice = bindings.slice(i, i + 3);
      await this.send(Cmd.SetBindings, buildBindingPage(i, slice));
      onProgress?.(Math.min(i + 3, bindings.length), bindings.length);
    }
    await this.send(Cmd.SetCount, u16le(bindings.length));
  }
}

export const device = new Device();
