-- =============================================================================
-- 0051_referral_payouts.sql
--
-- A referrer's own "cash out" request — they ask, giving a contact email;
-- an admin sees the request, pays them outside the app (however that
-- actually happens — bank transfer, Zelle, Partnero), and marks it paid.
-- This table is the request/paid record, NOT a payment rail — nothing here
-- moves money on its own.
--
-- Same grant pattern as every other money-adjacent table this session
-- (referral_codes, referral_commissions): 0006's default ACLs make a new
-- table client-writable by default, so REVOKE first and grant back only
-- what's actually needed. Writes go through the `referrals` and
-- `referral-admin` Edge Functions under service_role, never a raw client
-- insert/update — this is money, not a chat message.
-- =============================================================================

create table public.referral_payouts (
  id                uuid primary key default gen_random_uuid(),
  referral_code_id  uuid not null references public.referral_codes(id),
  owner_user_id     uuid not null references public.profiles(id),
  contact_email     text not null check (char_length(contact_email) between 3 and 254),
  -- Snapshot at request time — the underlying commissions ledger keeps
  -- accumulating after this, so this is "what they asked to be paid for",
  -- not a live-computed number that could drift while a request sits open.
  amount_cents      int not null check (amount_cents > 0),
  status            text not null default 'requested' check (status in ('requested', 'paid')),
  requested_at      timestamptz not null default now(),
  paid_at           timestamptz
);

create index referral_payouts_owner_idx on public.referral_payouts(owner_user_id);
create index referral_payouts_status_idx on public.referral_payouts(status);

-- At most one OPEN request per code at a time — asking again while a
-- request is still pending would just create a second claim on money
-- already spoken for. Partial unique index, not a check constraint,
-- because "at most one" needs to look across rows, not just validate one.
create unique index referral_payouts_one_open_per_code
  on public.referral_payouts(referral_code_id) where status = 'requested';

alter table public.referral_payouts enable row level security;

-- Same shape as 0015_tournaments.sql: revoke the default-ACL grant 0006
-- hands every new table, then grant SELECT back explicitly so RLS actually
-- has something to narrow — a bare REVOKE ALL with no re-grant would also
-- take away the SELECT this table's own RLS policy depends on.
revoke all on public.referral_payouts from anon, authenticated;
grant select on public.referral_payouts to anon, authenticated;
grant select, insert, update, delete on public.referral_payouts to service_role;

create policy "you may read your own payout requests"
  on public.referral_payouts for select using (owner_user_id = auth.uid());
