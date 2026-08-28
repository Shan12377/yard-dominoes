-- =============================================================================
-- 0052_referral_owner_only.sql
--
-- Referral financials (who owns which code, what's owed, cash-out requests
-- and marking them paid) are restricted to a NEW, narrower tier than
-- is_admin — a future admin granted for report/feedback moderation should
-- not automatically also see money data. Same three-tier shape is_admin
-- and is_host already established (a boolean on profiles, checked at the
-- top of the relevant Edge Function, no Postgres role or RLS policy behind
-- it — narrow by construction, per 0.tournament-host's own header).
-- =============================================================================

alter table public.profiles add column is_owner boolean not null default false;

update public.profiles set is_owner = true where username = 'Candy';
