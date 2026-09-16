-- Rooms are sorted by the one choice a player makes: which game.
--
-- Owner, 2026-09-16. The five rooms mixed two ideas — two by game, one for any
-- game, two by membership — and a room's game was only a label: its table
-- form offered all five games and the server enforced none, so every door
-- looked like it led anywhere. "Rankers Row" also promised ranking that
-- actually counts at every table.
--
--   Yard Gate           the welcome room, any game
--   Cut Throat Yard     cut throat
--   Partners Arena      partner (six love)
--   French Yard         French
--   Across & Open Hand  across, open hand
--   Tournament Yard     Sunday brackets (unchanged; the host picks the game)
--   Red Carpet          VIP only, any game
--
-- `games` lists what a room plays (null = any), in the table form's own keys:
-- 'cutthroat', 'partner', 'openhand', 'across', 'french' (French is a format
-- under cut throat, so it needs its own key). create-table enforces it.
-- Rankers Row is retired, not deleted: its old tables and chat keep their
-- lounge_id, and nobody is shown the room.

alter table public.lounges add column if not exists games text[];
alter table public.lounges add column if not exists retired boolean not null default false;

update public.lounges set
  games = null,
  description = 'The welcome room. Everybody welcome — learn the game, meet people, look for a four.',
  sort_order = 10
where slug = 'yard-gate';

update public.lounges set
  games = array['cutthroat'],
  description = 'Cut throat. Every tub on its own bottom.',
  sort_order = 20
where slug = 'cut-yard';

update public.lounges set
  games = array['partner'],
  description = 'Partner. Two against two, six love.',
  sort_order = 30
where slug = 'partners-arena';

insert into public.lounges (slug, name, description, mode, min_tier, capacity, sort_order, games) values
  ('french-yard', 'French Yard', 'French. Race to 100 — the lowest score wins.', null, 'guest', 40, 35, array['french']),
  ('across-yard', 'Across & Open Hand', 'Across and open hand. Partner games with the tiles in view.', null, 'guest', 40, 38, array['across', 'openhand'])
on conflict (slug) do nothing;

-- The Sunday-bracket event room (0015) stays: its host decides each event's
-- game, so it plays any. Listed after the game rooms.
update public.lounges set
  games = null,
  sort_order = 45
where slug = 'tournament-yard';

update public.lounges set retired = true where slug = 'rankers-row';

update public.lounges set
  games = null,
  description = 'VIP only. Every game, and never full for you.',
  sort_order = 50
where slug = 'red-carpet';
