-- =============================================================================
-- 0065_seat_takeover.sql
--
-- A seat someone left can go to a real person waiting in the Lounge.
--
-- Owner, 2026-09-17: when a player leaves mid-game a duppy keeps the game
-- going and holds the seat for the leaver for five minutes (0053's rejoin
-- window). After that, anyone may take the seat. They never take over half a
-- hand: during a hand the seat is booked (`claim_user_id`), and start-hand
-- seats them as the next hand is dealt. Between hands they sit straight away.
-- They inherit the seat's score, since scores live on `sets`, so nobody's
-- points move. Tournament tables keep their own substitutes line.
--
-- Written only by Edge Functions (service role); clients read it through the
-- existing seats select policy, which is what lets the Lounge list show
-- "seat open" and the table tell a booked player they are up next hand.
-- =============================================================================

alter table public.seats add column if not exists claim_user_id uuid references public.profiles(id);
alter table public.seats add column if not exists claimed_at timestamptz;
