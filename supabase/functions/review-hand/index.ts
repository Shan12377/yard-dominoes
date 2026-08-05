// POST /review-hand  { handId }
//
// The Coach. Runs only on a finished hand, because it needs the full deal —
// which is exactly why it can be exact where a live hint never could be.

import { handled, json, requireUser, serviceClient, HttpError, openingTileForFormat, effectiveTier } from '../_shared/lib.ts';
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

  // One NEW review a day on Guest — re-opening a hand already graded today
  // stays free forever (the cache check above returns before this runs).
  // Yardie and VIP are both uncapped: only the guest bullet in lounges.ts's
  // TIER_PITCH promises a number, and vip's own bullet is explicitly
  // "unlimited" — nothing here should read a paying member's cap as lower
  // than what they were sold.
  const { data: profile } = await db.from('profiles')
    .select('tier, tier_expires_at').eq('id', user.id).maybeSingle();
  if (effectiveTier(profile ?? { tier: 'guest', tier_expires_at: null }) === 'guest') {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { count } = await db.from('hand_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', startOfDay.toISOString());
    if ((count ?? 0) >= 1) {
      throw new HttpError(429, 'One free Coach review a day on Guest — become a Yardie or VIP for more.');
    }
  }

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
    penalties: new Array(table!.seat_count).fill(0),
    status: 'active',
    result: null,
    poseMustBeDoubleSix: hand.pose_must_be_double_six,
    poser: hand.poser,
    format,
    openingTile: openingTileForFormat(format),
  };

  // The engine's own default (120,000 nodes/decision) is tuned for a
  // browser tab, which has no hard CPU-time budget. This isolate does: a
  // real cut-throat hand blew it (546, ~3.5s CPU for ~500k nodes total
  // across the hand's decisions) the first time this function ever ran for
  // real, because the Coach had only ever executed client-side before now.
  // 20,000/decision keeps a full hand comfortably under budget; `exact:
  // false` on the odd position that still needs more already has a UI
  // message ("too big to solve exactly") rather than a hard failure.
  const review = reviewHand(initial, hand.move_log, seat, { nodeLimit: 20_000 });
  await db.from('hand_reviews').insert({
    hand_id: handId, user_id: user.id, seat_index: seat,
    review, accuracy: accuracy(review),
  });

  return json({ ok: true, review, accuracy: accuracy(review) });
}));
