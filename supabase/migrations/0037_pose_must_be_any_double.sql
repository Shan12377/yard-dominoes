-- =============================================================================
-- 0037_pose_must_be_any_double.sql
--
-- French, round 2+: the poser must lead SOME double they hold, not a
-- specific tile — a different constraint from pose_must_be_double_six
-- (which forces one exact tile: round 1's chucha, or a tie-break
-- reshuffle). Same persistence pattern as that column: set once at
-- start-hand's INSERT, never touched by commit_move, read back on every
-- toState() rehydration for the rest of that hand's lifetime.
-- =============================================================================

alter table public.hands add column pose_must_be_any_double boolean not null default false;
