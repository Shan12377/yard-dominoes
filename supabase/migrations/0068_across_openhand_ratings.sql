-- =============================================================================
-- 0068_across_openhand_ratings.sql
--
-- Across and Open hand get their own Yard Ratings (owner, 2026-09-17), the
-- same way French did in 0067. Both shared the partner rating until now
-- because they are partner's ruleset underneath, but they are not the same
-- game to play: Across is two people holding two seats each, and Open hand
-- plays with a partner's bones face up. Each wanted its own board.
--
-- Same shape and defaults as every other rating column (0001/0027/0067):
-- 1200 with a 350 ratings deviation, written only by Edge Functions — 0012's
-- column grants give clients no update right here.
-- =============================================================================

alter table public.profiles
  add column if not exists rating_across int not null default 1200,
  add column if not exists rd_across int not null default 350,
  add column if not exists rating_openhand int not null default 1200,
  add column if not exists rd_openhand int not null default 350;
