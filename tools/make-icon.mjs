#!/usr/bin/env node
/*
 * make-icon.mjs - generates app/resources/icon.ico.
 *
 * Written as code rather than shipped as a binary blob so the icon can be
 * recoloured or restyled without a graphics editor, and so the repository
 * carries no opaque asset nobody can edit.
 *
 * The motif is an emitter dot with three arcs: infrared leaving a remote.
 * It is drawn from signed-distance functions with 4x4 supersampling, which
 * is what keeps the 16 px version legible instead of a grey smudge.
 *
 * Usage: node tools/make-icon.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'app', 'resources', 'icon.ico');

/* Windows uses every one of these: 16 in the title bar, 32 in the taskbar,
 * 48 in Explorer's medium view, 256 for large tiles and the installer. */
const SIZES = [256, 128, 64, 48, 32, 16];

const BG       = [0x14, 0x1a, 0x22];
const BG_EDGE  = [0x2d, 0x33, 0x3e];
const ACCENT   = [0x52, 0xa3, 0xff];

// --- signed distance helpers ---------------------------------------------

/** Rounded box: negative inside, positive outside. */
function sdRoundedBox(px, py, bx, by, r) {
  const qx = Math.abs(px) - bx + r;
  const qy = Math.abs(py) - by + r;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

/** An arc centred on (cx,cy): a ring of radius R, thickness t, limited to
 *  +/- halfSpan radians either side of the +x axis. */
function sdArc(px, py, cx, cy, R, t, halfSpan) {
  const dx = px - cx;
  const dy = py - cy;
  const ring = Math.abs(Math.hypot(dx, dy) - R) - t;
  const ang = Math.abs(Math.atan2(dy, dx));
  if (ang <= halfSpan) return ring;

  /* Outside the angular span, fall back to the distance to the nearer
   * endpoint so the arc gets a rounded cap rather than a hard chop. */
  const ex = cx + Math.cos(halfSpan) * R;
  const ey = Math.sin(halfSpan) * R;
  const d1 = Math.hypot(dx - (ex - cx), dy - ey) - t;
  const d2 = Math.hypot(dx - (ex - cx), dy + ey) - t;
  return Math.min(d1, d2);
}

// --- rendering ------------------------------------------------------------

/** Coverage of a shape at one pixel, via NxN supersampling. */
function coverage(x, y, size, N, fn) {
  let hits = 0;
  for (let sy = 0; sy < N; sy++) {
    for (let sx = 0; sx < N; sx++) {
      const px = ((x + (sx + 0.5) / N) / size - 0.5) * 2;
      const py = ((y + (sy + 0.5) / N) / size - 0.5) * 2;
      if (fn(px, py) < 0) hits++;
    }
  }
  return hits / (N * N);
}

function render(size) {
  const N = size >= 64 ? 4 : 6; // small icons need more samples, not fewer
  const rgba = new Uint8Array(size * size * 4);

  /* Thicker strokes at small sizes: a line that is mathematically correct at
   * 256 px disappears entirely at 16. */
  const boost = size <= 32 ? 1.9 : size <= 48 ? 1.45 : 1.0;

  const bgShape = (px, py) => sdRoundedBox(px, py, 0.94, 0.94, 0.30);
  const edgeShape = (px, py) => -(sdRoundedBox(px, py, 0.94, 0.94, 0.30) + 0.055);

  /*
   * Fewer, fatter arcs as the icon shrinks. Three arcs at 16 px merge into an
   * unreadable blue block, so detail is dropped deliberately rather than
   * scaled down -- the same reason real icon sets are drawn per size.
   */
  const tiny = size <= 16;
  const small = size <= 32;

  const cx = tiny ? -0.34 : -0.46;
  const cy = 0.0;
  const dotR = tiny ? 0.21 : small ? 0.19 : 0.15;
  const thick = 0.052 * boost;

  const radii = tiny ? [0.66] : small ? [0.48, 0.84] : [0.40, 0.68, 0.96];
  const span = tiny ? 1.05 : 0.92;

  const motif = (px, py) => {
    let d = sdCircle(px, py, cx, cy, dotR);
    for (const R of radii) {
      d = Math.min(d, sdArc(px, py, cx, cy, R, thick, span));
    }
    return d;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inBg = coverage(x, y, size, N, bgShape);
      if (inBg <= 0) continue;

      const onEdge = coverage(x, y, size, N, (px, py) =>
        Math.max(bgShape(px, py), edgeShape(px, py))
      );
      const onMotif = coverage(x, y, size, N, motif);

      let r = BG[0], g = BG[1], b = BG[2];
      if (onEdge > 0) {
        r = r + (BG_EDGE[0] - r) * onEdge;
        g = g + (BG_EDGE[1] - g) * onEdge;
        b = b + (BG_EDGE[2] - b) * onEdge;
      }
      if (onMotif > 0) {
        r = r + (ACCENT[0] - r) * onMotif;
        g = g + (ACCENT[1] - g) * onMotif;
        b = b + (ACCENT[2] - b) * onMotif;
      }

      const i = (y * size + x) * 4;
      rgba[i] = Math.round(r);
      rgba[i + 1] = Math.round(g);
      rgba[i + 2] = Math.round(b);
      rgba[i + 3] = Math.round(inBg * 255);
    }
  }
  return rgba;
}

