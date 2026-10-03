/*
 * wire.ts - mirror of firmware/include/wire_protocol.h.
 *
 * Every offset below is written out literally rather than derived, and
 * tools/check-protocol-sync.mjs re-derives them from the C header to prove
 * they still agree. The C structs contain explicit padding fields for the
 * same reason: so there is exactly one layout, visible in both languages.
 */

export const WIRE_REPORT_SIZE = 64;
export const WIRE_PAYLOAD_SIZE = 60;
export const WIRE_VERSION = 1;

export const CFG_MAX_TOGGLE_RULES = 4;
export const CFG_BINDINGS_PER_PKT = 3;
export const WIRE_RAW_PER_PKT = 26;

export enum Cmd {
  GetInfo = 0x01,
  GetBindings = 0x02,
  SetBindings = 0x03,
  SetCount = 0x04,
  Commit = 0x05,
  GetSettings = 0x06,
  SetSettings = 0x07,
  SetMode = 0x08,
  FactoryReset = 0x09,
  Reboot = 0x0a,
  Identify = 0x0b,
  GetStats = 0x0c,
}

export enum Evt {
  Ir = 0x80,
  Raw = 0x81,
  Status = 0x82,
}

export enum WireStatus {
  Ok = 0x00,
  ErrCmd = 0x01,
  ErrLen = 0x02,
  ErrRange = 0x03,
  ErrStorage = 0x04,
  ErrBusy = 0x05,
  ErrVersion = 0x06,
}

export const STATUS_TEXT: Record<number, string> = {
  [WireStatus.Ok]: 'OK',
  [WireStatus.ErrCmd]: 'unknown command',
  [WireStatus.ErrLen]: 'wrong payload length',
  [WireStatus.ErrRange]: 'value out of range',
  [WireStatus.ErrStorage]: 'flash write failed',
  [WireStatus.ErrBusy]: 'device busy',
  [WireStatus.ErrVersion]: 'protocol version mismatch',
};

export enum WireMode {
  Normal = 0,
  Learn = 1,
}

export const MODEF_RAW_CAPTURE = 1 << 0;

export enum ActionType {
  None = 0,
  Key = 1,
  Consumer = 2,
  System = 3,
}

/** Keyboard modifier bits, matching the HID boot keyboard report byte 0. */
export const KMOD = {
  LCTRL: 1 << 0,
  LSHIFT: 1 << 1,
  LALT: 1 << 2,
  LGUI: 1 << 3,
  RCTRL: 1 << 4,
  RSHIFT: 1 << 5,
  RALT: 1 << 6,
  RGUI: 1 << 7,
} as const;

/*
 * Per-binding behaviour. Neither flag set is the default: one keystroke per
 * press, then repeat at the configured delay and rate while held.
 */
export const BIND_NO_REPEAT = 1 << 0; // fire exactly once, never repeat
export const BIND_HOLD = 1 << 1;      // hold the key down while the button is held
export const SETF_REPORT_UNMAPPED = 1 << 0;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WireBinding {
  key: bigint;
  action: ActionType;
  mods: number;
  code: number;
  flags: number;
}

export interface WireToggleRule {
  protocol: number;
  cmdMask: number;
}

export interface WireSettings {
  repeatDelayMs: number;
  repeatRateMs: number;
  releaseTimeoutMs: number;
  ledMode: number;
  flags: number;
  toggleRules: WireToggleRule[];
}

export interface WireInfo {
  wireVersion: number;
  firmware: string;
  maxBindings: number;
  bindingCount: number;
  vid: number;
  pid: number;
  mode: number;
  modeFlags: number;
  irGpio: number;
  dirty: boolean;
  protocolsMask: number;
  board: string;
}

export interface WireIrEvent {
  key: bigint;
  address: number;
  command: number;
  bindingIndex: number;
  repeatCount: number;
  rawCount: number;
  frameSeq: number;
  protocol: number;
  flags: number;
  nbits: number;
  matched: boolean;
}

export interface WireRawEvent {
  chunk: number;
  chunks: number;
  total: number;
  frameSeq: number;
  us: number[];
}

