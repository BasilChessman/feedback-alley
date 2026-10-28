// The Feedback Alley server: the built app from dist/ plus the API.
// Used by `npm start` (server/index.js) and by the desktop app (electron/main.js).

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './api.js';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// LAN addresses other machines (displays) can use to reach this one.
export function lanUrls(port) {
  const urls = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) urls.push(`http://${a.address}:${port}/`);
    }
  }
  return urls;
}

// Starts listening on `port`, or on the next free port after it when
// `fallback` allows. Resolves with the port actually used.
export function startServer({ port = 8090, host = '0.0.0.0', dataDir, distDir = path.join(rootDir, 'dist'), fallback = 0 }) {
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    throw new Error('dist/ is missing - run `npm run build` first (or `npm run dev` for development).');
  }
  const api = createApi({ dataDir, host });

  const server = http.createServer(async (req, res) => {
    if (await api(req, res, null)) return;

    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = path.join(distDir, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
    // a folder with its own index.html (the user guide) is served as that page
    if (file.startsWith(distDir) && fs.existsSync(path.join(file, 'index.html')) && file !== distDir) file = path.join(file, 'index.html');
    if (!file.startsWith(distDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(distDir, 'index.html');
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      // only Vite's hashed build files never change; everything else (the guide) is revalidated
      'Cache-Control': urlPath.startsWith('/assets/') && ext !== '.html' ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });

  return new Promise((resolve, reject) => {
    let tries = 0;
    const attempt = (p) => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && tries++ < fallback) attempt(p + 1);
        else reject(err);
      });
      server.listen(p, host, () => {
        server.removeAllListeners('error');
        api.setMainPort(p, host);
        resolve({ server, port: p, close: () => api.closeOutputs?.() });
      });
    };
    attempt(port);
  });
}
