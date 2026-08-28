// POST /settle-hand  { handId }
//
// The dispute-settler: 2 coins for a finished hand's full move log plus
// every seat's starting tiles — "did my partner really have that domino
// and just not play it." This is a deliberate, PAID exception to the
// `hands` redaction invariant (CLAUDE.md's six invariants, #3), not the
// same thing as reveal-hand (free): that one proves the shuffle wasn't
// rigged (deal + commit-reveal receipt only); it never returns move_log,
// so it cannot answer what anyone actually chose to play or hold back.
// Keep the two separate — one being free doesn't make the other free too.

import { handled, json, requireUser, serviceClient, HttpError } from '../_shared/lib.ts';

const PRICE_COINS = 2;

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

  // Once paid, always free to re-open — same idempotency shape as
  // french-reshuffle's reference key, just re-fetch instead of re-block.
  const reference = `settle-hand:${handId}:${user.id}`;
  const already = await db.from('coin_ledger').select('id')
    .eq('user_id', user.id).eq('kind', 'spend').eq('reference', reference).maybeSingle();

  if (!already.data) {
    const { error: spendError } = await db.rpc('spend_coins', {
      p_user_id: user.id, p_amount: PRICE_COINS, p_kind: 'spend', p_reference: reference,
    });
    if (spendError) throw new HttpError(402, 'not enough coins');
  }

  return json({
    ok: true,
    deal: hand.deal,
    moveLog: hand.move_log,
  });
}));
