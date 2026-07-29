-- =============================================================================
-- 0015_tournaments.sql
--
-- Sunday tournaments, v1: the version a human host runs by hand.
--
-- Deliberately NOT here: a bracket generator, auto-advance from
-- `sets.winner_side`, seeding by rating, or a recurrence scheduler. The results
-- already live in `sets`, so auto-advance is cheap to add after one real Sunday
-- has shown which assumptions were wrong. See
-- docs/superpowers/plans/2026-07-29-tournaments-debrief.md §1.
--
-- -----------------------------------------------------------------------------
-- `tables.tournament` IS NOT A TOURNAMENT.
--
-- That column has existed since 0001 and it is a RULES FLAG: it means the
-- double-six must actually be LED, not merely held. It feeds
-- `poseMustBeDoubleSix` in the engine and shows in the UI as "Tournament — must
-- lead the six". It is a property of how one table plays.
--
-- A tournament EVENT — a Sunday, a sign-up list, rounds — is the new thing
-- here. The entire relationship between them is that an event sets
-- `tables.tournament = true` on the tables it opens. Nothing else in this file
-- is named `tournament` on its own.
--
-- -----------------------------------------------------------------------------
-- GRANTS: READ THIS BEFORE ADDING ANY TABLE OR COLUMN BELOW.
--
-- `pg_default_acl` in this project grants anon and authenticated `arwdDxtm` —
-- select, insert, update, delete — on EVERY table created in `public`,
-- automatically, at creation time. 0006 set that default and it is still live;
-- confirmed by reading `pg_default_acl` on production before writing this file.
--
-- So `create table` here does not produce a locked-down table that policies
-- then open up. It produces a fully client-writable table with only RLS holding
-- it shut — the exact shape of the free-VIP hole 0012 had to close and the
-- infinite-clock hole 0013 pre-empted. Both new tables therefore REVOKE first
-- and grant SELECT back by hand.
--
-- There is no client write path to either table. Signing up, withdrawing, and
-- every host action go through Edge Functions under service_role, the same rule
-- as invariant 2 in CLAUDE.md applied to the queue instead of the hand.
-- =============================================================================

create type public.tournament_status as enum (
  'announced',     -- on the calendar; sign-ups not open yet
  'signups_open',
  'seating',       -- sign-ups closed, host is drawing the tables
  'running',
  'finished',
  'cancelled'
);

create type public.signup_status as enum (
  'signed_up',
  'seated',        -- above the cut line, has a table
  'substitute',    -- below the cut line — this is a sold VIP benefit, not waste
  'out',           -- withdrew, or did not turn up
  'disqualified'   -- host penalty, THIS EVENT ONLY. See the note on the column.
);

-- ------------------------------------------------------------- tournaments --
create table public.tournaments (
  id              uuid primary key default gen_random_uuid(),
  lounge_id       uuid references public.lounges(id),
  name            text not null check (char_length(name) between 2 and 80),
  mode            public.game_mode not null,
  format          public.set_format not null,
  seat_count      smallint not null default 4 check (seat_count between 2 and 4),
  -- Named, never numeric, exactly as create-table takes a clock name: the
  -- server owns the seconds, so nobody can schedule a ten-minute turn.
  clock           text not null default 'yard'
                    constraint clock_is_known check (clock in ('speed', 'yard', 'relaxed')),
  starts_at       timestamptz not null,
  -- Null means sign-ups are open the moment the event is announced.
  signups_open_at timestamptz,
  -- The stated shape is two rounds plus a final. Recorded because it is free to
  -- record and the host will want it on screen; v1 does not act on it, because
  -- v1 has no auto-advance — the host decides when a round is over.
  rounds          smallint not null default 3 check (rounds between 1 and 6),
  status          public.tournament_status not null default 'announced',
  -- The intercom, in one column. "Round 2 starts in five minutes" is what an
  -- intercom is actually used for, and this covers it.
  --
  -- Deliberately NOT a Realtime broadcast event: broadcast is peer-to-peer, so
  -- a patched client could claim to be the host and put words in her mouth. A
  -- column written by a host-checked Edge Function and read by everyone cannot
  -- be forged. Same reasoning that keeps every game write on the server.
  notice          text check (notice is null or char_length(notice) <= 280),
  host_id         uuid references public.profiles(id),
  created_at      timestamptz not null default now(),

  -- Partner is inherently a 4-seat, 2-vs-2 format — create-table rejects
  -- anything else, and sideOf() would split 3 seats into a nonsensical 2-vs-1.
  constraint partner_is_four_handed check (mode <> 'partner' or seat_count = 4)
);

