/**
 * Install to home screen.
 *
 * The two platforms are not symmetric and pretending otherwise loses installs:
 *
 *   Android / desktop Chrome — the browser fires `beforeinstallprompt`. We
 *   catch it, suppress the default banner, and show our own button. One tap.
 *
 *   iOS — Safari implements no such event. Every install is a manual Share →
 *   Add to Home Screen → Add. Most people do not know the option exists, so
 *   the instructions ARE the install flow, not a fallback for it.
 *
 *   iOS in Chrome/Firefox/Edge — those browsers cannot add to the home screen
 *   at all. Sending them the Safari steps is useless; they need to be told to
 *   open the page in Safari first.
 */

export type Platform = 'installed' | 'prompt' | 'ios-safari' | 'ios-other' | 'unsupported';

let deferred: (Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }) | null = null;
let waitingWorker: ServiceWorker | null = null;

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    // iOS predates display-mode and reports it here instead.
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua)
    // iPadOS 13+ reports itself as a Mac; touch points give it away.
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** On iOS every browser is WebKit, but only Safari can add to the home screen. */
function isIOSSafari(): boolean {
  const ua = navigator.userAgent;
  return isIOS() && !/CriOS|FxiOS|EdgiOS|OPiOS|Brave/i.test(ua);
}

export function platform(): Platform {
  if (isStandalone()) return 'installed';
  if (isIOS()) return isIOSSafari() ? 'ios-safari' : 'ios-other';
  if (deferred) return 'prompt';
  return 'unsupported';
}

/** Call once at startup, before anything might want to show an install button. */
export function watchInstallability(onChange: () => void) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();          // suppress the browser's own banner
    deferred = e as never;
    onChange();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    onChange();
  });
}

/** Android / desktop Chrome. Resolves true when the user accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  // The event is single-use; a declined prompt cannot be replayed.
  deferred = null;
  return outcome === 'accepted';
}

/** The three taps, in the order they appear on an iPhone. */
export const IOS_STEPS: { n: number; text: string }[] = [
  { n: 1, text: 'Tap the Share button at the bottom of Safari' },
  { n: 2, text: 'Scroll down and tap Add to Home Screen' },
  { n: 3, text: 'Tap Add in the top right' },
];

// ------------------------------------------------------------ service worker
/**
 * Register the worker and watch for updates. `onUpdateReady` fires when a new
 * version is downloaded — the caller decides WHEN to apply it, because
 * reloading someone mid-hand is a bug, not a feature.
 */
export function registerServiceWorker(onUpdateReady: () => void) {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;

  // Never in the dev server. sw.js caches same-origin GETs first-hit-wins,
  // which is safe in production because Vite content-hashes every built asset
  // — but `npm run dev` serves `/src/styles.css` and `/src/*.ts` at stable
  // URLs, so the worker pins the first version it sees and keeps serving it
  // through every edit. That has already hidden a real bug from a whole
  // session: pips had been invisible on every tile, and the felt kept
  // rendering in the previous build's colour, because the page under test was
  // never the code on disk. To exercise the worker itself, build and preview
  // (`npm run build && npx vite preview`) — PROD is true there.
  if (import.meta.env.DEV) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      if (reg.waiting) { waitingWorker = reg.waiting; onUpdateReady(); }
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        if (!next) return;
        next.addEventListener('statechange', () => {
          if (next.state === 'installed' && navigator.serviceWorker.controller) {
            waitingWorker = next;
            onUpdateReady();
          }
        });
      });

      // An installed PWA — iOS especially — is usually SUSPENDED on the way
      // to the background, not reloaded, so tapping the home-screen icon to
      // come back often never re-runs `load` at all. Without this, a player
      // who last force-quit the app weeks ago is the only one who ever sees
      // an update: everyone else just resumes the same page forever. This
      // only asks the browser to re-fetch and diff sw.js — it never applies
      // anything by itself. `applyUpdate()` still refuses mid-hand either way.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update();
      });
    }).catch(() => {
      // No worker means no offline shell. The app still works.
    });
  });

  // `controllerchange` does not mean "a new version replaced the old one" —
  // it means "the controller changed", and `clients.claim()` in sw.js's own
  // `activate` handler fires it on the worker's very first activation too,
  // for every first-time visitor, not only on a real update. That is not a
  // corner case: it fired on every fresh session, about 400ms after load,
  // and reloaded the page out from under whatever the visitor had just
  // done — an in-flight sign-in, a tap that landed on markup a moment
  // before everything under it vanished. It read as "the nav is broken"
  // because the reload silently erased a click's effect before the next
  // render could ever be seen.
  //
  // The only controllerchange that should trigger a reload is the one this
  // page caused on purpose, by calling applyUpdate() — never one that just
  // happens to arrive because a worker claimed control for the first time.
  // `updateApplied` is that gate.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateApplied || reloading) return;
    reloading = true;
    window.location.reload();
  });
}

let updateApplied = false;

/** Apply a pending update. Only call between hands. */
export function applyUpdate() {
  if (!waitingWorker) return;
  updateApplied = true;
  waitingWorker.postMessage('SKIP_WAITING');
  waitingWorker = null;
}

export function updatePending(): boolean {
  return waitingWorker !== null;
}
