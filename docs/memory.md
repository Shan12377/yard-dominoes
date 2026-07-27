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

1. **Online play** — spec approved, implementation plan written:
   [`docs/superpowers/plans/2026-07-27-online-play.md`](superpowers/plans/2026-07-27-online-play.md)
   (9 tasks). **Not yet built.**
2. **Visual polish** — not started. Portrait-first (390×844), per doc #1's
   scope decision, not deferred to "later."
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
