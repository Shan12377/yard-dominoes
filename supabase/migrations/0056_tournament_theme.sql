-- =============================================================================
-- 0056_tournament_theme.sql
--
-- A tournament is an event, and events come in kinds. JamDom runs weekly
-- tournaments across the game styles plus themed ones — "battle of sexes, team
-- vs team, couple's tourney" — and this is the column that says which.
--
-- A theme decides WHO SITS WITH WHOM and nothing else. The rules of the game
-- are identical at every table in this product, so a theme never touches them;
-- the seating lives in `_shared/tournament-queue.ts`'s `drawForTheme`.
--
-- Text plus a check constraint rather than a Postgres enum, following
-- `duppy_pace` (0047/0055): widening a check is one ALTER, where adding to an
-- enum mid-transaction has its own rules. Only themes that are actually built
-- are listed — a value the draw cannot seat would be a host choosing an event
-- that silently seats nobody. `team_vs_team` and `couples` come with their
-- sign-up concepts, not before.
-- =============================================================================

alter table public.tournaments
  add column theme text not null default 'open'
    constraint theme_is_known check (theme in ('open', 'battle_of_the_sexes'));

comment on column public.tournaments.theme is
  'Which kind of event this is. Decides seating only, never game rules: '
  'open = the queue cut into full tables; battle_of_the_sexes = women on one '
  'side, men on the other. See _shared/tournament-queue.ts drawForTheme.';

-- Battle of the sexes IS two-against-two, so it only makes sense at a
-- four-handed partner table. Enforced here as well as in tournament-host so a
-- direct insert cannot create an event whose draw can never seat anybody.
alter table public.tournaments
  add constraint battle_of_the_sexes_is_partner_four
    check (theme <> 'battle_of_the_sexes' or (mode = 'partner' and seat_count = 4));
