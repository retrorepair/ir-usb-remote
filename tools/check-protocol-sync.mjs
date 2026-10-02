#!/usr/bin/env node
/*
 * check-protocol-sync.mjs - prove the C headers and the TypeScript mirror agree.
 *
 * The firmware and the configurator each define the protocol independently:
 * the firmware in C because it has no choice, the app in TypeScript because
 * it has no choice either. Identity keys and binding layouts are written into
 * device flash and into saved user profiles, so a silent divergence between
 * the two would corrupt existing configurations rather than fail loudly.
 *
 * This compares them and exits non-zero on any mismatch. Run it in CI and
 * before a release: npm run check:protocol
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const problems = [];
const checked = [];

function expect(label, c, ts) {
  if (c === undefined) return problems.push(`${label}: not found in the C header`);
  if (ts === undefined) return problems.push(`${label}: not found in the TypeScript mirror`);
  if (String(c) !== String(ts)) {
    return problems.push(`${label}: C says ${c}, TypeScript says ${ts}`);
  }
  checked.push(label);
}

/* ---- #define constants ------------------------------------------------- */
function cDefines(text) {
  const out = {};
  const re = /^#define\s+([A-Z0-9_]+)\s+([0-9]+)\s*(?:\/\*|$)/gm;
  for (const m of text.matchAll(re)) out[m[1]] = Number(m[2]);
  return out;
}

/* ---- C enum members (decimal or hex) ---------------------------------- */
/*
 * Splitting on the opening brace rather than using one regex for the whole
 * construct: a lazy `[\s\S]*?` anchored on the closing type name still starts
 * at the FIRST `typedef enum` in the file, so every lookup but the first
 * swallowed all the preceding enums too.
 */
