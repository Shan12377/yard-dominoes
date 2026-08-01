/**
 * Player conduct reports. Filing one is a plain client insert — `reports`'
 * own RLS policy (0001) already scopes it to `reporter_id = auth.uid()`, the
 * same shape as `sendMessage` in lounges.ts. Reviewing one is admin-only and
 * goes through the `report-admin` Edge Function, since that needs to read
 * every report, not just the caller's own.
 */

import { supabase } from './online.ts';

function db() {
  if (!supabase) throw new Error('Reports need online mode — set VITE_SUPABASE_URL');
  return supabase;
}

async function call<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().functions.invoke(fn, { body });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

/** Filed by anyone at a table about anyone else — never about yourself,
 *  the terms' promised "report button" this had no UI behind until now. */
export async function fileReport(reportedId: string, tableId: string, reason: string): Promise<void> {
  const { data: auth } = await db().auth.getUser();
  if (!auth.user) throw new Error('sign in to report');
  const trimmed = reason.trim();
  if (trimmed.length < 3) throw new Error('Say a little about what happened');
  const { error } = await db().from('reports').insert({
    reporter_id: auth.user.id, reported_id: reportedId, table_id: tableId, reason: trimmed,
  });
  if (error) throw new Error(error.message);
}

export interface Report {
  id: string;
  reason: string;
  created_at: string;
  status: 'open' | 'resolved' | 'dismissed';
  table_id: string | null;
  reporter: { id: string; username: string } | null;
  reported: { id: string; username: string } | null;
}

export const listReports = () => call<{ reports: Report[] }>('report-admin', { action: 'list' })
  .then((r) => r.reports);

export const resolveReport = (reportId: string) =>
  call<{ ok: true }>('report-admin', { action: 'resolve', reportId });

export const dismissReport = (reportId: string) =>
  call<{ ok: true }>('report-admin', { action: 'dismiss', reportId });
