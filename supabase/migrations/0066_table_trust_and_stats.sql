-- =============================================================================
-- 0066_table_trust_and_stats.sql
--
-- Table Trust, career stats and the facts the end-of-game step needs
-- (owner, 2026-09-17, "Ranking, Table Trust & Fair Play").
--
-- profiles (written only by Edge Functions; 0012's column grants give
-- clients no update right on any of these):
--   table_trust     0-100, starts at 100. Walk-off -8, love-walk -12,
--                   stall-out -5, clean finish +1. Never touches rating.
--   love_walks      times a player walked off while their side was on love
--   games_started   games a player was seated for when they began (or joined)
--   games_finished  games a player was still seated for at the end
--   games_won       of those, games their side won
--   win_streak / best_win_streak
--
-- seats:
--   sat_at        when the current person first sat in this seat. A rejoin
--                 keeps it; a new person taking the seat resets it. A game is
--                 a "full game" for a seat when sat_at is before the set began.
--   timeouts      turns the clock played for this person in the current game
--   left_penalty  the Table Trust taken at Leave, so a rejoin inside the
--                 five-minute window can give it back
-- =============================================================================

alter table public.profiles
  add column if not exists table_trust smallint not null default 100
    check (table_trust between 0 and 100),
  add column if not exists love_walks integer not null default 0,
  add column if not exists games_started integer not null default 0,
  add column if not exists games_finished integer not null default 0,
  add column if not exists games_won integer not null default 0,
  add column if not exists win_streak integer not null default 0,
  add column if not exists best_win_streak integer not null default 0;

alter table public.seats
  add column if not exists sat_at timestamptz,
  add column if not exists timeouts smallint not null default 0,
  add column if not exists left_penalty smallint;
