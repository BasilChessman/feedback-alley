import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { createApi } from './server/api.js';

// In dev, the same API the production server uses is mounted into Vite,
// so `npm run dev` is the only process you need.
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'feedback-board-api',
      configureServer(server) {
        const api = createApi({ dataDir: path.resolve(process.env.DATA_DIR || 'data') });
        server.middlewares.use((req, res, next) => api(req, res, next));
        // per-screen output ports proxy back to this dev server
        server.httpServer?.once('listening', () => {
          const addr = server.httpServer!.address();
          // pass the real bind address: "localhost" may be IPv6-only (::1) on macOS
          if (addr && typeof addr === 'object') api.setMainPort(addr.port, addr.address);
        });
      },
    },
  ],
});