export interface WireStats {
  framesDecoded: number;
  framesUnknown: number;
  framesDropped: number;
  keysSent: number;
  uptimeMs: number;
  lastProtocol: number;
}

export interface WirePacket {
  id: number;
  seq: number;
  status: number;
  len: number;
  payload: DataView;
}

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

/**
 * Builds a full 64-byte report. Short payloads are zero-padded.
 *
 * The return type names ArrayBuffer explicitly rather than leaving it as the
 * default ArrayBufferLike: HIDDevice.sendReport takes a BufferSource, which
 * does not accept a possibly-SharedArrayBuffer-backed view.
 */
export function buildPacket(
  id: number,
  seq: number,
  payload?: Uint8Array
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(WIRE_REPORT_SIZE);
  out[0] = id;
  out[1] = seq & 0xff;
  out[2] = 0;
  out[3] = payload ? payload.length : 0;
  if (payload) {
    if (payload.length > WIRE_PAYLOAD_SIZE) {
      throw new Error(`payload ${payload.length} exceeds ${WIRE_PAYLOAD_SIZE} bytes`);
    }
    out.set(payload, 4);
  }
  return out;
}

export function parsePacket(data: DataView): WirePacket {
  return {
    id: data.getUint8(0),
    seq: data.getUint8(1),
    status: data.getUint8(2),
    len: data.getUint8(3),
    payload: new DataView(data.buffer, data.byteOffset + 4, data.byteLength - 4),
  };
}

// ---------------------------------------------------------------------------
// Payload codecs. Offsets correspond 1:1 to the C structs.
// ---------------------------------------------------------------------------

/** wire_info_t, 36 bytes. */
export function parseInfo(p: DataView): WireInfo {
  let board = '';
  for (let i = 0; i < 16; i++) {
    const c = p.getUint8(20 + i);
    if (c === 0) break;
    board += String.fromCharCode(c);
  }
  return {
    wireVersion: p.getUint8(0),
    firmware: `${p.getUint8(1)}.${p.getUint8(2)}.${p.getUint8(3)}`,
    maxBindings: p.getUint16(4, true),
    bindingCount: p.getUint16(6, true),
    vid: p.getUint16(8, true),
    pid: p.getUint16(10, true),
    mode: p.getUint8(12),
    modeFlags: p.getUint8(13),
    irGpio: p.getUint8(14),
    dirty: p.getUint8(15) !== 0,
    protocolsMask: p.getUint32(16, true),
    board,
  };
}

/** wire_binding_t, 16 bytes, at an arbitrary offset. */
export function readBinding(p: DataView, off: number): WireBinding {
  return {
    key: p.getBigUint64(off + 0, true),
    action: p.getUint8(off + 8) as ActionType,
    mods: p.getUint8(off + 9),
    code: p.getUint16(off + 10, true),
    flags: p.getUint8(off + 12),
  };
}

export function writeBinding(p: DataView, off: number, b: WireBinding): void {
  p.setBigUint64(off + 0, b.key, true);
  p.setUint8(off + 8, b.action);
  p.setUint8(off + 9, b.mods);
  p.setUint16(off + 10, b.code, true);
  p.setUint8(off + 12, b.flags);
  p.setUint8(off + 13, 0);
  p.setUint8(off + 14, 0);
  p.setUint8(off + 15, 0);
}

/**
 * wire_binding_page_t, 56 bytes. The array starts at offset 8, not 4: the
 * uint64 key forces 8-byte alignment, which the C struct spells out as an
 * explicit pad field.
 */
const PAGE_BINDINGS_OFFSET = 8;

export function buildBindingPage(index: number, bindings: WireBinding[]): Uint8Array {
  if (bindings.length > CFG_BINDINGS_PER_PKT) {
    throw new Error(`a page holds at most ${CFG_BINDINGS_PER_PKT} bindings`);
  }
  const buf = new Uint8Array(56);
  const dv = new DataView(buf.buffer);
  dv.setUint16(0, index, true);
  dv.setUint8(2, bindings.length);
  dv.setUint8(3, 0);
  dv.setUint32(4, 0, true);
  bindings.forEach((b, i) => writeBinding(dv, PAGE_BINDINGS_OFFSET + i * 16, b));
  return buf;
}

