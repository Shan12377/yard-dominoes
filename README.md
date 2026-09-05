# YaadDominoes

Phase 1: the rules engine. Pure TypeScript, zero dependencies, 44 passing tests.

```bash
cd packages/engine
node --test test/*.test.ts     # run the suite
node bench.ts                  # set-length distributions
```

Node 22+ runs the TypeScript directly. There is no build step.

---

## Your stack works. Here's the mapping.

You said Vercel and Supabase. That is a good fit for this game, and better than the generic Node-server-plus-Redis architecture in the design doc — because Jamaican dominoes is **turn-based**. There is no twitch latency requirement. A player taking two seconds to think is normal; a 150ms round trip is invisible.

| Design doc said | You use | Why it works |
|---|---|---|
| Authoritative Node game server | **Supabase Edge Functions** (Deno/TS) | Same TypeScript engine runs inside them. The Edge Function is the only writer to the game tables. |
| Redis for live table state | **Postgres** | Turn-based means state changes a few times a minute, not 60 times a second. Postgres is plenty. |
| Custom WebSocket layer | **Supabase Realtime** | Players subscribe to their table row and get pushed the new state. |
| Auth service | **Supabase Auth** | Apple, Google, email, and anonymous sign-in — which covers guest play without ever requiring Facebook. |
| Client hosting | **Vercel** | Static SPA. Instant web play, which is also your funnel. |
| iOS / Android | **Capacitor** | Wraps the same Vercel build. One codebase, three platforms. |
| Coach worker | **Supabase Edge Function on a queue** | Runs the retro-solver off the request path. |
| Turn timers | **pg_cron** | Serverless has no long-lived timers; a scheduled job expires stale turns. |

### The one rule that makes it secure

**Row Level Security must forbid clients from writing to game tables at all.**

Clients get `SELECT` on tables they are seated at, and nothing else. Every move goes through an Edge Function that:

1. Loads the hand state
2. Calls `isLegal()` from this engine
3. Calls `applyMove()`
4. Writes the new state
5. Lets Realtime push it out

A client never holds hidden tiles and cannot write state. That single constraint is what makes tile duplication and phantom-turn cheating — both found repeatedly in competitors' reviews — structurally impossible rather than merely discouraged.

### Where the engine runs

The same files run in three places, which is the main reason to keep the engine dependency-free:

- **Edge Function** — the authority. Validates and applies every move.
- **Client** — renders legal moves and predicts optimistically. Never trusted.
- **Coach worker** — replays finished hands with perfect information to grade decisions.

### Schema sketch

```sql
tables      (id, mode, format, options, status, created_by)
seats       (table_id, seat_index, user_id, connected_at)
sets        (id, table_id, scores, hand_value, poser,
             pose_must_be_double_six, playoff, winner_side)
hands       (id, set_id, commitment, server_seed, client_seeds,
             deal, board, turn, move_log, status, result)
verifications (hand_id, verified_by, verified_at, ok)
```

`server_seed` stays NULL to clients until the hand ends — that is the commit-reveal. Expose `hands` to players through a view that hides other seats' tiles and the unrevealed seed.

---

## What the engine does

**`tiles.ts`** — the 28-tile set, pip counting, matching, seat/side mapping. Seats are numbered in play order, which is anti-clockwise, so the next seat is the player to your physical right and partners land opposite each other automatically.

**`shuffle.ts`** — provably fair dealing. Server commits to `SHA-256(serverSeed)` before the deal, every client contributes a seed, the shuffle is a deterministic Fisher-Yates keyed on `HMAC(serverSeed, clientSeeds ‖ handId)`, and the seed is revealed when the hand ends. `verifyHand()` runs in the player’s browser; the visual Deal Check shows the reconstructed starting hands and keeps seeds/hashes under Technical details. It is free. Tests prove it catches both a swapped seed and a tampered deal.

**`hand.ts`** — legal moves, move application, blocked-hand resolution. Includes `knownVoids()`, which extracts what each player's passes have permanently revealed. That function exists because it is simultaneously the core Belt 4 lesson, the input to the stronger duppies, and a Coach primitive.

**`set.ts`** — six-love, bruk, one-all-play-two, escalating tie replays, first-to-six, single hand.

### Rules the tests pin down

The ones competitors get wrong:

- Blocked hands go to the **lowest individual count**, and in Partner that player's team wins on that basis alone. There is a test using the canonical example where the winning team is holding *more* pips overall.
- Play is **anti-clockwise**.
- Tournament mode forces the 6-6 to be **led**, not merely held. Casual mode allows **sporting**.
- A win by the side under love **bruks** the score to 0-0 — they do not score one.
- Tied blocked hands replay at 2, then 3, then 4.
- One-all-play-two sends the playoff winner straight to 2-0.
- A five-nil lead is worth nothing if they take the sixth.

---

