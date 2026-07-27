-- =============================================================================
-- Yard — Jamaican Dominoes
-- 0001_init.sql
--
-- SECURITY MODEL, in one sentence: clients may never write to a game table,
-- and may never read a row containing another player's tiles.
--
-- That is enforced by splitting hand state across three tables:
--
--   hands        full truth, including every seat's tiles and the unrevealed
--                server seed. NO client policy at all — service role only.
--   hand_public  the redacted view every seat is allowed to see. Broadcast
--                over Realtime.
--   seat_hands   one row per seat holding that seat's tiles, readable only by
--                the user who owns it.
--
-- Because clients hold no write permission, tile duplication and phantom-turn
-- cheating are not merely discouraged — they are inexpressible.
-- =============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- profiles --
create table public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  username     text unique not null check (char_length(username) between 2 and 24),
  flag         text,                       -- territory code, e.g. 'jm', 'tt'
  created_at   timestamptz not null default now(),
  rating_partner   int not null default 1200,
  rating_cutthroat int not null default 1200,
  hands_played int not null default 0,
  six_loves_given int not null default 0,
  six_loves_taken int not null default 0,
  abandons     int not null default 0
);

alter table public.profiles enable row level security;

create policy "profiles are readable by everyone"
  on public.profiles for select using (true);

create policy "you may edit only your own profile"
  on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- ------------------------------------------------------------------ tables --
create type public.game_mode   as enum ('cutthroat', 'partner');
create type public.set_format  as enum ('sixlove', 'firstToSix', 'single');
create type public.table_status as enum ('waiting', 'playing', 'finished', 'abandoned');

create table public.tables (
  id           uuid primary key default gen_random_uuid(),
  join_code    text unique not null,
  mode         public.game_mode not null,
  format       public.set_format not null,
  seat_count   smallint not null check (seat_count between 2 and 4),
  tournament   boolean not null default false,
  one_all_play_two boolean not null default true,
  use_boneyard boolean not null default false,
  is_private   boolean not null default false,
  status       public.table_status not null default 'waiting',
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  turn_seconds smallint not null default 30
);

alter table public.tables enable row level security;

-- ------------------------------------------------------------------- seats --
create table public.seats (
  table_id     uuid not null references public.tables on delete cascade,
  seat_index   smallint not null check (seat_index between 0 and 3),
  user_id      uuid references public.profiles(id),
  duppy_level  text check (duppy_level in ('pickney','yard','ranker','don','general')),
  connected_at timestamptz,
  primary key (table_id, seat_index),
  -- a seat is either a person or a duppy, never both and never neither
  constraint seat_is_person_or_duppy
    check ((user_id is null) <> (duppy_level is null))
);

alter table public.seats enable row level security;

create policy "seats at a table you can see are visible"
  on public.seats for select
  using (exists (select 1 from public.tables t where t.id = table_id));

create index seats_user_idx on public.seats(user_id);

-- `tables` policy references `seats`, so it is declared after seats exists.
create policy "public tables are listable; private ones need the code"
  on public.tables for select
  using (
    not is_private
    or exists (select 1 from public.seats s where s.table_id = id and s.user_id = auth.uid())
  );

-- -------------------------------------------------------------------- sets --
create table public.sets (
  id           uuid primary key default gen_random_uuid(),
  table_id     uuid not null references public.tables on delete cascade,
  scores       int[] not null,
  hand_value   smallint not null default 1,
  poser        smallint not null default 0,
  pose_must_be_double_six boolean not null default true,
  playoff      boolean not null default false,
  hands_played int not null default 0,
  winner_side  smallint,
  six_love     boolean not null default false,
  created_at   timestamptz not null default now()
);

alter table public.sets enable row level security;

create policy "sets are visible to anyone who can see the table"
  on public.sets for select
  using (exists (select 1 from public.tables t where t.id = table_id));

-- ------------------------------------------------------------------- hands --
-- FULL TRUTH. No client policy is defined, and RLS is on, so with RLS enabled
-- and zero policies every client SELECT returns nothing. Service role bypasses
-- RLS and is the only thing that ever touches this table.
create table public.hands (
  id           uuid primary key default gen_random_uuid(),
  set_id       uuid not null references public.sets on delete cascade,
  hand_no      int not null,
  commitment   text not null,              -- SHA-256(server_seed), published up front
  server_seed  text,                       -- NULL until the hand is over
  client_seeds text[] not null,
  deal         jsonb not null,             -- the dealt hands, for the Coach
  hands        jsonb not null,             -- live tiles per seat
  boneyard     jsonb not null default '[]',
  board        jsonb,
  turn         smallint not null,
  consecutive_passes smallint not null default 0,
  move_log     jsonb not null default '[]',
  status       text not null default 'active',
  result       jsonb,
  poser        smallint not null,
  pose_must_be_double_six boolean not null default false,
  turn_expires_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (set_id, hand_no)
);

