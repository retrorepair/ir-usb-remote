#!/usr/bin/env node
/*
 * build-db.mjs - turn Flipper-IRDB .ir files into the app's remote database.
 *
 * Source: https://github.com/Lucaslhm/Flipper-IRDB (CC0-1.0, public domain),
 * cloned into ./sources/Flipper-IRDB. CC0 is why this one is bundled: it can
 * be redistributed inside a commercial product with no conditions. See
 * docs/database.md for why probonopd/irdb is deliberately not included.
 *
 * Output (written to app/resources/db):
 *   index.json        metadata for every remote, plus a protocol+address
 *                     lookup used to identify a remote from one button press
 *   buttons/NN.json   the button-to-command maps, sharded so the app loads
 *                     only what the user actually selects
 *
 * Usage: node build-db.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'sources', 'Flipper-IRDB');
const OUT = join(HERE, '..', '..', 'app', 'resources', 'db');
const SHARDS = 32;

/* ------------------------------------------------------------------ */
/* Protocol mapping                                                   */
/* ------------------------------------------------------------------ */
/*
 * Flipper protocol name -> our ir_protocol_t id, plus how to turn Flipper's
 * little-endian address/command byte arrays into the address and command our
 * firmware produces for the same transmission. Getting this exactly right is
 * what lets a database entry pre-fill a keymap with no learning at all.
 */
const PROTO = {
  // Flipper stores the 8-bit address; the firmware reports the same.
  NEC: { id: 1, addr: (b) => b[0], cmd: (b) => b[0] },
  // 16-bit address, little-endian. Command's second byte is its inverse.
  NECext: { id: 2, addr: (b) => b[0] | (b[1] << 8), cmd: (b) => b[0] },
  RC5: { id: 3, addr: (b) => b[0], cmd: (b) => b[0] },
  RC5X: { id: 4, addr: (b) => b[0], cmd: (b) => b[0] },
  // Flipper's "RC6" is mode 0: 8-bit control, 8-bit information.
  RC6: { id: 5, addr: (b) => b[0], cmd: (b) => b[0] },
  SIRC: { id: 7, addr: (b) => b[0] | (b[1] << 8), cmd: (b) => b[0] },
  SIRC15: { id: 8, addr: (b) => b[0] | (b[1] << 8), cmd: (b) => b[0] },
  SIRC20: { id: 9, addr: (b) => b[0] | (b[1] << 8), cmd: (b) => b[0] },
  /*
   * Samsung sends its address byte twice and the firmware reports both, so a
   * database address of 0x0E corresponds to a decoded address of 0x0E0E.
   */
  Samsung32: { id: 10, addr: (b) => b[0] | (b[0] << 8), cmd: (b) => b[0] },
};

/*
 * Deliberately excluded rather than guessed at: Kaseikyo, RCA, Pioneer and
 * the NEC42 variants store their fields in a layout that does not line up
 * with how the firmware packs identity, so a computed key would be wrong in a
 * way the user could not see. These remotes still work -- they are learned by
 * pressing buttons, which is always available.
 */
const UNMAPPED_PROTOCOLS = new Set(['Kaseikyo', 'RCA', 'Pioneer', 'NEC42', 'NEC42ext', 'NECext42']);

/* ------------------------------------------------------------------ */
/* Button name canonicalisation                                       */
/* ------------------------------------------------------------------ */
/*
 * Contributors name buttons inconsistently ("Vol_up", "VOL+", "Volume_Up").
 * Mapping them onto one vocabulary is what allows a keymap preset to fill
 * itself in after the user picks their remote.
 */
