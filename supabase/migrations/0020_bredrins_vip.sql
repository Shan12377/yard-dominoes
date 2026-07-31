-- =============================================================================
-- 0020_bredrins_vip.sql
--
-- The bredrins list — "know where your people are" — is priced at VIP
-- ($69/yr) in TIER_PITCH and on the membership page. The table, RLS and
-- client functions (`addBredrin`/`whereAreMyBredrins` in lounges.ts) have
-- existed since 0002, but the policy never actually checked tier: it was
-- "your list is yours", not "your list is yours, if you are VIP". Any
-- signed-in Guest could read, add to, or clear a bredrins list today. This
-- was flagged as "shipped" in the first VIP audit pass and corrected on a
-- follow-up read of the policy itself — see
-- docs/superpowers/plans/2026-07-31-source-audit-and-followups.md §6.
--
-- Gating the whole `for all` policy (not just insert) is deliberate: reading
-- your own list is as much the paid feature as adding to it, so a Guest who
-- slipped rows in before this migration should not still be able to see
-- them either.
-- =============================================================================

drop policy if exists "your list is yours" on public.bredrins;

create policy "your list is yours, and you must be vip to have one"
  on public.bredrins for all
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and public.effective_tier(p) = 'vip'
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and public.effective_tier(p) = 'vip'
    )
  );
