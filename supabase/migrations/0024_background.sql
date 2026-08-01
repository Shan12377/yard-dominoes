-- =============================================================================
-- 0024_background.sql
--
-- Cosmetic yard-scene backgrounds (plan §7.1). Three flat-vector scenes,
-- picked from the profile editor, worn behind a seat card — no new
-- real-time infra, purely a personalization layer over data that already
-- ships with every seat.
--
-- Same reasoning as 0019's avatar column: store an id, never a URL. A
-- client-supplied image URL is an arbitrary pixel-server hole; the check
-- constraint keeps this to exactly the three ids the client ships art for.
-- =============================================================================

alter table public.profiles
  add column background text
    constraint background_is_known check (
      background in ('midday', 'evening', 'rain')
    );

comment on column public.profiles.background is
  'Self-picked, nullable, one of midday/evening/rain. Never a URL — '
  'apps/web/public/backgrounds/<id>.webp is the only thing that ever renders.';

grant update (username, flag, bio, origin, gender, avatar, background) on public.profiles to authenticated;
