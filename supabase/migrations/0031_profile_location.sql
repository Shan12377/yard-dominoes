-- =============================================================================
-- 0031_profile_location.sql
--
-- Optional, free-text "where you play from" location — separate from the
-- existing origin (Yardie/Foreign) toggle. The point is letting players spot
-- someone nearby and link up ("oh you're in Brooklyn too?"), which needs an
-- actual place name, not a binary. Free text, not geolocation: nothing here
-- is inferred from IP or GPS, and it's blank unless the player types
-- something in themselves. Shown on the profile card only when set.
-- =============================================================================

alter table public.profiles
  add column location text check (char_length(location) <= 60);

comment on column public.profiles.location is
  'Optional, player-typed place name shown on their profile card. Never '
  'inferred from IP/GPS — blank unless the player fills it in themselves.';

grant update (username, flag, bio, origin, gender, avatar, background, location)
  on public.profiles to authenticated;
