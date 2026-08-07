-- "Lime" reads as unexplained slang to a lot of players signing up outside
-- Jamaica — swap it for plain wording that says the same thing.
update public.lounges
set description = 'Everybody welcome. Learn the game, meet people, look for a four.'
where slug = 'yard-gate';
