-- Leaving a playing table drops a player to a duppy fill-in (leave-seat),
-- but join-table refuses everyone once a table is past 'waiting' — including
-- the very player who just stepped away for a moment. These two columns let
-- join-table recognize "this duppy seat is standing in for someone who left
-- seconds ago" and hand it straight back to them, without opening the seat
-- to a stranger.

alter table public.seats add column left_by_user_id uuid references public.profiles(id);
alter table public.seats add column left_at timestamptz;