## A finding from the simulation

`bench.ts` plays complete sets with random-legal-move bots. Median hands to finish a set:

| Format | Median | Max seen | Blocked hands |
|---|---|---|---|
| Partner · six love · 4p | 19 | 125 | 28% |
| Cut throat · six love · 4p | 21 | 94 | 28% |
| Partner · first to six · 4p | 9 | 11 | 26% |

**This table used to say cut-throat six-love ran to a 196-hand median, and that was a bug rather than a finding.** `applyHandResult` wiped the board whenever any non-leader won — Partner's two-sided rule applied to four separate sides — so only one player could ever hold points and a set really did need six wins in a row. The actual rule (pagat, and a Jamaican player who spotted it mid-set): several players hold points at once, and the score only returns to zero once every one of them has won a hand. Corrected 2026-09-04; cut-throat six-love is now an ordinary-length game.

**Product implication:** the old conclusion — never default a cut-throat table to six-love — was resting on that bad number. Cut throat still defaults to first-to-six, but the length argument for it is gone, and the choice is worth revisiting on its own merits.

---

## Getting it running

```bash
npm install
npm test          # 56 engine tests
npm run dev       # play immediately at localhost:5173, no account needed
```

The client works with no backend at all — it plays a full local game against
duppies, runs the Coach on your hand, and lets you verify the deal. Online play
needs Supabase:

```bash
cp .env.example .env      # fill in your project url and anon key
supabase db reset         # apply migrations/0001_init.sql
npm run fn:serve          # vendors the engine, serves Edge Functions
```

For iOS and Android:

```bash
npm run build
npx cap add ios && npx cap add android
npx cap sync
```

## What's built

| | |
|---|---|
| `packages/engine` | Rules, provably fair shuffle, duppy AI, the Coach, curriculum. Zero dependencies, 56 tests. |
| `supabase/migrations` | Schema and RLS. Clients hold no write permission on any game table. |
| `supabase/functions` | `create-table`, `join-table`, `start-hand`, `play-move`, `review-hand`, `expire-turns`, `french-reshuffle`. |
| `apps/web` | Vite client. Playable local table, visual Coach, 33 illustrated Academy lessons, 11 interactive drills, and deal verification. |

## The duppies

Five tiers, and they differ by how deeply they reason — never by what they can
see. Every tier is handed a `PublicView`, a structure with no field capable of
holding another seat's tiles. There is a test asserting nothing leaks into it.

| Tier | Plays like |
|---|---|
| Pickney | Anything legal |
| Yard | Sheds heavy tiles, favours its long suit |
| Ranker | Remembers who passed on what |
| Don | Counts suits out and blocks |
| General | Samples the hands still consistent with everything shown |

## The Coach

After a hand ends the server knows every tile, so it can go back and solve the
position exactly at each decision the player faced — try every legal
alternative, play the rest out under best defence, and compare. Moves come back
graded Best, Fine, Loose or Blunder, with the one costly decision flagged and a
plain-language explanation linked to the lesson that names the mistake.

This is tractable here in a way it isn't in most games: a hand is 28 tiles, each
player holds seven, and the branching factor is usually one to three. A node
budget catches the rare position that isn't exhaustible.

No domino app has this. It's the reason to build the thing.

## Lounges and membership

Lounges are rooms, not queues: live presence, chat, and the tables running
inside. Five are seeded — Yard Gate, Cut Throat Yard, Partners Arena, Rankers
Row (Yardie+), and Red Carpet (VIP).

| Tier | Price | Buys |
|---|---|---|
| Guest | Free forever | Every mode, ranked play, Academy belts 1-3, one Coach review a day, deal verification |
| Yardie | $24 / year | Rank badge, tournaments, belts 4-5, Rankers Row, priority matchmaking |
| VIP | $69 / year | Walk into full lounges, bredrins list, unlimited Coach, Red Carpet, front of the substitutes line |

The game itself is free and stays that way. Membership buys the room, not the
rules — which is the deliberate inversion of the incumbent's model, where
membership is mandatory before you can play a single hand.

Payment is Stripe Checkout through the `checkout` Edge Function, activated by
`stripe-webhook`. No app store, so no 30% cut and no gambling review. Set
`STRIPE_SECRET_KEY`, `STRIPE_PRICE_YARDIE`, `STRIPE_PRICE_VIP`,
`STRIPE_WEBHOOK_SECRET` and `SITE_URL` with `supabase secrets set`.

Tier gates are enforced in RLS, not in the client — a guest cannot read VIP
lounge chat even with a patched bundle.

## Still open

- Account-synced Academy progress and multi-question belt exams. The lesson
  diagrams and first interactive drill collection are complete; progress is
  currently session-local.
- Across-the-Table mode — deliberately unspecified until a Jamaican consultant defines it
- Belts 4–5 want review by a strong player before shipping