// --- ICO encoding ---------------------------------------------------------

/**
 * One icon image, in the BMP form ICO expects: a BITMAPINFOHEADER whose
 * height is doubled to account for the AND mask, then bottom-up BGRA rows.
 */
function encodeImage(size, rgba) {
  const headerSize = 40;
  const xorSize = size * size * 4;
  const maskRow = Math.ceil(size / 32) * 4; // 1bpp, rows padded to 4 bytes
  const maskSize = maskRow * size;

  const buf = Buffer.alloc(headerSize + xorSize + maskSize);
  buf.writeUInt32LE(headerSize, 0);
  buf.writeInt32LE(size, 4);
  buf.writeInt32LE(size * 2, 8); // XOR plus AND
  buf.writeUInt16LE(1, 12);      // planes
  buf.writeUInt16LE(32, 14);     // bits per pixel
  buf.writeUInt32LE(0, 16);      // BI_RGB
  buf.writeUInt32LE(xorSize, 20);

  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4; // bottom-up
    const dst = headerSize + y * size * 4;
    for (let x = 0; x < size; x++) {
      buf[dst + x * 4 + 0] = rgba[src + x * 4 + 2]; // B
      buf[dst + x * 4 + 1] = rgba[src + x * 4 + 1]; // G
      buf[dst + x * 4 + 2] = rgba[src + x * 4 + 0]; // R
      buf[dst + x * 4 + 3] = rgba[src + x * 4 + 3]; // A
    }
  }
  /* The AND mask stays all zeros: with 32bpp the alpha channel is what
   * Windows actually uses, and a zeroed mask means "opaque everywhere". */
  return buf;
}

const images = SIZES.map((size) => ({ size, data: encodeImage(size, render(size)) }));

const dirSize = 6 + images.length * 16;
let offset = dirSize;
const dir = Buffer.alloc(dirSize);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2); // type: icon
dir.writeUInt16LE(images.length, 4);

images.forEach((img, i) => {
  const e = 6 + i * 16;
  dir[e + 0] = img.size >= 256 ? 0 : img.size; // 0 means 256
  dir[e + 1] = img.size >= 256 ? 0 : img.size;
  dir[e + 2] = 0; // palette size
  dir[e + 3] = 0;
  dir.writeUInt16LE(1, e + 4);  // planes
  dir.writeUInt16LE(32, e + 6); // bpp
  dir.writeUInt32LE(img.data.length, e + 8);
  dir.writeUInt32LE(offset, e + 12);
  offset += img.data.length;
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.concat([dir, ...images.map((i) => i.data)]));

console.log(`wrote ${OUT}`);
console.log(`  sizes: ${SIZES.join(', ')}`);
console.log(`  bytes: ${(offset / 1024).toFixed(1)} KB`);
