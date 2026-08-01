-- =============================================================================
-- 0026_more_backgrounds.sql
--
-- Two more cosmetic yard-scene backgrounds: beach and rumshop. Same reasoning
-- as 0024 — a check constraint against exactly the ids the client ships art
-- for. A constraint is dropped-and-recreated rather than widened in place;
-- Postgres has no ALTER CONSTRAINT for check clauses.
-- =============================================================================

alter table public.profiles
  drop constraint background_is_known;

alter table public.profiles
  add constraint background_is_known check (
    background in ('midday', 'evening', 'rain', 'beach', 'rumshop')
  );
