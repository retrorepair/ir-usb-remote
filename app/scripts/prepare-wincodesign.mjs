#!/usr/bin/env node
/*
 * prepare-wincodesign.mjs - make `electron-builder --win` work on Windows
 * without Developer Mode or administrator rights.
 *
 * THE PROBLEM
 *
 * electron-builder downloads a support bundle called winCodeSign, which holds
 * rcedit (stamps the exe's icon and version metadata) and signtool. The
 * bundle is built for every platform, so it also contains two macOS symlinks:
 *
 *   darwin/10.12/lib/libcrypto.dylib
 *   darwin/10.12/lib/libssl.dylib
 *
 * Creating a symlink on Windows needs SeCreateSymbolicLinkPrivilege, which
 * ordinary accounts do not hold unless Developer Mode is on. 7-Zip extracts
 * all 83 files perfectly, fails on those two links, and exits 2.
 * electron-builder treats any non-zero exit as fatal, discards the whole
 * directory and retries -- so the build fails even though every file it
 * actually needs extracted correctly.
 *
 * This is not specific to the NSIS target. rcedit lives in the same bundle,
 * so any Windows target that stamps the executable hits it.
 *
 * THE FIX
 *
 * Extract the bundle ourselves without asking for symlinks (no -snl flag, so
 * 7-Zip writes them as ordinary files), and put the result where
 * electron-builder looks. It finds a populated directory and skips the
 * download and extraction entirely.
 *
 * Runs automatically via the `predist` script; safe and near-instant to
 * re-run once the cache is in place.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

/* The version electron-builder 25 asks for. If it ever moves, the build fails
 * loudly in the old way rather than silently using a stale bundle. */
const NAME = 'winCodeSign-2.6.0';
const URL = `https://github.com/electron-userland/electron-builder-binaries/releases/download/${NAME}/${NAME}.7z`;

/* Files that must be present for the extraction to count as usable. */
const REQUIRED = ['rcedit-x64.exe', 'rcedit-ia32.exe'];

function cacheRoot() {
  if (process.env.ELECTRON_BUILDER_CACHE) return process.env.ELECTRON_BUILDER_CACHE;
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Local'),
                'electron-builder', 'Cache');
  }
  return join(process.env.HOME || '', '.cache', 'electron-builder');
}

function find7za() {
  const candidates = [
    join(process.cwd(), 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe'),
    join(process.cwd(), '..', 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function isUsable(dir) {
  return existsSync(dir) && REQUIRED.every((f) => existsSync(join(dir, f)));
}

function main() {
  if (process.platform !== 'win32') {
    console.log('prepare-wincodesign: not Windows, nothing to do.');
    return;
  }

  const signDir = join(cacheRoot(), 'winCodeSign');
  const target = join(signDir, NAME);

  if (isUsable(target)) {
    console.log(`prepare-wincodesign: already present at ${target}`);
    cleanOrphans(signDir);
    return;
  }

  const sevenZip = find7za();
  if (!sevenZip) {
    console.error('prepare-wincodesign: 7za.exe not found. Run npm install first.');
    process.exit(1);
  }

  mkdirSync(signDir, { recursive: true });

  /* Reuse an archive a previous (failed) run already downloaded. */
  let archive = readdirSync(signDir)
    .filter((f) => f.toLowerCase().endsWith('.7z'))
    .map((f) => join(signDir, f))
    .find((f) => statSync(f).size > 1_000_000);

  if (!archive) {
    archive = join(signDir, `${NAME}.7z`);
    console.log(`prepare-wincodesign: downloading ${NAME}...`);
    const curl = spawnSync('curl.exe', ['-L', '--fail', '--retry', '3', '-o', archive, URL], {
      stdio: 'inherit',
    });
    if (curl.status !== 0 || !existsSync(archive)) {
      console.error('prepare-wincodesign: download failed.');
      process.exit(1);
    }
  } else {
    console.log(`prepare-wincodesign: reusing ${archive}`);
  }

  const staging = join(tmpdir(), `wincodesign-${process.pid}`);
  rmSync(staging, { recursive: true, force: true });

  /*
   * No -snl: that is the whole point. electron-builder passes it, which makes
   * 7-Zip try to create real symlinks and fail. Without it the two .dylib
   * entries become ordinary files, which Windows never needs anyway.
   */
  const res = spawnSync(sevenZip, ['x', archive, `-o${staging}`, '-y'], { stdio: 'pipe' });

  if (!isUsable(staging)) {
    console.error('prepare-wincodesign: extraction did not produce the expected files.');
    console.error((res.stderr || res.stdout || Buffer.from('')).toString().slice(-800));
    process.exit(1);
  }
  if (res.status !== 0) {
    console.log(`prepare-wincodesign: 7-Zip exited ${res.status}, but every required file is present — continuing.`);
  }

  rmSync(target, { recursive: true, force: true });
  renameSync(staging, target);
  console.log(`prepare-wincodesign: installed ${target}`);
  cleanOrphans(signDir);
}

/*
 * Remove the numerically-named directories left behind by electron-builder's
 * failed extraction attempts. Each is a ~20 MB abandoned temp copy of the
 * same bundle, and nothing ever reads them again.
 */
function cleanOrphans(signDir) {
  let freed = 0;
  let count = 0;
  for (const entry of readdirSync(signDir)) {
    if (!/^\d+$/.test(entry)) continue;
    const p = join(signDir, entry);
    try {
      if (!statSync(p).isDirectory()) continue;
      freed += dirSize(p);
      rmSync(p, { recursive: true, force: true });
      count++;
    } catch {
      /* In use or already gone; leaving it costs only disk space. */
    }
  }
  if (count) {
    console.log(`prepare-wincodesign: removed ${count} abandoned extraction(s), freed ${(freed / 1048576).toFixed(0)} MB`);
  }
}

function dirSize(dir) {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    try {
      total += e.isDirectory() ? dirSize(p) : statSync(p).size;
    } catch {
      /* ignore */
    }
  }
  return total;
}

main();
