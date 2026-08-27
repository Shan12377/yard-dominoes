-- =============================================================================
-- 0047_duppy_pace.sql
--
-- Duppies are part of the social table, not a background animation. Store a
-- named, bounded reading pace per table so every seated player sees the same
-- server-authoritative deadline. The browser may choose a label at creation;
-- it can never supply an arbitrary delay or advance a Duppy early.
-- =============================================================================

alter table public.tables
  add column duppy_pace text not null default 'yard'
    constraint duppy_pace_allowed check (duppy_pace in ('quick', 'yard', 'relaxed'));

comment on column public.tables.duppy_pace is
  'Server-enforced Duppy reading beat: quick=3.5s, yard=10s, relaxed=20s. '
  'Affects only AI turns; human turns remain governed by turn_seconds/time bank.';
