// POST /review-hand  { handId }
//
// The Coach. Runs only on a finished hand, because it needs the full deal —
// which is exactly why it can be exact where a live hint never could be.

import { handled, json, requireUser, serviceClient, HttpError, openingTileForFormat } from '../_shared/lib.ts';
import { reviewHand, accuracy } from '../_shared/engine/coach.ts';
import type { HandState } from '../_shared/engine/types.ts';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const { handId } = await req.json();
  const db = serviceClient();

  const { data: hand } = await db.from('hands').select('*').eq('id', handId).single();
  if (!hand) throw new HttpError(404, 'no such hand');
  if (hand.status === 'active') throw new HttpError(409, 'the hand is still being played');

  const { data: set } = await db.from('sets').select('*').eq('id', hand.set_id).single();
  const { data: table } = await db.from('tables').select('*').eq('id', set!.table_id).single();
  const { data: seats } = await db.from('seats').select('*').eq('table_id', table!.id).order('seat_index');

  const seat = seats!.findIndex((s: any) => s.user_id === user.id);
  if (seat < 0) throw new HttpError(403, 'you did not play this hand');

  const cached = await db.from('hand_reviews').select('*')
    .eq('hand_id', handId).eq('user_id', user.id).maybeSingle();
  if (cached.data) return json({ ok: true, review: cached.data.review, cached: true });

  // format/openingTile are required on HandState — without them, applyMove's
  // pose branch (`s.format === 'french'`) is always false and, worse, a
  // forced-open hand's legalMoves() checks `hand.includes(s.openingTile)`
  // against `undefined`, finds nothing, and reviewHand's replay throws the
  // instant it hits that pose. This is the exact same bug `toState()` in
  // lib.ts had (fixed 2026-07-31, see the source-audit plan's item 1) —
  // reproduced here because this function builds its own HandState literal
  // instead of going through toState().
  const format = table!.format;
  const initial: HandState = {
    seatCount: table!.seat_count,
    mode: table!.mode,
    hands: hand.deal,
    boneyard: [],
    board: null,
    turn: hand.poser,
    consecutivePasses: 0,
    moveLog: [],
    status: 'active',
    result: null,
    poseMustBeDoubleSix: hand.pose_must_be_double_six,
    poser: hand.poser,
    format,
    openingTile: openingTileForFormat(format),
  };

  const review = reviewHand(initial, hand.move_log, seat);
  await db.from('hand_reviews').insert({
    hand_id: handId, user_id: user.id, seat_index: seat,
    review, accuracy: accuracy(review),
  });

  return json({ ok: true, review, accuracy: accuracy(review) });
}));
