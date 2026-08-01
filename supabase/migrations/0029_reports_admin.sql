-- =============================================================================
-- 0029_reports_admin.sql
--
-- Closes a real gap: `reports` (0001) has always let a player FILE one
-- (RLS insert, reporter_id = auth.uid()) but nothing could ever review one —
-- no status column to mark it handled, and no policy letting anyone but the
-- reporter read it back. The terms of service already promises "There is a
-- report button — use it, and we will look." That promise had no UI and no
-- one who could look.
--
-- `is_admin` mirrors `is_host` (0015) exactly, deliberately: a boolean the
-- server checks under service_role, no Postgres role behind it, no grant, no
-- RLS policy naming it. Kept SEPARATE from `is_host` on purpose — a
-- tournament host running Sunday brackets is a different trust level from
-- someone reading player conduct reports, and conflating them the moment a
-- second admin-only feature showed up would have been the actual scope
-- creep, not adding one more narrow boolean.
-- =============================================================================

alter table public.reports
  add column status text not null default 'open'
    constraint report_status_is_known check (status in ('open', 'resolved', 'dismissed'));

comment on column public.reports.status is
  'open until an admin resolves or dismisses it via the report-admin Edge '
  'Function (service_role only — no client write path exists for this column).';

alter table public.profiles
  add column is_admin boolean not null default false;

comment on column public.profiles.is_admin is
  'Grants nothing by itself — no Postgres role, no RLS policy, no grant '
  'names it. report-admin reads this under service_role before doing '
  'anything. Set by hand: update public.profiles set is_admin = true '
  'where username = ''...''.  Deliberately separate from is_host (0015) — '
  'different trust level, not the same flag wearing two hats.';
