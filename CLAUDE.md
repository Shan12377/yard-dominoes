# YaadDominoes — Jamaican Dominoes

Web-first PWA. Two halves: online play, and an academy that takes a total
beginner to tournament level. Not in any app store, by choice.

See @README.md for setup and architecture.

## Product identity

- **YaadDominoes** is the confirmed user-facing product and brand name. It is
  a different product from Yaadmoji. Use YaadDominoes on all new visible
  product surfaces and in new current-facing documentation.
- **“Beat di table.”** is the confirmed public slogan. Use it for the primary
  invitation to play; “Slam dem down” is retired and must not return.
- The canonical visual brand specification is `docs/branding.md`. Read it
  before changing colors, typography, imagery, logos, table art, or marketing
  presentation.
- Do not mechanically rename stable internal identifiers: the GitHub repository
  remains `yard-dominoes`, the engine package remains `@yard/engine`, and
  existing `yard:*` localStorage keys remain intact to avoid breaking users.
- Vocabulary that describes the culture or product model remains valid rather
  than being rebranded: Yard duppy level, Yardie membership, Yard Gate lounge,
  yard rules, and Sunday Yard.
- The current legal entity string is separate from the product brand. Do not
  change it from its pending placeholder without confirmation of the registered
  company name.

## Commands

