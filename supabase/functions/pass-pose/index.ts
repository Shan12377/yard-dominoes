// POST /pass-pose
//
// The engine has passPoseToPartner(), but `sets` has no client write policy —
// this is the only path a client has to change who poses next. Only the side
// that just won may call it, only in Partner mode, and never when the
// double-six is forced (the engine itself throws on that; this mirrors the
// same guard so the error is a 422, not a 500).

import { handled, json, requireUser, serviceClient, HttpError } from '../_shared/lib.ts';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const { tableId } = await req.json() as { tableId: string };
  const db = serviceClient();

  const { data: table } = await db.from('tables').select('*').eq('id', tableId).single();
  if (!table) throw new HttpError(404, 'no such table');
  if (table.mode !== 'partner') throw new HttpError(422, 'only partners can pass the pose');

  const { data: seats } = await db.from('seats').select('*').eq('table_id', tableId);
  const mySeat = seats!.find((s: any) => s.user_id === user.id);
  if (!mySeat) throw new HttpError(403, 'you are not seated at this table');

  const { data: set } = await db.from('sets')
    .select('*').eq('table_id', tableId).is('winner_side', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!set) throw new HttpError(409, 'no open set on this table');
  if (set.pose_must_be_double_six) throw new HttpError(422, 'the double-six opens this hand — the pose is not yours to pass');
  if (set.hands_played === 0) throw new HttpError(422, 'the double-six opens this hand — the pose is not yours to pass');

  // Only the side that just won (the current poser's side) may pass it.
  const poserSide = mySeat.seat_index % 2 === set.poser % 2;
  if (mySeat.seat_index !== set.poser && !poserSide) throw new HttpError(403, 'only the side that just won may pass the pose');

  const partner = (set.poser + 2) % table.seat_count;
  await db.from('sets').update({ poser: partner }).eq('id', set.id);

  return json({ ok: true });
}));
