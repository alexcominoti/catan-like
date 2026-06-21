import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Resolve os pacotes direto para o codigo-fonte (TS) — Vite transpila.
      '@hexgame/engine': fileURLToPath(
        new URL('../../packages/engine/src/index.ts', import.meta.url),
      ),
      '@hexgame/bot': fileURLToPath(new URL('../../packages/bot/src/index.ts', import.meta.url)),
    },
  },
  server: { port: 5173 },
});
