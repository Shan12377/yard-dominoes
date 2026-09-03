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
- As of 2026-08-28, `www.yaaddominoes.com` serves commit `e99adb7`
  (`feat: 2-coin top-up for a guest's used-up daily Coach review`,
  service worker v83), a READY production deployment from
  `design/yaaddominoes-foundation`. For what any specific past deploy
  contained, read `git log` rather than trusting an accumulated list here —
  this line is a pointer to current truth, not a changelog. Update this
  line, don't append another one, next time.
- **`profiles.is_owner`** (0052) is narrower than `is_admin` — it gates
  referral financials specifically (stats, cash-out requests, marking
  paid) in `referral-admin`. Only Candy has it. Granting `is_admin` to a
  new account does NOT also grant this; that's the point.
- **Edge Functions deploy via the Supabase CLI** (`npx supabase functions
  deploy <name(s)> --project-ref iqixdijhckgilvyhduxb`), not by hand-assembling
  shared files through an MCP tool — the CLI resolves each function's real
  dependency tree automatically (including transitive `_shared/` and
  `_shared/engine/` files) and correctly preserves per-function
  `verify_jwt` settings from `supabase/config.toml` (confirmed:
  `stripe-webhook` stayed `verify_jwt: false` across a redeploy). Run
  `npm run sync:engine` first if `packages/engine/src` changed. The same
  CLI also runs arbitrary SQL when the Supabase MCP plugin needs
  re-authorization (its OAuth token expires independently of the CLI's own
  auth — one being down says nothing about the other): `npx supabase link
  --project-ref iqixdijhckgilvyhduxb` once, then `npx supabase db query
  "..." --linked` (must be `--linked`, not `--project-ref`, on the query
  itself).
