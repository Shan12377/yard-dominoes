import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

// A phone treats http://<Mac LAN IP> as an insecure origin and therefore
// withholds Web Crypto. Practice quite properly needs Web Crypto to commit to
// its shuffle before dealing. A developer may create these ignored local files
// for phone QA; normal development and every production build remain HTTP/
// deployment-configured as before.
const localCert = fileURLToPath(new URL('../../.local/yard-dev-cert.pem', import.meta.url));
const localKey = fileURLToPath(new URL('../../.local/yard-dev-key.pem', import.meta.url));
const localHttps = existsSync(localCert) && existsSync(localKey)
  ? { cert: readFileSync(localCert), key: readFileSync(localKey) }
  : undefined;

export default defineConfig({
  resolve: {
    alias: {
      '@yard/engine': fileURLToPath(new URL('../../packages/engine/src', import.meta.url)),
    },
  },
  server: { port: 5173, https: localHttps },
  build: { target: 'es2022' },
});