comment on table public.tournaments is
  'A scheduled event. Created and driven by a host through Edge Functions that '
  'check profiles.is_host. Nothing in the client writes this table.';

alter table public.tournaments enable row level security;

-- Readable by everyone, including guests who cannot enter the lounge: the
-- countdown IS the advertisement.
create policy "the schedule is public"
  on public.tournaments for select using (true);

create index tournaments_upcoming_idx on public.tournaments(starts_at)
  where status in ('announced', 'signups_open', 'seating', 'running');

-- ------------------------------------------------------- tournament signups --
create table public.tournament_signups (
  tournament_id  uuid not null references public.tournaments on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  -- Server-set, always. The whole queue rests on this timestamp being honest.
  signed_up_at   timestamptz not null default now(),

  -- A SNAPSHOT, FOR DISPUTES ONLY. NEVER ORDER BY THIS.
  --
  -- The queue is ordered by effective tier at SEATING time, not at signup:
  -- somebody who joined as a guest at 9am and bought VIP at 4:30 does jump, and
  -- that moment is exactly where the upgrade sells itself. This column exists
  -- so "why was I bumped" is answerable three weeks later, and for nothing else.
  -- The ordering lives in `_shared/tournament-queue.ts` and is tested there.
  tier_at_signup public.member_tier not null,

  status         public.signup_status not null default 'signed_up',
  -- Which round this player is currently in, and the table they were drawn to.
  -- Both null until the host draws the tables.
  round          smallint check (round is null or round >= 1),
  table_id       uuid references public.tables(id) on delete set null,

  primary key (tournament_id, user_id)
);

comment on table public.tournament_signups is
  'One row per player in the queue. Written only by the tournament-signup and '
  'tournament-host Edge Functions, under service_role.';

comment on column public.tournament_signups.status is
  'disqualified strips this EVENT only. Ratings in profiles.rating_partner / '
  'rating_cutthroat are deliberately untouched — "strip a player''s runs" is '
  'ambiguous between a Sunday result and a permanent record, and the smaller '
  'blast radius is the right default while that question is open with Dr Hunter.';

alter table public.tournament_signups enable row level security;

-- The queue is public ON PURPOSE. Seeing three VIPs ahead of you is the sales
-- pitch; a private queue would sell nothing.
create policy "the queue is public"
  on public.tournament_signups for select using (true);

create index tournament_signups_queue_idx
  on public.tournament_signups(tournament_id, signed_up_at, user_id);

-- ------------------------------------------------------------- host, scoped --
-- The first notion of a privileged human in this app. Scoped so it cannot grow:
-- a boolean, no new grants, no new RLS policies, and NO new Postgres role.
-- Every host action is an Edge Function that checks this column server-side and
-- touches only `tournaments` and `tournament_signups`, so a host holds exactly
-- zero database privileges they did not already have as an ordinary player.
-- Narrow by construction rather than by discipline — a Postgres role is a thing
-- somebody widens later with one `grant`.
--
-- THERE IS DELIBERATELY NO GRANT STATEMENT FOR THIS COLUMN.
--
-- 0012 revoked blanket UPDATE on `profiles` and re-granted three columns by
-- name; 0014 spelled out all five. A new column on this table is therefore not
-- writable by `authenticated` unless it is named in a grant — and `is_host`
-- must never be, for exactly the reason `tier` never is. The failure mode is a
-- reflex "grant update (...)" added for consistency; that reflex is what would
-- let any signed-in player make themselves a host.
--
-- After applying, the writable set must still be exactly five columns:
--
--   select column_name from information_schema.column_privileges
--   where table_name = 'profiles' and grantee = 'authenticated'
--     and privilege_type = 'UPDATE';
--   -- expect: username, flag, bio, origin, gender
--
-- Hosts are made in SQL, by hand. There is no UI for it and there should not be
-- one until there is a reason:
--
--   update public.profiles set is_host = true where username = '...';
alter table public.profiles
  add column is_host boolean not null default false;