function cEnum(text, typeName) {
  const parts = text.split(/typedef\s+enum\s*\{/);
  for (let i = 1; i < parts.length; i++) {
    const close = parts[i].indexOf('}');
    if (close < 0) continue;
    const named = parts[i].slice(close + 1).match(/^\s*(\w+)\s*;/);
    if (!named || named[1] !== typeName) continue;

    const out = {};
    const re = /^\s*([A-Z0-9_]+)\s*=\s*(0[xX][0-9a-fA-F]+|\d+)/gm;
    for (const m of parts[i].slice(0, close).matchAll(re)) out[m[1]] = Number(m[2]);
    return out;
  }
  return null;
}

/* ---- TypeScript enum members ------------------------------------------ */
function tsEnum(text, name) {
  const body = text.match(new RegExp(`export enum ${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!body) return null;
  const out = {};
  const re = /^\s*(\w+)\s*=\s*(0[xX][0-9a-fA-F]+|\d+)/gm;
  for (const m of body[1].matchAll(re)) out[m[1]] = Number(m[2]);
  return out;
}

function tsConsts(text) {
  const out = {};
  const re = /^export const ([A-Z0-9_]+)\s*=\s*(0[xX][0-9a-fA-F]+|\d+)\s*;/gm;
  for (const m of text.matchAll(re)) out[m[1]] = Number(m[2]);
  return out;
}

const irH = read('firmware/include/ir_protocol.h');
const wireH = read('firmware/include/wire_protocol.h');
const irTs = read('app/src/shared/irProtocol.ts');
const wireTs = read('app/src/shared/wire.ts');

/* ===================== protocol ids ==================================== */
const cProto = cEnum(irH, 'ir_protocol_t');
const tsProto = tsEnum(irTs, 'IrProtocol');
if (!cProto || !tsProto) {
  problems.push('could not parse the protocol enum from one of the two sides');
} else {
  /* C name -> TS name. Only the numeric values must match; the spellings are
   * idiomatic to each language. */
  const pairs = [
    ['IR_PROTO_NONE', 'None'], ['IR_PROTO_NEC', 'Nec'], ['IR_PROTO_NEC_EXT', 'NecExt'],
    ['IR_PROTO_RC5', 'Rc5'], ['IR_PROTO_RC5X', 'Rc5X'], ['IR_PROTO_RC6_0', 'Rc6_0'],
    ['IR_PROTO_RC6_6A', 'Rc6_6A'], ['IR_PROTO_SONY12', 'Sony12'], ['IR_PROTO_SONY15', 'Sony15'],
    ['IR_PROTO_SONY20', 'Sony20'], ['IR_PROTO_SAMSUNG32', 'Samsung32'],
    ['IR_PROTO_KASEIKYO', 'Kaseikyo'], ['IR_PROTO_JVC', 'Jvc'], ['IR_PROTO_SHARP', 'Sharp'],
    ['IR_PROTO_DENON', 'Denon'], ['IR_PROTO_RCA', 'Rca'], ['IR_PROTO_RAW_HASH', 'RawHash'],
  ];
  for (const [cName, tsName] of pairs) {
    expect(`protocol ${cName}`, cProto[cName], tsProto[tsName]);
  }
  for (const k of Object.keys(cProto)) {
    if (!pairs.some(([c]) => c === k)) {
      problems.push(`protocol ${k} exists in C but is not mirrored in TypeScript`);
    }
  }

  /* Short names are used as database keys and shown in the UI. */
  const cNames = {};
  for (const m of irH.matchAll(/case\s+(IR_PROTO_\w+):\s*return\s+"([^"]*)"/g)) cNames[m[1]] = m[2];
  const cNamesFromImpl = read('firmware/src/ir_protocol.c');
  for (const m of cNamesFromImpl.matchAll(/case\s+(IR_PROTO_\w+):\s*return\s+"([^"]*)"/g)) {
    cNames[m[1]] = m[2];
  }
  const tsNames = {};
  for (const m of irTs.matchAll(/\[IrProtocol\.(\w+)\]:\s*'([^']*)'/g)) tsNames[m[1]] = m[2];
  for (const [cName, tsName] of pairs) {
    if (cNames[cName] === undefined) continue;
    expect(`name of ${cName}`, cNames[cName], tsNames[tsName]);
  }
}

/* ===================== wire constants ================================== */
const cDef = { ...cDefines(wireH), ...cDefines(irH) };
const tsConst = tsConsts(wireTs);

for (const name of [
  'WIRE_REPORT_SIZE',
  'WIRE_PAYLOAD_SIZE',
  'WIRE_VERSION',
  'CFG_MAX_TOGGLE_RULES',
  'CFG_BINDINGS_PER_PKT',
  'WIRE_RAW_PER_PKT',
]) {
  expect(name, cDef[name], tsConst[name]);
}

/* ===================== command, event, status, action enums ============ */
const enumChecks = [
  ['wire_cmd_t', 'Cmd'],
  ['wire_status_t', 'WireStatus'],
  ['wire_action_t', 'ActionType'],
  ['wire_mode_t', 'WireMode'],
  ['wire_evt_t', 'Evt'],
];

/* Name mapping is spelling-only, so compare the sorted value sets instead of
 * trying to transliterate every identifier. */
for (const [cType, tsName] of enumChecks) {
  const c = cEnum(wireH, cType);
  const ts = tsEnum(wireTs, tsName);
  if (!c || !ts) {
    problems.push(`could not parse ${cType} / ${tsName}`);
    continue;
  }
  const cVals = Object.values(c).sort((a, b) => a - b).join(',');
  const tsVals = Object.values(ts).sort((a, b) => a - b).join(',');
  expect(`${cType} values`, cVals, tsVals);
  if (Object.keys(c).length !== Object.keys(ts).length) {
    problems.push(
      `${cType} has ${Object.keys(c).length} members but ${tsName} has ${Object.keys(ts).length}`
    );
  }
}

/* ===================== report ========================================== */
if (problems.length) {
  console.error('Protocol definitions are out of sync:\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    `\n${checked.length} checks passed, ${problems.length} failed.\n` +
      'Fix firmware/include/*.h and app/src/shared/*.ts so they agree, then re-run.'
  );
  process.exit(1);
}

console.log(`Protocol definitions are in sync (${checked.length} checks).`);
