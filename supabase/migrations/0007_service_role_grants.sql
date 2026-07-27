-- =============================================================================
-- 0007_service_role_grants.sql
--
-- service_role — the role every Edge Function connects as via serviceClient()
-- — never had base table privileges on ANY table in this project, the same
-- root-cause bug fixed for anon/authenticated in 0006. BYPASSRLS only skips
-- row-level security policy checks; it does not substitute for the base
-- GRANT/REVOKE privilege system Postgres checks first.
--
-- Practical impact, confirmed live: every server-authoritative write this
-- project depends on — create-table, join-table, start-hand, play-move,
-- review-hand, expire-turns, and the Stripe webhook's profile/payment
-- updates — was silently failing all session. Nothing threw, because
-- @supabase/supabase-js resolves `{ data: null, error }` rather than
-- rejecting, and most call sites here don't check `error` on every write.
-- expire-turns kept reporting 200 OK only because there were never any
-- active hands for it to touch yet.
-- =============================================================================

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage on all sequences in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;

-- Functions locked down for anon/authenticated in 0004 still need service_role
-- to call them; re-affirm explicitly rather than relying on an implicit grant.
grant execute on function public.commit_move(uuid, int, jsonb, jsonb, jsonb, smallint, smallint, jsonb, text, jsonb, timestamptz) to service_role;
grant execute on function public.generate_join_code() to service_role;
grant execute on function public.handle_new_user() to service_role;
grant execute on function public.record_move_speed(uuid, int) to service_role;
