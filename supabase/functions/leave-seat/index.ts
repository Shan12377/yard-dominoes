// POST /leave-seat  { tableId }
//
// Waiting tables: the seat opens back up for someone else to join — but a
// seat row can never hold neither a person nor a duppy (`seat_is_person_or_
// duppy` in migration 0001 requires exactly one of user_id/duppy_level to be
// set), so "opens back up" means falling back to a duppy fill, same as every
// unclaimed seat looks the moment a table is first created. join-table's
// target search (`!s.user_id`) doesn't care whether that placeholder is a
// duppy or truly empty, so a human can still claim it exactly the same way.
// Playing tables: the seat becomes a duppy (so the existing duppy-turn
// looping already in start-hand/play-move/expire-turns picks it up with no
// further changes there) and the departing player's abandons count goes up.
// Score is untouched — it lives on `sets`, not per-seat, so anyone who later
// joins that vacated seat inherits the running score automatically.

import { handled, json, requireUser, serviceClient, HttpError } from '../_shared/lib.ts';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const { tableId } = await req.json() as { tableId: string };
  const db = serviceClient();

  const { data: table } = await db.from('tables').select('*').eq('id', tableId).single();
  if (!table) throw new HttpError(404, 'no such table');

  const { data: seat } = await db.from('seats')
    .select('*').eq('table_id', tableId).eq('user_id', user.id).maybeSingle();
  if (!seat) throw new HttpError(403, 'you are not seated at this table');

  const { error: seatError } = await db.from('seats')
    .update({ user_id: null, duppy_level: 'yard', connected_at: null })
    .eq('table_id', tableId).eq('seat_index', seat.seat_index);
  if (seatError) throw new HttpError(500, seatError.message);

  if (table.status === 'playing') {
    const { data: profile } = await db.from('profiles').select('abandons').eq('id', user.id).single();
    const { error: profileError } = await db.from('profiles')
      .update({ abandons: (profile?.abandons ?? 0) + 1 }).eq('id', user.id);
    if (profileError) throw new HttpError(500, profileError.message);
  }

  return json({ ok: true });
}));
