# Online play — design

Status: **Approved.** Phase 1 of 3 (online play → polish → voice).

## Why

`online.ts` has every call needed for real multiplayer — create a table, join
one, play a move, watch a live table — but nothing in the client ever calls
them. Two real people cannot currently play each other through the UI, even
though the entire server-authoritative backend for it already works. This is
the build that closes that gap.

Competitive frame: JamDom is the incumbent (since 2007, mandatory paid
membership just to play a hand, offline-only app, 3.51★/250 ratings). Our
answer is free play, a Verify button instead of an argument, and matching what
they get right — lounges as places with regulars, pass-the-pose, per-style
rankings, spectator culture — without their paywall.

## Architecture

Tables live inside lounges via the existing `tables.lounge_id` column. A
lounge screen gets an "open tables" list above the chat — anyone can see who's
mid-game and sit into an open seat, or start a new table with a config panel
(mode / format / seat count / duppies) matching the local lobby's existing UI
language. A "Join with code" field sits at the top of the Lounges screen for
direct invites that skip lounge-browsing entirely.

The live table reuses the exact rendering helpers local play already uses —
`tileEl`, `renderBoard`, `scoreTrack`, `backsEl` from `render.ts`. Same board,
same tiles, same score track. Only the data source changes: a new `OnlineGame`
class subscribes to Realtime and calls the existing Edge Functions
(`createTable`, `joinTable`, `startHand`, `playMove`, `watchTable`) instead of
running the engine locally.

## Data flow

On entering a live table: fetch `hand_public`, my row in `seat_hands`,
`seats` (to learn my own seat index), and `sets` (score) **in parallel**, not
as four sequential round trips — slow on a Jamaican mobile connection. Then
`watchTable()` takes over for live deltas.

The server enforces every rule; the client only renders what streams in and
sends move *intents*. For "which end?" prompts and enabling/disabling playable
tiles, reconstruct a minimal client-side state: my real tiles, placeholder-
length arrays for opponents — the same pattern `bots.ts` already uses to
enumerate a duppy's own options. One detail that matters: set `turn` to my own
seat on the stub, because `legalMoves()` reads `hands[state.turn]` — get this
wrong and the client computes legal moves for the wrong seat.

Two small, additive backend changes, no schema changes:
- `create-table` gains a `loungeId` param to set `tables.lounge_id`.
- A new `listLoungeTables(loungeId)` query.

## Realtime correctness

- Resubscribe on `visibilitychange` — iOS kills WebSockets silently in the
  background; the app must assume the channel is stale and resubscribe when
  the tab becomes visible again.
- `removeChannel` on leaving a table, always — a leaked channel keeps pushing
  into a dead render closure.
- The turn countdown is computed from `turn_expires_at`, never a client-side
  timer that can drift from the server's actual expiry.

## Scope decisions

- **Rankings: not in v1, immediately after.** Two strangers finishing a hand
  is the v1 milestone. Per-style rankings are a real retention hook and
  prominent on JamDom, so this is a short deferral, not a shelving.
- **"Quick Ting" short-game mode: skip.** Not now, not v1. (JamDom added this
  in an April 2026 update; noted for later, not adopted here.)
- **Portrait mode is the primary target, not a phase-2 polish item.** Test at
  390×844 before anything wider.

## The six gaps

### 1. Pass the pose

The engine already has `passPoseToPartner()`; nothing in the plan surfaced it
until this review. In Partner, when a team wins a hand, the winner may hand
the pose to their partner. JamDom prompts "Who Should Pose? / PASS POSE / KEEP
POSE" and players expect the equivalent here. Rules: Partner mode only, never
when the double-six is forced, and the two partners must not be able to reveal
tiles to each other while deciding (no side-channel — the choice UI can't leak
hand contents). This is parity on a feature the engine already supports; it
just needs a client surface.

### 2. Conflict handling on 409

`play-move` returns 409 when two players move at the same instant — the
optimistic version check in `commit_move` rejects the second write rather than
clobbering the first. The client treats 409 as "refetch `hand_public` and
re-render," silently, never as an error shown to the player. They did nothing
wrong; this is the concurrency control working as designed.

### 3. Rejoin after reload or disconnect

Missing entirely — the difference between a demo and a product. If someone
reloads, backgrounds the app, or loses signal mid-hand, they must land back at
their live table with their tiles. On startup, look for a seat belonging to
this user at a table whose status is `playing`, and offer to rejoin — or go
straight back in. Losing games to a frozen client is one of the loudest
complaints against every rival app; this is where that complaint gets
prevented rather than reproduced.

### 4. Spectating

`hand_public` RLS already permits reading non-private tables — the data path
exists, this is purely a UI surface. Jamaican dominoes is played in front of a
crowd; watching is how people learn and how a lounge feels alive rather than
empty. Spectators see the board and hand sizes, never anyone's tiles.

### 5. Mid-set join and leave

Undefined until this review, and it will come up on day one:
- A seat vacated mid-set: a duppy takes over, clearly labelled to the table as
  a stand-in, and the departing player takes the result as recorded.
- Someone joining a vacated seat mid-set inherits the running score — they
  cannot join a fresh 0-0 into a 4-0 set.
- Abandonment records a loss on the departing player's own profile
  (`profiles.abandons`, already a column) — never on the duppy standing in for
  them, and never on the other seats at the table.

### 6. Initial fetch is parallel

Covered under Data Flow above — the four initial reads fire concurrently, not
sequentially.

## Testing

Two browser sessions playing a full hand is necessary but not sufficient.
Three scenarios that actually break in production and must be verified before
this ships:

- **Simultaneous moves.** Two clients moving at the same instant. Expect a 409
  and a clean, silent recovery on the losing client — no error shown.
- **Disconnect mid-hand.** Kill one client's network. The turn should expire
  server-side, a duppy plays a legal move, and the returning player finds
  their way back to the table via the rejoin flow (gap #3).
- **Background on iOS.** Background the tab for two minutes on a real iPhone.
  The WebSocket dies silently. Confirm the `visibilitychange` resubscribe
  actually recovers — this fails quietly and often, and a simulator will not
  catch it.

No new engine tests — the engine itself is unchanged; this is entirely client
wiring plus two small, additive server changes.
