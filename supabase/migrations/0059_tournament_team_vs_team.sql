-- =============================================================================
-- 0059_tournament_team_vs_team.sql
--
-- The third of JamDom's themed events. Exactly two named teams; a table seats
-- two of each on opposite partner sides. Unlike couples, a team-mate needs no
-- relationship to anybody — "on team A" is a roster affiliation chosen at
-- sign-up, not a claim about a specific person, so there is nothing here to
-- confirm the way a couple's partner_user_id has to be mutual.
-- =============================================================================

alter table public.tournaments
  add column team_a_name text check (team_a_name is null or char_length(team_a_name) between 1 and 40),
  add column team_b_name text check (team_b_name is null or char_length(team_b_name) between 1 and 40);

comment on column public.tournaments.team_a_name is
  'Display name for team A, required when theme = team_vs_team. Null otherwise.';
comment on column public.tournaments.team_b_name is
  'Display name for team B, required when theme = team_vs_team. Null otherwise.';

alter table public.tournament_signups
  add column team text check (team is null or team in ('a', 'b'));

comment on column public.tournament_signups.team is
  'Which side this player chose at sign-up, for the team_vs_team theme. Null '
  'for every other theme — nobody is asked to pick a team to enter an open '
  'event, battle of the sexes, or a couples tourney.';

alter table public.tournaments
  drop constraint theme_is_known;

alter table public.tournaments
  add constraint theme_is_known
    check (theme in ('open', 'battle_of_the_sexes', 'couples', 'team_vs_team'));

-- Same shape as 0056/0057: two-against-two only makes sense at a four-handed
-- partner table, whatever the theme.
alter table public.tournaments
  add constraint team_vs_team_is_partner_four
    check (theme <> 'team_vs_team' or (mode = 'partner' and seat_count = 4));

-- Both names are how the event is announced, not optional flavour — a
-- scheduled "team vs team" with one side unnamed is not ready to open
-- sign-ups. Enforced with the theme, not with tournament status, since a
-- host filling in the create form should see the gap immediately.
alter table public.tournaments
  add constraint team_vs_team_needs_both_names
    check (theme <> 'team_vs_team' or (team_a_name is not null and team_b_name is not null));
