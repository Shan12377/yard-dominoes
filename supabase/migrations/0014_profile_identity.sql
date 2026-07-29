-- =============================================================================
-- 0014_profile_identity.sql
--
-- Who you are at the table: yard or foreign, and optionally whether people
-- should call you she or he.
--
-- Why `origin` is not `flag`. `flag` has existed since 0001 as a territory
-- code ('jm', 'tt') and has never been written by anything. These are
-- different axes and collapsing them loses the point: a Jamaican in London is
-- FOREIGN and her flag is still 'jm'. The business partner asked for this
-- specifically, and it is the diaspora — UK, US and Canada — that makes up a
-- large share of anyone who will pay for this. `flag` is left alone.
--
-- Both columns are nullable and stay that way. "Did not say" is a real and
-- common answer to both questions, and a NOT NULL default would silently
-- declare something on a player's behalf for every account that already
-- exists. Nothing in the app may ever infer either one — not from a name, not
-- from a voice, not from an IP.
-- =============================================================================

alter table public.profiles
  add column origin text
    constraint origin_is_known check (origin in ('yardie', 'foreign'));

comment on column public.profiles.origin is
  'Self-declared, nullable: yard or foreign. NOT the same as flag, which is a '
  'territory code — someone in Brooklyn may fly jm and still be foreign.';

alter table public.profiles
  add column gender text
    constraint gender_is_known check (gender in ('f', 'm'));

comment on column public.profiles.gender is
  'Self-declared, optional, nullable, and never inferred. Exists only so '
  'players know who they are talking to at a voice table.';

-- ---------------------------------------------------------------------------
-- The part that actually matters.
--
-- 0012 revoked the blanket UPDATE on this table and granted three columns by
-- name, precisely because a table-wide grant covers columns that do not exist
-- yet — which is how `tier` became writable by anyone signed in, and the
-- paywall became decorative. A new column is therefore NOT writable until it
-- is named here, and that is the desired default: adding a column should never
-- hand it to the client by accident.
--
-- Note that this must GRANT rather than re-grant everything: naming only the
-- new columns would leave the 0012 grants in place, but spelling all five out
-- keeps the full writable set visible in one statement, so the next person can
-- see what a member owns without reading two files.
grant update (username, flag, bio, origin, gender) on public.profiles to authenticated;

-- Still nothing for `anon`, and the 0001 row policy (auth.uid() = id, with
-- check) continues to confine a member to their own row.
