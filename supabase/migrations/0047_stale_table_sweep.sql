-- =============================================================================
-- 0047_stale_table_sweep.sql
--
-- "Open tables" (listLoungeTables, lounges.ts) shows every table with
-- status in ('waiting','playing') — tables.status only reaches 'finished'
-- when a full SET completes (see tournaments.ts's comment), so a table
-- abandoned mid-set, or one whose creator never seated anyone, sat in that
-- list forever. Found live 2026-08-27: Cut Throat Yard's Open tables list
-- had ~50 rows, most weeks old, several from this project's own
-- Playwright/curl testing (which hits the same production database as
-- real players).
--
-- Direct SQL cron job, not an Edge Function — no engine logic or auth is
-- needed, just a status flip, so net.http_post's extra hop would be pure
-- overhead. Runs hourly; "no activity in 3+ hours" is generous next to
-- this app's real turn clocks (10-30s) and duppy paces (3.5-20s/move), so
-- a table that's actually still being played is never caught by this.
-- =============================================================================

select cron.schedule(
  'sweep-stale-tables',
  '17 * * * *',
  $$
  update public.tables t
  set status = 'finished'
  where t.status in ('waiting', 'playing')
    and coalesce(
      (select max(hp.updated_at) from public.hand_public hp where hp.table_id = t.id),
      t.created_at
    ) < now() - interval '3 hours';
  $$
);
