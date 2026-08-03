// POST /reveal-hand  { handId }
//
// 2 coins to see the whole hand after it ends. The free share-link replay
// (replay.ts) deliberately never includes what stayed in anyone's hand — "a
// tile drawn from the boneyard and never played stays hidden... Nobody's
// hand is in this string." This is the other half: every seat's starting
// tiles. The move log that goes with it is already public on PublicHand, so
// only the deal needs to travel here.

import { handled, json, requireUser, serviceClient, HttpError } from '../_shared/lib.ts';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const { handId } = await req.json();
  const db = serviceClient();

  const { data: hand } = await db.from('hands').select('*').eq('id', handId).single();
  if (!hand) throw new HttpError(404, 'no such hand');
  if (hand.status === 'active') throw new HttpError(409, 'the hand is still being played');

  const { data: set } = await db.from('sets').select('*').eq('id', hand.set_id).single();
  const { data: seats } = await db.from('seats').select('*').eq('table_id', set!.table_id).order('seat_index');

  const seat = seats!.findIndex((s: any) => s.user_id === user.id);
  if (seat < 0) throw new HttpError(403, 'you did not play this hand');

  // Idempotent on (user, hand): a page reload or a second click on an
  // already-revealed hand must not charge twice.
  const reference = `hand-reveal:${handId}`;
  const already = await db.from('coin_ledger').select('id')
    .eq('user_id', user.id).eq('kind', 'spend').eq('reference', reference).maybeSingle();

  if (!already.data) {
    const { error } = await db.rpc('spend_coins', {
      p_user_id: user.id, p_amount: 2, p_kind: 'spend', p_reference: reference,
    });
    if (error) throw new HttpError(402, 'not enough coins');
  }

  return json({ ok: true, deal: hand.deal });
}));
