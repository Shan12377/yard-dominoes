// POST /pass-pose
//
// AFTER THE DEAL, not before it. The pose is passed by a player who has seen
// their tiles — "generally must deal before asking if partner wants to keep
// pose or pass it… they need to see which hand is better first" (owner,
// 2026-09-12). Before this, the choice was made blind: the client called
// pass-pose and only then start-hand, so the winner decided without holding a
// single bone.
//
// Nothing about the DEAL changes when the pose is passed — the tiles are
// already out. Only who opens changes, so this moves the live hand's turn to
// the partner and leaves the deal exactly as dealt.
//
// `sets` and `hands` have no client write policy; this is the only path a
// client has to either. Only the poser may call it, only in Partner or Across,
// never when the double-six is forced, and never once a bone is already down.

import {
  handled, json, requireUser, serviceClient, persist, toState, HttpError, Conflict, type HandRow,
} from '../_shared/lib.ts';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const { tableId } = await req.json() as { tableId: string };
  const db = serviceClient();

  const { data: table } = await db.from('tables').select('*').eq('id', tableId).single();
  if (!table) throw new HttpError(404, 'no such table');
  // Across runs partner's exact rules, pass-the-pose included. Deliberately
  // not a switch to isPartnered() here — openhand's exclusion predates this
  // change and is not this function's to revisit.
  if (table.mode !== 'partner' && table.mode !== 'across') {
    throw new HttpError(422, 'only partners can pass the pose');
  }

  const { data: seats, error: seatsErr } = await db.from('seats').select('*').eq('table_id', tableId);
  if (seatsErr || !seats) throw new HttpError(503, 'could not read the seats — try again');
  const mySeat = seats.find((s: any) => s.user_id === user.id);
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

  // The hand is already dealt. Find it, and refuse once anything has been
  // played — the pose is only passable while the board is still empty.
  const { data: handRow } = await db.from('hands').select('*')
    .eq('set_id', set.id).eq('status', 'active')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!handRow) throw new HttpError(409, 'no hand is being played — deal first');
  const hand = handRow as HandRow;
  if ((hand.move_log?.length ?? 0) > 0) {
    throw new HttpError(422, 'the pose has already been played');
  }
  if (hand.turn !== set.poser) throw new HttpError(409, 'the pose is not sitting with you');

  const partner = (set.poser + 2) % table.seat_count;

  // Only the turn moves. Everything else — the deal, the boneyard, the empty
  // board — is written back exactly as it was read, under the same optimistic
  // version check every other move uses, so this cannot race a real play.
  const state = toState(hand, table.seat_count, table.mode, table.format);
  state.turn = partner;
  const seatUsers: (string | null)[] = seats
    .slice()
    .sort((a: any, b: any) => a.seat_index - b.seat_index)
    .map((s: any) => s.user_id);
  try {
    await persist(db, hand.id, table.id, set.id, state, seatUsers, table.turn_seconds, hand.version);
  } catch (err) {
    if (err instanceof Conflict) throw new HttpError(409, 'someone else moved first');
    throw err;
  }

  // Keep the record honest about who actually opened: the hand's own poser,
  // and the set's, so a client reading either sees the partner and stops
  // offering the choice again.
  await db.from('hands').update({ poser: partner }).eq('id', hand.id);
  await db.from('sets').update({ poser: partner }).eq('id', set.id);

  return json({ ok: true });
}));
