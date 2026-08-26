-- Extend the deliberately small, local-only cosmetic set. These ids are
-- rendered from bundled SVGs; user-supplied URLs remain forbidden.

alter table public.profiles
  drop constraint avatar_accessory_is_known;

alter table public.profiles
  add constraint avatar_accessory_is_known check (
    avatar_accessory in (
      'shades', 'crown', 'flower', 'headphones', 'flagpin',
      'canadapin', 'ukpin', 'bandana', 'beanie', 'necklace'
    )
  );

comment on column public.profiles.avatar_accessory is
  'Optional local cosmetic id from docs/avatar-set.md, never a remote URL.';
