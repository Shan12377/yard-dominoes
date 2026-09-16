-- Yard Gate's welcome text without "lime" (owner, 2026-09-16: "i dont use the
-- word lime"). 0039 had already taken it out; 0063 put it back by mistake.
-- Same plain wording 0039 chose, now that this is the welcome room.
update public.lounges
set description = 'The welcome room. Everybody welcome — learn the game, meet people, look for a four.'
where slug = 'yard-gate';
