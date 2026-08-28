-- =============================================================================
-- 0050_referral_bonus_coins.sql
--
-- Public referral rate drops from 10% cash to 5% cash + a one-time 100-coin
-- bonus on the referred player's FIRST payment only (never renewals) —
-- coins cost the business nothing to grant (money in, never out, per
-- 0021's own header), so this trades a chunk of ongoing cash commission for
-- something that still feels generous and keeps the referrer inside the
-- product. The founders' 20% cash-only codes are untouched.
--
-- Adds 'referral_bonus' as a fourth grant_coins() kind, with its own
-- idempotency: a Stripe retry of the same checkout.session.completed must
-- never double-grant the bonus, same guarantee 'purchase' already has.
-- =============================================================================

alter table public.coin_ledger drop constraint coin_ledger_kind_check;
alter table public.coin_ledger add constraint coin_ledger_kind_check
  check (kind in ('purchase', 'refund', 'adjustment', 'spend', 'gift_sent', 'gift_received', 'referral_bonus'));

create unique index coin_ledger_referral_bonus_ref_idx
  on public.coin_ledger(reference) where kind = 'referral_bonus';

create or replace function public.grant_coins(
  p_user_id   uuid,
  p_amount    int,
  p_kind      text,
  p_reference text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  if p_amount <= 0 then
    raise exception 'grant_coins amount must be positive';
  end if;
  if p_kind not in ('purchase', 'refund', 'adjustment', 'referral_bonus') then
    raise exception 'grant_coins kind must be purchase, refund, adjustment or referral_bonus';
  end if;

  if p_kind = 'purchase' then
    insert into public.coin_ledger (user_id, amount, kind, reference)
    values (p_user_id, p_amount, p_kind, p_reference)
    on conflict (reference) where kind = 'purchase' do nothing
    returning id into v_id;
  elsif p_kind = 'referral_bonus' then
    insert into public.coin_ledger (user_id, amount, kind, reference)
    values (p_user_id, p_amount, p_kind, p_reference)
    on conflict (reference) where kind = 'referral_bonus' do nothing
    returning id into v_id;
  else
    insert into public.coin_ledger (user_id, amount, kind, reference)
    values (p_user_id, p_amount, p_kind, p_reference)
    returning id into v_id;
  end if;

  return v_id; -- null means this reference was already granted; caller treats as success
end;
$$;

revoke all on function public.grant_coins from public, anon, authenticated;
grant execute on function public.grant_coins(uuid, int, text, text) to service_role;
