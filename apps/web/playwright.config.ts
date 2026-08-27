import { defineConfig, devices } from '@playwright/test';

// E2E smoke tests against a live table — the browser/network-timing bug
// class that pure unit tests can't reach (packages/engine's 297 tests cover
// rules, never a real Realtime round trip). Runs against a real Supabase
// project via guest sign-in, which needs no credentials at all — see
// online.ts's ensureSignedIn(). Set VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY
// in .env for local runs; CI needs the same two vars.
export default defineConfig({
  testDir: './e2e',
  // Real round trips to a live Supabase project (table create, deal, the
  // realtime broadcast back) — not a local mock. 30s left too little room
  // once setup (age gate, lounge, table, deal) ran first; give the
  // assertions their own window instead of racing the outer timeout.
  timeout: 60_000,
  fullyParallel: false, // each test creates a real table; keep runs from colliding
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
