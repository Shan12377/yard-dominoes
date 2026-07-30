-- =============================================================================
-- 0016_openhand.sql
--
-- Open Hand ("Ol' Man") — partner-open. Step 1 of 2: add the enum value.
--
-- `alter type ... add value` cannot be used in the same transaction that
-- adds it — Postgres requires the new value to be committed first (error
-- 55P04, "unsafe use of new value ... must be committed before they can be
-- used"). Supabase's migration runner applies each file as one atomic
-- block, so the add and every use of 'openhand' cannot share a file. This
-- migration is the commit boundary; 0017_openhand_rls.sql does everything
-- that reads or writes the new value.
-- =============================================================================

alter type public.game_mode add value if not exists 'openhand';
