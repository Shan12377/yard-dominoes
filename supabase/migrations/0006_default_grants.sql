-- =============================================================================
-- 0006_default_grants.sql
--
-- Every table in this project has RLS enabled and policies written on the
-- assumption that RLS is the ONLY gate (see .claude/rules/supabase.md: "The
-- database is the security boundary. Not the client... the RLS policies.").
-- That assumption requires anon/authenticated to hold the base table grant
-- underneath the policies — Postgres checks table-level privileges before it
-- ever evaluates a row-security policy.
--
-- This project never got that base grant (Supabase normally applies it at
-- provisioning; this one didn't). The practical symptom: every client-side
-- read, even ones a policy explicitly allows with `using (true)`, failed with
-- PostgREST 401 / Postgres 42501 (insufficient_privilege) instead of either
-- succeeding or being cleanly denied by RLS.
--
-- `hands` intentionally has RLS enabled with ZERO policies (see 0001). This
-- grant does not change that: the code comment "every client SELECT returns
-- nothing" only holds once the base grant exists AND no policy matches —
-- without the grant, clients got a 401 error instead of the intended empty
-- result. Granting here is what makes that comment true.
--
-- Function EXECUTE grants are untouched — several were deliberately revoked
-- from anon/authenticated in 0004 and must stay that way.
-- =============================================================================

grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage on all sequences in schema public to anon, authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;
