-- =============================================================================
-- 0028_rename_rumshop_background.sql
--
-- 'rumshop' -> 'shop'. The image never showed the word or any alcohol
-- imagery, but the id/label did use "rum shop" — teenagers can reach this
-- picker (the game itself has no age floor; only lounges/chat/voice do),
-- so the word doesn't belong here even as a label. Zero profiles had
-- picked it (checked before writing this), so a straight rename.
-- =============================================================================

alter table public.profiles
  drop constraint background_is_known;

alter table public.profiles
  add constraint background_is_known check (
    background in ('midday', 'evening', 'rain', 'beach', 'shop')
  );