comment on column public.profiles.is_host is
  'Runs tournaments. Grants no database privilege whatsoever — every host '
  'action is an Edge Function that reads this column under service_role. Must '
  'never appear in the profiles UPDATE grant list (see 0012).';

-- ------------------------------------------------- tables join an event ----
-- A tournament match is an ordinary table. These two columns are the whole
-- difference, both nullable, so every existing row and every casual table keeps
-- meaning exactly what it meant.
--
-- `tournament_id` is NOT `tournament`. The boolean two columns to its left is
-- the double-six rule; this is which Sunday the table belongs to. An event will
-- normally set both, and they are still different things.
alter table public.tables
  add column tournament_id uuid references public.tournaments(id) on delete set null,
  add column round_no smallint
    constraint round_no_is_positive check (round_no is null or round_no >= 1),
  -- Neither half of a bracket coordinate means anything alone.
  add constraint tournament_and_round_together
    check ((tournament_id is null) = (round_no is null));

create index tables_tournament_idx
  on public.tables(tournament_id, round_no) where tournament_id is not null;

-- ---------------------------------------------------------------- privileges --
-- The revokes described at the top of this file. A plain `revoke` also takes
-- back column-level rights, so these leave anon/authenticated holding nothing
-- on either table until SELECT is granted back.
revoke all on public.tournaments from anon, authenticated;
revoke all on public.tournament_signups from anon, authenticated;

grant select on public.tournaments to anon, authenticated;
grant select on public.tournament_signups to anon, authenticated;

-- 0007 already covers service_role through its default privileges, but 0007
-- exists precisely because an assumed grant turned out to be missing and every
-- server write silently failed for a session. Say it out loud.
grant select, insert, update, delete on public.tournaments to service_role;
grant select, insert, update, delete on public.tournament_signups to service_role;

-- ---------------------------------------------------------------------------
-- Same class of bug as 0013, on the table an event now writes to.
--
-- `tables` still carries a blanket `arwdDxtm` grant to anon and authenticated
-- from 0006 (verified against production while writing this file). The only
-- thing holding it shut is the absence of an INSERT/UPDATE/DELETE policy — and
-- a table-wide grant covers columns that do not exist yet, so `tournament_id`
-- and `round_no` inherit it the moment the statement above runs. A client able
-- to write those could attach a table it made to somebody else's Sunday, or
-- move its own table into a round.
--
-- No client has ever written `tables`: create-table inserts, start-hand and
-- play-move update `status`, all as service_role, and the client only SELECTs.
-- So the grant buys nothing and costs a future "you may update your own table"
-- policy silently handing away the event. Take it away while the columns it
-- would expose are going in.
-- ---------------------------------------------------------------------------
revoke insert, update, delete on public.tables from anon, authenticated;

-- ------------------------------------------------------------------ realtime --
-- The schedule and the queue are broadcast so the countdown, the intercom
-- notice, and a player's position update without polling. Realtime respects
-- RLS, and both policies above are public select-only, so this exposes nothing
-- a client could not already read. `tables` and `seats` are already published
-- (0001), which is what carries a player onto their table.
alter publication supabase_realtime add table public.tournaments;
alter publication supabase_realtime add table public.tournament_signups;

-- --------------------------------------------------------- tournament lounge --
-- One more row in `lounges`. No new table, no new view, no new presence
-- channel: the lounge channel is already open, already synced, and already
-- carries voice, reactions, quick chat and the `table` presence field.
--
-- `min_tier` is 'guest' on purpose. The tournament is not a paid room — the
-- QUEUE is where VIP pays off. Locking guests out would delete the audience
-- that watches VIPs jump the line, which is the mechanism that sells VIP.
insert into public.lounges (slug, name, description, mode, min_tier, capacity, sort_order)
values (
  'tournament-yard',
  'Tournament Yard',
  'Sunday brackets. Sign up, watch the queue, take your seat when it is drawn.',
  null,
  'guest',
  200,
  35
);

-- =============================================================================
-- No tournament is seeded here, and no cron job is scheduled.
--
-- Sundays are the regular slot, but a host creating each week's row is thirty
-- seconds of work and zero code. pg_cron is already available (0005) if that
-- ever becomes tedious, so the door is open. It is not open yet.
--
-- The first host is made by hand:
--   update public.profiles set is_host = true where username = 'whoever';
-- =============================================================================
