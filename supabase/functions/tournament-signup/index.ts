// POST /tournament-signup  { tournamentId, action: 'enter' | 'withdraw' | 'status' }
//
// The only way a `tournament_signups` row is created or removed. There is no
// client write grant on that table at all (0015), for two reasons:
//
//   1. `signed_up_at` decides the queue, so a client that could write its own
//      row could write itself an earlier morning.
//   2. The open/closed check has to live somewhere a patched client cannot
//      skip.
//
// `status` is here too, and reads rather than writes, because the position a
// player is shown must be computed by the server. The client renders the number
// it is handed and never sorts — `apps/web` imports nothing from
// `supabase/functions`, so a client-side ordering would be a second
// implementation of the rule VIP is sold on.

import { handled, json, requireUser, serviceClient, HttpError } from '../_shared/lib.ts';
import { loadQueue, signupsOpen, standingFor } from '../_shared/tournament.ts';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const { tournamentId, action, partner, team } = await req.json() as {
    tournamentId?: string;
    action?: string;
    /** Username of the person you are entering WITH, for a couples event. */
    partner?: string;
    /** 'a' | 'b' — which side, for a team_vs_team event. */
    team?: string;
  };
  if (!tournamentId) throw new HttpError(422, 'which tournament?');
  if (action !== 'enter' && action !== 'withdraw' && action !== 'status') {
    throw new HttpError(422, 'action must be enter, withdraw or status');
  }

  const db = serviceClient();
  const { data: t } = await db.from('tournaments').select('*').eq('id', tournamentId).single();
  if (!t) throw new HttpError(404, 'no such tournament');

  if (action !== 'status') {
    if (!signupsOpen(t)) {
      throw new HttpError(409, t.status === 'announced'
        ? 'sign-ups have not opened yet'
        : 'sign-ups have closed');
    }

    if (action === 'withdraw') {
      // Deleted rather than marked 'out': a player who changes their mind
      // before the draw was never in the Sunday, and leaving a tombstone in a
      // public queue would show everyone a name that is not playing.
      const { error } = await db.from('tournament_signups').delete()
        .eq('tournament_id', t.id).eq('user_id', user.id);
      if (error) throw new HttpError(500, error.message);
    } else {
      const { data: profile } = await db.from('profiles')
        .select('tier, tier_expires_at, gender').eq('id', user.id).single();

      // Battle of the sexes seats women against men, so a player with no side
      // recorded cannot be drawn into one. Refused at the door rather than at
      // the draw: finding out on Sunday morning that you were never seatable
      // is far worse than being told now, while it is still one tap to fix.
      // `gender` stays optional everywhere else — no ordinary event asks.
      if (t.theme === 'battle_of_the_sexes' && !profile?.gender) {
        throw new HttpError(422,
          'this one is women against men — set "Call me" to She or He on your profile first');
      }

      // A couples event is entered two by two. The partner is named here and
      // confirmed by them naming you back — `drawCouples` seats nobody on a
      // one-sided claim, so a typed username can never put a stranger in
      // somebody's partner seat.
      let partnerUserId: string | null = null;
      if (t.theme === 'couples') {
        const named = String(partner ?? '').trim();
        if (!named) throw new HttpError(422, 'this one is played in couples — name who you are entering with');

        const { data: found } = await db.from('profiles')
          .select('id, username').ilike('username', named).limit(2);
        if (!found?.length) throw new HttpError(404, `nobody here is called "${named}"`);
        // Usernames are not unique in this schema, so an ambiguous one has to
        // be refused rather than guessed at — picking the wrong person would
        // seat a stranger with them.
        if (found.length > 1) throw new HttpError(409, `more than one player is called "${named}" — ask them to change it or check the spelling`);
        if (found[0].id === user.id) throw new HttpError(422, 'you cannot enter with yourself');
        partnerUserId = found[0].id as string;
      }

      // A team-vs-team event needs a side, same reasoning as gender above:
      // finding out at the draw that you have no side is worse than being
      // asked now. Unlike a couple's partner, a team-mate needs no relation
      // to anybody — this is a roster choice, not a claim to confirm.
      let teamChoice: string | null = null;
      if (t.theme === 'team_vs_team') {
        teamChoice = String(team ?? '').trim().toLowerCase();
        if (teamChoice !== 'a' && teamChoice !== 'b') {
          throw new HttpError(422,
            `this one is team vs team — say "a" for ${t.team_a_name} or "b" for ${t.team_b_name}`);
        }
      }

      // `tier_at_signup` is a snapshot for disputes and is NEVER ordered by.
      // The queue reads the live tier at seating time, which is what lets an
      // afternoon upgrade jump the morning's line.
      //
      // Insert, not upsert: a second tap must not rewrite `signed_up_at` and
      // push a player to the back of the queue they are already standing in.
      // A duplicate hits the composite primary key and is simply ignored.
      const { error } = await db.from('tournament_signups').insert({
        tournament_id: t.id,
        user_id: user.id,
        tier_at_signup: profile?.tier ?? 'guest',
        partner_user_id: partnerUserId,
        team: teamChoice,
      });
      // 23505 is the primary key — they were already signed up, which is
      // exactly what they asked for. Anything else is real.
      //
      // One exception: naming a partner on a second tap is a correction, not a
      // duplicate. Their place in line is untouched (signed_up_at is never
      // rewritten); only who they say they are playing with changes.
      // Same correction-not-duplicate exception as the partner case: a second
      // tap that only changes team (or partner) must not push the player back
      // in line, and signed_up_at is never touched by this branch.
      if (error && error.code === '23505' && (partnerUserId || teamChoice)) {
        const { error: fixError } = await db.from('tournament_signups')
          .update({
            ...(partnerUserId ? { partner_user_id: partnerUserId } : {}),
            ...(teamChoice ? { team: teamChoice } : {}),
          })
          .eq('tournament_id', t.id).eq('user_id', user.id);
        if (fixError) throw new HttpError(500, fixError.message);
      } else if (error && error.code !== '23505') {
        throw new HttpError(500, error.message);
      }
    }
  }

  const ordered = await loadQueue(db, t.id);
  return json({
    ok: true,
    entered: ordered.some((p) => p.userId === user.id),
    standing: standingFor(ordered, t.seat_count, user.id, Date.now(), t.theme ?? 'open'),
  });
}));
