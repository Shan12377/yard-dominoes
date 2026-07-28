# Project memory

Running record of what's done, what's approved-but-not-built, and what's
still coming. Update this file whenever a doc lands, a phase finishes, or a
decision gets made — this is the single place to check status instead of
re-deriving it from chat history.

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
2. **Visual polish — core play screens, built and merged 2026-07-28.** Plan:
   [`docs/superpowers/plans/2026-07-28-visual-polish-core.md`](superpowers/plans/2026-07-28-visual-polish-core.md)
   (3 tasks, all complete). Scope was deliberately narrowed to the screens
   players actually play on — local play, the online live table, lounges,
   membership — with Academy lesson diagrams, avatars, and atmosphere images
   explicitly deferred (avatars/atmosphere need an image-generation API key
   not yet set up; Academy diagrams are their own large scope, left for last
   per your instruction).
   - **What shipped:** the app's palette/materials were inverted from what
     `.claude/rules/design.md` actually specifies — table surface was brown
     wood with green reserved for the score only, gold used broadly as
     routine chrome (nav, badges, chat usernames, buttons everywhere).
     Rebuilt to match the doc: green felt table surface, wood only framing
     the edges, gold restricted to genuine highlights (lit score pips,
     six-love, single primary actions, VIP indicators) — checked file-by-file
     against every screen, not just spot-checked. Anton replaced Archivo
     Black for display type; Bungee is now used in exactly two places (the
     wordmark, the six-love banner), matching the design doc's "signage face,
     used anywhere else it becomes noise" rule precisely. Added real
     materials: felt weave texture, a visible wood-grain table border, tile
     bottom-edge thickness.
   - **The board now turns corners** instead of scrolling horizontally
     forever — `renderBoard()` in `apps/web/src/render.ts` wraps into rows
     (a boustrophedon layout, alternating direction each row) once a row
     fills, the column count computed from viewport width in JS rather than
     CSS media queries (elements are built detached from the document before
     being appended, so `getComputedStyle` can't resolve an ancestor's custom
     property at render time — this cost one real bug during the build, see
     below). `Board.line`'s engine data shape is completely untouched; this
     is presentation-only.
   - **Real bugs found and fixed during the build, each confirmed by an
     independent hand-trace, not just accepted on an implementer's word:**
     (1) a partial (non-full) wrapped row packed to the left edge instead of
     right-aligning under the previous row's endpoint — since a real hand's
     tile count is rarely an exact multiple of the column count, this hit
     the currently-in-progress row (the part of the board a player is
     actually watching) on most renders, not as a rare edge case; fixed with
     explicit `grid-column` placement on reversed rows. (2) at exactly
     390×844 — the project's primary target width — the 5-item nav bar
     overflowed the viewport by 19px with mid-word text wrapping; fixed with
     `flex-wrap: wrap`, matching an idiom already used five other places in
     the same stylesheet. (3) `button.act` (the primary-action button style)
     was gold everywhere including three places that put multiple gold
     buttons on one screen at once (a looped lounge list, membership tier
     cards, the permanent chat send button) — this was the *plan* inverting
     what the original design spec had already correctly specified (a
     primary/gold vs. secondary/ghost split with named examples); fixed to
     match the spec. (4) the fix for (3) then introduced its own regression —
     wiring an unused `--gold-hi` token into `button.act:hover` collided with
     the pre-existing `.ghost:hover` rule, making every secondary button's
     hover state gold-on-near-gold, well under accessibility contrast
     minimums, app-wide — caught by the final review's own re-review pass and
     fixed with `:not(.ghost)` scoping.
   - **Known, deliberately-left-as-is:** `.seat.partner` and `.grade.best`
     use the felt-green family for a partner accent and a "best move" badge —
     flagged during review as technically outside a too-strict reading of
     "green is the table surface only," ruled acceptable since the actual
     design principle is a proportion/balance rule, not a single-selector
     lock, and these are small, non-decorative, legitimate uses.
3. **Voice** — not started. Confirmed **real live voice**, not voice notes.
   Requires a LiveKit or Daily account (real per-minute cost, needs your
   credentials) before any code gets written for it. `CLAUDE.md` updated
   2026-07-27 to reflect this as planned rather than off-limits.

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

## Open threads not yet in a phase

- **`OnlineGame` double-open race** (`apps/web/src/loungeview.ts`): two truly
  simultaneous table-join taps can leak a Realtime channel + `visibilitychange`
  listener — the shipped guard closes the common quick-double-tap case but not
  a genuine concurrent race. Low severity (resource leak, not data corruption,
  nothing visible breaks), fix is well-understood (a synchronous in-flight
  guard, same pattern as `main.ts`'s `ensureLoungeModule()`/`loungeLoading`),
  parked during the online-play final review rather than blocking merge.

- **Billing webhook gaps** (`billing.md`, doc #2): only `checkout.session.completed`
  and `customer.subscription.deleted` are wired. Missing: `invoice.paid` (the
  one that keeps renewals alive — its absence is a real bug waiting to happen,
  not a hypothetical), `invoice.payment_failed`, `customer.subscription.updated`,
  `charge.refunded`, `charge.dispute.created`. No plan written yet for this.

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