```bash
npm test              # 59 engine tests — run after ANY engine change
npm run bench         # set-length distributions
npm run dev           # client on :5173
npm run typecheck     # client types — run before declaring done
npm run build         # production build
npm run preview --workspace @yard/web -- --host 127.0.0.1 --port 4173
                      # production preview used for Lighthouse, never audit dev
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

## Production deployment truth

- Production is currently promoted manually from
  `design/yaaddominoes-foundation` with `vercel --prod`. A push or merge to
  `main` is not the production mechanism for this project.
- `origin/main` is a stale, disconnected development baseline. Never infer
  what is live from `main`; inspect the YaadDominoes Vercel project's current
  production deployment and its exact commit SHA.
- As of 2026-08-27, `www.yaaddominoes.com` serves commit `4d492f4`
  (`fix: open-tables list never expired dead tables`, service worker v75).
  Vercel records it as a READY production deployment from
  `design/yaaddominoes-foundation`. This deploy also carries the referral
  commission system, the SITE_URL fix, the fresh-deal tile race fix, the
  first Playwright E2E smoke tests, the admin referral-stats view, star
  ratings on feedback, the Profile/Admin split from Membership pricing (nav
  is Play / Lounges / Academy / Membership / Profile / Fair deal, plus an
  Admin tab shown only once the lounge module confirms `is_admin`), and
  collapsible `<details>` sections on Profile and Start a table (open state
  lives in module-scope variables — `render()` rebuilds the whole page on
  every call, so a bare `open` attribute does not survive an unrelated
  rerender; confirmed live before this fix).
- **`tables.status` only reaches `'finished'` when a full SET completes**
  (see `tournaments.ts`), so any table abandoned mid-set, or one whose
  creator never seated anyone, sat forever in every lounge's "Open tables"
  list. Found live 2026-08-27: Cut Throat Yard had ~50 rows, most weeks
  old, several from this project's own Playwright/curl testing (which hits
  this same production Supabase project — `iqixdijhckgilvyhduxb` — not a
  separate staging environment). Fixed with an hourly pg_cron job
  (`sweep-stale-tables`, migration `0047_stale_table_sweep.sql`) that
  finishes any `waiting`/`playing` table with no `hand_public` activity in
  3+ hours; `listLoungeTables()` also caps at 30 rows and the client shows
  the first 6 with the rest behind a "N more tables" disclosure. The ~50
  pre-existing stale rows were cleaned directly via SQL before this
  deployed. Any future Playwright/curl test run against this project will
  keep creating real rows the same way — the sweep now ages them out
  automatically within a few hours, so no separate test-cleanup step is
  needed.
- Before claiming that a project rule or brand document is stale, read the
  real repository file. Conversation attachments and compacted context may
  contain older versions. The current `.claude/rules/design.md` specifies the
  Kingston Signal system; `docs/branding.md` is the canonical brand reference.

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
   UI. See "Money" below.
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
- **Tied blocked hands replay at a flat 2 points, double-six forced.** The
  double-six holder opens the replay no matter who currently leads — never
  "sporting" — and it's worth 2 points whoever wins it, however many ties
  happened first. An earlier version escalated the value each successive
  tie (2, then 3, then 4); that was wrong, confirmed against real play.
- **One all play two:** at 1-1 the playoff winner goes straight to 2-0.
- **Pass the pose:** in Partner the winner may hand the pose across the table,
  but never when the double-six is forced. The engine rule is tested; the
  online build's server path (`pass-pose`) and client UI for it are in
  progress — see `docs/superpowers/plans/2026-07-27-online-play.md`.

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
- **Deal verification is free and visual.** After a hand ends, a participant
  may ask for the immutable starting deal and commit-reveal receipt. Their
  browser reconstructs the shuffle and shows every starting hand; seeds and
  hashes live under Technical details. Never charge coins for trust, never
  reveal a live hand, and never expose the `hands` table itself.
- **No auto-play.** A tile fitting both ends prompts for which end.
- **Academy teaching is visual and interactive.** Every declared lesson has a
  deterministic SVG in `apps/web/public/art/boards/`, generated from
  `scripts/gen-diagrams.ts`; every declared drill resolves through
  `academycontent.ts` to one unambiguous, explained decision. Do not replace
  either with decorative AI imagery or a list of inert prompts.
- **Timed-out seats play a legal move, they do not forfeit.**
- **Voice is a peer-to-peer mesh, never an SFU.** Live table voice ships in
  `apps/web/src/voice.ts`: each of the four seats sends audio straight to the
  other three, signalling over the Realtime channel the lounge already holds.
  No media server, no vendor, no per-minute bill. LiveKit and Daily were
  rejected — an SFU only earns its cost above roughly twenty in a room, and
  pricing a four-hander against one is what made voice look unaffordable.
  STUN is free; TURN relays only the minority of peers behind strict NAT and
  sits well inside Cloudflare's free tier. Do not reintroduce a media vendor.
- **Hearing the yard is free; talking is the membership.** Guests join
  listen-only and are never asked for a microphone, so a newcomer's first
  experience is the room rather than a permission dialog. The gate is
  `canSpeak()` in `voice.ts`, and it is currently client-side: a patched
  client could still transmit. The fix when it matters is Realtime
  Authorization — an RLS policy on `realtime.messages` for the `voice-signal`
  event — not a bigger check in the client.
- **Voice is additive and must never break the room.** It is the feature the
  incumbent's players complain about most, so it is the one ours is judged on
  hardest. A voice failure degrades to "no audio" with a plain explanation —
  it never takes down the lounge, the chat, or a live hand. Assume the
  microphone gets refused, two peers offer at once, ICE drops when a phone
  moves off wifi, and iOS suspends the whole channel in the background: those
  are normal conditions, not exceptions. Mute must actually stop transmitting
  and leaving must stop every track — a mute that only mutes the UI, or a
  recording light left on after leaving, loses trust permanently.
  `.claude/rules/voice.md` has the full failure list and loads when you open
  the file. Two tabs in one browser share a session and are not two players;
  verify with two real clients.

## Art

**Every image uses the template in `docs/art-direction.md`. Read it before
making or accepting any artwork.** The character is a domino tile with
pip-hole eyes, not a smiley with a flag behind it; flat vector, front-on,
solid forest-green background, no text baked into the picture, 128px WebP.
Never generate one image against a new rule while the rest of a set sits on
the old one — regenerate the whole set or change nothing.

Illustrations with people in them must show women playing and winning, not
spectating. It will not happen unless it is asked for every time.

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

## Money

Web-only, subscription-funded. No app store, so no platform cut and no store
review. Stripe is the only payment path. Guest free, Yardie $24/yr, VIP $69/yr —
the game is free, the subscription buys the social layer.

Access is decided by `effective_tier()` in SQL and enforced in RLS. A tier check
in client code is a suggestion, not a paywall. See `.claude/rules/billing.md`
for the subscription lifecycle.

**Cash-stakes gaming is a separate problem from subscriptions.** Being web-only
removes the app-store constraint but changes nothing about gambling law — a
licence is needed wherever dominoes-for-money counts as gambling, and a public
site is reachable everywhere unless deliberately geo-gated. Processors also
treat skill gaming as high risk. So: no stakes, pots, chips, or casino imagery
in this codebase. If it is ever built it is a separate application with its own
legal opinion and processor.

## Secrets

- **Any env var prefixed `VITE_` is compiled into the client bundle and visible
  to anyone who opens devtools.** Only `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` belong there — the anon key is public by design and
  RLS is the real gate.
- Service role key, Stripe secret key, Stripe webhook secret, and any image-API
  key go in `supabase secrets set` or `.env.local`. Never in source, never in a
  `VITE_` var, never committed.
- Putting `SUPABASE_SERVICE_ROLE_KEY` behind a `VITE_` prefix bypasses every RLS
  policy in the database. That single underscore undoes the whole security model.
- Check `git diff --staged` for anything key-shaped before committing. If a
  secret was ever pushed, rotate it — deleting the commit is not enough.

## Working style

- Use em dashes only where the sentence genuinely needs an interruption. Do
  not use them as automatic decoration, list separators, or substitutes for
  commas, colons, parentheses, and full stops. Keep established compounds such
  as `anti-clockwise` unchanged.
- Run `npm test` and `npm run typecheck` before saying a task is done.
- When a test fails, work out whether the test or the code is wrong before
  changing either. Several tests encode rules that look wrong and are not.
- Do not add a dependency to `packages/engine`. Ask first.
- French is built: cross board, chucha opening, doubling (own double ×2,
  doubled again when the winner's own final tile was a double, stacking to
  ×4), the +10 pass penalties, the blocked-tie chucha reshuffle — the set
  ends the instant ANY seat's score reaches or crosses 100, lowest score at
  that moment wins outright (confirmed against real play; an earlier
  "last-one-under-target-survives" design was wrong) — and the coin-tied
  mid-hand reshuffle at a 50-70 score window are all live — selectable from
  both local practice and real online tables.
  Across is built: partner's exact ruleset (six-love default, first-to-six
  selectable, same scoring, same pass-the-pose), played online by two real
  people instead of four — each one signed into both seats of a side (0&2 or
  1&3) and plays each in its own turn, never back-to-back. No new engine
  rules; `isPartnered()` covers it. Rules confirmed against a real Jamaican
  consultant, 2026-08-07. Local practice (a human plus duppies) is not yet
  wired up for it — online only so far.
  Shipping it first missed optimistic prediction on the partner seat, which
  looked like a stuck/delayed hand rather than just a slower one — see
  `.claude/rules/client.md`'s "Every playable seat needs optimistic
  prediction" before touching `OnlineGame.play()` again.
- Prefer editing existing files over creating new ones.
