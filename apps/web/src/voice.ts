import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Tier } from './lounges.ts';

/**
 * Table voice — a peer-to-peer WebRTC audio mesh.
 *
 * A domino table is four people, so every peer simply sends its microphone to
 * the other three directly. No SFU, no media server, no per-minute vendor
 * bill: at four seats a mesh is three outbound audio streams each (~32kbps
 * Opus), which is nothing. An SFU only earns its cost in rooms of twenty-plus,
 * and buying one for a four-hander is what made voice look unaffordable.
 *
 * Signalling rides the Supabase Realtime channel the lounge already holds, as
 * `broadcast` events addressed to one peer. No new backend, no new dependency.
 *
 * Media never touches our servers, so we never carry the audio, never store
 * it, and cannot be asked to hand it over. TURN is only a NAT relay for the
 * minority of connections that cannot go direct, and it relays encrypted
 * media it cannot read.
 */

export const SIGNAL_EVENT = 'voice-signal';

/**
 * Hearing the yard is free; talking is what membership buys.
 *
 * A guest joins listen-only — they hear the table talk, the cut-eye, the
 * argument over a blocked hand — and that is the whole pitch for upgrading.
 * It also means a guest is never asked for microphone permission, so the
 * first thing a newcomer meets is the room, not a browser dialog.
 *
 * Serving voice costs us essentially nothing (see the mesh note above), so
 * this gate is not recovering a cost. It is there because the table talk IS
 * the social layer, and the social layer is what the membership sells.
 */
export function canSpeak(tier: Tier): boolean {
  return tier !== 'guest';
}

/** Injected rather than importing online.ts directly, so this file keeps no
 *  Supabase client dependency of its own — same reasoning as video.ts's
 *  VideoCall. Cloudflare's TURN credentials are short-lived and must be
 *  generated server-side with a secret API token (see turn-credentials
 *  Edge Function); there is no static client-side credential to bake in. */
export type TurnCall = () => Promise<{ iceServers: RTCIceServer[] }>;

/**
 * Free public STUN plus, when a `call` is supplied, short-lived Cloudflare
 * TURN credentials for the minority of connections behind strict NAT that
 * STUN alone cannot traverse. TURN is additive: a failure fetching it (or
 * omitting `call` entirely) still leaves STUN-only connectivity working for
 * everyone else, so a fetch failure here is swallowed, never thrown.
 */
export async function iceServers(call?: TurnCall): Promise<RTCIceServer[]> {
  const servers: RTCIceServer[] = [
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
  ];
  if (!call) return servers;
  try {
    const { iceServers: turn } = await call();
    servers.push(...turn);
  } catch {
    // Additive only — never let a TURN-fetch failure block voice/video from
    // attempting a connection at all.
  }
  return servers;
}

/**
 * Perfect negotiation needs exactly one "polite" peer per pair, agreed without
 * talking. Comparing the two ids gives both sides the same answer with no
 * round trip: the lexicographically smaller id is always the polite one, so it
 * yields when two offers collide.
 */
export function isPolite(myId: string, peerId: string): boolean {
  return myId < peerId;
}

/**
 * A mesh is every peer talking to every other, so the connection count grows
 * with the square of the room. That is exactly right for a domino table and
 * wrong for a crowd: past a handful of live microphones the phone doing the
 * encoding, not the network, is what gives out. A lounge can hold far more
 * people than this — they simply do not all get the mic at once.
 */
export const MAX_VOICE_PEERS = 6;

/**
 * The current state of each person in a presence channel.
 *
 * Realtime keys presence to an ARRAY of metas per person, and calling
 * `track()` again appends rather than replaces — so `entries[0]` is frozen at
 * the moment they joined the room, before anyone picked up a microphone.
 * Reading the first entry meant `voice` was false for everyone forever, so
 * `diffRoster` below never had a peer to dial: both sides showed "Listening"
 * and heard nothing, with no error anywhere. Always take the newest meta.
 *
 * This lives beside `diffRoster` because it is the step immediately before it,
 * and getting it wrong disables the entire mesh silently.
 */
