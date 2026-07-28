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
2. **Visual polish** — not started. Portrait-first (390×844), per doc #1's
   scope decision, not deferred to "later." **Confirmed item for this phase**
   (flagged 2026-07-28 while reviewing the online table live): `renderBoard()`
   in `apps/web/src/render.ts` already lays doubles crosswise ("the way they
   sit on a real table" per its own comment) but draws the whole line on one
   axis, scrolling horizontally forever instead of turning corners the way a
   physical table's board does once it runs out of room. Fixing this means a
   real 2D layout algorithm (track direction changes, corner tiles), not a
   style tweak — affects local play too, since both share this function.
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
