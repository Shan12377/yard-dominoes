-- =============================================================================
-- 0005_expire_turns_cron.sql
--
-- Serverless has no long-lived timers, so a scheduled job retires stale turns
-- (see supabase/functions/expire-turns). This wires up the schedule itself,
-- which .claude/rules/supabase.md already assumed would exist:
-- "pg_cron must be enabled ... before expire-turns will fire."
--
-- The anon key in the request header is intentional, not an oversight: it is
-- public by design (see CLAUDE.md — Working style), and expire-turns has
-- verify_jwt = false, so no bearer token is required at all. The header only
-- satisfies the platform gateway's apikey check.
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'expire-turns',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://iqixdijhckgilvyhduxb.supabase.co/functions/v1/expire-turns',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxaXhkaWpoY2tnaWx2eWhkdXhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxMjg1MjQsImV4cCI6MjEwMDcwNDUyNH0.P5rvJWZQf3GvHltGZvWWMU9f3NDpG0Q-BsZie0wuxMc"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);
