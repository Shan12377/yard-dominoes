-- =============================================================================
-- 0057_tournament_couples.sql
--
-- The couple's tourney, the second of JamDom's themed events. Two people enter
-- together and sit as partners against another couple.
--
-- A pair is recorded as two ordinary signup rows that name each other, rather
-- than as a separate "pairs" table. Both people have to enter the tournament in
-- their own right anyway — they each hold a place in the queue, each get a
-- standing, each can withdraw — so a second table would duplicate all of that
-- to express one nullable reference. `drawCouples` only seats a pair when both
-- rows point at each other, which makes confirmation fall out of the data
-- rather than needing a status column to track.
-- =============================================================================

alter table public.tournament_signups
  add column partner_user_id uuid references public.profiles(id) on delete set null;

-- Naming yourself is not a couple. Cheap to state here, and it means neither
-- the Edge Function nor the draw has to treat self-pairing as a special case.
alter table public.tournament_signups
  add constraint partner_is_not_self check (partner_user_id is null or partner_user_id <> user_id);

comment on column public.tournament_signups.partner_user_id is
  'Who this player entered WITH, for the couples theme. A pair is seated only '
  'when both rows name each other — see drawCouples in tournament-queue.ts. '
  'Null for every other theme; nobody is asked for a partner to enter one.';

alter table public.tournaments
  drop constraint theme_is_known;

alter table public.tournaments
  add constraint theme_is_known
    check (theme in ('open', 'battle_of_the_sexes', 'couples'));

-- Couples is two-against-two, same as battle of the sexes: partners must land
-- opposite each other, which only happens at a four-handed partner table.
alter table public.tournaments
  add constraint couples_is_partner_four
    check (theme <> 'couples' or (mode = 'partner' and seat_count = 4));
