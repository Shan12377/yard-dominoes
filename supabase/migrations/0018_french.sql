-- =============================================================================
-- 0018_french.sql
--
-- French — race-to-100-loses. Adds the enum value only. Same rule as
-- 0016_openhand: `alter type ... add value` cannot be used in the same
-- transaction that adds it (Postgres 55P04), and Supabase applies each
-- migration file as one atomic block, so anything that WRITES 'french' has to
-- live in a separate later migration. This file is the commit boundary.
-- Right now nothing on the server needs to reference 'french' in DDL, so
-- there is no follow-up SQL needed — the engine ships in the client bundle
-- and edge functions read the value dynamically.
-- =============================================================================

alter type public.set_format add value if not exists 'french';
