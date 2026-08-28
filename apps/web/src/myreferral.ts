/**
 * Self-serve referral code — a player's OWN code and stats, via the
 * `referrals` Edge Function. Not to be confused with referraladmin.ts,
 * which is the admin-only view across everyone's codes.
 */

import { supabase } from './online.ts';

function db() {
  if (!supabase) throw new Error('Referrals need online mode — set VITE_SUPABASE_URL');
  return supabase;
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().functions.invoke('referrals', { body });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

export interface MyReferralCode {
  code: string;
  commissionPct: number;
  active: boolean;
  referredCount: number;
  totalEarnedCents: number;
  paidCents: number;
  pendingPayoutCents: number;
  availableToCashOutCents: number;
}

/** null if this player has never become a referrer. */
export const myReferralCode = () =>
  call<{ code: MyReferralCode | null }>({ action: 'mine' }).then((r) => r.code);

/** Idempotent — returns the existing code if already a referrer. */
export const becomeReferrer = () =>
  call<{ code: string; commissionPct: number; active: boolean }>({ action: 'become' });

/** Requests everything currently available be paid out. One open request
 *  at a time — the server rejects a second while one is still pending. */
export const requestCashout = (email: string) =>
  call<{ requestedCents: number }>({ action: 'cashout', email });
