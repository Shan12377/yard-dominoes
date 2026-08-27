-- =============================================================================
-- 0046_feedback_rating.sql
--
-- Feedback gains an optional star rating (1-5) alongside the free-text
-- message. Nullable: older rows and anyone who skips the stars still send
-- valid feedback. No RLS change needed — 0034's insert/select policies
-- already cover the whole row, not named columns.
-- =============================================================================

alter table public.feedback
  add column rating smallint check (rating between 1 and 5);
