import { iceServers } from './voice.ts';
import type { Tier } from './lounges.ts';

/**
 * Table video — VIP-gated, via Cloudflare Realtime (Calls), an SFU.
 *
 * This is architecturally NOT voice.ts's mesh. Video at even modest quality
 * is too much simultaneous upload for a mesh on mobile data (plan §7.2's
 * math: ~1.5-3Mbps uploading to three peers at once), which is exactly the
 * problem an SFU solves — one connection to Cloudflare, Cloudflare fans the
 * track out. So every seat holds exactly ONE RTCPeerConnection here, never
 * one per peer, and there is no mesh cap or glare/politeness dance to get
 * right the way voice.ts has to.
 *
 * The server side of this (supabase/functions/video-session) is the only
 * thing holding Cloudflare's App Secret. This module never talks to
 * Cloudflare's control-plane API directly — every session/track/renegotiate
 * call is proxied through that Edge Function, which re-checks VIP +
 * actually-seated on every single call. Unlike the mic (free, so
 * client-side-only canSpeak() is fine per voice.md), each video session here
 * costs real Cloudflare usage — the server-side gate is not optional.
 */

export const CAMERA_TRACK_NAME = 'camera';

/**
 * Seeing the yard is the same kind of membership perk as talking is
 * (voice.ts's canSpeak) — bundled into VIP, not a separate purchase or a new
 * tier (plan §7.2's pricing decision, made explicitly to avoid the
 * bait-and-switch of paywalling something that could have shipped free).
 */
export function canShowVideo(tier: Tier): boolean {
  return tier === 'vip';
}

type Action = 'create' | 'push' | 'pull' | 'renegotiate' | 'stop';

/** The one thing this module needs from the caller: a way to invoke the
 *  video-session Edge Function. Injected rather than imported from online.ts
 *  so this file has no Supabase client dependency of its own to mock in tests. */
export type VideoCall = (action: Action, body: Record<string, unknown>) => Promise<any>;

export interface RemotePeer {
  userId: string;
  sessionId: string;
  trackName: string;
}

export interface VideoRoom {
  /** Stop sending camera but stay connected to whoever you're already watching. */
  setCameraOff: (off: boolean) => void;
  cameraOff: () => boolean;
  /** This seat's own Cloudflare Realtime session id, for the caller to
   *  announce over presence so other seats know what to pull. */
  sessionId: () => string | null;
  /** The stream for a peer's video element, once pulled — null until then. */
  streamFor: (userId: string) => MediaStream | null;
  /** Pull anyone new, drop anyone who stopped. Call whenever presence changes,
   *  same shape as voice.ts's syncRoster. Fire-and-forget: pulls happen one at
   *  a time internally so they never collide on the shared PeerConnection. */
  syncPeers: (peers: RemotePeer[]) => void;
  /** Your own outgoing camera, for a local self-preview tile — never touches
   *  the network itself, the RTCPeerConnection above already carries the
   *  track to Cloudflare. Null once left; reflects setCameraOff's disabled
   *  track same as everyone else's pulled copy of you would. */
  localStream: () => MediaStream | null;
  leave: () => void;
}

interface PulledPeer {
  userId: string;
  sessionId: string;
  stream: MediaStream | null;
}

/**
 * Join table video. Returns null if the camera is refused or the browser
 * cannot do it — video is additive, same rule as voice.md's for the mic: a
 * refusal degrades this feature off, never takes anything else down.
 */
