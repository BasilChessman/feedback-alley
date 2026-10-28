// Per-screen output ports. A screen with `outputPort` set gets its own HTTP
// listener, so the display is simply http://host:<port>/ with nothing after it.
//
// Each output listener answers GET /api/output with the screen it shows, and
// proxies everything else (app files, API, uploads, Vite's HMR websocket in dev)
// to the main server, so it works the same under `npm start` and `npm run dev`.

import http from 'node:http';
import net from 'node:net';

export function createOutputs({ host = '0.0.0.0' } = {}) {
  // Vite may re-create the API on config reload; release the old listeners first.
  globalThis.__feedbackBoardOutputs?.closeAll();

  let main = { host: '127.0.0.1', port: 0 };
  const servers = new Map(); // port -> { server, screenId, state: 'starting'|'ok'|'error', error }

  function proxy(req, res) {
    const upstream = http.request(
      { host: main.host, port: main.port, path: req.url, method: req.method, headers: req.headers },
      (r) => {
        res.writeHead(r.statusCode || 502, r.headers);
        r.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Feedback Alley server is not reachable');
    });
    req.pipe(upstream);
  }

  function proxyUpgrade(req, socket, head) {
    const conn = net.connect(main.port, main.host, () => {
      const headers = Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n');
      conn.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n\r\n`);
      if (head?.length) conn.write(head);
      conn.pipe(socket);
      socket.pipe(conn);
    });
    conn.on('error', () => socket.destroy());
    socket.on('error', () => conn.destroy());
  }

  function open(port, screenId, name) {
    const entry = { server: null, screenId, state: 'starting', error: '' };
    const server = http.createServer((req, res) => {
      if (req.url.split('?')[0] === '/api/output') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ screenId: entry.screenId, port }));
        return;
      }
      proxy(req, res);
    });
    server.on('upgrade', proxyUpgrade);
    server.on('error', (err) => {
      entry.state = 'error';
      entry.error =
        err.code === 'EADDRINUSE' ? 'Port is already in use'
        : err.code === 'EACCES' ? 'Permission denied (ports below 1024 need admin rights)'
        : String(err.message || err);
    });
    server.listen(port, host, () => {
      entry.state = 'ok';
      console.log(`  Output "${name}": http://localhost:${port}/`);
    });
    entry.server = server;
    servers.set(port, entry);
  }

  function close(port) {
    const e = servers.get(port);
    if (!e) return;
    e.server.close();
    e.server.closeAllConnections?.();
    servers.delete(port);
  }

  return {
    setMain(port, mainHost) {
      main = { port, host: !mainHost || mainHost === '0.0.0.0' || mainHost === '::' ? '127.0.0.1' : mainHost };
    },

    // Bring listeners in line with the saved screens.
    // Does nothing until the main server's port is known, so an output can never grab it.
    sync(store) {
      if (!main.port) return;
      const wanted = new Map();
      const names = new Map();
      for (const s of store?.screens || []) {
        const port = Number(s.outputPort);
        if (!Number.isInteger(port) || port < 1 || port > 65535 || port === main.port) continue;
        if (!wanted.has(port)) {
          wanted.set(port, s.id); // first screen wins a duplicated port
          names.set(port, s.name);
        }
      }
      for (const port of [...servers.keys()]) {
        if (!wanted.has(port)) close(port);
      }
      for (const [port, screenId] of wanted) {
        const e = servers.get(port);
        if (!e) open(port, screenId, names.get(port));
        else if (e.state === 'error') { close(port); open(port, screenId, names.get(port)); }
        else e.screenId = screenId;
      }
    },

    status() {
      return {
        mainPort: main.port,
        outputs: [...servers].map(([port, e]) => ({ port, screenId: e.screenId, state: e.state, error: e.error })),
      };
    },

    closeAll() {
      for (const port of [...servers.keys()]) close(port);
    },
  };
}
