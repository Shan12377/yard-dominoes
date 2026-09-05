-- =============================================================================
-- 0060_sweep_abandoned_tables.sql
--
-- 0047 sweeps tables with no activity for three hours. That is the right
-- window for a table people are still sitting at between turns, and much too
-- long for one nobody is sitting at.
--
-- `leave-seat` nulls the seat but never touches `tables.status`, deliberately:
-- `join-table` keeps that seat claimable by the same player for five minutes
-- (0053), and closing the table would take that door away. But once everybody
-- has walked out, the table keeps `status = 'playing'` with only duppies
-- moving, and the lounge's Open Tables list advertised it — "0/4 seated" with
-- a Watch button, nothing to watch. Reported by a player who left a set
-- midway and found their own dead table sitting in the room behind them
-- (2026-09-05).
--
-- The client no longer lists a table with nobody at it, so this is the other
-- half: stop the row itself lingering for three hours, where it eats into
-- listLoungeTables' 30-row cap and keeps a finished game marked live.
--
-- Fifteen minutes is deliberately well clear of the five-minute rejoin window
-- — a player who is coming back has long since done so, and one who is not
-- should not leave a corpse in the room. Duppy-only seats are exactly what is
-- being swept: `seats.user_id` is null for a duppy, so "no seat has a
-- user_id" is precisely "no real person is here".
-- =============================================================================

select cron.schedule(
  'sweep-abandoned-tables',
  '*/5 * * * *',
  $$
  update public.tables t
  set status = 'finished'
  where t.status in ('waiting', 'playing')
    and not exists (
      select 1 from public.seats s
      where s.table_id = t.id and s.user_id is not null
    )
    and coalesce(
      (select max(hp.updated_at) from public.hand_public hp where hp.table_id = t.id),
      t.created_at
    ) < now() - interval '15 minutes'
    -- Tournament tables are drawn and seated by the host, so an empty one is
    -- waiting for its players rather than abandoned by them. tournament-host
    -- owns their lifecycle; never close one from here.
    and t.tournament_id is null;
  $$
);
