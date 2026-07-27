import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@yard/engine': fileURLToPath(new URL('../../packages/engine/src', import.meta.url)),
    },
  },
  server: { port: 5173 },
  build: { target: 'es2022' },
});
