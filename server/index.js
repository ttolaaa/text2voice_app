// Dependency-free web server: static site + self-hosted neural voice assets + optional Azure Speech proxy.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';
import { createAzure } from './azure.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.bin': 'application/octet-stream',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt']);

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self'",
  "img-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(self), geolocation=()',
  // Cross-origin isolation enables multi-threaded WebAssembly for faster in-browser voices.
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export function loadConfig(env = process.env) {
  const publicDir = resolve(env.PUBLIC_DIR || join(ROOT, 'public'));
  return {
    port: Number(env.PORT) || 8080,
    host: env.HOST || '0.0.0.0',
    publicDir,
    assetsDir: resolve(env.ASSETS_DIR || publicDir),
    trustProxy: env.TRUST_PROXY === '1',
    cloneUrl: (env.CLONE_URL || '').replace(/\/+$/, ''),
    azure: {
      key: env.AZURE_SPEECH_KEY || '',
      region: (env.AZURE_SPEECH_REGION || '').toLowerCase(),
      maxChars: Number(env.AZURE_MAX_CHARS_PER_REQUEST) || 3000,
    },
    rateLimit: {
      requestsPerMinute: Number(env.AZURE_REQUESTS_PER_MINUTE) || 30,
      charsPerHour: Number(env.AZURE_CHARS_PER_HOUR) || 60000,
    },
  };
}

/** Very small in-memory per-client limiter for the paid Azure endpoint. */
export function createRateLimiter({ requestsPerMinute, charsPerHour }, now = () => Date.now()) {
  const clients = new Map();
  const get = (id) => {
    const t = now();
    let c = clients.get(id);
    if (!c) clients.set(id, (c = { minute: t, requests: 0, hour: t, chars: 0 }));
    if (t - c.minute >= 60000) Object.assign(c, { minute: t, requests: 0 });
    if (t - c.hour >= 3600000) Object.assign(c, { hour: t, chars: 0 });
    return c;
  };
  const timer = setInterval(() => {
    const t = now();
    for (const [id, c] of clients) if (t - c.hour >= 3600000 && t - c.minute >= 60000) clients.delete(id);
  }, 600000);
  timer.unref?.();
  return {
    take(id) {
      const c = get(id);
      if (c.requests >= requestsPerMinute) return false;
      c.requests++;
      return true;
    },
    hasChars(id) {
      return get(id).chars < charsPerHour;
    },
    addChars(id, n) {
      get(id).chars += n;
    },
  };
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body === 'object' && !Buffer.isBuffer(body);
  const payload = isJson ? JSON.stringify(body) : body;
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

function readBody(req, limit) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Request body too large.'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 256 * 1024) {
  const raw = await readBody(req, limit);
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON body.'), { status: 400 });
  }
}

/** Rejects cross-site browser requests to the API (CSRF-style abuse of the paid endpoint). */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function resolveStatic(urlPath, { publicDir, assetsDir }) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const base = /^\/(vendor|models)\//.test(decoded) ? assetsDir : publicDir;
  const file = resolve(base, `.${decoded}`);
  if (file !== base && !file.startsWith(base + sep)) return null;
  return file;
}

