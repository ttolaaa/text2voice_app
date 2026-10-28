import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, createRateLimiter, loadConfig } from '../server/index.js';

let server;
let base;
let dir;
const cloneCalls = [];
const ID = 'a'.repeat(32);

/** Fake voice-clone service. */
async function fakeClone(url, init = {}) {
  const u = new URL(url);
  cloneCalls.push({ path: u.pathname, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.pathname === '/health') return json(200, { ready: true, loading: false, device: 'cpu', error: null });
  if (u.pathname === '/voices' && init.method === 'POST') return json(201, { id: ID, name: 'Me', token: 'tok', seconds: 20, created: 'now' });
  if (u.pathname === `/voices/${ID}/speak`) {
    if (init.headers['X-Voice-Token'] !== 'tok') return json(404, { detail: 'Voice not found.' });
    return new Response(new Uint8Array([82, 73, 70, 70]), { status: 200, headers: { 'Content-Type': 'audio/wav' } });
  }
  if (u.pathname === `/voices/${ID}` && init.method === 'DELETE') return new Response(null, { status: 204 });
  return json(404, { detail: 'Voice not found.' });
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 't2v-'));
  await mkdir(join(dir, 'public', 'js'), { recursive: true });
  await mkdir(join(dir, 'assets', 'models'), { recursive: true });
  await writeFile(join(dir, 'public', 'index.html'), '<!doctype html><title>x</title>' + 'x'.repeat(2000));
  await writeFile(join(dir, 'public', 'js', 'a.js'), 'export {}');
  await writeFile(join(dir, 'assets', 'models', 'm.bin'), Buffer.alloc(10));
  await writeFile(join(dir, 'secret.txt'), 'secret');
  const config = {
    ...loadConfig({ PUBLIC_DIR: join(dir, 'public'), ASSETS_DIR: join(dir, 'assets') }),
    cloneUrl: 'http://clone.test',
  };
  server = createServer(config, { fetchImpl: fakeClone });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

test('serves static files with security and isolation headers', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self' 'wasm-unsafe-eval'/);
  assert.equal(res.headers.get('cross-origin-embedder-policy'), 'require-corp');
  assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.match(res.headers.get('permissions-policy'), /microphone=\(self\)/);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  assert.equal(res.headers.get('content-encoding'), 'gzip');

  const js = await fetch(`${base}/js/a.js`);
  assert.match(js.headers.get('content-type'), /text\/javascript/);

  const etag = res.headers.get('etag');
  assert.equal((await fetch(`${base}/`, { headers: { 'If-None-Match': etag } })).status, 304);
});

test('serves model assets from ASSETS_DIR with long caching', async () => {
  const res = await fetch(`${base}/models/m.bin`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /max-age=604800/);
  assert.equal((await res.arrayBuffer()).byteLength, 10);
});

test('blocks path traversal and bad methods', async () => {
  for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/models/..%2f..%2fsecret.txt', '/%00']) {
    const res = await fetch(`${base}${p}`);
    assert.ok([400, 404].includes(res.status), `${p} -> ${res.status}`);
    assert.notEqual(await res.text(), 'secret');
  }
  assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${base}/nope.html`)).status, 404);
});

test('health and config endpoints', async () => {
  assert.equal(await (await fetch(`${base}/healthz`)).text(), 'ok\n');
  const cfg = await (await fetch(`${base}/api/config`)).json();
  assert.deepEqual(cfg.myVoice, { enabled: true });
  assert.equal(cfg.azure.enabled, false);
});

test('Azure endpoints report not configured', async () => {
  const res = await fetch(`${base}/api/azure/speak`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 503);
  assert.equal((await fetch(`${base}/api/azure/voices`)).status, 503);
});

test('My Voice: status, create, speak with token, delete', async () => {
  const status = await (await fetch(`${base}/api/myvoice/status`)).json();
  assert.equal(status.ready, true);

  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array(100)], { type: 'audio/wav' }), 'r.wav');
  form.append('name', 'Me');
  const created = await fetch(`${base}/api/myvoice/voices`, { method: 'POST', body: form });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).token, 'tok');
  assert.match(cloneCalls.at(-1).headers['Content-Type'], /^multipart\/form-data; boundary=/);

  const speak = (token) =>
    fetch(`${base}/api/myvoice/voices/${ID}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Voice-Token': token } : {}) },
      body: JSON.stringify({ text: 'Hello' }),
    });
  const ok = await speak('tok');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'audio/wav');
  const denied = await speak('wrong');
  assert.equal(denied.status, 404);
  assert.deepEqual(await denied.json(), { error: 'Voice not found.' });

  assert.equal((await fetch(`${base}/api/myvoice/voices/${ID}`, { method: 'DELETE', headers: { 'X-Voice-Token': 'tok' } })).status, 204);
});

test('My Voice: rejects cross-origin, bad ids and wrong content types', async () => {
  const cross = await fetch(`${base}/api/myvoice/voices/${ID}/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: '{}',
  });
  assert.equal(cross.status, 403);
  assert.equal((await fetch(`${base}/api/myvoice/voices/../../etc`)).status, 404);
  assert.equal((await fetch(`${base}/api/myvoice/voices/XYZ`)).status, 404);
  const wrongType = await fetch(`${base}/api/myvoice/voices`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(wrongType.status, 415);
});

test('My Voice disabled when CLONE_URL is empty', async () => {
  const s = createServer({ ...loadConfig({ PUBLIC_DIR: join(dir, 'public') }), cloneUrl: '' });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const res = await fetch(`http://127.0.0.1:${s.address().port}/api/myvoice/status`);
  assert.equal(res.status, 503);
  s.close();
});

test('rate limiter enforces requests per minute and characters per hour', () => {
  let now = 0;
  const limiter = createRateLimiter({ requestsPerMinute: 2, charsPerHour: 10 }, () => now);
  assert.ok(limiter.take('a'));
  assert.ok(limiter.take('a'));
  assert.ok(!limiter.take('a'));
  assert.ok(limiter.take('b'));
  now += 60000;
  assert.ok(limiter.take('a'));
  limiter.addChars('a', 10);
  assert.ok(!limiter.hasChars('a'));
  now += 3600000;
  assert.ok(limiter.hasChars('a'));
});
