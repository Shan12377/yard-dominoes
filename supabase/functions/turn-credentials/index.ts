// POST /turn-credentials  {}
//
// Short-lived Cloudflare TURN credentials for voice.ts's P2P mesh and
// video.ts's SFU leg, both via the same iceServers() helper. Cloudflare's
// TURN service issues credentials server-side against a secret API token —
// there is no static client-side credential to bake into VITE_* env vars,
// which is what the old iceServers() implementation assumed before this
// function existed. See .claude/rules/voice.md for the mesh/TURN context.
//
// No tier gate: even a listen-only guest's RTCPeerConnection needs real
// connectivity to receive audio from a speaker behind strict NAT, and
// Cloudflare's TURN service is free at this project's scale (voice.md).
// Unlike video-session, nothing here costs per-call Cloudflare usage beyond
// issuing a credential, so there is no VIP/seated check to make.
//
// Deliberately self-contained (not importing ../_shared/lib.ts) — this
// function needs none of the game-state helpers that file also carries
// (HandRow, toState, persist, the engine types they pull in), and a tiny
// endpoint like this is clearer standing on its own than pulling in that
// whole dependency chain for three small helpers.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors } });

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function requireUser(req: Request): Promise<void> {
  const auth = req.headers.get('Authorization');
  if (!auth) throw new HttpError(401, 'sign in first');
  const anon = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } },
  );
  const { data, error } = await anon.auth.getUser();
  if (error || !data.user) throw new HttpError(401, 'sign in first');
}

// Comfortably longer than any real hand or lounge session; short enough
// that a leaked credential (logs, a compromised client) stops working on
// its own rather than lingering indefinitely.
const TTL_SECONDS = 6 * 60 * 60;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    await requireUser(req);

    const keyId = Deno.env.get('CLOUDFLARE_TURN_KEY_ID');
    const token = Deno.env.get('CLOUDFLARE_TURN_KEY_API_TOKEN');
    if (!keyId || !token) throw new HttpError(500, 'TURN is not configured on this server yet');

    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ttl: TTL_SECONDS }),
      },
    );
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.iceServers) {
      // Cloudflare's own error, surfaced but never leaks the API token.
      throw new HttpError(502, `TURN service error (${res.status})`);
    }
    return json({ iceServers: data.iceServers });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'something went wrong' }, 500);
  }
});