const CANON = [
  ['power', /^(power|pwr|on_off|onoff|standby|power_toggle)$/],
  ['power_on', /^(power_?on|on)$/],
  ['power_off', /^(power_?off|off)$/],
  ['vol_up', /^(vol(ume)?[_\- ]?(up|\+|plus)|vol\+)$/],
  ['vol_down', /^(vol(ume)?[_\- ]?(dn|down|-|minus)|vol-)$/],
  ['mute', /^(mute|silence|vol_mute)$/],
  ['ch_up', /^(ch(annel)?[_\- ]?(up|next|\+|plus)|prog(ram)?[_\- ]?up)$/],
  ['ch_down', /^(ch(annel)?[_\- ]?(dn|down|prev|previous|-|minus)|prog(ram)?[_\- ]?down)$/],
  ['up', /^(up|arrow_?up|nav_?up|cursor_?up)$/],
  ['down', /^(down|arrow_?down|nav_?down|cursor_?down)$/],
  ['left', /^(left|arrow_?left|nav_?left|cursor_?left)$/],
  ['right', /^(right|arrow_?right|nav_?right|cursor_?right)$/],
  ['ok', /^(ok|enter|select|confirm|center|centre)$/],
  ['back', /^(back|return|prev_?menu)$/],
  ['exit', /^(exit|close|cancel)$/],
  ['home', /^(home|smart_?hub|smarthub|dashboard)$/],
  ['menu', /^(menu|settings|setup|tools|options)$/],
  ['guide', /^(guide|epg|tv_?guide)$/],
  ['info', /^(info|display|status|detail)$/],
  ['play', /^(play)$/],
  ['pause', /^(pause)$/],
  ['play_pause', /^(play_?pause|play_?\/?_?pause)$/],
  ['stop', /^(stop)$/],
  ['record', /^(rec|record)$/],
  ['next', /^(next|skip_?next|skip_?forward|track_?next)$/],
  ['prev', /^(prev|previous|skip_?prev|skip_?back|track_?prev)$/],
  ['fast_forward', /^(ff|fast_?forward|forward|fwd)$/],
  ['rewind', /^(rew|rewind|back_?ward|rwd)$/],
  ['source', /^(source|input|av|tv_?av|signal)$/],
  ['subtitle', /^(sub(title)?s?|cc|closed_?caption)$/],
  ['audio', /^(audio|lang(uage)?|sound)$/],
  ['text', /^(text|teletext|ttx)$/],
  ['red', /^(red)$/], ['green', /^(green)$/],
  ['yellow', /^(yellow)$/], ['blue', /^(blue)$/],
  ...Array.from({ length: 10 }, (_, i) => [`num_${i}`, new RegExp(`^(${i}|num_?${i}|key_?${i}|digit_?${i})$`)]),
];

function canonical(name) {
  const k = name.trim().toLowerCase().replace(/[\s\-]+/g, '_');
  for (const [canon, re] of CANON) if (re.test(k)) return canon;
  return null;
}

/* ------------------------------------------------------------------ */
/* .ir parsing                                                        */
/* ------------------------------------------------------------------ */
function parseBytes(s) {
  return s.trim().split(/\s+/).map((h) => parseInt(h, 16) & 0xff);
}

