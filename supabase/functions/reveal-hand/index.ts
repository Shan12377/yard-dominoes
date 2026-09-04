// POST /reveal-hand  { handId }
//
// Free visual deal verification after a hand ends. The response is a complete
// commit-reveal receipt so the PLAYER'S BROWSER can reconstruct the shuffle;
// a green verdict from our own server would still amount to "trust us".
// Nothing is returned during a live hand, and only a participant can ask.

import { handled, json, requireUser, serviceClient, HttpError } from '../_shared/lib.ts';
import { dealPlan } from '../_shared/engine/tiles.ts';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const { handId } = await req.json();
  const db = serviceClient();

  const { data: hand } = await db.from('hands').select('*').eq('id', handId).single();
  if (!hand) throw new HttpError(404, 'no such hand');
  if (hand.status === 'active') throw new HttpError(409, 'the hand is still being played');

  const { data: set } = await db.from('sets').select('*').eq('id', hand.set_id).single();
  // Who played THIS hand, from `seat_hands` — not who is sitting at the table
  // now, from `seats`. They are different questions the moment somebody
  // leaves: leave-seat nulls `seats.user_id`, so asking `seats` locks a player
  // out of their own finished hands forever. Deal verification is a settled
  // promise ("a participant may ask", CLAUDE.md) and the Coach is the reason
  // to play here at all, so neither may depend on still occupying the chair.
  // `seat_hands` is written per hand by persist() and never rewritten, which
  // makes it the honest record of who was actually dealt in.
  // `limit(1)`, not maybeSingle() on its own: across signs ONE player into TWO
  // seats (0&2 or 1&3), so this genuinely matches twice and an unqualified
  // single-row read would throw for exactly those players. The lower seat is a
  // deterministic choice, and both seats belong to the same person anyway.
  const { data: mySeatHand } = await db.from('seat_hands')
    .select('seat_index').eq('hand_id', handId).eq('user_id', user.id)
    .order('seat_index').limit(1).maybeSingle();
  if (!mySeatHand) throw new HttpError(403, 'you did not play this hand');
  const seat = mySeatHand.seat_index as number;

  const { data: table } = await db.from('tables').select('seat_count, use_boneyard')
    .eq('id', set!.table_id).single();
  const { removeDoubleBlank } = dealPlan(table!.seat_count, table!.use_boneyard);

  return json({
    ok: true,
    deal: hand.deal,
    receipt: {
      handId: `${hand.set_id}:${hand.hand_no}`,
      commitment: hand.commitment,
      serverSeed: hand.server_seed,
      clientSeeds: hand.client_seeds,
      removeDoubleBlank,
      dealt: hand.deal,
    },
  });
}));