export async function joinVideo(
  tableId: string,
  call: VideoCall,
  handlers: {
    onError?: (message: string) => void;
    onStream?: (userId: string, stream: MediaStream | null) => void;
  } = {},
): Promise<VideoRoom | null> {
  if (typeof RTCPeerConnection === 'undefined') {
    handlers.onError?.('This browser cannot do video.');
    return null;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    handlers.onError?.('This browser cannot reach a camera.');
    return null;
  }

  let camera: MediaStream;
  try {
    camera = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 20 } },
      audio: false,
    });
  } catch {
    handlers.onError?.('Camera blocked. Table video stays off.');
    return null;
  }
  // A stream with no video track is not something getUserMedia({video:true})
  // should ever hand back, but a broken device driver is exactly the kind
  // of thing that happens on someone's real Android phone and nowhere in
  // testing — fail the same clean way a refused permission does.
  if (camera.getVideoTracks().length === 0) {
    for (const t of camera.getTracks()) t.stop();
    handlers.onError?.('No usable camera found. Table video stays off.');
    return null;
  }

  const pc = new RTCPeerConnection({ iceServers: iceServers() });
  let left = false;
  let sessionId: string | null = null;
  let cameraOff = false;
  const peers = new Map<string, PulledPeer>();
  // Serializes pulls onto one queue — Cloudflare's own limit is 50 calls/sec
  // per session, but the real reason is simpler: two renegotiations racing
  // the same PeerConnection is a collision worth just never risking.
  let pullQueue: Promise<void> = Promise.resolve();

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') pc.restartIce();
  };

  pc.ontrack = ({ streams }) => {
    const [stream] = streams;
    if (!stream) return;
    // Pulls are strictly sequential (see pullQueue), so at most one peer is
    // ever mid-pull with no stream yet — that peer is unambiguously the one
    // this track belongs to.
    const pending = [...peers.values()].find((p) => !p.stream);
    if (!pending) return;
    pending.stream = stream;
    handlers.onStream?.(pending.userId, stream);
  };

  try {
    const track = camera.getVideoTracks()[0];
    // The device can vanish mid-session — unplugged, another app took
    // exclusive access, a phone's camera permission revoked while backgrounded.
    // Nothing about WebRTC surfaces this on its own; the sender just keeps
    // "sending" a track that stopped producing frames, silently. Surface it
    // as a camera-off state instead of leaving a frozen or black tile up.
    track.onended = () => { if (!left) { cameraOff = true; handlers.onError?.('Camera disconnected.'); } };
    const transceiver = pc.addTransceiver(track, { direction: 'sendonly' });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const created = await call('create', { tableId });
    sessionId = created.sessionId as string;

    const pushed = await call('push', {
      tableId, sessionId,
      sdp: { sdp: offer.sdp, type: offer.type },
      mid: transceiver.mid,
      trackName: CAMERA_TRACK_NAME,
    });
    await pc.setRemoteDescription(pushed.sdp);
  } catch (err) {
    for (const t of camera.getTracks()) t.stop();
    pc.close();
    handlers.onError?.(err instanceof Error ? err.message : 'video could not start');
    return null;
  }

  async function pullOne(peer: RemotePeer) {
    if (left || !sessionId || peers.has(peer.userId)) return;
    peers.set(peer.userId, { userId: peer.userId, sessionId: peer.sessionId, stream: null });
    try {
      const result = await call('pull', {
        tableId, sessionId,
        remoteSessionId: peer.sessionId,
        remoteTrackName: peer.trackName,
      });
      if (left) return;
      if (result.requiresRenegotiation) {
        await pc.setRemoteDescription(result.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await call('renegotiate', { tableId, sessionId, sdp: { sdp: answer.sdp, type: answer.type } });
      }
    } catch {
      peers.delete(peer.userId);
      handlers.onError?.('Could not load a video feed. Their audio and tiles are unaffected.');
    }
  }

  function dropOne(userId: string) {
    const peer = peers.get(userId);
    if (!peer) return;
    peers.delete(userId);
    handlers.onStream?.(userId, null);
    // Cloudflare drops the remote track from our session once the publisher
    // stops (their own 'stop' clears their video_session_id, and a pull
    // against a cleared session simply fails next time) — nothing to tell
    // Cloudflare here, only our own bookkeeping.
  }

  return {
    setCameraOff(off: boolean) {
      cameraOff = off;
      for (const t of camera.getVideoTracks()) t.enabled = !off;
    },
    cameraOff: () => cameraOff,
    sessionId: () => sessionId,
    streamFor: (userId: string) => peers.get(userId)?.stream ?? null,
    syncPeers(next: RemotePeer[]) {
      if (left) return;
      const nextIds = new Set(next.map((p) => p.userId));
      for (const id of [...peers.keys()]) if (!nextIds.has(id)) dropOne(id);
      for (const peer of next) {
        if (peers.has(peer.userId)) continue;
        pullQueue = pullQueue.then(() => pullOne(peer));
      }
    },
    localStream: () => (left ? null : camera),
    leave() {
      left = true;
      for (const t of camera.getTracks()) t.stop();
      pc.getReceivers().forEach((r) => r.track?.stop());
      pc.close();
      if (sessionId) void call('stop', { tableId, sessionId }).catch(() => {});
      for (const userId of [...peers.keys()]) handlers.onStream?.(userId, null);
      peers.clear();
    },
  };
}