function parseIrFile(text) {
  const signals = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) {
      if (cur) { signals.push(cur); cur = null; }
      continue;
    }
    const m = line.match(/^(\w+)\s*:\s*(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (key === 'name') {
      if (cur) signals.push(cur);
      cur = { name: value };
    } else if (cur) {
      cur[key] = value;
    }
  }
  if (cur) signals.push(cur);
  return signals;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (entry.toLowerCase().endsWith('.ir')) out.push(p);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Build                                                              */
/* ------------------------------------------------------------------ */
if (!existsSync(SRC)) {
  console.error(`Source database not found at ${SRC}\n` +
    `Run: git clone --depth 1 https://github.com/Lucaslhm/Flipper-IRDB.git "${SRC}"`);
  process.exit(1);
}

const files = walk(SRC);
console.log(`scanning ${files.length} .ir files`);

const remotes = [];
const shards = Array.from({ length: SHARDS }, () => ({}));
const byKey = new Map(); // "protocol:address" -> [remote index, ...]
const stats = { files: 0, skippedNoParsed: 0, skippedUnmapped: 0, mixed: 0, signals: 0, canon: 0, protocols: {} };

for (const file of files) {
  const rel = relative(SRC, file).split(/[\\/]/);
  if (rel.length < 2) continue;
  const category = rel[0];
  const brand = rel.length >= 3 ? rel[1] : 'Unknown';
  const model = basename(file, '.ir');

  let signals;
  try {
    signals = parseIrFile(readFileSync(file, 'utf8'));
  } catch {
    continue;
  }

  const parsed = signals.filter((s) => s.type === 'parsed' && s.protocol && s.address && s.command);
  if (!parsed.length) { stats.skippedNoParsed++; continue; }

  for (const s of parsed) stats.protocols[s.protocol] = (stats.protocols[s.protocol] ?? 0) + 1;

  /*
   * One remote must resolve to one protocol and one address, since that pair
   * is what identification matches on. A handful of files mix several
   * devices together; take the dominant pair and drop the rest rather than
   * registering an address that only some buttons use.
   */
  const tally = new Map();
  for (const s of parsed) {
    const map = PROTO[s.protocol];
    if (!map) continue;
    const addr = map.addr(parseBytes(s.address));
    const k = `${map.id}:${addr}`;
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  if (!tally.size) {
    if (parsed.some((s) => UNMAPPED_PROTOCOLS.has(s.protocol))) stats.skippedUnmapped++;
    else stats.skippedNoParsed++;
    continue;
  }

  const [domKey] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (tally.size > 1) stats.mixed++;
  const [protoId, address] = domKey.split(':').map(Number);

  const buttons = [];
  const seen = new Set();
  for (const s of parsed) {
    const map = PROTO[s.protocol];
    if (!map || map.id !== protoId) continue;
    if (map.addr(parseBytes(s.address)) !== address) continue;
    const cmd = map.cmd(parseBytes(s.command));
    const name = s.name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const canon = canonical(name);
    if (canon) stats.canon++;
    buttons.push(canon ? [name, cmd, canon] : [name, cmd]);
  }
  if (!buttons.length) continue;

  const idx = remotes.length;
  const shard = idx % SHARDS;
  remotes.push({ i: idx, b: brand, m: model, c: category, p: protoId, a: address, n: buttons.length, s: shard });
  shards[shard][idx] = buttons;
  stats.signals += buttons.length;
  stats.files++;

  const k = `${protoId}:${address}`;
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push(idx);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'buttons'), { recursive: true });

/*
 * Identification candidates are capped. An address like NEC 0x04 is shared by
 * hundreds of LG remotes, and a list that long is no more useful to the user
 * than the first few -- while the ones with the most buttons are the most
 * likely to be a complete layout.
 */
const MAX_CANDIDATES = 40;
const lookup = {};
for (const [k, list] of byKey) {
  lookup[k] = list
    .sort((x, y) => remotes[y].n - remotes[x].n)
    .slice(0, MAX_CANDIDATES);
}

writeFileSync(join(OUT, 'index.json'), JSON.stringify({
  source: 'Flipper-IRDB',
  sourceUrl: 'https://github.com/Lucaslhm/Flipper-IRDB',
  license: 'CC0-1.0',
  generated: new Date().toISOString().slice(0, 10),
  shards: SHARDS,
  remotes,
  lookup,
}));

shards.forEach((s, i) => {
  writeFileSync(join(OUT, 'buttons', `${String(i).padStart(2, '0')}.json`), JSON.stringify(s));
});

const kb = (p) => (statSync(p).size / 1024).toFixed(0);
console.log(`\nremotes:          ${stats.files}`);
console.log(`buttons:          ${stats.signals} (${stats.canon} recognised by name)`);
console.log(`distinct addrs:   ${byKey.size}`);
console.log(`skipped, no usable parsed signals: ${stats.skippedNoParsed}`);
console.log(`skipped, protocol not identity-mappable: ${stats.skippedUnmapped}`);
console.log(`files mixing devices (dominant kept):  ${stats.mixed}`);
console.log(`\nindex.json:       ${kb(join(OUT, 'index.json'))} KB`);
console.log(`buttons/*.json:   ${shards.reduce((a, _, i) => a + Number(kb(join(OUT, 'buttons', `${String(i).padStart(2, '0')}.json`))), 0)} KB total`);
console.log('\nprotocol counts in source:');
for (const [p, n] of Object.entries(stats.protocols).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${PROTO[p] ? ' ' : '-'} ${p.padEnd(12)} ${n}`);
}
