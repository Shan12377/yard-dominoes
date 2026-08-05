-- =============================================================================
-- 0036_french_tie_break_column.sql
--
-- SetState.frenchTieBreak (a French blocked-hand tie forces a chucha
-- reshuffle rather than the sixlove-style escalating replay — see
-- packages/engine/src/set.ts) needs to survive between play-move calls the
-- same way every other SetState field does: read from `sets`, folded
-- through applyHandResult(), written back. Missing this column would have
-- made play-move error on its very first write to a French set.
-- =============================================================================

alter table public.sets add column french_tie_break boolean not null default false;
