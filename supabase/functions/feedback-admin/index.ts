// POST /feedback-admin  { action, ... }
//
// Reviewing app feedback. Same shape as report-admin: one function, one gate
// at the top, nothing below it runs until the gate passes. Sending feedback
// does NOT go through here — that's a plain client insert already covered
// by feedback's own RLS policy (0034) — this function is only ever reached
// by someone reviewing it.

import { handled, json, requireUser, serviceClient, HttpError } from '../_shared/lib.ts';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const body = await req.json() as Record<string, any>;
  const action = String(body.action ?? '');
  const db = serviceClient();

  const { data: me } = await db.from('profiles').select('is_admin').eq('id', user.id).single();
  if (!me?.is_admin) throw new HttpError(403, 'admin only');

  if (action === 'list') {
    // Sender's username and tier, not just an id — an admin triaging
    // feedback needs to know who without a second round trip.
    const { data, error } = await db.from('feedback')
      .select('id, message, rating, created_at, status, sender:user_id(id, username, tier)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new HttpError(500, error.message);
    return json({ ok: true, feedback: data });
  }

  if (action === 'review') {
    if (!body.feedbackId) throw new HttpError(422, 'which item?');
    const { error } = await db.from('feedback')
      .update({ status: 'reviewed' }).eq('id', body.feedbackId);
    if (error) throw new HttpError(500, error.message);
    return json({ ok: true });
  }

  throw new HttpError(400, `unknown action: ${action}`);
}));
