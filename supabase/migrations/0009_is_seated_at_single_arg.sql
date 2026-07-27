-- =============================================================================
-- 0009_is_seated_at_single_arg.sql
--
-- Closes an RPC oracle introduced by 0008_seats_tables_rls_fix.sql.
--
-- `is_seated_at(p_table_id, p_user_id)` is `security definer`, and its
-- default `EXECUTE ... TO PUBLIC` grant cannot be revoked without breaking
-- the recursion fix it exists for (the `tables` SELECT policy calls it
-- during ordinary RLS evaluation). That means it was directly callable via
-- `POST /rest/v1/rpc/is_seated_at` by any anon/authenticated client with an
-- arbitrary `(table_id, user_id)` pair — letting a caller ask "is this
-- specific person seated at this private table?" for someone other than
-- themselves. `profiles` is globally readable, so user ids are
-- discoverable; a private table's uuid is never exposed via join codes but
-- is not impossible to obtain either. That RPC path did not exist before
-- 0008 and defeats the point of `is_private`.
--
-- Fix: the `tables` policy only ever needs to ask about the caller, not an
-- arbitrary user — it always passed `auth.uid()` as the second argument.
-- Drop `p_user_id` and check `auth.uid()` internally instead. Called via
-- RPC, the one-arg version can only ever answer "am I seated at this
-- table" — information the caller already has by other means. Observable
-- behavior of `tables` reads is unchanged, since the policy always passed
-- `auth.uid()` anyway.
--
-- `create or replace function` cannot change an existing function's
-- argument list, so the two-arg version is dropped first. The `tables`
-- policy depends on it, so the policy is dropped and recreated around the
-- swap.
-- =============================================================================

drop policy if exists "public tables are listable; private ones need the code" on public.tables;

drop function if exists public.is_seated_at(uuid, uuid);

create or replace function public.is_seated_at(p_table_id uuid)
returns boolean
language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.seats s
    where s.table_id = p_table_id and s.user_id = auth.uid()
  );
$$;

create policy "public tables are listable; private ones need the code"
  on public.tables for select
  using (
    not is_private
    or public.is_seated_at(id)
  );
