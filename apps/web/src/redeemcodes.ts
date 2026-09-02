/**
 * Comp codes — a free Yardie/VIP term redeemed instead of paid.
 * redeemCode() is self-serve, for anyone handed a code. The admin*
 * functions are owner-only (see redeem-admin's is_owner gate) and used
 * from the admin dashboard to generate and track them.
 */

import { supabase } from './online.ts';

function db() {
  if (!supabase) throw new Error('Redeeming a code needs online mode — set VITE_SUPABASE_URL');
  return supabase;
}

async function call<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().functions.invoke(fn, { body });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

/** Applies the code to the caller's own account. Never downgrades an
 *  existing higher tier — only extends it. */
export const redeemCode = (code: string) =>
  call<{ tier: string; tierExpiresAt: string }>('redeem-code', { code });

export interface RedeemCodeRow {
  id: string;
  code: string;
  tier: 'yardie' | 'vip';
  createdAt: string;
  redeemedAt: string | null;
  redeemedByUsername: string | null;
}

/** Owner only. Mints one fresh, unused code for the given tier. */
export const generateRedeemCode = (tier: 'yardie' | 'vip') =>
  call<{ code: string; tier: string; createdAt: string }>('redeem-admin', { action: 'generate', tier });

/** Owner only. Every code ever generated, newest first. */
export const listRedeemCodes = () =>
  call<{ codes: RedeemCodeRow[] }>('redeem-admin', { action: 'list' }).then((r) => r.codes);
