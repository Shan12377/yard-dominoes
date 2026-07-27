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

## Testing locally

`supabase db reset` then `npm run fn:serve`. Test RLS by querying as an
anonymous user, not as service role — service role passes everything and will
give you false confidence.
