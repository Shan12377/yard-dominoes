import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Wraps the same Vite build as iOS and Android. One codebase, three platforms.
 * Run `npm run build` first, then `npx cap sync`.
 */
const config: CapacitorConfig = {
  appId: 'com.yard.dominoes',
  appName: 'Yard',
  webDir: 'apps/web/dist',
  backgroundColor: '#140B09',
  ios: { contentInset: 'always' },
  android: { backgroundColor: '#140B09' },
};

export default config;
