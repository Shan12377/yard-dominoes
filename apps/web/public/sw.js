/* YaadDominoes service worker.
 *
 * Deliberately conservative. Three rules drive everything here:
 *
 *  1. NEVER cache anything from Supabase. Auth tokens, game state, and other
 *     seats' tiles must never sit in a cache another tab or a later session
 *     could read. Serving a stale board would also desync a live hand.
 *  2. NEVER activate a new version mid-hand. A forced reload during a set is
 *     worse than running yesterday's build for ten more minutes, so the new
 *     worker waits until the page asks it to take over.
 *  3. Only GET requests are cacheable. Everything else goes straight to the
 *     network.
 */

const VERSION = 'yaaddominoes-v87';
const SHELL = `${VERSION}-shell`;

// Bumping VERSION invalidates everything below.
const PRECACHE = [
  '/',
  '/manifest.webmanifest',
  '/art/yaaddominoes-mark.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon.ico',
  '/accessories/shades.svg',
  '/accessories/crown.svg',
  '/accessories/flower.svg',
  '/accessories/headphones.svg',
  '/accessories/flagpin.svg',
  // The table's own noise. Precached rather than left to the runtime cache
  // because a knock fetched on first play arrives after the tile has already
  // landed — and offline, it would never arrive at all. ~180 KB for all three.
  '/sfx/knock.m4a',
  '/sfx/shuffle.m4a',
  '/sfx/six-love.m4a',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)).catch(() => {
      // A failed precache must not block install; the app still works online.
    }),
  );
  // NOTE: no skipWaiting() here on purpose. See rule 2.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

/** The page sends this when it is safe to swap versions (never mid-hand). */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function isSupabase(url) {
  return url.hostname.endsWith('.supabase.co')
    || url.pathname.startsWith('/auth/')
    || url.pathname.startsWith('/rest/')
    || url.pathname.startsWith('/realtime/')
    || url.pathname.startsWith('/functions/');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (isSupabase(url)) return;                 // rule 1: straight to network
  if (url.origin !== self.location.origin) return;

  // Navigations: network first, cached shell only when genuinely offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put('/', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/').then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Build assets are content-hashed, so cache-first is safe and fast.
  event.respondWith(
    caches.match(request).then((hit) => hit ?? fetch(request).then((res) => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(request, copy)).catch(() => {});
      }
      return res;
    })),
  );
});
