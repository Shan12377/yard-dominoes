-- =============================================================================
-- 0002_lounges_tiers.sql
--
-- The JamDom answer: lounges as persistent social places, membership tiers
-- paid through Stripe, per-style rankings, and speed tracking.
--
-- Tier philosophy (deliberately different from JamDom): the GAME is free.
-- JamDom puts a paywall in front of basic play and bounces every curious new
-- player; we charge for the social layer, which is what their own VIPs say
-- they value ("enter full lounges", "bredrins list", "private messages").
-- =============================================================================

-- ------------------------------------------------------------------- tiers --
create type public.member_tier as enum ('guest', 'yardie', 'vip');

alter table public.profiles
  add column tier public.member_tier not null default 'guest',
  add column tier_expires_at timestamptz,
  add column stripe_customer_id text,
  -- Per-move speed, JamDom-style. Averages are computed, never stored raw.
  add column total_move_ms bigint not null default 0,
  add column total_moves int not null default 0,
  -- Per-style ratings beyond the two base modes (across/french arrive later).
  add column bio text check (char_length(bio) <= 280);

create or replace function public.effective_tier(p public.profiles)
returns public.member_tier language sql stable as $$
  select case
    when p.tier = 'guest' then 'guest'::public.member_tier
    when p.tier_expires_at is null or p.tier_expires_at > now() then p.tier
    else 'guest'::public.member_tier
  end
$$;

-- ----------------------------------------------------------------- lounges --
create table public.lounges (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  name         text not null,
  description  text,
  mode         public.game_mode,           -- null = any mode welcome
  min_tier     public.member_tier not null default 'guest',
  capacity     int not null default 40,    -- soft cap; VIPs bypass (JamDom's
                                           -- single most-praised paid feature)
  sort_order   int not null default 100,
  created_at   timestamptz not null default now()
);

alter table public.lounges enable row level security;

create policy "lounges are listable by everyone"
  on public.lounges for select using (true);

-- Seats-at-tables already exist; a table can now live inside a lounge.
alter table public.tables add column lounge_id uuid references public.lounges(id);
create index tables_lounge_idx on public.tables(lounge_id) where status <> 'finished';

-- ---------------------------------------------------------------- presence --
-- Live "who's in the room" runs over Realtime channel presence (ephemeral, no
-- rows). This table is the durable trace: last-seen, for bredrins lists.
create table public.lounge_visits (
  lounge_id  uuid not null references public.lounges on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  last_seen  timestamptz not null default now(),
  primary key (lounge_id, user_id)
);

alter table public.lounge_visits enable row level security;

create policy "visits are readable by everyone"
  on public.lounge_visits for select using (true);

create policy "you record only your own visit"
  on public.lounge_visits for insert with check (user_id = auth.uid());

create policy "you update only your own visit"
  on public.lounge_visits for update using (user_id = auth.uid());

-- -------------------------------------------------------------------- chat --
create table public.lounge_messages (
  id         bigint generated always as identity primary key,
  lounge_id  uuid not null references public.lounges on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index lounge_messages_idx on public.lounge_messages(lounge_id, created_at desc);

alter table public.lounge_messages enable row level security;

create policy "lounge chat is readable if you can enter the lounge"
  on public.lounge_messages for select
  using (
    exists (
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

create policy "you speak as yourself, in lounges you can enter"
  on public.lounge_messages for insert
  with check (
    user_id = auth.uid()
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

-- ---------------------------------------------------------------- bredrins --
-- JamDom's most-loved VIP feature: know where your friends are.
create table public.bredrins (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  bredrin_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, bredrin_id),
  check (user_id <> bredrin_id)
);

alter table public.bredrins enable row level security;

create policy "your list is yours"
  on public.bredrins for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------- payments --
-- Written by the stripe-webhook function only. No client policy at all.
create table public.payments (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id),
  stripe_session_id text unique not null,
  tier              public.member_tier not null,
  amount_cents      int not null,
  currency          text not null default 'usd',
  created_at        timestamptz not null default now()
);

alter table public.payments enable row level security;

create policy "you can read your own payment history"
  on public.payments for select using (user_id = auth.uid());

-- ---------------------------------------------------------------- realtime --
alter publication supabase_realtime add table public.lounge_messages;
alter publication supabase_realtime add table public.lounge_visits;

-- ------------------------------------------------------------ seed lounges --
insert into public.lounges (slug, name, description, mode, min_tier, capacity, sort_order) values
  ('yard-gate',    'Yard Gate',        'Everybody welcome. Learn, lime, look for a four.',       null,        'guest',  60, 10),
  ('cut-yard',     'Cut Throat Yard',  'Every tub on its own bottom. First to six.',             'cutthroat', 'guest',  40, 20),
  ('partners-arena','Partners Arena',  'The tournament game. Six love or nothing.',              'partner',   'guest',  40, 30),
  ('rankers-row',  'Rankers Row',      'Ranked play for members. Your points live here.',        null,        'yardie', 40, 40),
  ('red-carpet',   'Red Carpet',       'VIP only. Never full for you.',                          null,        'vip',    999, 50);

-- ------------------------------------------------------------- speed stats --
create or replace function public.record_move_speed(p_user uuid, p_ms int)
returns void language sql security definer set search_path = public as $$
  update public.profiles
  set total_move_ms = total_move_ms + p_ms,
      total_moves = total_moves + 1
  where id = p_user;
$$;
