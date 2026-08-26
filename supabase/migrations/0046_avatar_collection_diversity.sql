-- Add the four new human portraits. Duppy ids remain intentionally excluded:
-- they are AI-only local assets and cannot be stored on player profiles.

alter table public.profiles
  drop constraint avatar_is_known;

alter table public.profiles
  add constraint avatar_is_known check (
    avatar in (
      'tam', 'wrap', 'granny', 'straw', 'hoops', 'cap', 'phones', 'plain',
      'afro', 'braids', 'twists', 'goldtooth',
      'marigold', 'cedar', 'sonia', 'devon', 'otis', 'nadia', 'kyro', 'levi',
      'harold', 'mei', 'imani', 'tariq'
    )
  );

comment on column public.profiles.avatar is
  'Self-picked nullable human portrait id from docs/avatar-set.md. Never a URL; Duppy ids are excluded.';
