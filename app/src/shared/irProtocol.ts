/*
 * irProtocol.ts - mirror of firmware/include/ir_protocol.h.
 *
 * Kept in sync by tools/check-protocol-sync.mjs, which parses the C header
 * and fails if any value here disagrees. Identity keys end up in saved
 * profiles and in device flash, so a silent divergence would quietly break
 * every existing configuration.
 */

export enum IrProtocol {
  None = 0,
  Nec = 1,
  NecExt = 2,
  Rc5 = 3,
  Rc5X = 4,
  Rc6_0 = 5,
  Rc6_6A = 6,
  Sony12 = 7,
  Sony15 = 8,
  Sony20 = 9,
  Samsung32 = 10,
  Kaseikyo = 11,
  Jvc = 12,
  Sharp = 13,
  Denon = 14,
  Rca = 15,
  RawHash = 255,
}

/** Short names, identical to ir_protocol_name() in the firmware. */
export const PROTOCOL_NAMES: Record<number, string> = {
  [IrProtocol.None]: 'none',
  [IrProtocol.Nec]: 'NEC',
  [IrProtocol.NecExt]: 'NECext',
  [IrProtocol.Rc5]: 'RC5',
  [IrProtocol.Rc5X]: 'RC5X',
  [IrProtocol.Rc6_0]: 'RC6',
  [IrProtocol.Rc6_6A]: 'RC6-6A',
  [IrProtocol.Sony12]: 'SIRC12',
  [IrProtocol.Sony15]: 'SIRC15',
  [IrProtocol.Sony20]: 'SIRC20',
  [IrProtocol.Samsung32]: 'Samsung32',
  [IrProtocol.Kaseikyo]: 'Kaseikyo',
  [IrProtocol.Jvc]: 'JVC',
  [IrProtocol.Sharp]: 'Sharp',
  [IrProtocol.Denon]: 'Denon',
  [IrProtocol.Rca]: 'RCA',
  [IrProtocol.RawHash]: 'Raw',
};

export function protocolName(p: number): string {
  return PROTOCOL_NAMES[p] ?? `0x${p.toString(16)}`;
}

/** Protocols this firmware can decode by name rather than by timing hash. */
export function decodedProtocols(mask: number): string[] {
  const out: string[] = [];
  for (let i = 1; i < 32; i++) {
    if (mask & (1 << i)) out.push(protocolName(i));
  }
  return out;
}

/*
 * The 64-bit identity key, packed exactly as IR_KEY() does:
 *   bits 63..56 protocol, bits 55..32 address (24), bits 31..0 command.
 *
 * BigInt rather than number: a command alone can use all 32 bits, so the key
 * exceeds the 53 bits a double represents exactly, and an off-by-one in the
 * top bits would mean a binding that never matches.
 */
export function makeKey(protocol: number, address: number, command: number): bigint {
  return (
    (BigInt(protocol & 0xff) << 56n) |
    (BigInt(address & 0x00ffffff) << 32n) |
    BigInt(command >>> 0)
  );
}

export function keyProtocol(key: bigint): number {
  return Number((key >> 56n) & 0xffn);
}
export function keyAddress(key: bigint): number {
  return Number((key >> 32n) & 0xffffffn);
}
export function keyCommand(key: bigint): number {
  return Number(key & 0xffffffffn);
}

/** Human-readable form, for the UI only. Never parsed back. */
export function formatKey(key: bigint): string {
  const p = keyProtocol(key);
  const a = keyAddress(key).toString(16).toUpperCase().padStart(4, '0');
  const c = keyCommand(key).toString(16).toUpperCase().padStart(2, '0');
  return `${protocolName(p)}:${a}:${c}`;
}

/*
 * Storage form for saved profiles: the raw 64-bit value as fixed-width hex.
 *
 * Deliberately not the display form above. That one contains a protocol
 * *name*, so round-tripping it would depend on a name table that must then
 * never change -- and a renamed protocol would silently invalidate every
 * saved profile. JSON also has no integer type wide enough for the key, hence
 * a string rather than a number.
 */
export function encodeKey(key: bigint): string {
  return '0x' + key.toString(16).padStart(16, '0');
}

export function decodeKey(s: string): bigint {
  return BigInt(s);
}

/** Decoded-frame flags, matching IR_FLAG_* in the firmware. */
export const IR_FLAG_REPEAT = 1 << 0;
export const IR_FLAG_TOGGLE = 1 << 1;
export const IR_FLAG_AUTOREPEAT = 1 << 2;
