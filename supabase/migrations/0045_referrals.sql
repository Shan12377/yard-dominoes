-- =============================================================================
-- 0045_referrals.sql
--
-- Referral commissions: a person gets a code, anyone who signs up through it
-- is attributed to them permanently, and every payment the referred member
-- makes — first charge and every renewal — credits the referrer a percentage.
--
-- Attribution happens exactly once, atomically with account creation. The
-- code rides in as Supabase Auth signup metadata (see
-- apps/web/src/online.ts's signInAsGuest()) and handle_new_user() reads it
-- in the SAME insert that creates the profile — there is no window where a
-- client request could set or change it afterward. referred_by_code_id is
-- deliberately never added to profiles' column-update grant (0012), the same
-- protection tier and stripe_customer_id already have.
--
-- Almost every new player starts anonymous (the product's "no sign-in wall"
-- rule — see CLAUDE.md), and secureAccount() later upgrades that SAME
-- auth.users row to email/OAuth rather than creating a new one, so this one
-- hook point at first anonymous sign-in covers attribution for virtually
-- every real signup. A user who somehow signs up cold via OAuth with no
-- prior anonymous session skips attribution — accepted for v1; the guest
-- path is the only one this product actually funnels people through.
-- =============================================================================

create table public.referral_codes (
  id             uuid primary key default gen_random_uuid(),
  code           text unique not null check (char_length(code) between 3 and 32),
  owner_user_id  uuid not null references public.profiles(id) on delete cascade,
  commission_pct numeric(5,2) not null default 20 check (commission_pct >= 0 and commission_pct <= 100),
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

alter table public.referral_codes enable row level security;

-- Read-only, own rows only. Codes are created and deactivated by hand
-- (service role) for now — there is no self-serve "generate me a code" flow
-- yet, and building one before there is more than a single referrer would be
-- speculative.
create policy "you may read your own referral codes"
  on public.referral_codes for select using (owner_user_id = auth.uid());

alter table public.profiles
  add column referred_by_code_id uuid references public.referral_codes(id);
-- NOT added to the grant in 0012_profile_column_privileges.sql. That
-- migration's own comment is the rule: "Adding a column to this table does
-- NOT expose it — a new column has to be named here to become writable."
-- This one stays server-only on purpose.

-- Same signature as before (handle_new_user() returns trigger), so
-- CREATE OR REPLACE preserves the existing ACL — revoked from public/anon/
-- authenticated (0004), granted to service_role (0007). Nothing to re-grant.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ref_id uuid;
begin
  select id into ref_id
  from public.referral_codes
  where code = new.raw_user_meta_data->>'referral_code' and active
  limit 1;

  insert into public.profiles (id, username, referred_by_code_id)
  values (new.id, 'player_' || substr(new.id::text, 1, 8), ref_id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create table public.referral_commissions (
  id                uuid primary key default gen_random_uuid(),
  referral_code_id  uuid not null references public.referral_codes(id),
  owner_user_id     uuid not null references public.profiles(id),
  referred_user_id  uuid not null references public.profiles(id),
  -- Stripe checkout session id (first payment) or invoice id (every
  -- renewal) — same idempotency shape as payments.stripe_session_id. A
  -- Stripe retry of the same event must never double-credit.
  stripe_reference  text unique not null,
  amount_cents      int not null check (amount_cents >= 0),
  created_at        timestamptz not null default now()
);

alter table public.referral_commissions enable row level security;

create policy "you may read your own referral commissions"
  on public.referral_commissions for select using (owner_user_id = auth.uid());
