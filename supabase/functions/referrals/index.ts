// POST /referrals  { action: 'become' | 'mine' | 'cashout' }
//
// Self-serve counterpart to referral-admin: any signed-in player managing
// their OWN code, not an admin looking at everyone's. Code generation and
// the commission rate are decided here, server-side, under service_role —
// never accepted from the client — so a player can't hand themselves a
// nicer code string or a higher cut than the public rate. The two founding
// helpers' 20% codes stay hand-granted by an admin (referral_codes has no
// client insert policy at all); this path only ever writes PUBLIC_PCT, so
// the founders' rate stays a deliberately different, standout number
// rather than something self-serve could ever reach.
//
// Public rate is 5% recurring cash, not 10% — the other half of that
// original 10% moved to a one-time 100-coin bonus for the referrer plus a
// one-time 5% checkout discount for the person they referred (both paid
// only on the referred player's FIRST payment — see
// creditReferralCommission in _shared/referrals.ts and the
// STRIPE_COUPON_REFERRAL_WELCOME coupon in checkout/index.ts). Coins cost
// the business nothing to grant, so this trades ongoing cash for a
// one-time, near-zero-marginal-cost reward without shrinking what the
// referrer actually gets offered.

import { handled, json, requireUser, serviceClient, HttpError } from '../_shared/lib.ts';

const PUBLIC_COMMISSION_PCT = 5;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — read out loud without confusion

function randomSuffix(len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function codeSlug(username: string): string {
  const clean = username.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  return clean || 'PLAYER';
}

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const body = await req.json() as Record<string, any>;
  const action = String(body.action ?? '');
  const db = serviceClient();

  if (action === 'become') {
    const { data: existing } = await db.from('referral_codes')
      .select('id, code, commission_pct, active').eq('owner_user_id', user.id).maybeSingle();
    if (existing) return json({ ok: true, code: existing.code, commissionPct: existing.commission_pct, active: existing.active });

    const { data: profile } = await db.from('profiles').select('username').eq('id', user.id).single();
    const slug = codeSlug(profile?.username ?? 'PLAYER');

    // A handful of retries on the unique constraint rather than a fancier
    // collision scheme — the suffix space (33^4 ≈ 1.19M) makes a second
    // collision on the same slug vanishingly unlikely. Two DIFFERENT unique
    // constraints can fire a 23505 here: `code` (the rare collision this
    // loop is for) and `referral_codes_owner_unique` (0049) — a genuine
    // race between two concurrent calls for the same caller, e.g. a
    // double-click or two tabs, since the check above and this insert are
    // not atomic. On any 23505, re-check for an existing row first: if the
    // race is what happened, this returns the row the other request just
    // created instead of endlessly retrying a collision that was never
    // about the code string at all.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = `${slug}${randomSuffix(4)}`;
      const { data: inserted, error } = await db.from('referral_codes')
        .insert({ owner_user_id: user.id, code, commission_pct: PUBLIC_COMMISSION_PCT })
        .select('code, commission_pct, active').single();
      if (!error) return json({ ok: true, code: inserted.code, commissionPct: inserted.commission_pct, active: inserted.active });
      if (error.code !== '23505') throw new HttpError(500, error.message); // not a unique violation — stop retrying

      const { data: wonTheRace } = await db.from('referral_codes')
        .select('code, commission_pct, active').eq('owner_user_id', user.id).maybeSingle();
      if (wonTheRace) return json({ ok: true, code: wonTheRace.code, commissionPct: wonTheRace.commission_pct, active: wonTheRace.active });
      // No row for this owner yet — the 23505 was a real code-string
      // collision, not the owner race. Loop and try a fresh suffix.
    }
    throw new HttpError(500, 'could not generate a unique code, try again');
  }

  if (action === 'mine') {
    const { data: code } = await db.from('referral_codes')
      .select('id, code, commission_pct, active').eq('owner_user_id', user.id).maybeSingle();
    if (!code) return json({ ok: true, code: null });

    const { data: commissions } = await db.from('referral_commissions')
      .select('referred_user_id, amount_cents').eq('referral_code_id', code.id);
    const referredUserIds = new Set((commissions ?? []).map((c) => c.referred_user_id));
    const totalEarnedCents = (commissions ?? []).reduce((sum, c) => sum + c.amount_cents, 0);

    const { data: payouts } = await db.from('referral_payouts')
      .select('status, amount_cents').eq('referral_code_id', code.id);
    const paidCents = (payouts ?? []).filter((p) => p.status === 'paid')
      .reduce((sum, p) => sum + p.amount_cents, 0);
    const pendingPayoutCents = (payouts ?? []).filter((p) => p.status === 'requested')
      .reduce((sum, p) => sum + p.amount_cents, 0);
    const availableToCashOutCents = totalEarnedCents - paidCents - pendingPayoutCents;

    return json({
      ok: true,
      code: {
        code: code.code,
        commissionPct: code.commission_pct,
        active: code.active,
        referredCount: referredUserIds.size,
        totalEarnedCents,
        paidCents,
        pendingPayoutCents,
        availableToCashOutCents,
      },
    });
  }

  if (action === 'cashout') {
    const email = String(body.email ?? '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422, 'a real email is needed to be paid');

    const { data: code } = await db.from('referral_codes')
      .select('id, active').eq('owner_user_id', user.id).maybeSingle();
    if (!code) throw new HttpError(404, 'you are not a referrer yet');

    const { data: commissions } = await db.from('referral_commissions')
      .select('amount_cents').eq('referral_code_id', code.id);
    const totalEarnedCents = (commissions ?? []).reduce((sum, c) => sum + c.amount_cents, 0);

    const { data: payouts } = await db.from('referral_payouts')
      .select('status, amount_cents').eq('referral_code_id', code.id);
    const alreadyClaimedCents = (payouts ?? []).reduce((sum, p) => sum + p.amount_cents, 0);
    const availableCents = totalEarnedCents - alreadyClaimedCents;
    if (availableCents <= 0) throw new HttpError(422, 'nothing available to cash out yet');

    // Unique index (0051) enforces at most one open request per code — this
    // check is just for a clean error message instead of a raw 23505.
    const hasOpenRequest = (payouts ?? []).some((p) => p.status === 'requested');
    if (hasOpenRequest) throw new HttpError(409, 'a cash-out request is already pending');

    const { error } = await db.from('referral_payouts').insert({
      referral_code_id: code.id,
      owner_user_id: user.id,
      contact_email: email,
      amount_cents: availableCents,
    });
    if (error) {
      if (error.code === '23505') throw new HttpError(409, 'a cash-out request is already pending');
      throw new HttpError(500, error.message);
    }
    return json({ ok: true, requestedCents: availableCents });
  }

  throw new HttpError(400, `unknown action: ${action}`);
}));
