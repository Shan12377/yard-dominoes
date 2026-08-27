/**
 * App feedback — not player conduct (that's reports.ts). Same shape:
 * sending is a plain client insert covered by `feedback`'s own RLS policy
 * (0034), reviewing goes through the `feedback-admin` Edge Function since
 * that needs to read everyone's rows, not just the caller's own.
 */

import { supabase } from './online.ts';

function db() {
  if (!supabase) throw new Error('Feedback needs online mode — set VITE_SUPABASE_URL');
  return supabase;
}

async function call<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().functions.invoke(fn, { body });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

export async function sendFeedback(message: string, rating: number | null): Promise<void> {
  const { data: auth } = await db().auth.getUser();
  if (!auth.user) throw new Error('sign in to send feedback');
  const trimmed = message.trim();
  if (trimmed.length < 3) throw new Error('Say a little more');
  const { error } = await db().from('feedback')
    .insert({ user_id: auth.user.id, message: trimmed, rating });
  if (error) throw new Error(error.message);
}

export interface FeedbackItem {
  id: string;
  message: string;
  rating: number | null;
  created_at: string;
  status: 'open' | 'reviewed';
  sender: { id: string; username: string; tier: string } | null;
}

export const listFeedback = () => call<{ feedback: FeedbackItem[] }>('feedback-admin', { action: 'list' })
  .then((r) => r.feedback);

export const markFeedbackReviewed = (feedbackId: string) =>
  call<{ ok: true }>('feedback-admin', { action: 'review', feedbackId });
