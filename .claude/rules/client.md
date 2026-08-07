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

**The reverse also bites: module-scoped selection state must be invalidated
when the state it depends on stops being true, not just preserved across a
render.** `pendingTile` (`main.ts`, `onlinetableview.ts`) holds a tile the
player tapped to ask "which end?" — including, since dead tiles became
tappable so a player can see *why* one doesn't fit, a tile that has no legal
placement at all. Nothing cleared it when the hand ended: a player who tapped
a dead tile right as the hand blocked or went out got the result screen
fighting a stale "that tile doesn't fit" chooser for a hand that no longer
existed, instead of seeing the winner and scores. Any selection tied to "my
turn, this hand, this move" must be cleared the moment that context ends —
`myHand()`/`myHandPanel()` now guard on `hand.status === 'active'` before
rendering the chooser at all, and `main.ts` additionally clears `pendingTile`
on its `handOver` event so a same-id tile in the next deal doesn't inherit a
stale "chosen" highlight. When you add a new piece of tap-to-select state,
ask the same question the text-input case asks, pointed the other way: what
happens when the thing this selection was ABOUT stops being true underneath
it?

## Every playable seat needs optimistic prediction, not just "mine"

`OnlineGame.play()` (`onlinetable.ts`) predicts a move locally the instant
it's tapped — see `predict.ts` — so the tile lifts immediately instead of
waiting for the realtime round-trip. When across shipped, prediction was
scoped to only `mySeat`, on the reasoning that the partner seat's move
would "just be a little less snappy." That was wrong, found live
(2026-08-07): a seat with **no** prediction gets **zero** visual feedback
at all while the request is in flight — no tile lift, no "Sending…", the
panel just sits there. That reads as broken, not slow, and a player who
sees nothing happen taps again, which can fire a second `play()` before the
first one has even resolved.

`predict.ts`'s shape has no built-in notion of "my" seat — it only takes a
seat index and that seat's tiles as plain parameters — so this generalizes
for free to any seat a player can actually act for. If a future mode adds a
third playable seat to one account, predict for that seat too, and gate the
"pending" freeze (`myHandPanel`'s `pending` flag, `legalMovesForMe`'s
effective disable) on a check scoped to the ACTIVE seat, not a single
fixed field — `OnlineGame.predictedTilesFor(seat)` exists for exactly this.
Never ship a tappable hand with no prediction path behind it.

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
