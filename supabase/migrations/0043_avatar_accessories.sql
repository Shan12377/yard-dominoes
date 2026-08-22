-- A small composable flair layer gives the curated portrait set more variety
-- without allowing arbitrary remote URLs or turning profile setup into a
-- full character creator.

alter table public.profiles
  add column avatar_accessory text
    constraint avatar_accessory_is_known check (
      avatar_accessory in ('shades', 'crown', 'flower', 'headphones', 'flagpin')
    );

comment on column public.profiles.avatar_accessory is
  'Optional cosmetic layer over a preset avatar. A known local asset id, never a URL.';

grant update (
  username, flag, bio, origin, gender, avatar, avatar_accessory, background, location
) on public.profiles to authenticated;
