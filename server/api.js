// HTTP API shared by the production server and the Vite dev server.
//
//   GET  /api/store            -> { rev, store }       saved project (screens, templates, connections)
//   PUT  /api/store            <- { store }  -> { rev }
//   GET  /api/rev              -> { rev }              cheap poll so displays pick up edits live
//   POST /api/variables        <- { refs: ["$(internal:time_hms)", "[1]$(atem:pgm)"] } -> { values, connections }
//   POST /api/press            <- { connection, location: "page/row/col", action }
//   GET  /api/connection-test?connection=0
//   POST /api/assets           raw image body -> { url }
//   GET  /uploads/<file>
//   GET  /api/output           -> { screenId }         which screen this port shows (null on the main port)
//   GET  /api/outputs          -> { mainPort, outputs } per-screen output port status

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createOutputs } from './outputs.js';

const REF_RE = /^(?:\[(\d+)\])?\$\(([^:)\s]+):([^)\s]+)\)$/;
const FETCH_TIMEOUT_MS = 1500;
const CONNECTION_RETRY_MS = 3000;
const VALUE_CACHE_MS = 100;
const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const ASSET_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};
const EXT_TYPES = Object.fromEntries(Object.entries(ASSET_TYPES).map(([t, e]) => [e, t]));

export function normalizeUrl(url) {
  let u = String(url || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u.replace(/\/+$/, '');
}

export function createApi({ dataDir, host }) {
  const storeFile = path.join(dataDir, 'store.json');
  const assetDir = path.join(dataDir, 'assets');
  fs.mkdirSync(assetDir, { recursive: true });

  let rev = 0;
  let store = null;
  try {
    const saved = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    rev = saved.rev || 0;
    store = saved.store || null;
  } catch {
    // first run: the client creates a default project
  }

  const outputs = createOutputs({ host });
  globalThis.__feedbackBoardOutputs = outputs;

  let writing = Promise.resolve();
  const persist = () => {
    const body = JSON.stringify({ rev, store }, null, 2);
    writing = writing.then(async () => {
      const tmp = `${storeFile}.tmp`;
      await fsp.writeFile(tmp, body);
      await fsp.rename(tmp, storeFile);
    });
    return writing;
  };

  const connectionUrl = (index) => normalizeUrl(store?.connections?.[index]?.url);

  // A connection that just failed is skipped for a few seconds so one offline
  // Companion can't stall every poll behind its timeout.
  const downUntil = new Map();
  // Several displays polling the same variables share one upstream request.
  const valueCache = new Map();

  async function fetchVariable(baseUrl, conn, name) {
    const key = `${baseUrl}|${conn}:${name}`;
    const cached = valueCache.get(key);
    if (cached && Date.now() - cached.at < VALUE_CACHE_MS) return cached.promise;

    const promise = (async () => {
      if ((downUntil.get(baseUrl) || 0) > Date.now()) return { ok: false, value: null };
      try {
        const res = await fetch(
          `${baseUrl}/api/variable/${encodeURIComponent(conn)}/${encodeURIComponent(name)}/value`,
          { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
        );
        downUntil.delete(baseUrl);
        if (!res.ok) return { ok: true, value: null };
        const text = await res.text();
        // Companion echoes unknown variables back as "$(conn:name)"
        if (text === `$(${conn}:${name})` || text === 'null') return { ok: true, value: null };
        return { ok: true, value: text };
      } catch {
        downUntil.set(baseUrl, Date.now() + CONNECTION_RETRY_MS);
        return { ok: false, value: null };
      }
    })();
    valueCache.set(key, { at: Date.now(), promise });
    if (valueCache.size > 5000) valueCache.clear();
    return promise;
  }

  async function handleVariables(body) {
    const refs = Array.isArray(body?.refs) ? body.refs.slice(0, 2000) : [];
    const values = {};
    const connections = {};
    await Promise.all(
      refs.map(async (ref) => {
        const m = REF_RE.exec(String(ref));
        if (!m) return;
        const index = m[1] ? parseInt(m[1], 10) : 0;
        const baseUrl = connectionUrl(index);
        if (!baseUrl) {
          connections[index] = 'unconfigured';
          return;
        }
        const result = await fetchVariable(baseUrl, m[2], m[3]);
        values[ref] = result.value;
        if (result.ok) connections[index] = 'ok';
        else if (connections[index] !== 'ok') connections[index] = 'error';
      }),
    );
    return { values, connections };
  }

  async function handlePress(body) {
    const index = parseInt(body?.connection ?? 0, 10) || 0;
    const baseUrl = connectionUrl(index);
    const loc = String(body?.location || '').trim();
    if (!baseUrl || !/^\d+\/\d+\/\d+$/.test(loc)) return [400, { error: 'bad connection or location' }];
    const action = ['press', 'down', 'up'].includes(body?.action) ? body.action : 'press';
    try {
      const res = await fetch(`${baseUrl}/api/location/${loc}/${action}`, {
        method: 'POST',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      return [res.ok ? 200 : 502, { ok: res.ok, status: res.status }];
    } catch (err) {
      return [502, { ok: false, error: String(err?.message || err) }];
    }
  }

  async function handleConnectionTest(index) {
    const baseUrl = connectionUrl(index);
    if (!baseUrl) return { ok: false, error: 'No URL configured' };
    try {
      const res = await fetch(`${baseUrl}/api/variable/internal/time_hms/value`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true, sample: await res.text() };
    } catch (err) {
      return { ok: false, error: String(err?.cause?.code || err?.message || err) };
    }
  }

  async function handle(req, res, next) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (!p.startsWith('/api/') && !p.startsWith('/uploads/')) return next ? next() : false;

    try {
      if (p === '/api/store' && req.method === 'GET') return json(res, 200, { rev, store });
      if (p === '/api/rev' && req.method === 'GET') return json(res, 200, { rev });
      if (p === '/api/output' && req.method === 'GET') return json(res, 200, { screenId: null });
      if (p === '/api/outputs' && req.method === 'GET') return json(res, 200, outputs.status());
      if (p === '/api/store' && req.method === 'PUT') {
        const body = JSON.parse((await readBody(req, 50 * 1024 * 1024)).toString('utf8'));
        if (!body?.store || typeof body.store !== 'object') return json(res, 400, { error: 'missing store' });
        store = body.store;
        rev += 1;
        outputs.sync(store);
        await persist();
        return json(res, 200, { rev });
      }
      if (p === '/api/variables' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8'));
        return json(res, 200, await handleVariables(body));
      }
      if (p === '/api/press' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'));
        const [status, payload] = await handlePress(body);
        return json(res, status, payload);
      }
      if (p === '/api/connection-test' && req.method === 'GET') {
        return json(res, 200, await handleConnectionTest(parseInt(url.searchParams.get('connection') || '0', 10)));
      }
      if (p === '/api/assets' && req.method === 'POST') {
        const type = String(req.headers['content-type'] || '').split(';')[0].trim();
        const ext = ASSET_TYPES[type];
        if (!ext) return json(res, 415, { error: `unsupported type ${type}` });
        const data = await readBody(req, MAX_ASSET_BYTES);
        const name = `${crypto.createHash('sha1').update(data).digest('hex').slice(0, 16)}.${ext}`;
        await fsp.writeFile(path.join(assetDir, name), data);
        return json(res, 200, { url: `/uploads/${name}` });
      }
      if (p.startsWith('/uploads/') && req.method === 'GET') {
        const name = path.basename(decodeURIComponent(p.slice('/uploads/'.length)));
        const type = EXT_TYPES[name.split('.').pop()];
        const file = path.join(assetDir, name);
        if (!type || !fs.existsSync(file)) return json(res, 404, { error: 'not found' });
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable' });
        fs.createReadStream(file).pipe(res);
        return true;
      }
      return json(res, 404, { error: 'not found' });
    } catch (err) {
      return json(res, err?.status || 500, { error: String(err?.message || err) });
    }
  }

  // Output listeners proxy to the main server, so they need to know where it is.
  handle.setMainPort = (port, mainHost) => {
    outputs.setMain(port, mainHost);
    outputs.sync(store);
  };
  handle.closeOutputs = () => outputs.closeAll();
  return handle;
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
  return true;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
