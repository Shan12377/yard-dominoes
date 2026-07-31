-- =============================================================================
-- 0021_coin_economy.sql
--
-- Coins: never cash out. Money in, utility only — the partner was explicit:
-- "it's not gambling because you're not getting any real money, you're not
-- taking it out." That single rule is what keeps this out of a licensing
-- regime, and it is load-bearing (docs/superpowers/plans/
-- 2026-07-29-partner-feedback-roadmap.md, "Settled decisions"). Nothing in
-- this schema, and nothing that is ever built on top of it, may convert a
-- coin back into money.
--
-- Scope of this migration, decided 2026-07-31: the wallet/ledger/spend/
-- refund infrastructure and player-to-player gifting. Deliberately NOT
-- included — the paid re-shuffle (open product decision: is 2-coin
-- pay-to-win something Dr. Hunter wants to ship at all, and it contradicts
-- a current Terms sentence until she decides) and a "playback" spend (the
-- share-link hand replay already shipped free and public; retrofitting a
-- paywall onto something already public is a product reversal, not an
-- engineering call). Both can spend through the same grant_coins/
-- spend_coins primitives here whenever they're actually decided — nothing
-- about this schema needs to change to add them later.
--
-- A LEDGER, NOT A COUNTER. Every grant, spend and transfer is a row; the
-- balance is always derived, never stored. A stored balance column is
-- exactly the kind of thing that drifts from reality under a bug or a race,
-- and "why did my coins vanish" has to be answerable from an audit trail,
-- not from a single number's word for it.
-- =============================================================================

create table public.coin_ledger (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles(id),
  -- Positive = credit (purchase, refund, gift received). Negative = debit
  -- (spend, gift sent). Never zero — a zero-amount row is not an event.
  amount        int not null check (amount <> 0),
  kind          text not null check (
                  kind in ('purchase', 'refund', 'adjustment', 'spend', 'gift_sent', 'gift_received')
                ),
  -- For a purchase/refund: the Stripe checkout session id, which is what
  -- makes a duplicated webhook delivery a no-op instead of a double grant —
  -- same role as payments.stripe_session_id, just scoped to this table.
  -- For gift_received: the gift_sent row's own id, so a transfer can be
  -- traced both directions without a join table.
  reference     text,
  -- The other party to a gift. Null for every other kind.
  related_user_id uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);

create index coin_ledger_user_idx on public.coin_ledger(user_id, created_at desc);

-- The idempotency guarantee: two deliveries of the same checkout.session.completed
-- (Stripe retries on any non-2xx) can only ever produce one purchase row.
create unique index coin_ledger_purchase_ref_idx
  on public.coin_ledger(reference) where kind = 'purchase';

alter table public.coin_ledger enable row level security;

create policy "you read only your own ledger"
  on public.coin_ledger for select using (user_id = auth.uid());

-- Deliberately no insert/update/delete policy for anon or authenticated, at
-- all. Every write goes through a security-definer function below, called
-- only from a service-role Edge Function that has independently verified
-- the caller's identity from their JWT. A client that could insert its own
-- ledger row could name its own balance — the one thing the roadmap doc
-- calls out by name as the thing that must never be possible here.

create or replace function public.coin_balance(p_user_id uuid)
returns bigint language sql stable as $$
  select coalesce(sum(amount), 0)::bigint from public.coin_ledger where user_id = p_user_id;
$$;

-- ---------------------------------------------------------------------------
-- grant_coins — purchase or refund credit. Idempotent on (kind='purchase',
-- reference) via the unique index above: a retried Stripe delivery calls this
-- again with the same session id and silently does nothing the second time.
-- ---------------------------------------------------------------------------
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
  if p_kind not in ('purchase', 'refund', 'adjustment') then
    raise exception 'grant_coins kind must be purchase, refund or adjustment';
  end if;

  insert into public.coin_ledger (user_id, amount, kind, reference)
  values (p_user_id, p_amount, p_kind, p_reference)
  on conflict (reference) where kind = 'purchase' do nothing
  returning id into v_id;

  return v_id; -- null means this reference was already granted; caller treats as success
end;
$$;

revoke all on function public.grant_coins from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- spend_coins — atomic debit for a service (virtual beer, a future
-- shuffle, anything else that costs coins but is not a transfer to another
-- player). pg_advisory_xact_lock serializes concurrent spends/gifts for the
-- SAME user for the life of the transaction, so two requests racing on a
-- balance of exactly `amount` cannot both succeed — the balance itself is
-- always re-read from the ledger here, never accepted as a parameter, which
-- is the "signed check on every debit" the wallet exists to guarantee.
-- ---------------------------------------------------------------------------
create or replace function public.spend_coins(
  p_user_id   uuid,
  p_amount    int,
  p_kind      text,
  p_reference text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_balance bigint;
  v_id bigint;
begin
  if p_amount <= 0 then
    raise exception 'spend_coins amount must be positive';
  end if;
  if p_kind <> 'spend' then
    raise exception 'spend_coins kind must be spend';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  select coalesce(sum(amount), 0) into v_balance from public.coin_ledger where user_id = p_user_id;
  if v_balance < p_amount then
    raise exception 'insufficient coins';
  end if;

  insert into public.coin_ledger (user_id, amount, kind, reference)
  values (p_user_id, -p_amount, 'spend', p_reference)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.spend_coins from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- gift_coins — atomic transfer between two players. "Pure social flex" per
-- the roadmap doc; the floor exists to keep it a gesture, not a spam vector.
-- MIN_GIFT_COINS is mirrored as a named constant in apps/web/src/lounges.ts
-- for client-side UX only — THIS is the enforced copy. Change both together.
-- ---------------------------------------------------------------------------
create or replace function public.gift_coins(
  p_from_user_id uuid,
  p_to_user_id   uuid,
  p_amount       int
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_balance bigint;
  v_sent_id bigint;
begin
  if p_from_user_id = p_to_user_id then
    raise exception 'cannot gift coins to yourself';
  end if;
  if p_amount < 20 then
    raise exception 'gifts must be at least 20 coins';
  end if;
  if not exists (select 1 from public.profiles where id = p_to_user_id) then
    raise exception 'no such player';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_from_user_id::text));

  select coalesce(sum(amount), 0) into v_balance from public.coin_ledger where user_id = p_from_user_id;
  if v_balance < p_amount then
    raise exception 'insufficient coins';
  end if;

  insert into public.coin_ledger (user_id, amount, kind, related_user_id)
  values (p_from_user_id, -p_amount, 'gift_sent', p_to_user_id)
  returning id into v_sent_id;

  insert into public.coin_ledger (user_id, amount, kind, related_user_id, reference)
  values (p_to_user_id, p_amount, 'gift_received', p_from_user_id, v_sent_id::text);

  return v_sent_id;
end;
$$;

revoke all on function public.gift_coins from public, anon, authenticated;
