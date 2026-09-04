-- =============================================================================
-- 0058_tournament_seat_assignment.sql
--
-- A themed draw promises a specific seating, not just a table: battle of the
-- sexes puts women on 0&2 and men on 1&3, couples puts each pair opposite
-- itself. That promise was being computed and then thrown away — tournament-
-- host recorded only `table_id`, never which of the four seats a drawn player
-- belonged in — so join-table fell back to "any open seat", and which
-- literal seat a real person landed in came down to who tapped Join first.
-- Two women both racing for the table could easily land on opposite sides.
--
-- This column is where the draw's seat plan survives past the draw itself.
-- Null for an open event: no promise is made there about who ends up beside
-- whom, so the existing free-for-all join order is untouched.
-- =============================================================================

alter table public.tournament_signups
  add column seat_index smallint check (seat_index is null or seat_index between 0 and 3);

comment on column public.tournament_signups.seat_index is
  'Which seat this player was drawn into at their current table, for a theme '
  'that promises specific seating (battle_of_the_sexes, couples). Null for an '
  'open event, and null again once the round ends. join-table enforces this '
  'when set, rather than handing out whichever seat is open first.';
