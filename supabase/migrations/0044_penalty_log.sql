-- =============================================================================
-- 0044_penalty_log.sql
--
-- French's penalty EVENTS (who got +10 and why: board-pass, triple-pass,
-- no-double-to-pose) were never given a column of their own, unlike the
-- numeric running total in `penalties` (0035). HandState.penaltyLog only
-- ever lived in one Edge Function invocation's memory — the very next
-- play-move call rehydrates HandState from this row via toState(), which
-- never set penaltyLog at all, so it silently reset to empty on every move
-- after the one that earned it. `penalties` (the numbers) survived because
-- it has real column round-tripping it; `penaltyLog` (the reasons) did not,
-- so a real, already-scored +10 reached hand-end with no record of who
-- earned it or why. Found live 2026-08-23: a hand's stored result showed
-- `penalties: [0,10,0,0]` but `penaltyLog: []` — the exact symptom, and the
-- reason a genuine board-pass penalty could show up in a player's score with
-- the "Penalties this hand" explanation panel rendering nothing at all.
-- =============================================================================

alter table public.hands add column penalty_log jsonb not null default '[]';

drop function if exists public.commit_move(
  uuid, int, jsonb, jsonb, jsonb, smallint, smallint, jsonb, text, jsonb, timestamptz, int[]
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
  p_penalties int[] default '{}',
  -- Defaulted for the same rollout-ordering reason p_penalties was in 0035:
  -- an old, not-yet-redeployed caller keeps writing '[]' until it catches up,
  -- never a hard failure the instant this migration lands.
  p_penalty_log jsonb default '[]'
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
      penalty_log = p_penalty_log,
      version = version + 1
  where id = p_hand_id
    and version = p_expected_version
    and status = 'active'
  returning version;
$$;

revoke all on function public.commit_move from public, anon, authenticated;
grant execute on function public.commit_move(
  uuid, int, jsonb, jsonb, jsonb, smallint, smallint, jsonb, text, jsonb, timestamptz, int[], jsonb
) to service_role;
