-- =============================================================================
-- 0034_feedback.sql
--
-- App feedback — not player conduct (that's reports, 0001). Same shape on
-- purpose: filing is a plain client insert covered by RLS, reviewing needs
-- every player's rows so it goes through a service-role Edge Function
-- (feedback-admin) gated on is_admin, exactly like report-admin.
-- =============================================================================

create table public.feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id),
  message    text not null,
  status     text not null default 'open' check (status in ('open', 'reviewed')),
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

create policy "you may send feedback"
  on public.feedback for insert with check (user_id = auth.uid());

create policy "you may read feedback you sent"
  on public.feedback for select using (user_id = auth.uid());
