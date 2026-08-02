-- =============================================================================
-- 0032_site_stats.sql
--
-- A site-wide "hands played" tally, tracked from today even though nothing
-- displays it yet — the number only means something once it's been running
-- a while, so plumbing starts now rather than later. One row, incremented
-- atomically by increment_site_hands() every time play-move finishes a
-- hand (win or block), same trigger point sets.hands_played already uses.
-- =============================================================================

create table public.site_stats (
  id                 int primary key default 1,
  total_hands_played bigint not null default 0,
  constraint site_stats_singleton check (id = 1)
);

insert into public.site_stats (id, total_hands_played) values (1, 0);

alter table public.site_stats enable row level security;

create policy "site stats are readable by everyone"
  on public.site_stats for select using (true);

-- No client write policy — only increment_site_hands() (service_role via
-- Edge Functions) ever changes this, same pattern as profiles.tier.

create or replace function public.increment_site_hands()
returns void language sql security definer set search_path = public as $$
  update public.site_stats set total_hands_played = total_hands_played + 1 where id = 1;
$$;

revoke execute on function public.increment_site_hands() from public, anon, authenticated;
grant execute on function public.increment_site_hands() to service_role;
