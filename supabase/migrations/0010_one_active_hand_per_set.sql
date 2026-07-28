-- =============================================================================
-- 0010_one_active_hand_per_set.sql
--
-- start-hand's own idempotency check (an active-hand lookup before inserting)
-- closes the common double-tap case, but a JS-level check-then-insert still
-- has a race window under real concurrency. This partial unique index makes
-- "at most one active hand per set" a database-enforced fact, not just an
-- application-level convention — the second concurrent insert fails outright
-- rather than silently succeeding.
-- =============================================================================

create unique index if not exists hands_one_active_per_set
  on public.hands (set_id)
  where status = 'active';