export function newestPresence<T>(state: Record<string, T[]>): T[] {
  return Object.values(state)
    .filter((entries) => entries.length > 0)
    .map((entries) => entries[entries.length - 1]);
}

/**
 * Who joined and who left, so connections are opened and torn down exactly
 * once. `roster` must be only the people actually on voice: being in the
 * lounge is not being on the mic, and dialling a reader opens a connection
 * they will never answer.
 *
 * Peers are taken in a stable order once the room is over the cap, so every
 * client independently agrees on the same set rather than each picking a
 * different six and half-connecting.
 */
export function diffRoster(known: Iterable<string>, roster: Iterable<string>, myId: string) {
  const before = new Set(known);
  const now = new Set(roster);
  now.delete(myId);
  const capped = new Set([...now].sort().slice(0, MAX_VOICE_PEERS));
  return {
    added: [...capped].filter((id) => !before.has(id)),
    removed: [...before].filter((id) => !capped.has(id)),
    full: now.size > MAX_VOICE_PEERS,
  };
}

export interface VoiceSpeaker {
  id: string;
  speaking: boolean;
}

export interface VoiceRoom {
  /** Stop sending audio but stay connected — you still hear the table. */
  setMuted: (muted: boolean) => void;
  muted: () => boolean;
  listenOnly: () => boolean;
  leave: () => void;
}

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  makingOffer: boolean;
  ignoreOffer: boolean;
  meter?: () => void;
}

type Signal =
  | { kind: 'sdp'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; from: string; to: string; candidate: RTCIceCandidateInit };

/**
 * Watch a stream's level and report speaking/quiet. This is what lights the
 * name in the roster, so a table can see who is talking over whom.
 */
function meterStream(
  stream: MediaStream,
  id: string,
  onSpeaking: (s: VoiceSpeaker) => void,
): () => void {
  const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!Ctx) return () => {};
  const ctx: AudioContext = new Ctx();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  const buf = new Uint8Array(analyser.frequencyBinCount);
  let speaking = false;
  let quietFrames = 0;
  let raf = 0;

  const tick = () => {
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
    const loud = peak > 8;
    // Latch on instantly, release slowly — otherwise the indicator strobes on
    // the natural gaps between words.
    if (loud) quietFrames = 0; else quietFrames++;
    const next = loud || quietFrames < 20;
    if (next !== speaking) {
      speaking = next;
      onSpeaking({ id, speaking });
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    source.disconnect();
    void ctx.close();
  };
}

/**
 * Join table voice. Returns null if the browser or the player refuses the
 * microphone — the caller keeps working, voice just stays off.
 *
 * `roster` is called by the caller whenever presence changes; the mesh opens
 * and closes connections to match.
 */
