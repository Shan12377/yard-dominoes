-- Comp codes: a way to hand someone a free Yardie/VIP term without a
-- Stripe payment. Owner generates a code ahead of time (so it's ready to
-- hand out the moment someone asks, not something that needs a live
-- session at redemption time); anyone signed in can redeem one, once.
--
-- Same posture as referral_payouts (0051): RLS enabled, zero client
-- policies. Every access goes through redeem-code (self-serve redemption)
-- or redeem-admin (owner-only generation/listing), both under service_role
-- — never a direct client select/insert on this table.
create table public.redeem_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  tier text not null check (tier in ('yardie', 'vip')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  redeemed_by uuid references public.profiles(id),
  redeemed_at timestamptz
);

alter table public.redeem_codes enable row level security;
revoke all on public.redeem_codes from public, anon, authenticated;

create index redeem_codes_created_by_idx on public.redeem_codes(created_by);
