-- =============================================================================
-- 0035_french_penalties.sql
--
-- French's pass penalties (+10 for a seat's own third real pass in a row,
-- +10 to every seat a board-blocking play just shut out) accrue mid-hand,
-- across several separate play-move calls — each one a fresh server request
-- that rehydrates HandState from this row, applies ONE move, and writes back.
-- Without a column to round-trip them through, every penalty already earned
-- would be silently lost on the very next move. Every other format leaves
-- this at all zeros; nothing outside the French scoring path reads it.
-- =============================================================================

alter table public.hands add column penalties int[] not null default '{}';

-- `create or replace` only replaces a function whose signature matches
-- exactly — a changed argument list creates a second, OVERLOADED
-- commit_move instead of replacing the original, leaving a stale
-- 11-argument version still callable. Drop it explicitly first.
drop function if exists public.commit_move(
  uuid, int, jsonb, jsonb, jsonb, smallint, smallint, jsonb, text, jsonb, timestamptz
);

create or replace function public.commit_move(
  p_hand_id uuid,
  p_expected_version int,
  p_hands jsonb,
  p_boneyard jsonb,
  p_board jsonb,
  p_turn smallint,
  p_passes smallint,
  p_move_log jsonb,
  p_status text,
  p_result jsonb,
  p_expires timestamptz,
  -- Defaulted, not required: every currently-deployed caller (start-hand,
  -- play-move, expire-turns, at the moment this migration lands) still
  -- calls the OLD 11-argument shape until each is redeployed. Without a
  -- default here, the very first real move after this migration applies
  -- would 404 against a signature nothing currently calls, breaking every
  -- live table until every function is redeployed in the same instant —
  -- not achievable through this deploy pipeline. The default makes the
  -- rollout order-independent: an old caller keeps writing '{}' (no
  -- penalties tracked yet) until it's redeployed, never a hard failure.
  p_penalties int[] default '{}'
) returns int
language sql security definer set search_path = public as $$
  update public.hands
  set hands = p_hands,
      boneyard = p_boneyard,
      board = p_board,
      turn = p_turn,
      consecutive_passes = p_passes,
      move_log = p_move_log,
      status = p_status,
      result = p_result,
      turn_expires_at = p_expires,
      penalties = p_penalties,
      version = version + 1
  where id = p_hand_id
    and version = p_expected_version
    and status = 'active'
  returning version;
$$;

revoke all on function public.commit_move from public, anon, authenticated;
grant execute on function public.commit_move(
  uuid, int, jsonb, jsonb, jsonb, smallint, smallint, jsonb, text, jsonb, timestamptz, int[]
) to service_role;
