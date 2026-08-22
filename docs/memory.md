# Project memory

Running record of what's done, what's approved-but-not-built, and what's
still coming. Update this file whenever a doc lands, a phase finishes, or a
decision gets made — this is the single place to check status instead of
re-deriving it from chat history.

## Current product identity and connected systems (2026-08-22)

- **Correction recorded 2026-08-22:** **YaadDominoes** is the confirmed
  user-facing product and brand name. Yaadmoji is a separate app owned by the
  user and must never be used for this repository, its Vercel project, or its
  domain. No commit, push, or deployment occurred while the mistaken Yaadmoji
  name was present; it existed only in the local working tree.
- A bare “Yard” is a prior working product name. Historical plans may retain it
  as historical record; new UI and current-facing docs should use YaadDominoes.
- **“Beat di table.” is the confirmed slogan**, not a former product name.
  “Slam dem down” is retired.
- Stable internal identifiers are deliberately unchanged: private GitHub repo
  `Shan12377/yard-dominoes`, package `@yard/engine`, and `yard:*` localStorage
  keys. Yard/Yardie terms that describe gameplay, culture, tiers, lounges, or
  the Sunday Yard art direction also remain valid.
- GitHub and Vercel are connected. `main` auto-deploys through Vercel, so a push
  can change production; do not push or deploy merely to preview design work.
- The current legal entity placeholder is distinct from the YaadDominoes product
  brand and must not be guessed or renamed before formation is confirmed.
- **Brand direction: Kingston Signal.** The prior cream “Sunday Yard” room and
  brown-default table were rejected on 2026-08-22 as too muted. Current system:
  deep signal-blue room, electric-green table, mango actions/wins, coral
  emotion, sky-blue social accents, and bone-white dominoes. Visual language
  comes from dancehall sign rhythm plus sound-system/pip geometry; no palm or
  flag template inside live gameplay. The scalable mark is
  `apps/web/public/art/yaaddominoes-mark.svg`.
- The complete canonical brand handoff lives in `docs/branding.md` and must be
  read before visual or marketing changes.
- The confirmed wordmark treatment is one unbroken name with two colors:
  mango **Yaad** + bone **Dominoes** on signal blue.
- **Board-first hand layout completed 2026-08-22:** practice and online tables
  share a large felt, the player's hand docks directly below it, mobile seats
  form one compact four-player strip, and the online social rail becomes tabs
  below the board through 1100px. The prior stacked mobile seat cards and
  300px tablet rail were the primary causes of the “board is too small” issue
  and must not be restored.

## Incoming docs (5 expected)

| # | Topic | Status |
|---|---|---|
| 1 | Online play — architecture review | Received 2026-07-27. Spec written: [`docs/superpowers/specs/2026-07-27-online-play-design.md`](superpowers/specs/2026-07-27-online-play-design.md). **Not yet implemented.** |
| 2 | Design system + lesson art + billing rules + CLAUDE.md | Received 2026-07-27 (CLAUDE.md text arrived in a follow-up message). Installed: `.claude/rules/design.md`, `.claude/rules/lesson-art.md`, `.claude/rules/billing.md`, and the replacement `CLAUDE.md`. One real contradiction found and fixed before install: the "Voice is not wired... do not add before paying members" line directly contradicted the Phase 3 voice decision made earlier this session — reworded to reflect voice as planned/gated-on-vendor-account rather than off-limits. |
| 3 | — | Not yet received |
| 4 | — | Not yet received |
| 5 | — | Not yet received |

## Build phases

