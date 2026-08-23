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
  const { data: seats } = await db.from('seats').select('*').eq('table_id', set!.table_id).order('seat_index');

  const seat = seats!.findIndex((s: any) => s.user_id === user.id);
  if (seat < 0) throw new HttpError(403, 'you did not play this hand');

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
