#!/usr/bin/env node
// Downloads the pinned Kokoro neural-voice runtime and model so the app is fully self-hosted
// (no third-party requests at runtime). Every file is verified against scripts/assets.lock.json.
//
//   node scripts/fetch-assets.mjs                 download missing/changed files (verifies SHA-256)
//   node scripts/fetch-assets.mjs --update-lock   re-download everything and record new hashes
//   ASSETS_DIR=/some/dir node scripts/...         write somewhere other than ./public
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_PATH = join(ROOT, 'scripts', 'assets.lock.json');
const OUT_DIR = process.env.ASSETS_DIR || join(ROOT, 'public');
const UPDATE = process.argv.includes('--update-lock');

const lock = JSON.parse(await readFile(LOCK_PATH, 'utf8'));
const { kokoroJs, transformers, modelRepo, modelRevision, modelFiles, voices } = lock.sources;

const HF = `https://huggingface.co/${modelRepo}/resolve/${modelRevision}`;
const wanted = [
  { path: 'vendor/kokoro/kokoro.web.js', url: `https://cdn.jsdelivr.net/npm/kokoro-js@${kokoroJs}/dist/kokoro.web.js` },
  ...['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'].map((f) => ({
    path: `vendor/ort/${f}`,
    url: `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${transformers}/dist/${f}`,
  })),
  ...modelFiles.map((f) => ({ path: `models/kokoro/${f}`, url: `${HF}/${f}` })),
  ...voices.map((v) => ({ path: `models/kokoro/voices/${v}.bin`, url: `${HF}/voices/${v}.bin` })),
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const known = new Map((lock.assets || []).map((a) => [a.path, a.sha256]));

async function existingHash(file) {
  try {
    return sha256(await readFile(file));
  } catch {
    return null;
  }
}

async function download(url, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (i >= attempts) throw new Error(`Failed to download ${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

const results = [];
let fetched = 0;
for (const asset of wanted) {
  const dest = join(OUT_DIR, asset.path);
  const expected = known.get(asset.path);
  if (!UPDATE && !expected) throw new Error(`${asset.path} has no hash in assets.lock.json - run with --update-lock`);

  if (!UPDATE && (await existingHash(dest)) === expected) {
    results.push({ path: asset.path, sha256: expected });
    continue;
  }
  const buf = await download(asset.url);
  const hash = sha256(buf);
  if (!UPDATE && hash !== expected) {
    throw new Error(`Checksum mismatch for ${asset.path}\n  expected ${expected}\n  got      ${hash}`);
  }
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  fetched++;
  console.log(`  ✓ ${asset.path} (${(buf.length / 1048576).toFixed(1)} MB)`);
  results.push({ path: asset.path, sha256: hash });
}

if (UPDATE) {
  lock.assets = results;
  await writeFile(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`Updated ${LOCK_PATH}`);
}
console.log(`Neural voice assets ready in ${OUT_DIR} (${fetched} downloaded, ${wanted.length - fetched} up to date).`);