1. **Online play** — built, reviewed, verified live, and merged to `main`
   (2026-07-28). Plan:
   [`docs/superpowers/plans/2026-07-27-online-play.md`](superpowers/plans/2026-07-27-online-play.md)
   (9 tasks, all complete, plus 3 fixes found and inserted mid-build, plus a
   9-finding final whole-branch review fix wave — see below). Built via
   subagent-driven development (fresh implementer + independent reviewer per
   task; task reports and review packages were in
   `.superpowers/sdd/2026-07-27-online-play/` on the now-merged
   `worktree-online-play` branch — gitignored, not in the commit history, so
   that detail lives only here now). The Supabase backend (migrations,
   Edge Functions) has been live in production throughout the build — only
   the frontend deploy was pending merge. What shipped: table tier-gating
   (create/join, server-enforced), pass-the-pose as a real server path,
   optimistic-concurrency conflict
   handling, an open-tables lounge panel + join-by-code, the full live table
   (board, hand, scores, pass-pose UI), rejoin after reload/disconnect
   (including the boot-time trigger, not just the logic), and leaving a seat
   mid-game (converts to a duppy, records an abandon, frees a `waiting`
   seat). Rankings/leaderboard UI deliberately **not** included — doc #1
   said build that immediately after online play v1 ships; still an open
   thread below.
   - **3 real bugs found and fixed mid-build, not part of the original 9
     tasks:** (1) `tables`/`seats` RLS policies referenced each other in a
     circle — Postgres refused every client-side read of either table with
     `42P17`, silently breaking Task 3's rejoin lookup before anyone noticed;
     fixed with a `security definer` helper (`is_seated_at`), then hardened
     further after a reviewer caught it was RPC-callable as a membership
     oracle on private tables. (2) No UI button existed anywhere to start a
     table's first hand — the whole online flow was a dead end past "join a
     table." (3) The rejoin logic from Task 7 worked once triggered but
     nothing ever triggered it on page load — fixed with a self-controlled
     `localStorage` marker so it doesn't defeat the app's lazy-loading
     (offline players still never touch the Supabase bundle).
   - **Final whole-branch review found 9 more findings** (2 Critical, 7
     Important) that only showed up once every task was viewed together —
     each individually-reviewed task was correct on its own. Worth knowing
     the shape of these for future features: **leaving a table after
     finishing a set falsely recorded an abandonment** (the status check used
     `!== 'waiting'` instead of `=== 'playing'`); **nothing stopped two
     players both tapping "Deal next hand" from creating two active hands on
     one set** (fixed with an idempotency check plus a DB-level partial
     unique index as backstop); an unfiltered realtime subscription could let
     a stale hand's tiles overwrite the current one on screen;
     `expire-turns` never resolved `sets`/`tables.status` when its forced
     move happened to end a set, so an unattended finish silently discarded
     the result; `OnlineGame`'s error events had no listener anywhere, so a
     failed action just did nothing visible; `create-table` swallowed its
     seats-insert error, capable of leaving a permanently broken zero-seat
     table in a lounge list; Partner mode allowed 2 or 3 seats (nonsensical —
     it's inherently a 4-seat format) with no validation; a countdown timer
     leaked and compounded over a long hand; and opening a table could leak a
     Realtime connection on a double-tap. All 9 were fixed and re-verified
     live except one: **a narrow true-concurrency race in the double-open fix
     is parked, not closed** — requires literally-simultaneous taps (not just
     a quick double-tap, which is handled), and the consequence is an
     orphaned Realtime connection, not corrupted game state or anything
     visible to the player. Worth a fast follow-up fix (a synchronous
     in-flight guard, mirroring `main.ts`'s existing `ensureLoungeModule()`
     pattern) but didn't block this merge.
   - **One scenario genuinely unverified:** real iPhone Safari backgrounding
     (the `visibilitychange`-triggers-resubscribe path). No agent has a
     physical device — this needs a human test on a real iPhone before
     trusting it fully. Everything else in the spec's five-scenario list
     (happy path, simultaneous moves, disconnect/reconnect, portrait 390×844)
     was verified live against a real Vercel preview deploy and the real
     Supabase project, with two genuinely separate anonymous sessions.
2. **Visual polish — core play screens. Two shipped generations, the second
   replacing the first same day, both merged 2026-07-28.**

   **Generation 1 (superseded, do not resurrect):**
   [`docs/superpowers/plans/2026-07-28-visual-polish-core.md`](superpowers/plans/2026-07-27-visual-polish-core.md)
   built a dark "black room" theme — brown-wood table, gold as routine chrome
   — correcting the app's palette to actually match `.claude/rules/design.md`
   as it read *at the time*. It also gave the board a "wrap every N tiles"
   corner-turning algorithm to stop it scrolling horizontally forever. You
   rejected both after seeing them live: "never do a website black," and
   separately, a reference photo of real domino play showing the board
   should turn specifically at doubles, not at an arbitrary tile count.
   `design.md` itself has since been rewritten — the "black is the room"
   principle it used to state no longer exists.

   **Generation 2 (current, live):** research into actual Jamaican/Caribbean
   visual language (flag colors, dancehall poster culture, Caribbean
   branding — see Sources in that conversation) plus a 3-direction mockup you
   reviewed picked **"Sunday Yard"**: sun-bleached cream room at midday, flag
   green and gold at full strength (not rationed to a dark-theme accent),
   black used only as ink. Plans:
   [`docs/superpowers/plans/2026-07-28-sunday-yard-palette.md`](superpowers/plans/2026-07-28-sunday-yard-palette.md)
   and
   [`docs/superpowers/plans/2026-07-28-board-turns-at-doubles.md`](superpowers/plans/2026-07-28-board-turns-at-doubles.md).
   `.claude/rules/design.md` is up to date with this generation — trust it,
   not any earlier description of a dark theme.
   - **Board layout, current algorithm:** `renderBoard()`/`layoutPath()` in
     `apps/web/src/render.ts` is a strict 2-direction boustrophedon — a row
     travels entirely right or left, a double (or a width safety cap) ends
     the row, drops exactly one row, and reverses direction, the way text
     wraps. `row` only ever increases and `col` only ever moves one way
     within a row, which makes two tiles ever landing on the same cell
     *structurally impossible*, not just unlikely — this was proven by
     construction during review, not only tested. `Board.line`'s engine data
     shape is completely untouched; this is presentation-only. The column
     count is computed from `window.innerWidth` in JS, not CSS media
     queries, because boards are built detached from the document before
     being appended, and `getComputedStyle` can't resolve an ancestor's
     custom property on a detached element.
   - **The bug history here is worth remembering, because it's a genuinely
     hard failure mode to catch: a 4-direction clockwise version of this
     same algorithm (turn right→down→left→up→right, cycling) shipped first,
     passed its own task review, then passed a scoped re-review of a
     separate off-by-one fix — and was still fundamentally broken.** A path
     that always turns the same rotational way is a spiral, and spirals
     self-intersect unless segment lengths strictly increase, which real
     domino hands never guarantee. The final whole-branch review caught it
     by simulating 600 real hands through the actual engine and finding
     overlapping tiles (one hiding behind another) on **~70% of hands at the
     narrowest breakpoint** — invisible to both per-task reviews because
     every *individual* step of the algorithm was correct; the defect only
     exists in the shape of the whole path. Lesson for next time a
     path/sequence algorithm ships: a manual walkthrough of "a few doubles"
     is not sufficient verification — the failure only showed up deep into a
     full hand (median first overlap at tile 16 of ~23). The switch to a
     2-direction boustrophedon fixes this by construction, not by patching
     around the spiral.
   - **Other real bugs found and fixed, each confirmed by independent
     hand-trace or live measurement, not accepted on an implementer's word:**
     a partial wrapped row packing left instead of right-aligning under the
     previous row (hit most renders, not an edge case); the 390×844 nav bar
     overflowing the viewport by 19px; `button.act` (primary-action style)
     being gold everywhere including three places that stacked multiple gold
     buttons on one screen — the *plan* had inverted a primary/gold vs.
     secondary/ghost split the original design spec already specified
     correctly; a hover-state fix for that then collided with an unrelated
     rule and made every secondary button's hover gold-on-near-gold, caught
     by its own re-review; `--muted` (#8A7355) failing WCAG AA contrast
     (4.07:1, needs 4.5) with real reading copy sitting on it — darkened to
     `#786243`; `--bone` (the tile face color) accidentally set identical to
     the tile's own gradient highlight stop, flattening tiles to a flat fill
     with zero visible light direction — a real violation of `design.md`'s
     own stated material principles, on the app's hero object.
   - **`design.md` itself had two real bugs**, found and fixed alongside the
     code: its documented `--bone` value was identical to `--sand-hi`
     (panels), which would make tiles indistinguishable from the cards they
     sit near if the CSS had actually matched the doc; and `--muted` was
     used throughout the spec's own reasoning but never defined in the
     palette block at all. Both fixed in the doc, not just the CSS.
   - **Known, deliberately-left-as-is:** `.seat.partner` and `.grade.best`
     use the felt-green family for a partner accent and a "best move" badge —
     technically outside a too-strict reading of "green is the table surface
     only," ruled acceptable since the actual design principle is a
     proportion/balance rule, not a single-selector lock.
3. **Voice — built, and as of 2026-07-28 actually proven to work.** The
   LiveKit/Daily requirement in the old version of this entry is gone: voice
   is a peer-to-peer WebRTC mesh signalling over the Supabase Realtime channel
   the lounge already holds (`apps/web/src/voice.ts`). No SFU, no media
   vendor, no per-minute bill. Full failure list in `.claude/rules/voice.md`.

   - **It had never once connected two people, and nothing said so.**
     `enterLounge` read `entries[0]` from `channel.presenceState()`. Realtime
     keys presence to an *array* of metas per person and a second `track()`
     appends rather than replaces, so `entries[0]` is frozen at the moment
     someone walked into the room — before they picked up a microphone. The
     `voice` flag therefore stayed `false` for everybody forever,
     `syncRoster()` never had a peer to dial, and `new RTCPeerConnection` was
     never called at all. Both sides showed "Listening" and heard silence,
     with no error in any console. Fixed by reading the newest meta
     (`newestPresence()` in `voice.ts`, sitting next to `diffRoster()`, the
     step it feeds, with regression tests for the two-meta case and for a key
     left with no metas — that one put `undefined` in the roster and threw
     inside render).
   - **Only a second real client could have found it.** Unit tests pass on
     the broken version; one browser looks fine. `voice.md` already warned
     that two tabs share `localStorage`, collapse to one Supabase session,
     and prove nothing — that warning is now load-bearing, not advice.
   - **Proven, not assumed** (`docs/two-client-voice-check.mjs`,
     `docs/two-client-audio-1-signin.mjs`, `docs/two-client-audio-2-flow.mjs`):
     both peers reach `connectionState: 'connected'`; audio packets are sent
     and bytes arrive at the far end; the arriving audio carries real
     `totalAudioEnergy` (silence packets would satisfy a byte counter, so
     energy is the honest metric); **mute drops far-end energy to exactly
     +0.000000 against +1.61 unmuted**, which is the one bug `voice.md` says
     loses trust permanently; and leaving stops every sender track, so no
     recording light is left on. Speaking needs a paid tier, so the audio
     harness runs in two phases with the tier set out of band — both test
     accounts were reverted to guest afterwards.
   - **Reactions and voice now render at the four-seat table**, not only in
     the lounge. This was a rendering gap, not missing plumbing: the table
     view replaces the room view but nothing leaves the lounge channel, so
     the mesh was already live there and simply was not drawn. Seats show who
     is talking and what they threw; the speaking glow deliberately leaves
     `border-color` alone so it can never mask the gold whose-turn ring.
   - **All three routes onto a seat now join the channel.** Only "sit down
     from inside a lounge" ever did. Joining by code left the mic on
     "Connecting…" forever and dropped every reaction; they all go through
     `attachTable()`, which guards against re-entering a lounge you are
     already talking in (`openLounge()` tears the room down and would drop a
     live mic).

   **Still unproven, and both need a real device — do not claim otherwise:**
   (a) iOS Safari backgrounding, where the WebSocket dies with no close event
   and voice must recover on return; the simulator does not reproduce it.
   (b) Strict-NAT relay, which cannot be exercised until Cloudflare TURN
   credentials exist. There is no TURN configured today — `iceServers()` adds
   one only if `VITE_TURN_URL/USERNAME/CREDENTIAL` are set, and they are not
   set anywhere, not even in `.env.example`. STUN alone covers the majority
   and those behind strict NAT currently just fail to connect.

   **When TURN is wired, do not use static `VITE_` credentials.** Anything
   `VITE_`-prefixed is compiled into the bundle and readable in devtools, so
   static TURN creds let anyone relay on the account — burning the 1,000 GB
   free tier and then real money at $0.05/GB. Cloudflare's TURN is built
   around short-lived credentials minted from a TURN Key; mint them in an
   Edge Function per session. Sizing: ~50 MB per relayed player-hour in a
   four-seat mesh, so the free tier is roughly 19,000 relayed player-hours a
   month, and only the minority behind strict NAT relay at all.

   `canSpeak()` remains a client-side gate — a patched client could still
   transmit. The fix when freeloading actually appears is Realtime
   Authorization (an RLS policy on `realtime.messages` for the
   `voice-signal` event), which needs a migration. Not more client checks.

4. **Front door + the Verify line — shipped 2026-07-28.**
   - The page's bottom half read as an older site than the hero. Three causes,
     all fixed: stock `<select>` controls (no `appearance: none`, so the OS
     drew its own chevron and focus ring — the single most dated thing on the
     page and the strongest "this is the incumbent" signal); two typefaces on
     one screen (Bungee hero over Anton headings — Bungee is now the poster
     voice for the whole front door and hands over to Anton at the table);
     and flat cards, which now get the light-from-above, bottom-edge,
     real-shadow treatment `design.md` already demanded of the tiles.
   - `apps/web/public/art/yard-band.svg` is the house motif — coconut palms, a
     midday sun, a line of bones stood up in the yard — bridging the felt into
     the cream. Deliberately a dancehall-flyer silhouette, **not** a
     travel-brochure beach; postcard-tropical is the cliché that makes
     Caribbean products look generic, and the standing bones are what make it
     this game's picture rather than stock palm art. It renders `contain` at
     every width: cropping it on phones was tried and reverted because the
     palms sit near the artboard edges and any crop slices them in half.
   - **A latent bug from the Sunday Yard palette change:** the manifest and
     the `theme-color` meta still declared the old dark theme
     (`#140B09`/`#1A0F0D`), so an installed phone opened on a near-black
     splash and status bar into a cream app. Fixed, and `pwa.md` now says to
     change the three together whenever the room colour moves.
   - **The service worker `VERSION` had never been bumped** after the palette
     change, so returning players were being served the old design
     indefinitely. Hit this personally mid-build when the browser kept showing
     stale CSS. Bumped to `yard-v2`.
   - **The Verify line now appears where the suspicion actually lands** — on a
     loss, with a sharper variant when six love has just gone against you.
     The button, the Fair Deal page and the hero link were all already built;
     the pointed line was missing at the only moment it means anything.
     Explaining the cryptography anywhere else is a lecture nobody asked for,
     which is why a whole Fair Deal page was not converting a real structural
     advantage into something felt.

5. **Billing — the paywall was decorative, and renewals killed members.**
   Found by reading `.claude/rules/billing.md` against the code it governs:
   the rule already specified the correct behaviour and the webhook did not
   implement it. Four separate defects, all in the money path.

   - **Anyone signed in could grant themselves VIP.** `0006` granted
     table-wide `UPDATE` on every table to `authenticated` so RLS could act
     as the gate, but RLS is row-level only: the profiles policy decides
     which ROW you may write, never which COLUMNS. `effective_tier()` reads
     `tier` and `tier_expires_at`, both of which sat in that grant, so one
     PATCH bought a free membership. Ratings, `hands_played` and the speed
     counters were writable too, which made every leaderboard fiction.
     Setting `stripe_customer_id` to a paying member's id was worse still —
     the webhook matches renewals on that column. Fixed in
     `0012_profile_column_privileges.sql` with column grants (`username`,
     `flag`, `bio` — the three a member actually owns). Postgres checks
     column privileges before RLS, which is why this is the right layer.
     **A future blanket `grant update on all tables` silently reopens it.**
   - **A hardcoded year, whatever the term.** `checkout.session.completed`
     set `tier_expires_at` to now + 1 year regardless of the price bought, so
     a monthly price sold twelve months for one and cancelling after the
     first payment kept the other eleven. It now reads the real period from
     the subscription. The term lives in a dashboard price id, so the code
     cannot infer it — it has to ask.
   - **`invoice.paid` was not handled at all**, the exact failure the rule
     warns about in bold: Stripe renews and charges the card while
     `effective_tier` sees an expired date and drops a paying member to
     guest. Now the authoritative writer for every renewal. Checkout stamps
     `subscription_data[metadata]` so a renewal a year out identifies its own
     member without depending on event ordering; subscriptions sold before
     that are still found by customer id.
   - **Cancellation threw and retried forever.** Stripe moved
     `current_period_end` off the Subscription onto its items in the
     2025-03-31 API version. `new Date(undefined * 1000).toISOString()`
     raises a RangeError, so the handler 500'd, Stripe retried the event
     indefinitely, and the cancellation never applied — a cancelled member
     kept access permanently. All period reads now check both layouts.
   - Refunds and chargebacks revoke immediately (`0011_billing_hold.sql`
     adds the flag; note `profiles.flag` is a territory code and unrelated).
     A Dispute names only its charge, never a customer, so the charge is read
     back to find whose membership it is. `invoice.payment_failed`
     deliberately has no handler — dunning retries for weeks and ends in
     `subscription.deleted`, which is handled, so acting on the first failure
     would cut off a member whose card is about to go through.

   Every handler is idempotent by construction (absolute timestamps, never
   increments), so Stripe's retries need no event-id table. The pure payload
   readers live in `supabase/functions/_shared/billing.ts` with 14 tests in
   `npm test` — Deno is not installed locally and edge functions are outside
   the `tsc` project, so without those the money path had no check at all.

   **Not done, and deliberate:** `customer.subscription.updated` (upgrade
   Yardie → VIP via the Stripe portal). There is no portal link in the app,
   so every tier change currently goes back through checkout, which handles
   it. Wire it if a portal ships. Also unguarded: `invoice.paid` assumes
   every invoice is a subscription invoice. It is — everything sold is
   `mode: 'subscription'` — and a shape-sniffing guard whose failure mode is
   "lock out a paying member" is a worse trade than the manual-invoice edge
   case it would protect against.

6. **The board never grew — fixed 2026-07-29.** Raised by the business
   partner after a JamDom walkthrough: "yours need to be a little bit bigger,
   so it's like an actual domino you're looking at." He was describing a real
   bug, not a preference. `unitPx()` in `render.ts` returned a hardcoded 13 or
   15, so a tile was 60px tall on a phone and on a 27-inch monitor alike — the
   felt stretched to the viewport while the bones stayed put, and a four-tile
   opening rendered at exactly the same size as a twenty-eight-tile endgame.

   The unit is now searched for rather than fixed. Bigger tiles mean fewer
   units across, which means more rows, which needs more height, so the size
   cannot be solved directly — `chooseUnit()` tries MAX_UNIT (28) downward and
   takes the first that fits both the width and the felt's `min(64vh, 560px)`.
   `layoutLine` is pure and a hand is 28 tiles at most, so trying every size
   costs nothing. Measured: desktop went 15 → 28 (tile 30×60 → 56×112), phone
   13 → 23 (26×52 → 46×92), both roughly double.

   Two things this depended on. The pips were a hardcoded 5px, which left a
   big bone looking almost blank — they are now sized as a percentage of their
   cell. And the host element is **detached** when `renderBoard` runs (it is
   built, filled, then appended), so measuring the parent is not an option and
   the box is computed from the window and the known CSS chrome instead.

   `chooseUnit()` is pure and exported for that reason; `apps/web/src/render.test.ts`
   asserts across every board length 1–28 on a phone and a desktop box that the
   line fits its width, fits its height, never shrinks on the larger screen, and
   never squeezes below `MIN_WIDTH_UNITS`. The hero pins `unit: 15` so the front
   door keeps the size it was designed at.

7. **Banked turn time — built 2026-07-29, NOT yet verified live.** The best
   idea from the business partner's JamDom walkthrough. A flat clock punishes
   the fast player twice: moving quickly earns them nothing, and on the one
   hand that actually needs reading they hit the same wall as somebody who has
   dawdled all game. So unused time is now kept.

   Every turn grants a base; whatever is unspent accumulates in a bank the seat
   draws on later; no single turn may exceed a cap however full the bank; the
   bank empties when a hand is dealt, so nobody reaches the deciding hand of a
   set holding a hoard. Rules are pure in `packages/engine/src/clock.ts` with
   11 tests, including the partner's own scenario and a nonsense table row.

   - `0013_banked_turn_time.sql` adds `tables.turn_cap_seconds` and
     `seats.time_bank`. The bank sits on `seats`, not `hands`, because a new
     column on `hands` would mean changing the `commit_move` signature — and
     that function is granted to service_role **by exact signature** in 0007.
   - `turn_seconds` keeps its name and meaning: it was already the per-turn
     allowance and is now the base of one, so existing tables behave as before.
   - `play-move` charges the turn and banks the remainder, but only **after**
     `commit_move` has held — a move that loses the conditional write must not
     spend a bank on a turn that never happened.
   - `expire-turns` empties the timed-out seat's bank. Without that, a player
     could bank all game and then sit out every turn on the same hoard.
   - Clocks are chosen **by name** (`speed` / `yard` / `relaxed`), never by
     seconds, so a patched client cannot start a table with a turn long enough
     to hold the room hostage. `create-table` resolves the name server-side.
   - The table form gained a Clock control. Without it the feature would have
     been unreachable: every table would take the database default and no speed
     room could ever be started.

   **Deploy order is not optional here.** `create-table` now inserts
   `turn_cap_seconds`, so deploying the functions before applying `0013` breaks
   table creation outright. Apply the migration first, then deploy. The client
   is defensive either way (`turn_cap_seconds ?? turn_seconds`, `time_bank ?? 0`),
   and `clock.ts`'s `sane()` tolerates a missing cap — but the insert does not.

   **Unverified, and needs a real table:** the whole online path. The rules and
   the fit are unit-tested, the Clock control is confirmed rendering, and it all
   typechecks and builds — but no hand has been played on a banked clock, because
   that needs the migration applied, the functions deployed, and two clients.
   Do not claim this works until someone has watched a bank actually accumulate.

   Local play against duppies still has no clock at all. That is deliberate for
   now — the partner's ask was about online speed tables — but it means the
   practice mode does not train the thing the speed rooms test.

## Done — infrastructure (2026-07-27 session)

Everything below is live and verified, not just written:

- **GitHub**: private repo, `Shan12377/yard-dominoes`, connected to Vercel for
  auto-deploy on push to `main`.
- **Vercel**: live at `yard-dominoes.vercel.app`, env vars set for prod/preview/dev.
- **Supabase** (`Jamaican Domino`, `iqixdijhckgilvyhduxb`): schema applied,
  all 8 Edge Functions deployed, `pg_cron` running `expire-turns` every minute.
- **Critical fix**: `service_role` had zero base table grants on every table
  in the project — silently broke every real write path (create-table,
  join-table, start-hand, play-move, the Stripe webhook) all session. Fixed
  in migration `0007_service_role_grants.sql`. Verified by playing a real
  online move through the authenticated pipeline.
- **Also fixed**: same missing-grants bug for `anon`/`authenticated`
  (migration `0006`), `SITE_URL` trailing-newline bug in `checkout`, wrong
  Stripe Price ID (was a Product ID), silent guest sign-in wired into
  `loungeview.ts` (nothing previously called `signInAsGuest()`).
- **Stripe**: sandbox tested end-to-end for both Yardie and VIP, real
  checkout session, real redirect, real webhook write confirmed working
  post-grant-fix. Still on the `Hunter's Holistic Health LLC` Stripe account
  — you said you'll move it to a dedicated account later.
- **Full audit result**: local play, lounge chat, membership/payments, and
  the entire server-authoritative backend all confirmed working. Online
  multiplayer, Academy drills/progress, bredrins list, and username editing
  were found to have **no UI at all** — backend exists for some, nothing
  built for others. This is what kicked off the current build phase.

## Done — Kingston Signal brand and performance pass (2026-08-22)

- The confirmed product is **YaadDominoes**, never Yaadmoji, with the public
  slogan **“Beat di table.”** `docs/branding.md` is the brand source of truth.
- The complete production asset family now ships from the canonical
  `yaaddominoes-mark.svg`: PWA/favicon sizes, maskable icon, iOS splash screens,
  responsive hero WebPs, editable hero SVG, and a 1200×630 social card.
- The landing hero changed from a large pip-by-pip DOM illustration to a
  responsive static WebP. External Google Fonts were removed in favor of local
  stacks. Optional global statistics and service-worker registration are
  delayed beyond first paint. Do not reverse these choices without measuring
  the production build.
- Lighthouse was run against the local production preview, not Vite dev. The
  clean desktop audit scored **100 in every category** (performance,
  accessibility, best practices, SEO, and agentic browsing). Mobile scored 100
  in every non-performance category; performance varied with throttling, with
  a best observed score of 97 and a clean final run of 92. Do not report mobile
  as 100 until an actual audit produces it.
- Nothing from this pass was pushed or deployed. `main` auto-deploys to the
  YaadDominoes Vercel project, so local approval remains the gate.

## Done — design foundation completion (2026-08-22)

- The seven requested design gates were implemented together before the final
  audit: board-first mobile layout, complete browser/PWA/domain assets, twelve
  human avatars, gameplay motion and sound, three human marketing scenes, copy
  cleanup, and a preview-only release workflow.
- Player avatars are now one cohesive twelve-person Jamaican portrait set.
  Source sheet, ids and art rules live in `docs/avatar-set.md`; production WebPs
  live in `apps/web/public/avatars/`.
- A focused accessory layer now adds shades, crown, flower, headphones or a
  Jamaica pin to any portrait, producing 72 combinations without a slow face
  builder. Migration `0043_avatar_accessories.sql` must land before that field
  is saved or queried in production; keep `VITE_AVATAR_ACCESSORIES_DB=false`
  until then. The client keeps the choice locally while that flag is off and
  deliberately avoids querying a missing column.
- Migration `0042_avatar_collection.sql` widens the profile constraint for the
  four new ids. It must be applied before a deployed client is allowed to save
  `afro`, `braids`, `twists` or `goldtooth`; the original eight ids remain
  backward compatible.
- Marketing photography is generated artwork, not customer testimony. The
  three scenes live under `apps/web/public/marketing/`, load only when their
  section enters the viewport below the play controls, and never appear in a
  live game.
- The live-table signature is now: quick placement settle + recorded knock,
  animated pass card + spoken response, a foreground final-bone spin + felt
  impact, and dedicated six-love motion/sound. The real winning bone remains
  in its legal board position while an aria-hidden visual clone performs the
  airborne celebration. Reduced-motion hides that clone and leaves the winning
  bone highlighted, so every state remains clear without movement.
- Phone rules keep chat/watchers/standings/log/profile below the table up to
  1100px, enlarge the playable hand to 44×88px on normal phones, and reserve
  56svh for the felt where height permits.
- The 2026-08-22 hidden-hand UI change was a misunderstanding and has been
  reverted. Opponents intentionally retain face-down bone backs as public hand
  counts, and Open hand intentionally reveals a partner's tiles. The privacy
  correction applies only to human marketing artwork: photographs must never
  show a player's unplayed pip faces to the camera or other players.
- All three marketing photographs were regenerated on 2026-08-22 around the
  same art direction but with one connected legal played chain, a crosswise
  double, and private hands facing their owners. Future image work must be
  checked against the domino-accuracy rule in `docs/branding.md` before ship.
- The night final-bone scene was discarded and regenerated completely from
  scratch on 2026-08-22 after iterative edits became soft and confused hand
  ownership. Its final quality-90 master uses a square table with one player per
  edge: green winner opposite yellow, and coral directly opposite blue. The
  raised-fist winner has zero bones; every losing hand remains beside its owner;
  played bones form one open centered line. Never reuse rejected derivatives or
  place coral and blue beside one another.
- Seat backdrops were replaced with five vibrant, people-free environmental
  scenes on 2026-08-22. They intentionally contain no dominoes, hands, faces,
  text or flags; this prevents decorative art from reading as leaked tiles at
  seat-card scale. The profile picker now names every scene and the live card
  uses an asymmetric navy veil instead of flattening all artwork under 84%
  opacity.
- Browser QA completed a real four-player practice hand through all 24 played
  bones at 390×844, then rechecked 320×568 and 430×932. The board did not
  overflow in either axis, the hand remained below the felt, the final bone
  used the spin/impact treatment, and the twelve-avatar picker stayed within
  the phone viewport.
- Verified preview branch: `design/yaaddominoes-foundation`. The Vercel Git
  integration deployed it only to project `yard-dominoes` (not the separate
  `yaadmoji-soundbites` project); production and `main` remain untouched. The
  stable branch preview is
  `https://yard-dominoes-git-design-yaaddom-deaf0a-yaadmoji-5201s-projects.vercel.app`.
- Final post-seven-gate mobile Lighthouse measured **95 performance, 100
  accessibility, 100 best practices, 100 SEO** (FCP 1.2s, LCP 1.9s, TBT 140ms,
  CLS 0). The audit showed that below-fold marketing images were still fetched
  several viewports early by native lazy loading, so they were changed to an
  IntersectionObserver visibility gate afterward. A repeat audit was blocked
  by the local runner's network/socket permission limit; do not claim the
  optimized build is 100 until a fresh production-preview run proves it.

## Open threads not yet in a phase

- **`OnlineGame` double-open race** (`apps/web/src/loungeview.ts`): two truly
  simultaneous table-join taps can leak a Realtime channel + `visibilitychange`
  listener — the shipped guard closes the common quick-double-tap case but not
  a genuine concurrent race. Low severity (resource leak, not data corruption,
  nothing visible breaks), fix is well-understood (a synchronous in-flight
  guard, same pattern as `main.ts`'s `ensureLoungeModule()`/`loungeLoading`),
  parked during the online-play final review rather than blocking merge.

- ~~**Billing webhook gaps**~~ — fixed 2026-07-29, see phase 5 above. Only
  `customer.subscription.updated` remains unwired, and only matters once a
  Stripe billing portal exists.

- **The Stripe endpoint must be reconfigured to send the new events.** The
  code handles `invoice.paid`, `charge.refunded` and `charge.dispute.created`;
  the dashboard endpoint is still subscribed to the original two, so until
  someone ticks them the renewal fix does nothing in production. Migrations
  `0011` and `0012` also need applying, and `0012` is the one that closes the
  free-VIP hole. Deploy order does not matter, but neither is optional.

- Rankings/leaderboard UI (per-style ratings already tracked in
  `profiles.rating_partner` / `rating_cutthroat`, never surfaced anywhere).
  Doc #1 says: build immediately after online play v1 ships.
  - `"Quick Ting"` short-game mode — explicitly skipped, not adopted.
- Academy drill UI + `academy_progress` persistence — lesson content exists
  in `academy.ts`, no screens, no progress tracking.
- Bredrins list UI (VIP's "see where your people are") — backend exists
  (`addBredrin`, `whereAreMyBredrins`), no UI.
- Google/Apple sign-in — `signInWithProvider` exists in code, no button, and
  the providers aren't confirmed configured in Supabase Auth yet.
- Username customization — DB allows a user to update their own username
  (RLS policy already permits it), no UI to do so.
- **`OnlineGame`'s emitted `'error'` events have no listener anywhere in the
  UI** — a failed move or a failed "start hand" (e.g. table not full yet)
  currently just silently re-renders with no visible feedback. Needs a
  future task touching `loungeview.ts`'s `OnlineGame.on()` wiring.
- **No UI path to spectate a table before its first hand starts** —
  `openTablesPanel`'s "Watch" option only appears once `status !== 'waiting'`,
  by which point a hand already exists.
- **`create-table`'s `seats` insert silently swallows constraint-violation
  errors** if the `duppies` array doesn't cover every non-creator seat — hit
  repeatedly during the online-play build's own testing (never in the real
  UI, which always supplies a full `duppies` array, but a real risk for
  anyone calling the API directly). Worth a real fix — check the insert's
  error and surface it — before it bites something else.
- **`expire-turns` doesn't update `sets`/`tables.status` when the hand it
  force-plays happens to end a set** (unlike `play-move`, which does). More
  likely to surface now that `leave-seat` creates duppy'd seats that finish
  hands unattended.
- **`leave-seat`'s `abandons` counter is read-then-write, not atomic** — a
  double-tap could under-count. Low real-world risk, worth an `update ...
  set abandons = abandons + 1` if ever revisited.
