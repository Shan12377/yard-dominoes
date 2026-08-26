-- Expand the selectable human portrait collection from twelve to twenty.
-- Duppy art stays separate: it is never selectable or stored on profiles.

alter table public.profiles
  drop constraint avatar_is_known;

alter table public.profiles
  add constraint avatar_is_known check (
    avatar in (
      'tam', 'wrap', 'granny', 'straw', 'hoops', 'cap', 'phones', 'plain',
      'afro', 'braids', 'twists', 'goldtooth',
      'marigold', 'cedar', 'sonia', 'devon', 'otis', 'nadia', 'kyro', 'levi'
    )
  );

comment on column public.profiles.avatar is
  'Self-picked, nullable, one of the twenty human ids in docs/avatar-set.md. '
  'Never a URL — apps/web/public/avatars/<id>.webp is the only rendering path.';
