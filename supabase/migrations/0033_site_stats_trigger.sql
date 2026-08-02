-- =============================================================================
-- 0033_site_stats_trigger.sql
--
-- Keeps site_stats.total_hands_played in sync via a trigger on sets, rather
-- than a second call from play-move/index.ts — every write that bumps
-- sets.hands_played is covered automatically, including any future code
-- path, without each caller needing to remember an extra RPC.
-- =============================================================================

create or replace function public.tally_site_hand()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- The delta, not a flat +1 — correct even if something ever corrects or
  -- batches hands_played by more than one in a single write.
  if new.hands_played > old.hands_played then
    update public.site_stats
      set total_hands_played = total_hands_played + (new.hands_played - old.hands_played)
      where id = 1;
  end if;
  return new;
end;
$$;

create trigger sets_tally_site_hand
  after update of hands_played on public.sets
  for each row
  execute function public.tally_site_hand();
