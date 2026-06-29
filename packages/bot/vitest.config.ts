import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@trevalis/engine': fileURLToPath(new URL('../engine/src/index.ts', import.meta.url)),
    },
  },
});
