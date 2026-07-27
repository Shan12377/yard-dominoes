-- =============================================================================
-- 0008_seats_tables_rls_fix.sql
--
-- seats' SELECT policy subqueries tables; tables' SELECT policy subqueries
-- seats. Evaluating either under RLS can require evaluating the other —
-- Postgres detects this as infinite recursion (42P17) rather than looping,
-- and refuses to plan the query. This broke every client-side read of
-- `tables` or `seats` from day one; it went unnoticed because prior manual
-- verification of code touching these tables ran through service-role or
-- execute_sql paths, which bypass RLS entirely.
--
-- Fix: give `tables`' policy a security-definer helper instead of a raw
-- subquery into `seats`. Table owners bypass RLS on their own tables by
-- default (this repo never sets FORCE ROW LEVEL SECURITY), so the helper's
-- internal seats query does not re-trigger seats' policy — breaking the
-- cycle without changing either policy's actual access semantics.
-- =============================================================================

create or replace function public.is_seated_at(p_table_id uuid, p_user_id uuid)
returns boolean
language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.seats s
    where s.table_id = p_table_id and s.user_id = p_user_id
  );
$$;

drop policy "public tables are listable; private ones need the code" on public.tables;

create policy "public tables are listable; private ones need the code"
  on public.tables for select
  using (
    not is_private
    or public.is_seated_at(id, auth.uid())
  );
