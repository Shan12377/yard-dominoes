// POST /referral-admin  { action: 'list' | 'listPayouts' | 'markPaid' }
//
// Same shape as report-admin/feedback-admin, but gated on is_owner, not
// is_admin (0052) — this is real money (who's owed what, cash-out
// requests, marking them paid), and a future admin granted for ordinary
// report/feedback moderation must not automatically also see it. Narrower
// than every other admin function in this codebase on purpose.
//
// referral_codes and referral_commissions are RLS-restricted to their own
// owner (0045_referrals.sql) — an owner-tier admin still isn't THAT owner,
// so this reads under service_role rather than widening those RLS policies
// to "or is_owner", which would be a second, easier-to-miss path into the
// same data.

import { handled, json, requireUser, serviceClient, HttpError } from '../_shared/lib.ts';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const body = await req.json() as Record<string, any>;
  const action = String(body.action ?? '');
  const db = serviceClient();

  const { data: me } = await db.from('profiles').select('is_owner').eq('id', user.id).single();
  if (!me?.is_owner) throw new HttpError(403, 'owner only');

  if (action === 'list') {
    const { data: codes, error: codesError } = await db.from('referral_codes')
      .select('id, code, owner_user_id, commission_pct, active, created_at, owner:owner_user_id(username)')
      .order('created_at', { ascending: false });
    if (codesError) throw new HttpError(500, codesError.message);

    const { data: commissions, error: commissionsError } = await db.from('referral_commissions')
      .select('referral_code_id, referred_user_id, amount_cents');
    if (commissionsError) throw new HttpError(500, commissionsError.message);

    const stats = new Map<string, { referredUserIds: Set<string>; totalCents: number }>();
    for (const c of commissions ?? []) {
      const s = stats.get(c.referral_code_id) ?? { referredUserIds: new Set<string>(), totalCents: 0 };
      s.referredUserIds.add(c.referred_user_id);
      s.totalCents += c.amount_cents;
      stats.set(c.referral_code_id, s);
    }

    const { data: payouts, error: payoutsError } = await db.from('referral_payouts')
      .select('referral_code_id, status, amount_cents');
    if (payoutsError) throw new HttpError(500, payoutsError.message);
    const paidByCode = new Map<string, number>();
    const openRequestByCode = new Set<string>();
    for (const p of payouts ?? []) {
      if (p.status === 'paid') paidByCode.set(p.referral_code_id, (paidByCode.get(p.referral_code_id) ?? 0) + p.amount_cents);
      else openRequestByCode.add(p.referral_code_id);
    }

    // Email lives in auth.users, not public.profiles — most players are
    // anonymous by design (CLAUDE.md's "no login wall") and have none at
    // all. Only a referrer who secureAccount()'d (email/password) has one
    // to show; the Admin API is the supported way to read it, not reaching
    // into auth.users directly. One lookup per DISTINCT owner, not per
    // code — a referrer only ever has one code (0049's unique constraint),
    // but this stays correct even if that ever changes.
    const ownerIds = [...new Set((codes ?? []).map((row: any) => row.owner_user_id))];
    const emailByOwner = new Map<string, string | null>();
    for (const ownerId of ownerIds) {
      const { data } = await db.auth.admin.getUserById(ownerId);
      emailByOwner.set(ownerId, data.user?.email ?? null);
    }

    const result = (codes ?? []).map((row: any) => {
      const s = stats.get(row.id);
      const totalEarnedCents = s?.totalCents ?? 0;
      const paidCents = paidByCode.get(row.id) ?? 0;
      return {
        id: row.id,
        code: row.code,
        ownerUsername: row.owner?.username ?? 'unknown',
        ownerEmail: emailByOwner.get(row.owner_user_id) ?? null,
        commissionPct: row.commission_pct,
        active: row.active,
        createdAt: row.created_at,
        referredCount: s?.referredUserIds.size ?? 0,
        totalEarnedCents,
        // What's actually still owed right now — lifetime earned minus
        // whatever's already been paid out. This is what used to be called
        // totalOwedCents before payouts existed; kept the same field name
        // since every caller already reads it that way, just corrected to
        // net rather than gross now that "paid" is a real state.
        totalOwedCents: totalEarnedCents - paidCents,
        hasOpenPayoutRequest: openRequestByCode.has(row.id),
      };
    });
    return json({ ok: true, codes: result });
  }

  if (action === 'listPayouts') {
    const { data: payouts, error } = await db.from('referral_payouts')
      .select('id, referral_code_id, owner_user_id, contact_email, amount_cents, status, requested_at, paid_at, '
        + 'code:referral_code_id(code), owner:owner_user_id(username)')
      .order('requested_at', { ascending: true });
    if (error) throw new HttpError(500, error.message);
    return json({
      ok: true,
      payouts: (payouts ?? []).map((row: any) => ({
        id: row.id,
        ownerUsername: row.owner?.username ?? 'unknown',
        code: row.code?.code ?? 'unknown',
        contactEmail: row.contact_email,
        amountCents: row.amount_cents,
        status: row.status,
        requestedAt: row.requested_at,
        paidAt: row.paid_at,
      })),
    });
  }

  if (action === 'markPaid') {
    if (!body.payoutId) throw new HttpError(422, 'which request?');
    const { error } = await db.from('referral_payouts')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', body.payoutId).eq('status', 'requested');
    if (error) throw new HttpError(500, error.message);
    return json({ ok: true });
  }

  throw new HttpError(400, `unknown action: ${action}`);
}));
