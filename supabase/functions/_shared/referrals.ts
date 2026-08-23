// Credits a referrer's commission the moment a referred member pays — first
// payment (checkout.session.completed) and every renewal (invoice.paid) both
// call this from stripe-webhook. Idempotent on `reference` (the Stripe
// session or invoice id), same discipline as payments.stripe_session_id: a
// Stripe retry of the same event must never double-credit.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export async function creditReferralCommission(
  db: SupabaseClient,
  userId: string,
  amountCents: number,
  reference: string,
): Promise<void> {
  if (amountCents <= 0) return;

  const { data: profile } = await db.from('profiles')
    .select('referred_by_code_id').eq('id', userId).maybeSingle();
  if (!profile?.referred_by_code_id) return;

  const { data: code } = await db.from('referral_codes')
    .select('id, owner_user_id, commission_pct, active')
    .eq('id', profile.referred_by_code_id).maybeSingle();
  if (!code?.active) return;

  const commissionCents = Math.round(amountCents * (Number(code.commission_pct) / 100));
  if (commissionCents <= 0) return;

  const { error } = await db.from('referral_commissions').upsert({
    referral_code_id: code.id,
    owner_user_id: code.owner_user_id,
    referred_user_id: userId,
    stripe_reference: reference,
    amount_cents: commissionCents,
  }, { onConflict: 'stripe_reference', ignoreDuplicates: true });
  if (error) console.error('creditReferralCommission failed', error);
}
