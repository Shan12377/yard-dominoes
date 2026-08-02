---
paths:
  - "supabase/**"
---

# Supabase rules

The database is the security boundary. Not the client, not the Edge Function
code — the RLS policies.

## The redaction model

Three tables split one hand:

- `hands` — full truth: every seat's tiles, the unrevealed seed. RLS is enabled
  with **zero policies**, which denies all client access. Service role only.
- `hand_public` — the redacted view. Safe to broadcast.
- `seat_hands` — one row per seat, readable only by `user_id = auth.uid()`.

`persist()` in `functions/_shared/lib.ts` is the only place redaction happens.
Keep it that way so there is exactly one file to audit.

**Never add `hands` to the realtime publication.** Realtime respects RLS, but
publishing that table at all is one policy mistake away from broadcasting
everyone's tiles.

## Writing Edge Functions

- Validate with `isLegal()` before `applyMove()`. Never trust a client move.
- Check three things independently: the caller is seated, it is their turn, and
  the move's `seat` matches their own seat. A client can lie about all three.
- `npm run sync:engine` vendors the engine into `functions/_shared/engine/`.
  That directory is gitignored and generated — never edit it, edit
  `packages/engine/src/` and re-sync. `fn:serve` and `fn:deploy` sync first.
- The service role key bypasses RLS. It belongs only in function env vars.

## Concurrency

Moves use optimistic locking. `commit_move` (migration 0003) only writes when
`version` still matches what was read, and returns `NULL` otherwise; `persist`
throws `Conflict` and `play-move` answers 409.

**Do not go back to a plain `update`.** Two players tapping at the same instant
both pass the turn check against the same stale snapshot, and the second write
erases the first — a tile disappears off the board.

Any new writer to `hands` must go through `commit_move`.

## Webhooks

- `stripe-webhook` needs `verify_jwt = false`; Stripe cannot send a Supabase
  JWT. Signature verification replaces it, including a 5-minute replay window.
- Stripe retries. Idempotency comes from the unique constraint on
  `payments.stripe_session_id`.
- `profiles.tier` and `payments` are written **only** by the webhook. A client
  that can set its own tier has no paywall.

## Schema conventions

- Always `timestamptz`, never `timestamp`.
- Every new table: `enable row level security` in the same migration. A table
  with RLS off and no policy is world-readable.
- Migrations are append-only. Never edit a migration that has been applied;
  add a new numbered one.
- `pg_cron` must be enabled in the dashboard before `expire-turns` will fire.

## Auth

- The client signs a user in three ways: anonymous (`signInAnonymously`),
  Apple/Google OAuth, or — as of 2026-08-02 — email/password via
  `online.ts`'s `secureAccount()`/`signInWithPassword()`. Email/password was
  closed outright for a long time (see history below); it was reopened for a
  specific, narrow reason and should stay narrow.
- **What "narrow" means:** `secureAccount()` is reachable only from a player
  who is already signed in and already has an account — it converts an
  existing anonymous session to a permanent one (same user id, so
  `tier`/`is_admin`/`is_host`/every stat carries over unchanged), it is never
  a cold "create a new account with just an email" form, and it is never
  required to play. If a change ever makes email signup reachable by someone
  who is NOT already an existing signed-in session (a logged-out landing
  page with an email field, for instance), that is a different, wider
  feature than what was approved here and needs its own decision.
- **Why it was reopened:** a paying Yardie/VIP's `profiles.tier` is keyed to
  one anonymous session in one browser, exactly like every other anonymous
  account — clear that browser, switch phones, or reinstall, and the
  membership they paid for is gone with no self-service way back. That is a
  worse gap than the abuse risk email signup was originally closed against,
  so the tradeoff was made deliberately, with eyes open to the abuse
  surface, not by accident. `loungeview.ts`'s `upgradePrompt()` nudges a
  fresh Yardie/VIP purchase (`?upgraded=yardie|vip` off the Stripe success
  redirect, previously read by nothing on the client) toward securing the
  account right after paying, when it's least likely to be forgotten.
- **Original reasoning, still worth knowing:** `enable_signup = false` closed
  the email provider outright rather than trying to blocklist disposable
  domains — a fight with no end state — on the premise that the product had
  no legitimate use for email signup. That premise held right up until a
  real admin account got permanently locked out of `is_admin`/`is_host` by
  clearing a browser, with no way back in short of a raw SQL grant to a
  *different* account. If abuse shows up (throwaway emails farming coins,
  dodging a ban), the fix is tightening `secureAccount()`'s reachability
  (rate limiting, requiring a minimum account age, a `before-user-created`
  Postgres auth hook) — not re-closing the gate and reintroducing the
  lockout risk this was built to fix.
- `config.toml`'s `[auth.email] enable_signup` must read `true` — it was
  quietly diverging from the hosted dashboard (which had already been
  flipped on to make `secureAccount()` work) until both were reconciled
  together. `config.toml` is authoritative for local dev; the hosted
  project's Auth provider settings live separately (Dashboard →
  Authentication → Providers → Email, or `supabase config push`) — confirm
  they still match before trusting this file alone to describe production.

## Testing locally

`supabase db reset` then `npm run fn:serve`. Test RLS by querying as an
anonymous user, not as service role — service role passes everything and will
give you false confidence.
