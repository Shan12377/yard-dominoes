-- =============================================================================
-- 0038_last_penalties.sql
--
-- French penalties (+10 board-pass, +10 triple-pass, +10 no-double-to-pose)
-- accrued silently until now — visible only in the running total at hand-end.
-- `hand_public.last_penalties` carries the events from whichever
-- deal()/applyMove() call most recently ran, so every seat watching the
-- table can be told the moment a +10 lands, and why. Always overwritten
-- fresh on the next write, never accumulated — see PenaltyEvent in
-- packages/engine/src/types.ts. hand_public is already the redacted,
-- safe-to-broadcast table (no hidden tiles), so no RLS change is needed.
-- =============================================================================

alter table public.hand_public add column last_penalties jsonb not null default '[]';
