-- =============================================================================
-- 0041_across.sql
--
-- Across: partner's exact ruleset (six-love/first-to-six, same scoring, same
-- pass-the-pose), played by two real people instead of four. Each of the two
-- signs into BOTH seats of one side (0&2 or 1&3) and plays each in its own
-- turn — never back-to-back, same anti-clockwise rotation partner already
-- uses. Rules confirmed against a real Jamaican-consultant transcript, per
-- CLAUDE.md's "do not invent Across rules without one."
--
-- Everything about hand visibility falls out of the EXISTING seat_hands
-- policy with zero changes: `user_id = auth.uid()` already returns both of
-- a two-seated player's rows, because seat_hands.user_id is populated
-- straight from seats.user_id at deal time (persist() in _shared/lib.ts) —
-- an across player's two seats both carry their own id, unlike openhand
-- where a special policy was needed to read a row that belongs to someone
-- else's account. No RLS change in this migration for that reason.
-- =============================================================================

alter type public.game_mode add value if not exists 'across';
