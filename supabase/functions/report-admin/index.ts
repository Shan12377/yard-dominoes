// POST /report-admin  { action, ... }
//
// Reviewing player conduct reports. Same shape as tournament-host: one
// function, one gate at the top, nothing below it runs until the gate
// passes. `is_admin` holds no database privilege of its own — this function
// reads it under service_role and that is the entire enforcement. Filing a
// report does NOT go through here; that's a plain client insert already
// covered by reports' own RLS policy (0001) — this function is only ever
// reached by someone reviewing them.

import { handled, json, requireUser, serviceClient, HttpError } from '../_shared/lib.ts';

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const body = await req.json() as Record<string, any>;
  const action = String(body.action ?? '');
  const db = serviceClient();

  const { data: me } = await db.from('profiles').select('is_admin').eq('id', user.id).single();
  if (!me?.is_admin) throw new HttpError(403, 'admin only');

  if (action === 'list') {
    // Reporter and reported usernames, not just ids — an admin reviewing a
    // report needs to know who without a second round trip.
    const { data, error } = await db.from('reports')
      .select('id, reason, created_at, status, table_id, reporter:reporter_id(id, username), reported:reported_id(id, username)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new HttpError(500, error.message);
    return json({ ok: true, reports: data });
  }

  if (action === 'resolve' || action === 'dismiss') {
    const status = action === 'resolve' ? 'resolved' : 'dismissed';
    if (!body.reportId) throw new HttpError(422, 'which report?');
    const { error } = await db.from('reports')
      .update({ status }).eq('id', body.reportId);
    if (error) throw new HttpError(500, error.message);
    return json({ ok: true, status });
  }

  // Lets an existing admin hand the role on without anyone running SQL —
  // the whole point of building this function was to get is_admin out of
  // "ask Claude to run a query" and into a panel a non-technical host can use.
  if (action === 'list-admins') {
    const { data, error } = await db.from('profiles')
      .select('id, username').eq('is_admin', true).order('username');
    if (error) throw new HttpError(500, error.message);
    return json({ ok: true, admins: data });
  }

  if (action === 'grant-admin') {
    const username = String(body.username ?? '').trim();
    if (!username) throw new HttpError(422, 'which username?');
    const { data: target, error: findError } = await db.from('profiles')
      .select('id, username, is_admin').ilike('username', username).maybeSingle();
    if (findError) throw new HttpError(500, findError.message);
    if (!target) throw new HttpError(404, `no player called "${username}"`);
    if (target.is_admin) return json({ ok: true, username: target.username, already: true });
    const { error } = await db.from('profiles').update({ is_admin: true }).eq('id', target.id);
    if (error) throw new HttpError(500, error.message);
    return json({ ok: true, username: target.username });
  }

  if (action === 'revoke-admin') {
    const userId = String(body.userId ?? '');
    if (!userId) throw new HttpError(422, 'which admin?');
    // Never let the panel revoke its own last door — that would put is_admin
    // back to SQL-only, exactly the thing this function exists to avoid.
    if (userId === user.id) {
      const { count } = await db.from('profiles')
        .select('id', { count: 'exact', head: true }).eq('is_admin', true);
      if ((count ?? 0) <= 1) {
        throw new HttpError(409, "you're the only admin — make someone else admin first");
      }
    }
    const { error } = await db.from('profiles').update({ is_admin: false }).eq('id', userId);
    if (error) throw new HttpError(500, error.message);
    return json({ ok: true });
  }

  throw new HttpError(400, `unknown action: ${action}`);
}));
