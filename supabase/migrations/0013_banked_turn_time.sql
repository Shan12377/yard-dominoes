-- =============================================================================
-- 0013_banked_turn_time.sql
--
-- Turn time becomes a budget instead of a flat allowance.
--
-- A seat is granted `tables.turn_seconds` every turn. Whatever it does not
-- spend accumulates in `seats.time_bank` and can be drawn on later, and no
-- single turn may ever run past `tables.turn_cap_seconds` however full that
-- bank is. The bank is emptied whenever a hand is dealt, so nobody reaches the
-- last hand of a set holding a hoard.
--
-- Why: a flat clock punishes the fast player twice — moving quickly earns them
-- nothing, and on the one hand that genuinely needs reading they hit the same
-- wall as somebody who has dawdled all game. Rules live in
-- `packages/engine/src/clock.ts` (vendored to functions/_shared/engine).
--
-- `turn_seconds` keeps its name and its meaning: it was already the per-turn
-- allowance, and it is now the BASE of one. Existing tables therefore carry on
-- behaving as they did, with a bank they can build on top.
--
-- The bank sits on `seats` rather than `hands` deliberately: adding a column to
-- `hands` would mean changing the `commit_move` signature, and that function is
-- granted to service_role by exact signature in 0007. A seat-level column needs
-- no such surgery, and the bank is written only after commit_move has already
-- succeeded, so a move that loses the conditional write never moves the bank.
-- =============================================================================

alter table public.tables
  add column turn_cap_seconds smallint not null default 40
    constraint turn_cap_at_least_base check (turn_cap_seconds >= turn_seconds);

comment on column public.tables.turn_seconds is
  'Seconds granted fresh at the start of every turn — the BASE of the budget.';
comment on column public.tables.turn_cap_seconds is
  'Ceiling on a single turn, bank included. Caps how long a table can be held.';

alter table public.seats
  add column time_bank smallint not null default 0
    constraint time_bank_not_negative check (time_bank >= 0);

comment on column public.seats.time_bank is
  'Unspent seconds carried between turns. Reset to 0 by start-hand. Written by '
  'the edge functions under service_role only — a seat must never bank its own '
  'time, which is why 0012 revoked blanket UPDATE and granted columns instead.';

-- What actually stops a player writing their own bank is RLS: `seats` has one
-- policy, for SELECT, and no UPDATE policy at all, so client updates
-- default-deny. Verified against production before this migration was applied,
-- rather than assumed.
--
-- But a table-wide UPDATE grant still sits underneath that (`authenticated=
-- arwdDxtm`), and a table-wide grant covers columns that do not exist yet — so
-- `time_bank` inherits it the moment this file runs. That is the exact shape of
-- the bug 0012 had to fix on `profiles`: a row policy assumed to restrict
-- columns, with one blanket grant beneath it doing the real damage. There, the
-- only thing between a guest and free VIP was a missing policy; here, the only
-- thing between a player and an infinite clock is a missing policy.
--
-- The client never writes seats — it only SELECTs, and every mutation goes
-- through an edge function as service_role — so the grant buys nothing and
-- costs a future "you may update your own seat" policy (a connection
-- heartbeat, say) silently handing away the clock. Take it away now, while the
-- column being protected is going in.
revoke update on public.seats from anon, authenticated;
