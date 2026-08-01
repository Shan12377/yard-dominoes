// POST /video-session  { action, tableId, ... }
//
// The only thing that ever holds CLOUDFLARE_REALTIME_APP_SECRET, so it is
// also the only thing that ever talks to Cloudflare. A client requests
// video, this function checks VIP + actually-seated, then proxies exactly
// one Cloudflare Realtime (Calls) call and hands back only what the client
// needs to keep negotiating its own RTCPeerConnection.
//
// Cloudflare Realtime is an SFU, not the P2P mesh voice.ts uses: every seat
// holds ONE connection to Cloudflare, never to another seat directly. That
// makes the gate simpler than voice's mesh cap — there is no room-size
// blowup to defend against, just "is this caller allowed to publish or pull
// a track at all."
//
// `seats.video_session_id` (0025) is the authority for the 'pull' action.
// Lounge presence carries a client-broadcast copy of the same value for
// instant UI discovery, but presence is never trusted for anything that
// costs Cloudflare money or hands over a video stream — only this column is.

import { handled, json, requireUser, serviceClient, effectiveTier, HttpError } from '../_shared/lib.ts';

const CF_API = 'https://rtc.live.cloudflare.com/v1';

interface SDP {
  sdp: string;
  type: 'offer' | 'answer';
}

function cloudflareHeaders(): HeadersInit {
  const secret = Deno.env.get('CLOUDFLARE_REALTIME_APP_SECRET');
  if (!secret) throw new HttpError(500, 'video is not configured on this server yet');
  return { Authorization: `Bearer ${secret}`, 'content-type': 'application/json' };
}

function appPath(path: string): string {
  const appId = Deno.env.get('CLOUDFLARE_REALTIME_APP_ID');
  if (!appId) throw new HttpError(500, 'video is not configured on this server yet');
  return `${CF_API}/apps/${appId}${path}`;
}

async function cloudflare(path: string, init: { method: string; body?: unknown }) {
  const res = await fetch(appPath(path), {
    method: init.method,
    headers: cloudflareHeaders(),
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.errorCode) {
    // Cloudflare's own error, not ours — surfaced but never leaks the secret.
    throw new HttpError(502, data?.errorDescription ?? `video service error (${res.status})`);
  }
  return data;
}

/**
 * VIP + actually seated at this table. Both checked server-side on every
 * action — video is bundled into VIP (plan §7.2 pricing decision), and
 * unlike the mic gate (free P2P, deferred enforcement is fine per
 * voice.md), each session here costs real Cloudflare usage, so this cannot
 * be a client-side-only check the way canSpeak() currently is.
 */
async function requireVipSeat(db: ReturnType<typeof serviceClient>, userId: string, tableId: string) {
  const { data: profile } = await db.from('profiles')
    .select('tier, tier_expires_at').eq('id', userId).single();
  const tier = effectiveTier(profile ?? { tier: 'guest', tier_expires_at: null });
  if (tier !== 'vip') throw new HttpError(403, 'video is a VIP benefit');

  const { data: seat } = await db.from('seats')
    .select('seat_index').eq('table_id', tableId).eq('user_id', userId).maybeSingle();
  if (!seat) throw new HttpError(403, 'you are not seated at this table');
  return seat.seat_index as number;
}

Deno.serve(handled(async (req) => {
  const user = await requireUser(req);
  const body = await req.json();
  const { action, tableId } = body as { action: string; tableId: string };
  const db = serviceClient();

  const seatIndex = await requireVipSeat(db, user.id, tableId);

  switch (action) {
    // Create an empty Cloudflare session, before any track exists yet.
    case 'create': {
      const { sessionId } = await cloudflare('/sessions/new', { method: 'POST' });
      const { error } = await db.from('seats')
        .update({ video_session_id: sessionId })
        .eq('table_id', tableId).eq('seat_index', seatIndex);
      if (error) throw new HttpError(500, error.message);
      return json({ ok: true, sessionId });
    }

    // Push this seat's own camera track: send the local SDP offer (already
    // containing the video m= line), get back Cloudflare's answer.
    case 'push': {
      const { sessionId, sdp, mid, trackName } = body as {
        sessionId: string; sdp: SDP; mid: string; trackName: string;
      };
      const { data: mine } = await db.from('seats')
        .select('video_session_id').eq('table_id', tableId).eq('seat_index', seatIndex).single();
      if (mine?.video_session_id !== sessionId) throw new HttpError(403, 'not your video session');

      const result = await cloudflare(`/sessions/${sessionId}/tracks/new`, {
        method: 'POST',
        body: { sessionDescription: sdp, tracks: [{ location: 'local', mid, trackName, kind: 'video' }] },
      });
      return json({ ok: true, sdp: result.sessionDescription, trackName });
    }

    // Pull ANOTHER seat's track into this seat's own session. remoteSessionId
    // must belong to a seat actually seated at the SAME table right now —
    // checked against seats.video_session_id, not the caller's say-so.
    case 'pull': {
      const { sessionId, remoteSessionId, remoteTrackName } = body as {
        sessionId: string; remoteSessionId: string; remoteTrackName: string;
      };
      const { data: mine } = await db.from('seats')
        .select('video_session_id').eq('table_id', tableId).eq('seat_index', seatIndex).single();
      if (mine?.video_session_id !== sessionId) throw new HttpError(403, 'not your video session');

      const { data: remoteSeat } = await db.from('seats')
        .select('seat_index').eq('table_id', tableId).eq('video_session_id', remoteSessionId).maybeSingle();
      if (!remoteSeat) throw new HttpError(403, 'that session is not seated at your table');

      const result = await cloudflare(`/sessions/${sessionId}/tracks/new`, {
        method: 'POST',
        body: { tracks: [{ location: 'remote', sessionId: remoteSessionId, trackName: remoteTrackName }] },
      });
      return json({
        ok: true,
        requiresRenegotiation: Boolean(result.requiresImmediateRenegotiation),
        sdp: result.sessionDescription,
      });
    }

    // Answer a Cloudflare-initiated renegotiation (fired when a remote track
    // was just added to this seat's own session).
    case 'renegotiate': {
      const { sessionId, sdp } = body as { sessionId: string; sdp: SDP };
      const { data: mine } = await db.from('seats')
        .select('video_session_id').eq('table_id', tableId).eq('seat_index', seatIndex).single();
      if (mine?.video_session_id !== sessionId) throw new HttpError(403, 'not your video session');

      await cloudflare(`/sessions/${sessionId}/renegotiate`, {
        method: 'PUT',
        body: { sessionDescription: sdp },
      });
      return json({ ok: true });
    }

    // Stop publishing. Cloudflare sessions expire on their own once the
    // underlying connection closes; clearing the column here is what
    // actually matters — it is what closes the 'pull' gate above for
    // anyone still holding this seat's old sessionId.
    case 'stop': {
      const { error } = await db.from('seats')
        .update({ video_session_id: null })
        .eq('table_id', tableId).eq('seat_index', seatIndex);
      if (error) throw new HttpError(500, error.message);
      return json({ ok: true });
    }

    default:
      throw new HttpError(400, `unknown action: ${action}`);
  }
}));
