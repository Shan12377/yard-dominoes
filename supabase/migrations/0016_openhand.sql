-- =============================================================================
-- 0016_openhand.sql
--
-- Open Hand ("Ol' Man") — partner-open. Each seat sees its partner's tiles.
-- Everything else about pairing, format and scoring is identical to partner
-- mode; the change is a single visibility channel on `seat_hands`.
--
-- See docs/superpowers/plans/2026-07-29-openhand-debrief.md for the scoping
-- decisions. In particular §0: the bots.ts anti-cheat invariant is preserved
-- because in openhand mode a partner's tiles are information the rules grant
-- to the human in that seat, so a bot receiving them is not cheating.
-- =============================================================================

-- ------------------------------------------------------------------ enum ----
-- `alter type ... add value` cannot run inside a transaction on Postgres 17,
-- but Supabase's migration runner treats a `.sql` file as one atomic block.
-- The workaround Supabase docs already recommend: commit-then-add, using
-- `if not exists` so re-runs are safe. See the Supabase enum guidance.
alter type public.game_mode add value if not exists 'openhand';

-- ---------------------------------------------------- hand_public snapshot --
--
-- The RLS policy widening below must gate on the mode of the HAND being read,
-- not the current table's mode. Otherwise flipping a table from openhand back
-- to partner mid-set (or after) would retroactively hide already-visible
-- tiles, or worse, retroactively expose historic partner rows on tables that
-- were never openhand.
--
-- `hand_public` rows are written once per state transition by `writeHandState`
-- in `_shared/lib.ts`, so the mode captured here is the mode this hand was
-- ACTUALLY dealt under. That's the honest denormalisation — the value was
-- true when the row was written.
alter table public.hand_public
  add column mode public.game_mode;

comment on column public.hand_public.mode is
  'The game mode this hand was dealt under. Denormalised from `tables.mode` '
  'so RLS on seat_hands can gate visibility on the hand''s own mode rather '
  'than the current table setting — see 0016.';

-- Backfill for any already-existing hands. Every hand ties back to a table
-- through set_id -> tables.id.
update public.hand_public hp
   set mode = t.mode
  from public.sets s, public.tables t
 where hp.set_id = s.id and s.table_id = t.id and hp.mode is null;

-- New writes must always populate it. The writer in `_shared/lib.ts` is
-- updated in the same commit as this migration.
alter table public.hand_public alter column mode set not null;

-- ------------------------------------------------------- seat_hands, RLS ---
--
-- The one visibility change the whole feature turns on. Openhand seats read
-- their partner's row; every other pair combination still returns nothing.
--
-- Written as an OR against the existing policy rather than replacing it, so
-- the failure mode is additive: if this policy is dropped or broken, the
-- fallback is "you may read only your own tiles" — the shipped behaviour.
--
-- The policy checks three things, in the order most likely to filter first:
--
--   1. the hand is openhand (a scan of `hand_public.mode`, indexed by pk),
--   2. the CALLER is seated at that table (a scan of `seats.user_id`),
--   3. the ROW's seat is the caller's PARTNER at that table (0<->2, 1<->3).
--
-- The third check is why an ordinary cutthroat opponent never leaks — even in
-- openhand mode. Partner-open only exposes partner.
-- ------------------------------------------ tournament pairing constraint --
--
-- 0015 wrote the constraint as `mode <> 'partner' or seat_count = 4`. Openhand
-- is the same 2-vs-2 shape (see `isPartnered` in the engine) and needs the
-- same rule: sideOf() would otherwise split three seats into a 2-vs-1.
-- Replace the check rather than adding a second, so the constraint remains a
-- single source of truth on tournament shape.
alter table public.tournaments
  drop constraint partner_is_four_handed;
alter table public.tournaments
  add constraint partnered_is_four_handed
    check (mode not in ('partner', 'openhand') or seat_count = 4);

create policy "openhand: your partner's tiles are yours to see"
  on public.seat_hands for select
  using (
    exists (
      select 1
        from public.hand_public hp
        join public.seats me       on me.table_id   = hp.table_id
                                  and me.user_id    = auth.uid()
        join public.seats partner  on partner.table_id  = hp.table_id
                                  and partner.seat_index = seat_hands.seat_index
       where hp.hand_id = seat_hands.hand_id
         and hp.mode    = 'openhand'
         -- The pairing rule: 0<->2, 1<->3, exactly matching `sideOf` in the
         -- engine for a paired mode. `<>` guards against a mistaken self-read
         -- returning the row twice or masking a broken pairing check.
         and me.seat_index <> partner.seat_index
         and me.seat_index % 2 = partner.seat_index % 2
    )
  );
