-- =============================================================================
-- 0048_blitz_clock.sql
--
-- Adds 'blitz' (5s, bank up to 20s) as a fourth live-player clock, below
-- 'speed' (10s) — requested directly: "10 sec too long". CLOCKS/CLOCK_LABELS
-- in packages/engine/src/clock.ts is the source of truth and already carries
-- the new entry; regular tables never had a DB-level clock constraint (only
-- turn_seconds/turn_cap_seconds are stored, resolved server-side by
-- clockByName()), so the only schema this touches is tournaments.clock_is_known.
-- =============================================================================

alter table public.tournaments drop constraint clock_is_known;
alter table public.tournaments add constraint clock_is_known
  check (clock in ('blitz', 'speed', 'yard', 'relaxed'));