export async function joinVoice(
  channel: RealtimeChannel,
  myId: string,
  handlers: {
    /** Guests join listen-only and are never asked for a microphone. */
    speak?: boolean;
    /** Fetches short-lived TURN credentials — see iceServers()'s doc. */
    turn?: TurnCall;
    onSpeaking?: (s: VoiceSpeaker) => void;
    onError?: (message: string) => void;
  } = {},
): Promise<(VoiceRoom & { syncRoster: (ids: string[]) => void }) | null> {
  if (typeof RTCPeerConnection === 'undefined') {
    handlers.onError?.('This browser cannot do voice. Text still works.');
    return null;
  }

  // Resolved once per join, not once per peer — up to three peer
  // connections in a four-seat mesh all reuse the same short-lived
  // credential rather than each fetching their own.
  const servers = await iceServers(handlers.turn);

  let local: MediaStream | null = null;
  if (handlers.speak) {
    if (!navigator.mediaDevices?.getUserMedia) {
      handlers.onError?.('This browser cannot reach a microphone. You can still listen.');
    } else {
      try {
        local = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
      } catch {
        // Refusing the mic drops you to listen-only rather than out of voice.
        handlers.onError?.('Microphone blocked. You can still hear the table.');
      }
    }
  }

  const peers = new Map<string, Peer>();
  let muted = false;
  let left = false;

  const stopLocalMeter = local && handlers.onSpeaking
    ? meterStream(local, myId, (s) => handlers.onSpeaking!({ ...s, speaking: s.speaking && !muted }))
    : () => {};

  const send = (signal: Signal) =>
    void channel.send({ type: 'broadcast', event: SIGNAL_EVENT, payload: signal });

  function connect(peerId: string): Peer {
    const existing = peers.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: servers });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    const peer: Peer = { pc, audio, makingOffer: false, ignoreOffer: false };
    peers.set(peerId, peer);

    // Both sides add media as soon as they meet, so both fire
    // `negotiationneeded` and the polite/impolite rule settles the collision.
    // A listener adds a receive-only slot instead, which negotiates the same
    // way and keeps the mesh symmetric.
    if (local) for (const track of local.getTracks()) pc.addTrack(track, local);
    else pc.addTransceiver('audio', { direction: 'recvonly' });

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) send({ kind: 'ice', from: myId, to: peerId, candidate: candidate.toJSON() });
    };

    pc.ontrack = ({ streams }) => {
      const [stream] = streams;
      if (!stream) return;
      audio.srcObject = stream;
      // Autoplay can be refused until the player has interacted with the page;
      // they joined voice by tapping a button, so this normally resolves.
      void audio.play().catch(() => {});
      peer.meter?.();
      peer.meter = handlers.onSpeaking ? meterStream(stream, peerId, handlers.onSpeaking) : undefined;
    };

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) {
          send({ kind: 'sdp', from: myId, to: peerId, sdp: pc.localDescription.toJSON() });
        }
      } catch {
        // A failed offer is retried by the next negotiationneeded.
      } finally {
        peer.makingOffer = false;
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce();
    };

    return peer;
  }

  function drop(peerId: string) {
    const peer = peers.get(peerId);
    if (!peer) return;
    peer.meter?.();
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onnegotiationneeded = null;
    peer.pc.close();
    peer.audio.srcObject = null;
    peers.delete(peerId);
    handlers.onSpeaking?.({ id: peerId, speaking: false });
  }

  channel.on('broadcast', { event: SIGNAL_EVENT }, async ({ payload }) => {
    const signal = payload as Signal;
    if (left || signal.to !== myId || signal.from === myId) return;

    const peer = connect(signal.from);
    const { pc } = peer;
    const polite = isPolite(myId, signal.from);

    try {
      if (signal.kind === 'ice') {
        try {
          await pc.addIceCandidate(signal.candidate);
        } catch (err) {
          // Candidates that arrive during a discarded offer are expected.
          if (!peer.ignoreOffer) throw err;
        }
        return;
      }

      const collision = signal.sdp.type === 'offer'
        && (peer.makingOffer || pc.signalingState !== 'stable');
      peer.ignoreOffer = !polite && collision;
      if (peer.ignoreOffer) return;

      await pc.setRemoteDescription(signal.sdp);
      if (signal.sdp.type === 'offer') {
        await pc.setLocalDescription();
        if (pc.localDescription) {
          send({ kind: 'sdp', from: myId, to: signal.from, sdp: pc.localDescription.toJSON() });
        }
      }
    } catch {
      handlers.onError?.('Lost a voice connection. Trying again.');
    }
  });

  return {
    /** Open a connection to everyone new, tear down everyone gone. */
    syncRoster(ids: string[]) {
      if (left) return;
      const { added, removed } = diffRoster(peers.keys(), ids, myId);
      for (const id of added) connect(id);
      for (const id of removed) drop(id);
    },
    setMuted(next: boolean) {
      muted = next;
      if (local) for (const track of local.getAudioTracks()) track.enabled = !next;
      if (next) handlers.onSpeaking?.({ id: myId, speaking: false });
    },
    muted: () => muted,
    /** True when we have no microphone — a guest, or the mic was refused. */
    listenOnly: () => local === null,
    leave() {
      left = true;
      stopLocalMeter();
      for (const id of [...peers.keys()]) drop(id);
      if (local) for (const track of local.getTracks()) track.stop();
    },
  };
}
