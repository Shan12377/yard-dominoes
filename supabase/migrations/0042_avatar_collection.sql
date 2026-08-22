-- Expand the curated avatar collection from eight to twelve human portraits.
-- Existing ids remain valid so saved profiles keep working.

alter table public.profiles
  drop constraint avatar_is_known;

alter table public.profiles
  add constraint avatar_is_known check (
    avatar in (
      'tam', 'wrap', 'granny', 'straw', 'hoops', 'cap', 'phones', 'plain',
      'afro', 'braids', 'twists', 'goldtooth'
    )
  );

comment on column public.profiles.avatar is
  'Self-picked, nullable, one of the twelve ids in docs/avatar-set.md. Never a '
  'URL — apps/web/public/avatars/<id>.webp is the only thing that ever renders.';
