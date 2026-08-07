-- =============================================================================
-- 0040_invites.sql
--
-- "Tell them what room to join" — the half of the bredrins feature that
-- didn't exist yet. 0002/0020 already let a VIP see where a bredrin last
-- was (a passive, durable last-seen read off lounge_visits); this is the
-- active counterpart, a one-shot nudge from one player to a specific
-- bredrin: "come to this lounge."
--
-- Deliberately minimal — no status column, no expiry job. A row is consumed
-- (deleted) the moment the recipient joins or dismisses it. If it sits
-- unread, it sits; nothing depends on it being cleaned up.
-- =============================================================================

create table public.invites (
  id            uuid primary key default gen_random_uuid(),
  from_user_id  uuid not null references public.profiles(id) on delete cascade,
  to_user_id    uuid not null references public.profiles(id) on delete cascade,
  lounge_id     uuid not null references public.lounges(id) on delete cascade,
  created_at    timestamptz not null default now()
);

alter table public.invites enable row level security;

create policy "you can see invites sent to you"
  on public.invites for select
  using (to_user_id = auth.uid());

-- Same VIP gate as the bredrins list itself (0020), plus: you can only
-- invite someone already on your bredrins list. This is a nudge between
-- people who already chose each other, not a way to message a stranger.
create policy "vip can invite an existing bredrin"
  on public.invites for insert
  with check (
    from_user_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and public.effective_tier(p) = 'vip'
    )
    and exists (
      select 1 from public.bredrins b
      where b.user_id = auth.uid() and b.bredrin_id = to_user_id
    )
  );

create policy "you can dismiss invites sent to you"
  on public.invites for delete
  using (to_user_id = auth.uid());

alter publication supabase_realtime add table public.invites;
