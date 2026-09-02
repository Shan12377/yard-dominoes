// POST /redeem-code  { code }
//
// Self-serve counterpart to redeem-admin: any signed-in player redeeming a
// code someone handed them, not the owner minting one. A comp code never
// downgrades — if the player's current tier already outranks the code's
// tier, only the expiry moves; the tier itself only ever goes up. Term is
// always a flat year, same length as a real Yardie/VIP purchase, stacked
// onto whatever time they already had left (never wasting an active term).

import { handled, json, requireUser, serviceClient, HttpError, TIER_RANK } from '../_shared/lib.ts';

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const { code } = await req.json() as { code?: string };
  const cleaned = String(code ?? '').trim().toUpperCase();
  if (!cleaned) throw new HttpError(422, 'enter a code');
  const db = serviceClient();

  // Atomic claim: only succeeds if nobody has redeemed this code yet. Two
  // people racing the same code both pass a plain select-then-check; only
  // one of them can win this update.
  const { data: claimed, error: claimError } = await db.from('redeem_codes')
    .update({ redeemed_by: user.id, redeemed_at: new Date().toISOString() })
    .eq('code', cleaned).is('redeemed_by', null)
    .select('tier').maybeSingle();
  if (claimError) throw new HttpError(500, claimError.message);
  if (!claimed) throw new HttpError(404, 'that code is invalid or already used');

  const { data: profile } = await db.from('profiles')
    .select('tier, tier_expires_at').eq('id', user.id).single();
  const now = Date.now();
  const currentlyActive = profile?.tier_expires_at && Date.parse(profile.tier_expires_at) > now;
  const currentRank = currentlyActive ? (TIER_RANK[profile!.tier] ?? 0) : 0;
  const codeRank = TIER_RANK[claimed.tier] ?? 0;

  const newTier = codeRank > currentRank ? claimed.tier : profile?.tier ?? claimed.tier;
  const base = currentlyActive ? Date.parse(profile!.tier_expires_at!) : now;
  const newExpiry = new Date(base + YEAR_MS).toISOString();

  const { error: profileError } = await db.from('profiles')
    .update({ tier: newTier, tier_expires_at: newExpiry }).eq('id', user.id);
  if (profileError) throw new HttpError(500, profileError.message);

  return json({ ok: true, tier: newTier, tierExpiresAt: newExpiry });
}));
