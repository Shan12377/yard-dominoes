-- =============================================================================
-- 0003_concurrency.sql
--
-- Fixes a real race: two clients can call play-move at almost the same instant.
-- Both read the same hand row, both pass the "is it your turn" check against
-- that stale snapshot, and the second write silently clobbers the first — one
-- player's tile vanishes from the board.
--
-- The turn check alone cannot prevent this, because the check and the write are
-- separate round trips. A version column makes the write itself conditional:
-- the update only lands if nobody has moved since we read.
-- =============================================================================

alter table public.hands add column version int not null default 0;

/**
 * Apply a validated move. Returns the new version, or NULL when the row moved
 * underneath us — in which case the caller must reload and retry.
 *
 * The Edge Function still does all rules validation; this only guarantees that
 * two concurrent writers cannot both win.
 */
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
  p_expires timestamptz
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
      version = version + 1
  where id = p_hand_id
    and version = p_expected_version
    and status = 'active'
  returning version;
$$;

revoke all on function public.commit_move from public, anon, authenticated;