export function parseBindingPage(p: DataView): { index: number; bindings: WireBinding[] } {
  const index = p.getUint16(0, true);
  const count = p.getUint8(2);
  const bindings: WireBinding[] = [];
  for (let i = 0; i < count && i < CFG_BINDINGS_PER_PKT; i++) {
    bindings.push(readBinding(p, PAGE_BINDINGS_OFFSET + i * 16));
  }
  return { index, bindings };
}

/** wire_settings_t, 44 bytes; toggle rules start at offset 12, 8 bytes each. */
const RULES_OFFSET = 12;

export function parseSettings(p: DataView): WireSettings {
  const toggleRules: WireToggleRule[] = [];
  for (let i = 0; i < CFG_MAX_TOGGLE_RULES; i++) {
    const base = RULES_OFFSET + i * 8;
    toggleRules.push({
      protocol: p.getUint8(base + 0),
      cmdMask: p.getUint32(base + 4, true),
    });
  }
  return {
    repeatDelayMs: p.getUint16(0, true),
    repeatRateMs: p.getUint16(2, true),
    releaseTimeoutMs: p.getUint16(4, true),
    ledMode: p.getUint8(6),
    flags: p.getUint8(7),
    toggleRules,
  };
}

export function buildSettings(s: WireSettings): Uint8Array {
  const buf = new Uint8Array(44);
  const dv = new DataView(buf.buffer);
  dv.setUint16(0, s.repeatDelayMs, true);
  dv.setUint16(2, s.repeatRateMs, true);
  dv.setUint16(4, s.releaseTimeoutMs, true);
  dv.setUint8(6, s.ledMode);
  dv.setUint8(7, s.flags);
  dv.setUint32(8, 0, true);
  for (let i = 0; i < CFG_MAX_TOGGLE_RULES; i++) {
    const r = s.toggleRules[i] ?? { protocol: 0, cmdMask: 0 };
    const base = RULES_OFFSET + i * 8;
    dv.setUint8(base + 0, r.protocol);
    dv.setUint8(base + 1, 0);
    dv.setUint16(base + 2, 0, true);
    dv.setUint32(base + 4, r.cmdMask >>> 0, true);
  }
  return buf;
}

/** wire_ir_event_t, 32 bytes. */
export function parseIrEvent(p: DataView): WireIrEvent {
  const bindingIndex = p.getUint16(16, true);
  return {
    key: p.getBigUint64(0, true),
    address: p.getUint32(8, true),
    command: p.getUint32(12, true),
    bindingIndex,
    repeatCount: p.getUint16(18, true),
    rawCount: p.getUint16(20, true),
    frameSeq: p.getUint32(24, true),
    protocol: p.getUint8(28),
    flags: p.getUint8(29),
    nbits: p.getUint8(30),
    matched: p.getUint8(31) !== 0,
  };
}

/** wire_raw_event_t, 60 bytes. */
export function parseRawEvent(p: DataView): WireRawEvent {
  const total = p.getUint16(2, true);
  const chunk = p.getUint8(0);
  const offset = chunk * WIRE_RAW_PER_PKT;
  const take = Math.max(0, Math.min(WIRE_RAW_PER_PKT, total - offset));
  const us: number[] = [];
  for (let i = 0; i < take; i++) us.push(p.getUint16(8 + i * 2, true));
  return {
    chunk,
    chunks: p.getUint8(1),
    total,
    frameSeq: p.getUint32(4, true),
    us,
  };
}

/** wire_stats_t, 24 bytes. */
export function parseStats(p: DataView): WireStats {
  return {
    framesDecoded: p.getUint32(0, true),
    framesUnknown: p.getUint32(4, true),
    framesDropped: p.getUint32(8, true),
    keysSent: p.getUint32(12, true),
    uptimeMs: p.getUint32(16, true),
    lastProtocol: p.getUint8(20),
  };
}

export function u16le(v: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, v, true);
  return b;
}
