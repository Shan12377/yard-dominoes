-- =============================================================================
-- 0067_french_rating.sql
--
-- French gets its own Yard Rating (owner, 2026-09-17). French is played every
-- player for themself and shared the cut-throat rating until now, but being
-- good at a race to 100 where the lowest score wins is a different skill from
-- cut throat, and French players want their own board.
--
-- Same shape and defaults as the two ratings 0001/0027 created: 1200 with a
-- 350 ratings deviation, written only by Edge Functions (0012's column grants
-- give clients no update right here).
-- =============================================================================

alter table public.profiles
  add column if not exists rating_french int not null default 1200,
  add column if not exists rd_french int not null default 350;
