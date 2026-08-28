// POST /referral-admin  { action: 'list' }
//
// Same shape as report-admin/feedback-admin: one gate at the top, nothing
// below it runs until it passes. referral_codes and referral_commissions
// are RLS-restricted to their own owner (0045_referrals.sql) — an admin
// isn't the owner, so this reads under service_role rather than widening
// that RLS policy to "or is_admin", which would be a second, easier-to-miss
// path into the same data.

import { handled, json, requireUser, serviceClient, HttpError } from '../_shared/lib.ts';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const body = await req.json() as Record<string, any>;
  const action = String(body.action ?? '');
  const db = serviceClient();

  const { data: me } = await db.from('profiles').select('is_admin').eq('id', user.id).single();
  if (!me?.is_admin) throw new HttpError(403, 'admin only');

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
      return {
        id: row.id,
        code: row.code,
        ownerUsername: row.owner?.username ?? 'unknown',
        ownerEmail: emailByOwner.get(row.owner_user_id) ?? null,
        commissionPct: row.commission_pct,
        active: row.active,
        createdAt: row.created_at,
        referredCount: s?.referredUserIds.size ?? 0,
        totalOwedCents: s?.totalCents ?? 0,
      };
    });
    return json({ ok: true, codes: result });
  }

  throw new HttpError(400, `unknown action: ${action}`);
}));
