// POST /gift-coins  { toUserId: string, amount: number }
//
// Player-to-player coin transfer — "pure social flex" per the roadmap. The
// caller's identity comes only from their verified bearer token, never from
// the request body: a client naming its own "from" user id is exactly the
// hole a wallet cannot have. All the real rules (self-gift, the 20-coin
// floor, insufficient balance) are enforced again inside gift_coins itself —
// this function does not duplicate them, it just turns a bad RPC error into
// a clean HTTP one.

import { handled, json, requireUser, serviceClient, HttpError } from '../_shared/lib.ts';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const { toUserId, amount } = await req.json() as { toUserId?: string; amount?: number };
  if (!toUserId || typeof toUserId !== 'string') throw new HttpError(422, 'toUserId is required');
  if (!Number.isInteger(amount) || (amount as number) <= 0) throw new HttpError(422, 'amount must be a positive integer');

  const db = serviceClient();
  const { error } = await db.rpc('gift_coins', {
    p_from_user_id: user.id,
    p_to_user_id: toUserId,
    p_amount: amount,
  });
  if (error) {
    // gift_coins raises plain messages for every rule it enforces; surface
    // them as-is rather than a generic 500, since each one is something the
    // sender can actually act on (add more coins, pick someone else).
    throw new HttpError(422, error.message);
  }

  const { data: balance } = await db.rpc('coin_balance', { p_user_id: user.id });
  return json({ ok: true, balance: balance ?? 0 });
}));