alter table public.hands enable row level security;
-- deliberately no policies

-- ------------------------------------------------------------- hand_public --
-- What players are allowed to see. Realtime broadcasts this.
create table public.hand_public (
  hand_id      uuid primary key references public.hands on delete cascade,
  table_id     uuid not null references public.tables on delete cascade,
  set_id       uuid not null references public.sets on delete cascade,
  commitment   text not null,
  server_seed  text,                       -- populated only once the hand ends
  board        jsonb,
  turn         smallint not null,
  hand_sizes   int[] not null,
  boneyard_size int not null default 0,
  move_log     jsonb not null default '[]',
  status       text not null default 'active',
  result       jsonb,
  turn_expires_at timestamptz,
  updated_at   timestamptz not null default now()
);

alter table public.hand_public enable row level security;

create policy "seated players may watch the public state"
  on public.hand_public for select
  using (
    exists (
      select 1 from public.seats s
      where s.table_id = hand_public.table_id and s.user_id = auth.uid()
    )
    or exists (select 1 from public.tables t where t.id = table_id and not t.is_private)
  );

-- -------------------------------------------------------------- seat_hands --
-- Your tiles, and nobody else's.
create table public.seat_hands (
  hand_id    uuid not null references public.hands on delete cascade,
  seat_index smallint not null,
  user_id    uuid references public.profiles(id),
  tiles      jsonb not null,
  primary key (hand_id, seat_index)
);

alter table public.seat_hands enable row level security;

create policy "you may read only your own tiles"
  on public.seat_hands for select
  using (user_id is not null and user_id = auth.uid());

create index seat_hands_user_idx on public.seat_hands(user_id);

-- ------------------------------------------------------------- fairness log --
create table public.verifications (
  id         uuid primary key default gen_random_uuid(),
  hand_id    uuid not null references public.hands on delete cascade,
  user_id    uuid references public.profiles(id),
  ok         boolean not null,
  reason     text,
  created_at timestamptz not null default now()
);

alter table public.verifications enable row level security;

create policy "anyone may read verification history"
  on public.verifications for select using (true);

-- --------------------------------------------------------------- the coach --
create table public.hand_reviews (
  id         uuid primary key default gen_random_uuid(),
  hand_id    uuid not null references public.hands on delete cascade,
  user_id    uuid not null references public.profiles(id),
  seat_index smallint not null,
  review     jsonb not null,
  accuracy   smallint not null,
  created_at timestamptz not null default now(),
  unique (hand_id, user_id)
);

alter table public.hand_reviews enable row level security;

create policy "you may read your own reviews"
  on public.hand_reviews for select using (user_id = auth.uid());

-- ------------------------------------------------------------------ academy --
create table public.academy_progress (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  belt_id     text not null,
  lessons_done text[] not null default '{}',
  drills_done  jsonb not null default '{}',
  exam_passed  boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (user_id, belt_id)
);

alter table public.academy_progress enable row level security;

create policy "your progress is yours"
  on public.academy_progress for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ------------------------------------------------------------------ reports --
create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id),
  reported_id uuid not null references public.profiles(id),
  table_id    uuid references public.tables on delete set null,
  reason      text not null,
  created_at  timestamptz not null default now()
);

alter table public.reports enable row level security;

create policy "you may file a report"
  on public.reports for insert with check (reporter_id = auth.uid());

create policy "you may read reports you filed"
  on public.reports for select using (reporter_id = auth.uid());

-- ---------------------------------------------------------------- realtime --
-- Only the redacted tables are ever broadcast. `hands` is not in the
-- publication, so the full truth never leaves the server.
alter publication supabase_realtime add table public.hand_public;
alter publication supabase_realtime add table public.seat_hands;
alter publication supabase_realtime add table public.sets;
alter publication supabase_realtime add table public.seats;
alter publication supabase_realtime add table public.tables;

-- --------------------------------------------------------------- join codes --
create or replace function public.generate_join_code() returns text
language plpgsql as $$
declare
  -- no O/0/I/1 — these get read aloud across a room
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text := '';
  i int;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, floor(random() * length(alphabet) + 1)::int, 1);
    end loop;
    exit when not exists (select 1 from public.tables t where t.join_code = code);
  end loop;
  return code;
end;
$$;

-- ------------------------------------------------------------ profile hook --
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, 'player_' || substr(new.id::text, 1, 8))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------- turn expiry --
-- Serverless has no long-lived timers, so a scheduled job retires stale turns.
-- Requires pg_cron; the Edge Function does the actual move.
create index hands_expiry_idx on public.hands(turn_expires_at)
  where status = 'active';
