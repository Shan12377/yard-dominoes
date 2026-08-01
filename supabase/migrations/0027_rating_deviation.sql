-- =============================================================================
-- 0027_rating_deviation.sql
--
-- Glicko rating deviation (RD) — how much to trust rating_partner/
-- rating_cutthroat, not just the number itself. This is what replaces
-- JamDom's frequency-bucket wall: a new account's high RD makes its rating
-- swing hard until it's proven, so nobody reaches the top off a lucky
-- streak, without a hard division ceiling that can permanently cap a
-- genuinely better player below a worse one. See packages/engine/src/
-- rating.ts for the full reasoning and the formula, verified against
-- Glickman's own published worked example.
--
-- 350 is Glickman's own value for a brand-new, unrated player — matches
-- rating_partner/rating_cutthroat's existing 1200 default, which was
-- already the "unrated" convention this schema picked before RD existed.
-- =============================================================================

alter table public.profiles
  add column rd_partner   int not null default 350,
  add column rd_cutthroat int not null default 350;

comment on column public.profiles.rd_partner is
  'Glicko ratings deviation for rating_partner — how much to trust that '
  'number. Written only by the server after a fully-human set completes. '
  'See packages/engine/src/rating.ts.';
comment on column public.profiles.rd_cutthroat is
  'Glicko ratings deviation for rating_cutthroat. Same as rd_partner.';
