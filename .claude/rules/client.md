---
paths:
  - "apps/web/src/**"
---

# Client rules

The client renders and sends intents. It never decides game state.

## Rendering model

`render()` rebuilds the whole view into `#app`. That is deliberate and simple,
but it destroys DOM state on every call, which has already caused one bug.

**Anything a player is mid-way through must live outside the DOM.** The chat
draft and caret are held in module scope in `loungeview.ts` and restored after
each render, because an incoming message re-renders the room and would
otherwise wipe what they were typing. Same applies to any future input: scroll
position, a partly-filled form, an open dropdown.

If you add a text input, ask what happens when a render fires while it is
focused. The answer must not be "the player loses their typing."

## Hard UI rules

- **No modal during a live hand.** Not a gift, not a rating prompt, not the
  service worker update. `updateBar()` checks `hand.status === 'active'` and
  defers.
- **No auto-play.** A tile matching both ends prompts for which end.
- **Never block on an animation.** The duppy delay in `local.ts` is 420ms; if
  a player leaves the view mid-loop the promise still resolves against a
  detached state — check `status === 'active'` after every await.
- Keyboard reachable and `:focus-visible` styled. Respect
  `prefers-reduced-motion` (already handled globally in `styles.css`).

## Realtime

- iOS Safari freezes background pages and WebSockets die **silently** — no
  error, no close event the app sees. On `visibilitychange` back to visible,
  assume the channel is stale and resubscribe.
- Always `removeChannel` on leave. `leaveCurrentLounge()` does this; a leaked
  channel keeps pushing into a dead render closure.
- RLS filters the `seat_hands` stream, so a subscription can only ever deliver
  the player's own row. Do not rely on a client-side filter for that.

## Bundle discipline

The Supabase client is larger than the rest of the app combined. It loads
lazily via dynamic `import()` in `main.ts` so offline play stays ~16 kB gzipped.
**Do not add a static import of `online.ts`, `lounges.ts`, or `loungeview.ts`
to `main.ts`** — that pulls Supabase back into the main chunk and quadruples
the download for players who never sign in. Check `npm run build` output: two
chunks, and `index` should stay under about 50 kB raw.

## Types

`npm run typecheck` before declaring done. `import.meta.env` needs
`vite/client` in `tsconfig` types — already set.
