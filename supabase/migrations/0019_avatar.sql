-- =============================================================================
-- 0019_avatar.sql
--
-- Presence without a photo. Eight curated characters (docs/avatar-set.md),
-- picked from the profile editor, worn on the seat.
--
-- Stores an id, never a URL — a client-supplied image URL is an arbitrary
-- pixel-server hole: point your avatar at a remote tracker (or worse) and
-- every player who sees you at a table loads it. The check constraint keeps
-- the column to exactly the eight ids the client ships art for; nothing else
-- can be written here even by a patched client, because there is no matching
-- file to render for it.
-- =============================================================================

alter table public.profiles
  add column avatar text
    constraint avatar_is_known check (
      avatar in ('tam', 'wrap', 'granny', 'straw', 'hoops', 'cap', 'phones', 'plain')
    );

comment on column public.profiles.avatar is
  'Self-picked, nullable, one of the eight ids in docs/avatar-set.md. Never a '
  'URL — apps/web/public/avatars/<id>.webp is the only thing that ever renders.';

-- Same reasoning as 0012/0014: a new column is not writable until it is named
-- in a grant. Unlike `is_host`, a player picks their own avatar, so — unlike
-- that column — this one belongs in the list. Spelling out the full set
-- again (not just the new column) keeps the complete writable surface
-- visible in one statement.
grant update (username, flag, bio, origin, gender, avatar) on public.profiles to authenticated;