- **`tables.status` only reaches `'finished'` when a full SET completes**
  (`tournaments.ts`), so an abandoned table used to sit in every lounge's
  "Open tables" list forever — including rows created by this project's own
  Playwright/curl testing, which hits this same production Supabase project
  (`iqixdijhckgilvyhduxb`), not a separate staging environment. An hourly
  pg_cron job (`sweep-stale-tables`, `0047_stale_table_sweep.sql`) now
  finishes any `waiting`/`playing` table with no `hand_public` activity in
  3+ hours, so this self-heals — no manual cleanup or special test-teardown
  needed going forward.
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
- **Every set opens on the 6-6, LED, casual tables included** — the holder of
  the six opens, and the six is the only legal first move. Confirmed as a house
  rule 2026-09-03 after casual tables were seen posing anything to start.
  "Sporting" (declaring you'll open with another bone) stays in the Academy as
  real yard vocabulary, but it never opens a set here. `createSet` hardcodes
  `poseMustBeDoubleSix: true` and `start-hand` inserts the set flag the same
  way — do not make either conditional on `tournament`, because the lounge's
  create-table form never sends that field, so every online table is casual and
  a conditional would mean no online set ever forces the six. French is the
  same rule with the chucha (0-0) as its opening tile.
- **The six is forced at exactly three moments, and `tournament` is not one of
  them.** A set's first hand, a tied blocked hand's replay, and the hand after
  a bruk — identical in casual and tournament play. Every other hand is opened
  by the previous winner, who poses what he likes. `set.ts` already sets
  `poseMustBeDoubleSix` at precisely those three points, so the callers must
  pass it straight through: do NOT reintroduce `|| tournament` into
  `local.ts`'s or `start-hand`'s deal, which forced the six on every hand of a
  tournament set and meant the winner never posed. Confirmed 2026-09-03.
  There is no casual/tournament rules toggle any more — see "What a tournament
  is" below. `SetOptions` has no `tournament` field, the practice Rules picker
  and its walkthrough stop are gone, and `tables.tournament` survives in the
  schema unwritten. Do not resurrect it as a ruleset.
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
- **The key tile scores a flat 2, not 1 — and never stacks with handValue.**
  When the board's two open ends need two DIFFERENT pip values and every
  other tile bearing either one is already down, the single remaining tile
  that closes the game (e.g. ends need a 5 and a 1 — the "5-1" bone) is the
  key. Winning by playing it scores 2 points, full stop — not `handValue + 1`,
  so it lands on exactly 2 even during an already-elevated one-all-play-two
  decider. If the last playable tile happens to be a double (both ends
  coincidentally need the SAME value), that does NOT count as a key even
  though it's the sole legal play — normal 1 point only. Confirmed against
  pagat.com's Caribbean Dominoes rules and gamerules.com's Jamaican Cut
  Throat rules; `hand.ts`'s `isKeyTile` and `HandResult.keyWin`.

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
- **A tournament is a scheduled EVENT played by real people. It is never a way
  to play.** This is the JamDom sense of the word and the only one this product
  uses: an event with a start time, sign-ups, a host-run draw, rounds, and a
  substitutes line that VIP goes to the top of. The `tournaments` /
  `tournament_signups` tables and `tournament-host` are that feature; a table
  belongs to one when `tables.tournament_id` is set. There is deliberately no
  "tournament ruleset" — the six opens a set, a tied replay and the hand after
  a bruk on every table alike (see above), so a rules toggle would have been a
  difference that does not exist.

  **Real people is enforced, not merely intended, and rating is why.**
  `apply-rating.ts` refuses to rate a set containing ANY duppy seat. A host's
  draw fills each seat with a placeholder duppy (0001 forbids a seat that is
  neither person nor duppy) which the drawn player displaces by turning up — so
  a single no-show would otherwise produce a whole round that scores for
  nobody. Three guards prevent that, and `tournament-real-people.test.ts` pins
  all three: `start-hand` will not deal while any seat is unfilled,
  `advance-duppy` refuses on a table with a `tournament_id`, and `expire-turns`
  steps over an unfilled seat. A timed-out HUMAN seat still gets a legal move
  played for it, tournament or not — otherwise one absent player stalls the
  event. A walkout leaves a claimable seat: the leaver has 0053's rejoin window,
  then the substitutes line has it.

  Known consequence, accepted deliberately: a tournament hand PAUSES on an
  empty seat rather than letting a bot finish it. The host's `cancel`/`clear`
  actions are the escape hatch. If that proves too blunt in a real Sunday, give
  the host a "fill this seat" action — do not reintroduce a duppy.

  **Themes.** `tournaments.theme` (0056) says which kind of event this is, and
  a theme decides WHO SITS WITH WHOM — never the game rules. Seating lives in
  one place, `_shared/tournament-queue.ts`'s `drawForTheme`; the host calls
  that, not `drawCutLine`, so a new theme never means teaching the host a
  seating rule. Only themes whose draw is actually built may appear in the
  check constraint — a theme the draw cannot seat is a host scheduling an event
  that silently seats nobody.

  - `open` — the queue cut into full tables.
  - `battle_of_the_sexes` — women on seats 0&2, men on 1&3, which IS the two
    partner sides. Four-handed partner only (enforced in 0056 and in the host).
    `tournament-signup` refuses entry without `profiles.gender` set, because
    finding out on Sunday morning that you were never seatable is worse than
    being told while it is one tap to fix.

  **The trap a theme sets, already sprung once:** "above the cut" and "in the
  first N of the queue" are the same sentence only for an open event. With six
  women and two men the four who play sit at queue positions 1, 2, 5 and 7 — so
  anything comparing an index against a seat count tells two people they are
  out when they are in. `standingFor` and the host's queue view both ask the
  draw for membership instead. Any future theme inherits that for free; do not
  reintroduce a positional cut.

  **Still to build:** `team_vs_team` and `couples`, which both need a pair or
  team concept at sign-up (a partner reference plus mutual confirmation), and
  weekly recurrence — JamDom runs weekly events across the game styles, and a
  host filling the form in each week is the current substitute for that.
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
