-- =============================================================================
-- 0049_referral_code_owner_unique.sql
--
-- referrals/index.ts's 'become' action checks for an existing code, then
-- inserts one if none exists — a check-then-insert with nothing at the
-- database level stopping two concurrent calls (a double-click, two tabs)
-- from both passing the check and both inserting, leaving one player with
-- two referral_codes rows. Flagged by automated review of that commit.
--
-- One code per referrer, enforced where it can't be raced.
-- =============================================================================

alter table public.referral_codes
  add constraint referral_codes_owner_unique unique (owner_user_id);
