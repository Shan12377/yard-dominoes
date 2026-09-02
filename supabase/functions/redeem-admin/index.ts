// POST /redeem-admin  { action: 'generate' | 'list' }
//
// Owner-only, same gate as referral-admin (0052's is_owner, not is_admin) —
// minting a free year of membership is a real cost decision, not ordinary
// report/feedback moderation, so a future admin granted for other reasons
// must not automatically also get to give away memberships.
//
// 'generate' is meant to be called ahead of time, with nobody waiting on
// the other end — the whole point is a code sitting ready in the owner's
// pocket for whenever someone asks, not something minted live in front of
// them.

import { handled, json, requireUser, serviceClient, HttpError } from '../_shared/lib.ts';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — read out loud without confusion

function randomCode(len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const body = await req.json() as Record<string, any>;
  const action = String(body.action ?? '');
  const db = serviceClient();

  const { data: me } = await db.from('profiles').select('is_owner').eq('id', user.id).single();
  if (!me?.is_owner) throw new HttpError(403, 'owner only');

  if (action === 'generate') {
    const tier = String(body.tier ?? '');
    if (!['yardie', 'vip'].includes(tier)) throw new HttpError(422, 'tier must be yardie or vip');

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode(6);
      const { data: inserted, error } = await db.from('redeem_codes')
        .insert({ code, tier, created_by: user.id })
        .select('code, tier, created_at').single();
      if (!error) return json({ ok: true, code: inserted.code, tier: inserted.tier, createdAt: inserted.created_at });
      if (error.code !== '23505') throw new HttpError(500, error.message);
      // Unique collision on the code string — vanishingly rare at this
      // length, but loop and try a fresh one rather than fail the request.
    }
    throw new HttpError(500, 'could not generate a unique code, try again');
  }

  if (action === 'list') {
    const { data: codes, error } = await db.from('redeem_codes')
      .select('id, code, tier, created_at, redeemed_at, redeemer:redeemed_by(username)')
      .order('created_at', { ascending: false });
    if (error) throw new HttpError(500, error.message);
    return json({
      ok: true,
      codes: (codes ?? []).map((row: any) => ({
        id: row.id,
        code: row.code,
        tier: row.tier,
        createdAt: row.created_at,
        redeemedAt: row.redeemed_at,
        redeemedByUsername: row.redeemer?.username ?? null,
      })),
    });
  }

  throw new HttpError(400, `unknown action: ${action}`);
}));
