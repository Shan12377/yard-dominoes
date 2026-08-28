/**
 * Admin-only view of referral codes and what they've earned. Sending/
 * reading a referrer's OWN codes never needs this — referral_codes' RLS
 * (0045) already covers that. This goes through the referral-admin Edge
 * Function because an admin needs every code's stats, not just their own.
 */

import { supabase } from './online.ts';

function db() {
  if (!supabase) throw new Error('Referral admin needs online mode — set VITE_SUPABASE_URL');
  return supabase;
}

async function call<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().functions.invoke(fn, { body });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

export interface ReferralCodeStats {
  id: string;
  code: string;
  ownerUsername: string;
  /** null for an anonymous guest referrer — most players, by design. Only
   *  set once they've secureAccount()'d with an email. */
  ownerEmail: string | null;
  commissionPct: number;
  active: boolean;
  createdAt: string;
  referredCount: number;
  totalOwedCents: number;
}

export const listReferralStats = () =>
  call<{ codes: ReferralCodeStats[] }>('referral-admin', { action: 'list' }).then((r) => r.codes);