async function serveStatic(req, res, config) {
  const urlPath = new URL(req.url, 'http://x').pathname;
  let file = resolveStatic(urlPath, config);
  if (!file) return send(res, 400, 'Bad request');
  let info = await stat(file).catch(() => null);
  if (info && info.isDirectory()) {
    file = join(file, 'index.html');
    info = await stat(file).catch(() => null);
  }
  if (!info || !info.isFile()) return send(res, 404, 'Not found');

  const ext = extname(file).toLowerCase();
  const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  const isAsset = /^\/(vendor|models)\//.test(urlPath);
  const headers = {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[ext] || 'application/octet-stream',
    ETag: etag,
    // Pinned model/runtime files rarely change; app files always revalidate so new deploys show up immediately.
    'Cache-Control': isAsset ? 'public, max-age=604800' : 'no-cache',
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  const gzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && info.size > 1024;
  if (gzip) {
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  } else {
    headers['Content-Length'] = info.size;
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(file);
  stream.on('error', () => res.destroy());
  (gzip ? stream.pipe(createGzip()) : stream).pipe(res);
}

export function createServer(config = loadConfig(), { azure = createAzure(config.azure), fetchImpl = globalThis.fetch } = {}) {
  const limiter = createRateLimiter(config.rateLimit);
  // Self-hosted cloning has no per-character cost, but each sentence is one request; allow more.
  const cloneLimiter = createRateLimiter({ requestsPerMinute: 120, charsPerHour: Infinity });
  const clientId = (req) =>
    (config.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';

  /** Forwards a request to the voice-clone service, normalising its errors to { error }. */
  async function proxyClone(res, path, init = {}) {
    let upstream;
    try {
      upstream = await fetchImpl(`${config.cloneUrl}${path}`, { ...init, signal: AbortSignal.timeout(300000) });
    } catch {
      return send(res, 502, { error: 'The My Voice service is not reachable.' });
    }
    const body = Buffer.from(await upstream.arrayBuffer());
    if (!upstream.ok) {
      let message = `My Voice service error (HTTP ${upstream.status}).`;
      try {
        const parsed = JSON.parse(body.toString('utf8'));
        if (typeof parsed.detail === 'string') message = parsed.detail;
      } catch {
        /* keep generic message */
      }
      return send(res, upstream.status, { error: message });
    }
    if (upstream.status === 204) {
      res.writeHead(204, SECURITY_HEADERS);
      return res.end();
    }
    return send(res, upstream.status, body, { 'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream' });
  }

  async function handleMyVoice(req, res, path) {
    if (!config.cloneUrl) return send(res, 503, { error: 'My Voice is not enabled on this server.' });

    if (path === '/api/myvoice/status' && req.method === 'GET') {
      try {
        const r = await fetchImpl(`${config.cloneUrl}/health`, { signal: AbortSignal.timeout(5000) });
        const h = await r.json();
        return send(res, 200, { enabled: true, ready: Boolean(h.ready), loading: Boolean(h.loading), device: h.device || null, model: h.model || null, error: h.error || null });
      } catch {
        return send(res, 200, { enabled: true, ready: false, loading: false, device: null, error: 'The My Voice service is not reachable.' });
      }
    }

    if (req.method !== 'GET' && !sameOrigin(req)) return send(res, 403, { error: 'Cross-origin requests are not allowed.' });
    const token = String(req.headers['x-voice-token'] || '').slice(0, 200);
    const tokenHeaders = token ? { 'X-Voice-Token': token } : {};

    if (path === '/api/myvoice/voices' && req.method === 'POST') {
      const type = req.headers['content-type'] || '';
      if (!/^multipart\/form-data;\s*boundary=/i.test(type)) return send(res, 415, { error: 'Use multipart/form-data.' });
      if (!cloneLimiter.take(clientId(req))) return send(res, 429, { error: 'Too many requests - please wait a minute.' }, { 'Retry-After': '60' });
      const body = await readBody(req, 13 * 1024 * 1024);
      return proxyClone(res, '/voices', { method: 'POST', headers: { 'Content-Type': type }, body });
    }

    const m = path.match(/^\/api\/myvoice\/voices\/([a-f0-9]{32})(\/speak)?$/);
    if (!m) return send(res, 404, { error: 'Not found.' });
    const [, id, speak] = m;
    if (speak && req.method === 'POST') {
      if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'Use application/json.' });
      if (!cloneLimiter.take(clientId(req))) return send(res, 429, { error: 'Too many requests - please wait a minute.' }, { 'Retry-After': '60' });
      const body = await readBody(req, 16 * 1024);
      return proxyClone(res, `/voices/${id}/speak`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...tokenHeaders }, body });
    }
    if (!speak && (req.method === 'GET' || req.method === 'DELETE')) {
      return proxyClone(res, `/voices/${id}`, { method: req.method, headers: tokenHeaders });
    }
    return send(res, 405, { error: 'Method not allowed.' });
  }

  return http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    try {
      if (path === '/healthz') return send(res, 200, 'ok\n');

      if (path.startsWith('/api/')) {
        if (path === '/api/config' && req.method === 'GET') {
          return send(res, 200, {
            azure: { enabled: azure.enabled, region: azure.region, maxChars: azure.maxChars },
            myVoice: { enabled: Boolean(config.cloneUrl) },
          });
        }
        if (path.startsWith('/api/myvoice/')) return await handleMyVoice(req, res, path);
        if (path === '/api/azure/voices' && req.method === 'GET') {
          const { list } = await azure.voices();
          return send(res, 200, { voices: list }, { 'Cache-Control': 'private, max-age=3600' });
        }
        if (path === '/api/azure/speak' && req.method === 'POST') {
          if (!azure.enabled) return send(res, 503, { error: 'Azure Speech is not configured.' });
          if (!sameOrigin(req)) return send(res, 403, { error: 'Cross-origin requests are not allowed.' });
          if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'Use application/json.' });
          const id = clientId(req);
          if (!limiter.take(id)) return send(res, 429, { error: 'Too many requests - please wait a minute.' }, { 'Retry-After': '60' });
          if (!limiter.hasChars(id)) return send(res, 429, { error: 'Hourly character limit reached.' }, { 'Retry-After': '3600' });
          const body = await readJson(req);
          const { audio, chars } = await azure.speak(body);
          limiter.addChars(id, chars);
          return send(res, 200, audio, { 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length });
        }
        return send(res, 404, { error: 'Not found.' });
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
      return await serveStatic(req, res, config);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(`[text2voice] ${req.method} ${path}: ${err.message}`);
      if (!res.headersSent) send(res, status, path.startsWith('/api/') ? { error: status >= 500 && !err.status ? 'Internal error.' : err.message } : 'Error');
      else res.destroy();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const server = createServer(config);
  server.listen(config.port, config.host, () => {
    const azure = config.azure.key && config.azure.region ? `enabled (${config.azure.region})` : 'disabled';
    const clone = config.cloneUrl ? `enabled (${config.cloneUrl})` : 'disabled';
    console.log(`[text2voice] http://localhost:${config.port}  (Azure: ${azure}, My Voice: ${clone}, assets: ${config.assetsDir})`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
