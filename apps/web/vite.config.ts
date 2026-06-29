import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Resolve os pacotes direto para o codigo-fonte (TS) — Vite transpila.
      '@trevalis/engine': fileURLToPath(
        new URL('../../packages/engine/src/index.ts', import.meta.url),
      ),
      '@trevalis/bot': fileURLToPath(new URL('../../packages/bot/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Em dev, encaminha API e WebSocket para o servidor Node (porta 8080) para
    // que o navegador veja a MESMA origem (cookies/CSRF simples, sem CORS).
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/healthz': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
});
