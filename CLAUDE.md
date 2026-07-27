# Yard — Jamaican Dominoes

Web-first PWA. Two halves: online play, and an academy that takes a total
beginner to tournament level. Not in any app store, by choice.

See @README.md for setup and architecture.

## Commands

```bash
npm test              # 59 engine tests — run after ANY engine change
npm run bench         # set-length distributions
npm run dev           # client on :5173
npm run typecheck     # client types — run before declaring done
npm run build         # production build
npm run sync:engine   # vendor engine into supabase/functions/_shared/engine
npm run fn:serve      # local Edge Functions (runs sync:engine first)
```

Node 22+ runs TypeScript directly. The engine has no build step.

## Layout

- `packages/engine/` — pure rules, zero dependencies, the source of truth
- `supabase/migrations/` — schema and RLS
- `supabase/functions/` — Edge Functions, the game authority
- `apps/web/` — Vite client, PWA

Detailed rules live in `.claude/rules/` and load when you touch matching files.

## The six invariants

Breaking any of these breaks the product's reason to exist. They are not
preferences.

1. **The engine has zero dependencies.** It runs in the browser, in Deno Edge
   Functions, and in the Node test runner. Use Web Crypto, never `node:crypto`.
2. **Clients never write game state.** No RLS write policy exists on `hands`,
   `hand_public`, `seat_hands`, or `sets`. Every move goes through the
   `play-move` Edge Function, which validates with `isLegal()` before applying.
3. **`hands` is never exposed to clients or Realtime.** Redaction happens in
   exactly one place — `persist()` in `supabase/functions/_shared/lib.ts`.
4. **Duppies never receive hidden tiles.** They take a `PublicView`, which has
   no field able to hold another seat's tiles. If you are passing `HandState`
   to a bot, stop.
5. **The server seed is revealed only after a hand ends.** Never populate
   `hand_public.server_seed` while `status = 'active'`.
6. **No real-money play in this codebase.** Not behind a flag, not as hidden
   UI. See "Real money" below.

## Rules competitors get wrong

Jamaican players notice these immediately. All are covered by tests.

- **Blocked hands go to the lowest INDIVIDUAL count.** In Partner, that
  player's team wins on that basis alone — the partner's tiles are irrelevant,
  and the winning team can hold more pips overall.
- **Play is anti-clockwise.** Seats are numbered in play order, so seat+1 is
  the player to your physical right and partners land opposite automatically.
- **Tournament forces the 6-6 to be LED**, not merely held. Casual allows
  "sporting" — opening with any tile.
- **A win by the side under love BRUKS the score to 0-0.** They do not score
  one. Under six love only one side can hold points at a time.
- **Tied blocked hands replay at escalating value:** 2, then 3, then 4.
- **One all play two:** at 1-1 the playoff winner goes straight to 2-0.
- **Pass the pose:** in Partner the winner may hand the pose across the table,
  but never when the double-six is forced.

## Settled product decisions

Do not relitigate these without asking.

- **Never default cut throat to six love.** It needs six consecutive wins from
  one player out of four; `npm run bench` measures a median of ~196 hands
  against 37 for partner. Cut throat defaults to first-to-six.
- **The game is free; membership buys the social layer.** Guest free, Yardie
  $24/yr, VIP $69/yr. The incumbent gates basic play behind a paywall and
  bounces every newcomer; we do the opposite deliberately.
- **No social login is ever required.** Anonymous sign-in is on.
- **No modal during a live hand.** Not a gift, not a rate prompt, not an ad,
  not a service worker update.
- **No auto-play.** A tile fitting both ends prompts for which end.
- **Timed-out seats play a legal move, they do not forfeit.**
- **Voice is not wired.** Presence carries the roster and the UI has the slot,
  but audio needs LiveKit or Daily at real per-minute cost. Do not add it
  before there are paying members.

## Competitive position

JamDom.com (since 2007) is the incumbent, not a generic app-store rival.
Standard membership $20.99/yr is mandatory for basic play; VIP is $74.95/yr;
Jamaican players pay by bank deposit and email the receipt. Their app is
offline practice only — real games need a desktop browser — and it sits at
3.51 stars from 250 ratings, last updated June 2020. After eighteen years they
still argue with players about "bad hands" on Facebook.

Our three answers: mobile-first PWA, a Verify button instead of an argument,
and a free game.

Match what they get right: lounges as places with regulars, pass-the-pose,
per-style rankings, per-move speed stats, spectator culture, patois register.

## Real money

Real-money play must be a separate application with its own store listing and
legal opinion. Apple forbids using in-app purchase to buy currency for
real-money gaming, while our cosmetics shop requires IAP — they cannot coexist
in one binary. Apps have been rejected for merely *resembling* gambling. Keep
chips, stakes, pots, and casino imagery out of this codebase entirely.

The groundwork is already laid: server authority, a score ledger, and a
provably fair shuffle that doubles as an audit trail.

## Working style

- Run `npm test` and `npm run typecheck` before saying a task is done.
- When a test fails, work out whether the test or the code is wrong before
  changing either. Several tests encode rules that look wrong and are not.
- Do not add a dependency to `packages/engine`. Ask first.
- Do not invent rules for game modes we have not specified. French and
  Across-the-table are deliberately unbuilt pending a Jamaican consultant.
- Prefer editing existing files over creating new ones.
