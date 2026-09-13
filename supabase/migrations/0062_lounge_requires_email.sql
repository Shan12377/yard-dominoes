-- The Lounge requires a real email. Practice does not.
--
-- Owner's partner, 2026-09-12: "for people to use lounge, they must have an
-- email." The Lounge is where you meet strangers, chat and talk on voice, so
-- it needs somebody reachable behind each seat — a ban that a cleared browser
-- undoes is not a ban, and a table dispute with an anonymous account has
-- nobody to answer it.
--
-- This deliberately does NOT touch the settled decisions it sits next to:
--   * Practice stays anonymous and instant. There is still no wall in front
--     of a first game, which is the whole funnel.
--   * No SOCIAL login is required. An email and password is not Facebook.
--   * The game stays free. This is an identity floor, not a paywall — a guest
--     with an email reaches every lounge a guest could reach before.
--
-- CONFIRMED, not merely typed. Supabase flips `is_anonymous` to false only
-- once the confirmation link is clicked, and `secureAccount()` in online.ts
-- already sends that link while keeping the same user id, so profile, tier
-- and any admin grant carry over. An unconfirmed address is not a reachable
-- one, which is the entire point of asking for it.

create or replace function public.has_lounge_email() returns boolean
language sql stable security definer set search_path = public, auth as $$
  -- security definer because auth.users is not readable by the anon or
  -- authenticated roles. It returns only a boolean about the CALLER, never
  -- anybody else's address, so it leaks nothing.
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and u.email is not null
      and u.email_confirmed_at is not null
  );
$$;

revoke execute on function public.has_lounge_email() from public;
grant execute on function public.has_lounge_email() to authenticated, service_role;

-- Presence: being IN the room. Reading who is there stays open, so the lounge
-- list can still show a live count to somebody deciding whether to sign up.
drop policy if exists "you record only your own visit" on public.lounge_visits;
create policy "you record only your own visit"
  on public.lounge_visits for insert
  with check (user_id = auth.uid() and public.has_lounge_email());

drop policy if exists "you update only your own visit" on public.lounge_visits;
create policy "you update only your own visit"
  on public.lounge_visits for update
  using (user_id = auth.uid() and public.has_lounge_email());

-- Chat: reading and speaking both need the email, because both are the room.
drop policy if exists "lounge chat is readable if you can enter the lounge" on public.lounge_messages;
create policy "lounge chat is readable if you can enter the lounge"
  on public.lounge_messages for select
  using (
    public.has_lounge_email()
    and exists (
      select 1 from public.lounges l, public.profiles p
      where l.id = lounge_id
        and p.id = auth.uid()
        and (
          l.min_tier = 'guest'
          or (l.min_tier = 'yardie' and public.effective_tier(p) in ('yardie', 'vip'))
          or (l.min_tier = 'vip' and public.effective_tier(p) = 'vip')
        )
    )
  );

drop policy if exists "you speak as yourself, in lounges you can enter" on public.lounge_messages;
create policy "you speak as yourself, in lounges you can enter"
  on public.lounge_messages for insert
  with check (
    user_id = auth.uid()
    and public.has_lounge_email()
    and exists (
      select 1 from public.lounges l, public.profiles p
      where l.id = lounge_id
        and p.id = auth.uid()
        and (
          l.min_tier = 'guest'
          or (l.min_tier = 'yardie' and public.effective_tier(p) in ('yardie', 'vip'))
          or (l.min_tier = 'vip' and public.effective_tier(p) = 'vip')
        )
    )
  );
