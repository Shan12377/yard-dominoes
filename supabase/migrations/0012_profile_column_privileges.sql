-- =============================================================================
-- 0012_profile_column_privileges.sql
--
-- CRITICAL: the paywall was bypassable with one request.
--
-- 0006 granted table-wide UPDATE on every public table to anon/authenticated so
-- that RLS could act as the gate. For `profiles` that grant is too wide, because
-- RLS is row-level only — the policy "you may edit only your own profile"
-- (0001) decides WHICH ROW you may write, never WHICH COLUMNS. With table-wide
-- UPDATE underneath it, any signed-in member could PATCH their own row and set
-- `tier` to 'vip' with `tier_expires_at` far in the future, because
-- `effective_tier()` reads exactly those two user-writable columns. Free VIP,
-- no Stripe involved. The same request could rewrite ratings, hands_played and
-- the speed counters, so the leaderboards were writable fiction too.
--
-- Setting `stripe_customer_id` to a paying member's id was the nastier version:
-- the webhook matches renewals on that column, so a squatter's membership would
-- have been extended by somebody else's card.
--
-- Postgres checks column privileges before RLS, so the fix is column grants.
-- A member owns their name, territory and bio. Everything else on this table is
-- written by the server — the Stripe webhook and the game functions, which
-- connect as service_role and are unaffected (0007 grants that role separately).
--
-- The comment in stripe-webhook/index.ts calling itself "the ONLY writer to
-- profiles.tier" only becomes true here.
--
-- Note for future migrations: re-running a blanket
-- `grant update on all tables in schema public to authenticated` would silently
-- reopen this. Grant per table, or re-apply this file after.
-- =============================================================================

revoke update on public.profiles from anon, authenticated;

-- The three columns a member actually owns. Adding a column to this table does
-- NOT expose it — a new column has to be named here to become writable.
grant update (username, flag, bio) on public.profiles to authenticated;

-- `anon` gets nothing: there is no signed-out profile to edit, and the update
-- policy requires auth.uid() to match anyway.

-- ---------------------------------------------------------------------------
-- Same class of bug, far smaller blast radius: this policy has a `using` but no
-- `with check`, so a member could update their own visit row and hand it to
-- another user_id, faking where somebody else is sitting.
-- ---------------------------------------------------------------------------
drop policy if exists "you update only your own visit" on public.lounge_visits;
create policy "you update only your own visit"
  on public.lounge_visits for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
