// POST /review-hand  { handId, payCoins? }
//
// The Coach. Runs only on a finished hand, because it needs the full deal —
// which is exactly why it can be exact where a live hint never could be.
//
// Guest's daily free review can be topped up with coins — 2 per extra
// review, same price as the other coin utilities (french-reshuffle,
// settle-hand). Never a tier substitute: this buys one more REVIEW, not
// membership, and Yardie/VIP are already uncapped so they never see this
// path at all. See the guest-cap block below for the two-step flow: a
// plain request 429s with a distinct, client-detectable message; a
// request with payCoins: true spends and proceeds.

import { handled, json, requireUser, serviceClient, HttpError, openingTileForFormat, effectiveTier } from '../_shared/lib.ts';
import { reviewHand, accuracy } from '../_shared/engine/coach.ts';
import type { HandState } from '../_shared/engine/types.ts';

const EXTRA_REVIEW_PRICE_COINS = 2;

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const { handId, payCoins } = await req.json();
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
  // Reviews saved before the practical Coach shipped lack its safe
  // before/after snapshots. Rebuild those existing reviews at no charge so a
  // player does not get stuck with the old, unexplained verdict forever.
  const cachedHasPracticalRead = cached.data
    && Array.isArray((cached.data.review as any)?.reviews)
    && (cached.data.review as any).reviews.every((entry: any) => entry.position?.after);
  if (cachedHasPracticalRead) return json({
    ok: true,
    review: cached.data!.review,
    accuracy: cached.data!.accuracy,
    cached: true,
  });

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
      if (payCoins !== true) {
        // Distinct message from the plain cap message on purpose — the
        // client matches on this exact text to offer the coin top-up
        // rather than just showing a dead end.
        throw new HttpError(429, `Today's free Coach review is used — ${EXTRA_REVIEW_PRICE_COINS} coins unlocks this one.`);
      }
      // reviewHand:${handId}:${userId} would double-charge nothing anyway
      // (the cache check above already makes a second request for the
      // SAME hand free), but a reference still traces what each spend was
      // for in the ledger, same as every other coin spend this session.
      const { error: spendError } = await db.rpc('spend_coins', {
        p_user_id: user.id, p_amount: EXTRA_REVIEW_PRICE_COINS, p_kind: 'spend',
        p_reference: `review-hand:${handId}:${user.id}`,
      });
      if (spendError) throw new HttpError(402, 'not enough coins');
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
    poseMustBeAnyDouble: hand.pose_must_be_any_double,
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
  await db.from('hand_reviews').upsert({
    hand_id: handId, user_id: user.id, seat_index: seat,
    review, accuracy: accuracy(review),
  }, { onConflict: 'hand_id,user_id' });

  return json({ ok: true, review, accuracy: accuracy(review) });
}));
