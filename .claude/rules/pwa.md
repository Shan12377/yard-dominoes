---
paths:
  - "apps/web/public/**"
  - "apps/web/src/pwa.ts"
  - "apps/web/index.html"
---

# PWA rules

Distribution is the web, so install and offline behaviour are the product, not
a nice-to-have.

## The service worker

`public/sw.js`. Three rules it must keep:

1. **Never cache Supabase.** `isSupabase()` bails out before any cache logic.
   Caching auth responses risks leaking a token; caching game state serves a
   stale board and desyncs a live hand.
2. **Never activate mid-hand.** `install` deliberately does **not** call
   `skipWaiting()`. The page decides when to swap, via a `SKIP_WAITING`
   message, and `updateBar()` refuses while a hand is active.
3. **GET only.** Any other method goes straight to the network.

Bump `VERSION` when shipping; `activate` deletes every cache not prefixed with
it. Forgetting to bump means players run stale assets indefinitely.

A `controllerchange` listener reloads, but only when `applyUpdate()` caused it
— gated by `updateApplied` in `pwa.ts`, not just a `reloading` re-entrancy
flag. `clients.claim()` in `sw.js`'s own `activate` fires `controllerchange`
on the worker's very first activation too, for every first-time visitor, not
only on a real update — a `reloading`-only guard still reloads that visitor's
page out from under them about 400ms after load, before they have done
anything. This was live in production for a real session before being caught:
it looked exactly like "the nav is broken," because the auto-reload erased
whatever a click had just done before the next render was ever seen. Verify
the fix by loading a fresh, never-visited session and confirming no
`framenavigated` event fires in the seconds after load — not just that the
page eventually looks right.

## The two platforms are not the same

- **Android / desktop Chrome** fire `beforeinstallprompt`. We `preventDefault()`
  it and show our own button. The event is **single-use**: once prompted, it
  cannot be replayed, so `deferred` is nulled after use.
- **iOS has no install event at all.** Every install is a manual Share → Add to
  Home Screen → Add. The written steps in `IOS_STEPS` are the entire iOS funnel
  — most users do not know the option exists. Do not replace them with a
  generic "install" button that does nothing.
- **iOS Chrome, Firefox, Edge cannot install at all**, even though they are
  WebKit underneath. `platform()` returns `ios-other` and we tell them to open
  Safari. Sending them the Safari steps is a dead end.

Standalone detection needs both `matchMedia('(display-mode: standalone)')` and
`navigator.standalone` — iOS predates the former.

iPadOS reports itself as `MacIntel`; `maxTouchPoints > 1` is what distinguishes
it. Without that check iPad users are treated as desktop and never see the
instructions.

## Known iOS constraints

- Web push requires iOS 16.4+ **and** the app already added to the home screen.
  You cannot notify a visitor who never installed.
- No background sync. Do not design around it.
- Storage can be evicted after prolonged disuse, so treat any cached auth as
  disposable — a returning player may need to sign in again. Never store
  anything that cannot be re-fetched.
- No splash screen support without explicit `apple-touch-startup-image` links,
  which exist in `index.html` for four device sizes. Missing sizes get a white
  flash on launch.

## Manifest

- `start_url` must be inside `scope` or install silently fails.
- Keep one `maskable` icon with content inside the middle 80%, or Android crops
  into the tile art.
- `theme_color` and `background_color` must match the CSS background — the
  Sunday Yard room, `#FAF3E1` — or the status bar and the launch splash flash
  a different colour. These were left on the old dark theme's `#140B09` for a
  full palette cycle, so an installed phone opened on a black splash into a
  cream app. Whenever the room colour changes, change these three together:
  `manifest.webmanifest`, the `theme-color` meta in `index.html`, and `--sand`.

## Testing

Service workers need HTTPS, except on `localhost`. `npm run dev` works;
testing over a LAN IP does not.

Test iOS on a real device in real Safari. The simulator does not reproduce
install behaviour, storage eviction, or background WebSocket death. Use
`npm run build && npm run preview` — `dev` mode does not serve the worker the
same way.
