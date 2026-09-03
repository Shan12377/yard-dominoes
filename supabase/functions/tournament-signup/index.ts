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
  const { tournamentId, action } = await req.json() as {
    tournamentId?: string;
    action?: string;
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
      });
      // 23505 is the primary key — they were already signed up, which is
      // exactly what they asked for. Anything else is real.
      if (error && error.code !== '23505') throw new HttpError(500, error.message);
    }
  }

  const ordered = await loadQueue(db, t.id);
  return json({
    ok: true,
    entered: ordered.some((p) => p.userId === user.id),
    standing: standingFor(ordered, t.seat_count, user.id, Date.now(), t.theme ?? 'open'),
  });
}));
