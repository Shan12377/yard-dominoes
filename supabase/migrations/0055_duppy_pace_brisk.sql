-- =============================================================================
-- 0055_duppy_pace_brisk.sql
--
-- Real players said a launched table felt slow: the default 'yard' pace ran
-- 10s per Duppy move, and three Duppies at 10s is half a minute of waiting
-- between your own turns. 'yard' drops to 7.5s and a new 'brisk' (5s) lands
-- between it and 'quick' (3.5s), so the step down from the default isn't
-- straight to the fastest setting.
--
-- The seconds themselves live in the engine (packages/engine/src/clock.ts);
-- this constraint only bounds which NAMES a table row may hold, which is what
-- stops a patched client posting itself an arbitrary Duppy delay. Existing
-- 'yard' rows need no backfill — they resolve through the engine at read
-- time, so they pick up 7.5s automatically.
-- =============================================================================

alter table public.tables drop constraint duppy_pace_allowed;

alter table public.tables
  add constraint duppy_pace_allowed
    check (duppy_pace in ('quick', 'brisk', 'yard', 'relaxed'));

comment on column public.tables.duppy_pace is
  'Server-enforced Duppy reading beat: quick=3.5s, brisk=5s, yard=7.5s, '
  'relaxed=20s. Affects only AI turns; human turns remain governed by '
  'turn_seconds/time bank.';
