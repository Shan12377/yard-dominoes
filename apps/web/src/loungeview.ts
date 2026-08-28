/**
 * Lounge and membership views.
 *
 * A lounge is a place you walk into, not a queue you sit in. The list shows
 * who is inside before you commit, chat is live, and the tier gate is stated
 * plainly rather than discovered after you click.
 */

import {
  listLounges, myProfile, canEnter, recentMessages, sendMessage, enterLounge,
  startCheckout, loungesAvailable, TIER_LABEL, TIER_PITCH, TIER_RANK,
  REACTIONS, REACTION_EVENT, reactionLabel, QUICK_CHAT, knownSignal,
  ORIGIN_LABEL,
  addBredrin, removeBredrin, whereAreMyBredrins,
  sendInvite, pendingInvites, dismissInvite, watchInvites,
  MIN_GIFT_COINS, giftCoins,
  fetchPublicProfile,
  topRanked, avatarUrl, avatarAccessoryUrl, AVATAR_LABEL,
} from './lounges.ts';
import type {
  Bredrin, Invite, Lounge, LoungeMessage, LoungeRoom, MyProfile, Origin, PresenceEntry, Tier,
  PublicProfile, RankedPlayer, RatingCategory,
} from './lounges.ts';
import { profilePanel, adminSection, avatarImg, timeAgo } from './profile.ts';
import {
  ensureSignedIn, findActiveSeat, videoSessionCall, turnCredentialsCall,
  secureAccount, signInWithPassword, isAnonymousUser,
  requestPasswordReset, updatePassword, watchForPasswordRecovery,
} from './online.ts';
import { OnlineGame } from './onlinetable.ts';
import { openTablesPanel, joinByCodeField, liveTableView } from './onlinetableview.ts';
import { el, penaltyBanner } from './render.ts';
import { describeSeat } from './movelog.ts';
import type { PenaltyEvent } from '@yard/engine';
import { canSpeak, joinVoice } from './voice.ts';
import type { VoiceRoom } from './voice.ts';
import { canShowVideo, joinVideo, CAMERA_TRACK_NAME } from './video.ts';
import { photoUrl, uploadMyPhoto, removeMyPhoto } from './photo.ts';
import type { VideoRoom, RemotePeer } from './video.ts';
import { loadTournament, stopTournamentClock, tournamentPanel } from './tournamentview.ts';

/**
 * Reactions: table talk for people who cannot or will not talk. Free for
 * everyone, including guests — the thing membership sells is the microphone,
 * not the right to be part of the room.
 *
 * Art comes from `docs/art-direction.md`; the words live here rather than
 * baked into the pictures, so they stay readable at any size.
 */
/* REACTIONS and REACTION_EVENT now live in lounges.ts — the four-seat table
   renders them too, and a view importing another view is a circular import. */
/** Long enough to read across the table, short enough not to become wallpaper. */
const REACTION_MS = 4000;

type LiveVoice = VoiceRoom & { syncRoster: (ids: string[]) => void };

interface LoungeState {
  lounges: Lounge[];
  me: MyProfile | null;
  current: Lounge | null;
  roster: PresenceEntry[];
  messages: LoungeMessage[];
  room: LoungeRoom | null;
  error: string | null;
  loading: boolean;
  onlineGame: OnlineGame | null;
  /** A French penalty that just landed at this table — see PenaltyEvent.
   *  Cleared by attachTable's own timeout, PENALTY_BANNER_MS after it fires. */
  penaltyEvents: PenaltyEvent[] | null;
  voice: LiveVoice | null;
  /** Joining is async; this keeps the button from being tapped twice. */
  voiceJoining: boolean;
  speaking: Set<string>;
  /** The reaction each person last threw, by user id. */
  reactions: Map<string, string>;
  video: VideoRoom | null;
  videoJoining: boolean;
  /** Keyed by user id — decorateSeat reads this to attach a <video> tile. */
  videoStreams: Map<string, MediaStream>;
  /** True for a guest session with no email/password attached yet. */
  isAnonymous: boolean;
  /** Pending "come to this lounge" nudges from bredrins, newest first. Shown
   *  only on the Lounges screen proper (see loungesView) — never surfaced
   *  while a live hand is on screen, by construction: that branch returns
   *  early before this ever renders. */
  invites: Invite[];
}

export const loungeState: LoungeState = {
  lounges: [], me: null, current: null, roster: [], messages: [],
  room: null, error: null, loading: false, onlineGame: null, penaltyEvents: null,
  voice: null, voiceJoining: false, speaking: new Set(), reactions: new Map(),
  video: null, videoJoining: false, videoStreams: new Map(), isAnonymous: true,
  invites: [],
};

/** Long enough to read, short enough not to linger past the next couple of moves. */
const PENALTY_BANNER_MS = 6000;

/** Timers clearing each reaction, so one person spamming cannot pile them up. */
const reactionTimers = new Map<string, number>();

function showReaction(userId: string, id: string, rerender: () => void) {
  if (!knownSignal(id)) return; // never render what a peer invents
  clearTimeout(reactionTimers.get(userId));
  loungeState.reactions = new Map(loungeState.reactions).set(userId, id);
  reactionTimers.set(userId, window.setTimeout(() => {
    const next = new Map(loungeState.reactions);
    next.delete(userId);
    loungeState.reactions = next;
    reactionTimers.delete(userId);
    rerender();
  }, REACTION_MS));
  rerender();
}

/**
 * The whole view re-renders when a message arrives, which destroys the input
 * element. Without this, anyone typing while the room is busy loses what they
 * wrote — every incoming message clears the box. Keep the draft outside the
 * DOM and restore it, including the caret.
 */
let draft = '';
let draftCaret = 0;

/**
 * A paid tier lives on `profiles.tier`, keyed to whatever account was signed
 * in at checkout — same fragile, one-browser-only anonymous session as
 * everything else, except now there's real money behind it. Stripe already
 * redirects success here as `?upgraded=yardie|vip` (checkout/index.ts); until
 * now nothing on the client ever read it. Set once per successful checkout,
 * cleared on dismiss or once the account is secured.
 */
let justUpgradedTier: Tier | null = null;

let recoveryWatcherStarted = false;
let invitesWatcherStarted = false;

/** Load lounges and profile. Safe to call repeatedly. */
export async function loadLounges(rerender: () => void) {
  if (!recoveryWatcherStarted) {
    recoveryWatcherStarted = true;
    watchForPasswordRecovery(() => { recoveryMode = true; rerender(); });
    const params = new URLSearchParams(window.location.search);
    if (params.has('recovery')) {
      params.delete('recovery');
      const rest = params.toString();
      history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
    }
  }
  if (!invitesWatcherStarted) {
    invitesWatcherStarted = true;
    // Live push while they're already on the Lounges screen — a fresh fetch
    // on every loadLounges() call (below) covers the "invited while they
    // were elsewhere" case, so this only needs to catch what arrives in between.
    watchInvites(() => {
      void pendingInvites().then((list) => { loungeState.invites = list; rerender(); });
    });
  }
  if (!loungesAvailable || loungeState.loading) return;
  loungeState.loading = true;
  try {
    await ensureSignedIn();
    const [lounges, me, anon] = await Promise.all([listLounges(), myProfile(), isAnonymousUser()]);
    loungeState.lounges = lounges;
    loungeState.me = me;
    loungeState.isAnonymous = anon;
    loungeState.error = null;

    // Additive, same posture as loadTournament below — an invites fetch
    // failure must never block walking into the lounges.
    try {
      loungeState.invites = await pendingInvites();
    } catch { /* stays whatever it was */ }

    if (anon) {
      const params = new URLSearchParams(window.location.search);
      const upgraded = params.get('upgraded');
      if (upgraded === 'yardie' || upgraded === 'vip') {
        justUpgradedTier = upgraded;
        params.delete('upgraded');
        const rest = params.toString();
        history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
      }
    }

    // Additive, and never allowed to take the lounges down with it: before the
    // tournament migration is applied these queries 404, and a player must
    // still be able to walk into a room. loadTournament swallows its own
    // failures for exactly that reason.
    await loadTournament(me);

    if (!loungeState.onlineGame) {
      const active = await findActiveSeat();
      if (active) await attachTable(active.tableId, rerender);
    }
  } catch (err) {
    loungeState.error = err instanceof Error ? err.message : 'could not load lounges';
  } finally {
    loungeState.loading = false;
    rerender();
  }
}

export function leaveCurrentLounge() {
  draft = '';
  draftCaret = 0;
  // The countdown only lives on the lounge LIST, and this is called both on the
  // way into a room and on the way off the tab. It reschedules itself the next
  // time the list draws, so stopping it here costs nothing and stops a timer
  // waking a screen the player has left.
  stopTournamentClock();
  // Voice holds the microphone and open peer connections, so it must be torn
  // down before the channel it signals over goes away.
  if (loungeState.voice) {
    loungeState.voice.leave();
    loungeState.voice = null;
    loungeState.room?.setVoice(false);
  }
  loungeState.voiceJoining = false;
  loungeState.speaking = new Set();
  for (const t of reactionTimers.values()) clearTimeout(t);
  reactionTimers.clear();
  loungeState.reactions = new Map();
  loungeState.room?.leave();
  loungeState.room = null;
  loungeState.current = null;
  loungeState.roster = [];
  loungeState.messages = [];
}

async function openLounge(lounge: Lounge, rerender: () => void) {
  leaveCurrentLounge();
  const me = loungeState.me;
  if (!me) { loungeState.error = 'Sign in to enter a lounge'; rerender(); return; }

  loungeState.current = lounge;
  rerender();

  try {
    loungeState.messages = await recentMessages(lounge.id);
  } catch (err) {
    loungeState.error = err instanceof Error ? err.message : 'chat unavailable';
  }

  loungeState.room = enterLounge(
    lounge,
    { user_id: me.id, username: me.username, tier: me.tier },
    {
      onPresence: (roster) => {
        loungeState.roster = roster;
        // The mesh follows the mic, not the room: only people who actually
        // joined voice get dialled. Safe on every sync — it diffs.
        loungeState.voice?.syncRoster(
          roster.filter((p) => p.voice).map((p) => p.user_id));
        // Video is scoped to the table you're actually seated at, not the
        // whole lounge — a spectator's video presence would never carry a
        // valid session anyway (the server gate requires a seat), but there
        // is no reason to even try pulling someone not at your own table.
        if (loungeState.video) loungeState.video.syncPeers(videoPeersFrom(roster));
        rerender();
      },
      onMessage: (msg) => { loungeState.messages = [...loungeState.messages, msg]; rerender(); },
    },
  );

  loungeState.room.channel.on(
    'broadcast', { event: REACTION_EVENT },
    ({ payload }) => {
      const { from, id } = (payload ?? {}) as { from?: string; id?: string };
      if (typeof from === 'string' && typeof id === 'string') showReaction(from, id, rerender);
    });
  rerender();
}

/**
 * Open a table, and make sure the social layer actually works once you are on
 * it.
 *
 * There are three ways onto a seat — reloading straight onto one, joining by
 * code from the lounge list, and sitting down from inside a lounge — and only
 * the last had already joined the Realtime channel that voice and reactions
 * ride on. On the other two the mic sat on "Connecting…" forever and every
 * reaction was dropped, because nothing was ever subscribed. Two real clients
 * caught this; it is invisible from one. Entering the table's own lounge here
 * is what makes the table social on all three paths.
 */
async function attachTable(tableId: string, rerender: () => void) {
  loungeState.onlineGame?.leave();
  const game = await OnlineGame.open(tableId);
  loungeState.onlineGame = game;
  // State arrives over Realtime, not from a call this module makes — without
  // this, moves and seat changes update the model but nothing redraws. It also
  // carries 'error' events that otherwise have no listener and vanish.
  game.on((e) => {
    if (e.type === 'error') loungeState.error = e.message;
    if (e.type === 'penalty') {
      loungeState.penaltyEvents = e.events;
      setTimeout(() => { loungeState.penaltyEvents = null; rerender(); }, PENALTY_BANNER_MS);
    }
    rerender();
  });

  // Already in the right lounge: leave it alone. openLounge() tears the room
  // down first, which would drop a live microphone for someone who sat down
  // from inside the very lounge they are talking in.
  const home = loungeState.lounges.find((l) => l.id === game.table.loungeId);
  if (home && loungeState.current?.id !== home.id) {
    try { await openLounge(home, rerender); } catch { /* the table still plays */ }
  }
  // Announce which table this is, so everyone else's watcher list picks you up.
  // After openLounge, because that tears the old room down and builds a new one.
  loungeState.room?.setTable(tableId);
  rerender();
}

/**
 * Throw a reaction to the room. Everyone sees it beside your name, including
 * you — silently dropping your own is confusing when nobody replies.
 */
function reactionBar(rerender: () => void): HTMLElement {
  const bar = el('div', 'reactions');
  const me = loungeState.me;
  // The room is joined asynchronously and, at a table reached by reload, may
  // never be joined at all. A button that silently does nothing is the failure
  // mode voice.md calls out by name — disable it and say why instead.
  const ready = me !== null && loungeState.room !== null;
  if (!ready) {
    const status = el('p', 'social-connecting', 'Connecting stickers…');
    status.setAttribute('role', 'status');
    bar.append(status);
  }
  for (const r of REACTIONS) {
    const b = document.createElement('button');
    b.className = 'reaction';
    b.disabled = !ready;
    b.title = ready ? r.label : 'Connecting to the room…';
    b.setAttribute('aria-label', `Send ${r.label}`);
    const img = document.createElement('img');
    img.src = `${import.meta.env.BASE_URL}reactions/${r.id}.webp`;
    img.alt = '';
    img.width = 44;
    img.height = 44;
    b.appendChild(img);
    b.append(el('span', undefined, r.label));
    b.onclick = () => sendSignal(r.id, rerender);
    bar.appendChild(b);
  }
  return bar;
}

/**
 * Show it locally and tell the room. Local first, deliberately: the broadcast
 * does not echo back to the sender, so waiting for the network would leave
 * your own button feeling dead.
 */
function sendSignal(id: string, rerender: () => void) {
  const me = loungeState.me;
  if (!me || !loungeState.room) return;
  showReaction(me.id, id, rerender);
  void loungeState.room.channel.send({
    type: 'broadcast', event: REACTION_EVENT, payload: { from: me.id, id },
  });
}

/**
 * The eight words, as buttons. Text rather than pictures because these are
 * things people SAY — and because a player on a phone mid-hand can hit a short
 * word faster than they can recognise an icon.
 */
function quickChatBar(rerender: () => void): HTMLElement {
  const bar = el('div', 'quick-chat');
  const ready = loungeState.me !== null && loungeState.room !== null;
  for (const q of QUICK_CHAT) {
    const b = document.createElement('button');
    b.className = 'quick';
    b.disabled = !ready;
    b.textContent = q.label;
    b.title = ready ? `Say ${q.label}` : 'Connecting to the room…';
    b.setAttribute('aria-label', `Say ${q.label}`);
    b.onclick = () => sendSignal(q.id, rerender);
    bar.appendChild(b);
  }
  return bar;
}

/**
 * Everyone else's video worth pulling right now: on video, at the table you
 * are seated at, not you. The server independently re-checks that
 * `videoSessionId` actually belongs to a seat at your table before ever
 * calling Cloudflare (video-session's 'pull' action) — this filter is only
 * about not wasting a round trip on someone it would reject anyway.
 */
function videoPeersFrom(roster: PresenceEntry[]): RemotePeer[] {
  const myTable = loungeState.onlineGame?.table.id;
  const me = loungeState.me;
  if (!myTable || !me) return [];
  return roster
    .filter((p): p is PresenceEntry & { videoSessionId: string; videoTrackName: string } =>
      Boolean(p.video && p.table === myTable && p.videoSessionId && p.videoTrackName)
      && p.user_id !== me.id)
    .map((p) => ({ userId: p.user_id, sessionId: p.videoSessionId, trackName: p.videoTrackName }));
}

/**
 * Join table voice. Requires a tap: browsers only hand over a microphone (and
 * only start audio playback) in response to a real gesture.
 */
async function startVoice(rerender: () => void) {
  const { me, room } = loungeState;
  if (!me || !room || loungeState.voice || loungeState.voiceJoining) return;

  loungeState.voiceJoining = true;
  rerender();
  try {
    const voice = await joinVoice(room.channel, me.id, {
      speak: canSpeak(me.tier),
      turn: turnCredentialsCall,
      onSpeaking: ({ id, speaking }) => {
        const next = new Set(loungeState.speaking);
        if (speaking) next.add(id); else next.delete(id);
        loungeState.speaking = next;
        rerender();
      },
      onError: (message) => { loungeState.error = message; rerender(); },
    });
    loungeState.voice = voice;
    if (voice) {
      // Announce the mic before dialling, so peers already on voice hear that
      // we arrived and dial back on the same presence sync.
      room.setVoice(true);
      voice.syncRoster(loungeState.roster.filter((p) => p.voice).map((p) => p.user_id));
    }
  } catch (err) {
    loungeState.error = err instanceof Error ? err.message : 'voice could not start';
  } finally {
    loungeState.voiceJoining = false;
    rerender();
  }
}

/**
 * Hearing the yard is free; talking is the membership. A guest sees the room
 * light up as people speak, which is a better argument for upgrading than any
 * copy we could write.
 */
function voicePanel(rerender: () => void): HTMLElement {
  const me = loungeState.me;
  const panel = el('div', 'voice-bar');
  const tier: Tier = me?.tier ?? 'guest';
  const voice = loungeState.voice;

  if (!voice) {
    // The room is joined asynchronously, so this panel can render before the
    // channel exists. Say so rather than offering a button that does nothing.
    const ready = loungeState.room !== null;
    const join = document.createElement('button');
    join.className = 'act ghost';
    join.textContent = !ready
      ? 'Connecting…'
      : loungeState.voiceJoining
        ? 'Opening the mic…'
        : canSpeak(tier) ? 'Join the talk' : 'Listen in';
    join.disabled = !ready || loungeState.voiceJoining;
    join.onclick = () => void startVoice(rerender);
    panel.append(join);
    panel.append(el('span', 'muted', canSpeak(tier)
      ? 'Talk to the table, like you were there.'
      : 'Free to listen. Yardie to talk.'));
    return panel;
  }

  if (voice.listenOnly()) {
    panel.append(el('span', 'mic-state', 'Listening'));
    panel.append(el('span', 'muted', canSpeak(tier)
      ? 'No microphone. You can still hear the table.'
      : 'Yardie members talk at the table.'));
  } else {
    const mute = document.createElement('button');
    mute.className = 'act ghost';
    mute.textContent = voice.muted() ? 'Unmute' : 'Mute';
    mute.setAttribute('aria-pressed', String(voice.muted()));
    mute.onclick = () => { voice.setMuted(!voice.muted()); rerender(); };
    panel.append(mute);
  }

  const leave = document.createElement('button');
  leave.className = 'dismiss';
  leave.textContent = 'Leave voice';
  leave.onclick = () => {
    voice.leave();
    loungeState.voice = null;
    loungeState.speaking = new Set();
    loungeState.room?.setVoice(false);
    rerender();
  };
  panel.append(leave);
  return panel;
}

/**
 * Join table video. Requires a tap, same as voice — a camera only turns on in
 * response to a real gesture. Table-scoped only: `loungeState.onlineGame`
 * must exist, since video is bundled into VIP for the 4-seat table you're
 * actually playing at, not the lounge lobby (plan §7.2's pricing math is
 * specifically a 4-seat session, not a whole room of spectators).
 */
async function startVideo(rerender: () => void) {
  const { me, room, onlineGame } = loungeState;
  if (!me || !room || !onlineGame || loungeState.video || loungeState.videoJoining) return;

  loungeState.videoJoining = true;
  rerender();
  try {
    const video = await joinVideo(onlineGame.table.id, videoSessionCall, {
      turn: turnCredentialsCall,
      onStream: (userId, stream) => {
        const next = new Map(loungeState.videoStreams);
        if (stream) next.set(userId, stream); else next.delete(userId);
        loungeState.videoStreams = next;
        rerender();
      },
      onError: (message) => { loungeState.error = message; rerender(); },
    });
    loungeState.video = video;
    if (video) {
      // Announce before syncing peers, same ordering voice uses — peers
      // already on video hear that we arrived and pull us back on their own
      // next presence sync.
      room.setVideo(true, video.sessionId() ?? undefined, CAMERA_TRACK_NAME);
      video.syncPeers(videoPeersFrom(loungeState.roster));
      // Self-preview: your own seat card gets the same treatment a pulled
      // peer's does, keyed by your own id — decorateSeat doesn't need to
      // know this stream never touched the network.
      const local = video.localStream();
      if (local) {
        const next = new Map(loungeState.videoStreams);
        next.set(me.id, local);
        loungeState.videoStreams = next;
      }
    }
  } catch (err) {
    loungeState.error = err instanceof Error ? err.message : 'video could not start';
  } finally {
    loungeState.videoJoining = false;
    rerender();
  }
}

/**
 * Seeing the yard is a VIP benefit — bundled the same way talking is bundled
 * into Yardie, and gated server-side (video-session Edge Function) as well
 * as here, since unlike the mic each session costs real Cloudflare usage.
 */
function videoPanel(rerender: () => void): HTMLElement | null {
  const me = loungeState.me;
  if (!me || !loungeState.onlineGame) return null;
  const panel = el('div', 'video-bar');
  const video = loungeState.video;

  if (!video) {
    if (!canShowVideo(me.tier)) {
      panel.append(el('span', 'muted', 'VIP members see the table.'));
      return panel;
    }
    const join = document.createElement('button');
    join.className = 'act ghost';
    join.textContent = loungeState.videoJoining ? 'Opening the camera…' : 'Show video';
    join.disabled = loungeState.videoJoining;
    join.onclick = () => void startVideo(rerender);
    panel.append(join);
    return panel;
  }

  const toggle = document.createElement('button');
  toggle.className = 'act ghost';
  toggle.textContent = video.cameraOff() ? 'Turn camera on' : 'Turn camera off';
  toggle.setAttribute('aria-pressed', String(!video.cameraOff()));
  toggle.onclick = () => { video.setCameraOff(!video.cameraOff()); rerender(); };
  panel.append(toggle);

  const leave = document.createElement('button');
  leave.className = 'dismiss';
  leave.textContent = 'Leave video';
  leave.onclick = () => {
    video.leave();
    loungeState.video = null;
    loungeState.videoStreams = new Map();
    loungeState.room?.setVideo(false);
    rerender();
  };
  panel.append(leave);
  return panel;
}

function tierBadge(tier: Tier): HTMLElement {
  const b = el('span', `badge ${tier}`, TIER_LABEL[tier]);
  return b;
}

/** Yard or foreign, worn on the profile and on the seat. */
export function originBadge(origin: Origin): HTMLElement {
  // `origin-` prefixed, not bare: the tier badge already owns `.badge.yardie`
  // and the Yardie TIER and a Yardie ORIGIN are different things entirely.
  return el('span', `badge origin-${origin}`, ORIGIN_LABEL[origin]);
}

// ------------------------------------------------------- player profile --
// A read-only card for someone ELSE's profile, opened by tapping their name
// in a lounge roster. "Online now" only ever means "present in this same
// room right now" — there is no global presence tracker, and building one
// just for this card isn't worth it when the honest, cheap answer is
// already sitting in loungeState.roster.
let viewingProfileId: string | null = null;
let viewingProfile: PublicProfile | null = null;
let viewingProfileLoading = false;
let viewingProfileError: string | null = null;

function openPlayerProfile(userId: string, rerender: () => void) {
  viewingProfileId = userId;
  viewingProfile = null;
  viewingProfileError = null;
  viewingProfileLoading = true;
  rerender();
  void fetchPublicProfile(userId).then((p) => {
    if (viewingProfileId !== userId) return; // they closed/opened another before this landed
    viewingProfile = p;
    viewingProfileError = p ? null : 'could not load that profile';
    viewingProfileLoading = false;
    rerender();
  }).catch((err) => {
    if (viewingProfileId !== userId) return;
    viewingProfileError = err instanceof Error ? err.message : 'could not load that profile';
    viewingProfileLoading = false;
    rerender();
  });
}

function closePlayerProfile(rerender: () => void) {
  viewingProfileId = null;
  viewingProfile = null;
  viewingProfileError = null;
  rerender();
}

const MEMBER_SINCE = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' });
/** Glicko RD starts at 350 and narrows with real games — still near that
 *  means the number hasn't been tested yet, so label it rather than let a
 *  brand-new account's placeholder rating read as earned. */
const PROVISIONAL_RD = 300;

function ratingLine(label: string, rating: number, rd: number): HTMLElement {
  const row = el('div', 'row');
  row.append(el('span', 'muted', label));
  row.append(el('span', 'mono', String(rating)));
  if (rd >= PROVISIONAL_RD) row.append(el('span', 'muted small', '(provisional)'));
  return row;
}

function playerProfileCard(rerender: () => void): HTMLElement {
  const panel = el('div', 'panel profile-card');
  const top = el('div', 'spread');
  top.append(el('div', 'eyebrow', 'Player'));
  const close = document.createElement('button');
  close.className = 'act ghost small';
  close.textContent = 'Close';
  close.onclick = () => closePlayerProfile(rerender);
  top.appendChild(close);
  panel.appendChild(top);

  if (viewingProfileLoading) {
    panel.append(el('p', 'muted', 'Loading…'));
    return panel;
  }
  if (viewingProfileError || !viewingProfile) {
    panel.append(el('div', 'banner', viewingProfileError ?? 'could not load that profile'));
    return panel;
  }

  const p = viewingProfile;
  const head = el('div', 'row');
  if (p.tier !== 'guest') {
    const img = document.createElement('img');
    img.className = 'photo-preview';
    img.alt = '';
    img.width = 64;
    img.height = 64;
    img.src = photoUrl(p.id);
    img.onerror = () => { img.style.display = 'none'; };
    head.appendChild(img);
  } else if (p.avatar) {
    head.appendChild(avatarImg(p.avatar, '', p.avatarAccessory));
  }
  const names = el('div');
  names.append(el('h2', undefined, p.username));
  const badges = el('div', 'row');
  if (p.tier !== 'guest') badges.append(tierBadge(p.tier));
  if (p.origin) badges.append(originBadge(p.origin));
  const online = loungeState.roster.some((r) => r.user_id === p.id);
  if (online) badges.append(el('span', 'badge online', 'Online now'));
  names.appendChild(badges);
  head.appendChild(names);
  panel.appendChild(head);

  if (p.location) panel.append(el('p', 'muted small', `📍 ${p.location}`));
  panel.append(el('p', 'muted small', `Playing since ${MEMBER_SINCE.format(new Date(p.createdAt))}`));

  const stats = el('div', 'stack');
  stats.appendChild(ratingLine('Partner rating', p.ratingPartner, p.rdPartner));
  stats.appendChild(ratingLine('Cut throat rating', p.ratingCutthroat, p.rdCutthroat));
  const hands = el('div', 'row');
  hands.append(el('span', 'muted', 'Hands played'), el('span', 'mono', String(p.handsPlayed)));
  stats.appendChild(hands);
  if (p.sixLovesGiven || p.sixLovesTaken) {
    const sixes = el('div', 'row');
    sixes.append(el('span', 'muted', 'Six love — given / taken'),
      el('span', 'mono', `${p.sixLovesGiven} / ${p.sixLovesTaken}`));
    stats.appendChild(sixes);
  }
  panel.appendChild(stats);

  if (loungeState.me && p.id !== loungeState.me.id) {
    panel.appendChild(giftButton(p.id, rerender));
  }

  return panel;
}

// ------------------------------------------------------------- bredrins --
let bredrinsOpen = false;
let bredrinsList: Bredrin[] | null = null;
let bredrinsLoading = false;
let bredrinsError: string | null = null;
/** Ids added this session, so a roster "+" swaps to a confirmation without
 *  waiting on a full bredrins reload. */
const justAddedBredrin = new Set<string>();
/** `${bredrinId}:${loungeId}` pairs invited this session, so "Invite here"
 *  swaps to a confirmation without a reload — keyed by lounge too, since
 *  moving to a different lounge makes it a genuinely new invite to send. */
const justInvitedBredrin = new Set<string>();

function loadBredrins(rerender: () => void) {
  bredrinsLoading = true;
  bredrinsError = null;
  rerender();
  void whereAreMyBredrins()
    .then((list) => { bredrinsList = list; })
    .catch((err) => { bredrinsError = err instanceof Error ? err.message : 'could not load'; })
    .finally(() => { bredrinsLoading = false; rerender(); });
}

/**
 * "Know where your people are" — JamDom's own most-praised VIP feature
 * (docs/superpowers/plans/2026-07-31-source-audit-and-followups.md §6). The
 * panel stays visible to everyone who opens it, VIP or not: the lock is
 * stated here rather than the button simply not existing, the same way a
 * "VIP only" lounge card stays on screen instead of vanishing.
 */
function bredrinsPanel(me: MyProfile, rerender: () => void): HTMLElement {
  const panel = el('div', 'panel');
  panel.append(el('div', 'eyebrow', 'Your people'));
  panel.append(el('h2', undefined, 'Bredrins'));

  if (me.tier !== 'vip') {
    panel.append(el('p', 'muted',
      `Know the moment your people walk into a lounge. Part of VIP, ${TIER_PITCH.vip.price}.`));
    return panel;
  }

  panel.append(el('p', 'muted',
    'Add someone from the room list below and you will see which lounge ' +
    'they are in next time you look.'));

  if (bredrinsError) panel.append(el('div', 'banner', bredrinsError));

  if (bredrinsLoading && !bredrinsList) {
    panel.append(el('p', 'muted', 'Loading…'));
  } else if (!bredrinsList || bredrinsList.length === 0) {
    panel.append(el('p', 'muted', 'No bredrins yet.'));
  } else {
    const list = el('div', 'roster');
    for (const b of bredrinsList) {
      const line = el('div', 'person');
      line.append(el('span', undefined, b.username));
      const foundLounge = b.lounge ? loungeState.lounges.find((l) => l.id === b.lounge) : undefined;
      if (foundLounge) {
        // Jump straight to where they are — same navigation openLounge
        // already does from the room list, just triggered from here instead.
        const where = document.createElement('button');
        where.className = 'link-plain small';
        where.textContent = `In ${foundLounge.name}`;
        where.onclick = () => void openLounge(foundLounge, rerender);
        line.appendChild(where);
      } else {
        line.append(el('span', 'muted small',
          b.lastSeen ? `Last seen ${timeAgo(b.lastSeen)}` : 'Never seen'));
      }
      if (loungeState.current) {
        // "Tell them what room to join" — the active counterpart to seeing
        // where they are. Only makes sense while standing in a lounge
        // yourself, which is exactly when loungeState.current is set.
        const here = loungeState.current;
        const inviteKey = `${b.bredrinId}:${here.id}`;
        const invite = document.createElement('button');
        invite.className = 'act ghost small';
        invite.textContent = justInvitedBredrin.has(inviteKey) ? 'Invited' : 'Invite here';
        invite.disabled = justInvitedBredrin.has(inviteKey);
        invite.onclick = () => void (async () => {
          invite.disabled = true;
          try {
            await sendInvite(b.bredrinId, here.id);
            justInvitedBredrin.add(inviteKey);
          } catch (err) {
            bredrinsError = err instanceof Error ? err.message : 'could not invite';
            invite.disabled = false;
          } finally {
            rerender();
          }
        })();
        line.appendChild(invite);
      }
      const remove = document.createElement('button');
      remove.className = 'dismiss';
      remove.textContent = 'Remove';
      remove.onclick = () => void (async () => {
        remove.disabled = true;
        try {
          await removeBredrin(b.bredrinId);
          bredrinsList = (bredrinsList ?? []).filter((x) => x.bredrinId !== b.bredrinId);
        } catch (err) {
          bredrinsError = err instanceof Error ? err.message : 'could not remove';
        } finally {
          rerender();
        }
      })();
      line.appendChild(remove);
      list.appendChild(line);
    }
    panel.appendChild(list);
  }
  return panel;
}

// Reports and admin management moved to profile.ts's adminSection — the
// profile is now the one place reachable from the lounge, the live table,
// and Membership alike, so that's where admin tools live too. See that
// file's header comment for why the old header-button home didn't work.

// ---------------------------------------------------------------- coins --
// Balance and purchase now live in profilePanel (profile.ts) — this is only
// the gift button, which stays here since it's specific to viewing someone
// ELSE's profile, not your own.
let giftBusy = false;

/** Framed the way the gesture actually reads at a yard table — you buy a
 *  bredrin a drink, you don't "send them coins". No further detail than
 *  that: one word doing real work, not a menu of what's in the glass.
 *  Fixed at the floor — a full amount picker is more UI than "pure social
 *  flex" needs. */
function giftButton(toUserId: string, rerender: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'act ghost small';
  btn.textContent = giftBusy ? 'Buying…' : `Buy a drink — ${MIN_GIFT_COINS} coins`;
  btn.disabled = giftBusy;
  btn.onclick = () => void (async () => {
    giftBusy = true;
    rerender();
    try {
      await giftCoins(toUserId, MIN_GIFT_COINS);
    } catch (err) {
      loungeState.error = err instanceof Error ? err.message : 'could not buy that drink';
    } finally {
      giftBusy = false;
      rerender();
    }
  })();
  return btn;
}

// --------------------------------------------------------------- account --
// A guest session lives in one browser's storage only — clear it, switch
// devices, or reinstall, and it's gone with nothing to sign back into. This
// is the optional, never-a-wall way out: attach a real email + password to
// the account you already have, or sign into one you secured earlier.
let accountOpen = false;
let accountMode: 'secure' | 'signin' = 'secure';
let accountBusy = false;
let accountError: string | null = null;
let accountMessage: string | null = null;
// A membership-page redraw replaces the native inputs. Android treats that
// as a fresh field and can reset the keyboard state midway through a
// password. main.ts therefore defers background redraws while either auth
// field is active; these drafts remain outside the DOM for intentional
// redraws such as validation feedback.
let accountEmailDraft = '';
let accountPasswordDraft = '';
let accountFocusedField: 'email' | 'password' | null = null;
let accountFocusRequest: 'email' | 'password' | null = null;

// Forgot password — sign-in mode only, since "secure" is for someone who
// doesn't have a password yet at all.
let resetRequested = false;
let resetBusy = false;
let resetError: string | null = null;

/**
 * True once a password-recovery link has been clicked and the Supabase SDK
 * has established the temporary session it grants (see
 * watchForPasswordRecovery in online.ts). Rendered ahead of everything else
 * in membershipView — someone who just clicked an emailed link expects to
 * land directly on "set a new password", not have to go find it.
 */
let recoveryMode = false;
let newPasswordDraft = '';
let recoveryBusy = false;
let recoveryError: string | null = null;
let recoveryDone = false;
let recoveryPasswordFocused = false;

/**
 * Used by the app shell to protect the browser's native authentication
 * fields from timer, resize, and realtime redraws while someone is typing.
 * Submission deliberately clears focus first, so validation and progress
 * states still render immediately.
 */
export function authInputIsActive(): boolean {
  return (!accountBusy && accountOpen && accountFocusedField !== null)
    || (!recoveryBusy && recoveryMode && recoveryPasswordFocused);
}

function passwordRecoveryPanel(rerender: () => void): HTMLElement {
  const panel = el('div', 'panel');
  panel.append(el('div', 'eyebrow', 'Account'));
  panel.append(el('h2', undefined, 'Set a new password'));

  if (recoveryDone) {
    panel.append(el('p', 'muted', 'Password updated — you\'re signed in.'));
    const done = document.createElement('button');
    done.className = 'act ghost';
    done.textContent = 'Done';
    done.onclick = () => { recoveryMode = false; recoveryDone = false; rerender(); };
    panel.appendChild(done);
    return panel;
  }

  panel.append(el('p', 'muted small', 'This link signed you in — pick a new password to finish.'));

  const password = document.createElement('input');
  password.type = 'password';
  password.className = 'field';
  password.autocomplete = 'new-password';
  password.setAttribute('autocapitalize', 'none');
  password.setAttribute('autocorrect', 'off');
  password.spellcheck = false;
  password.setAttribute('aria-label', 'New password');
  password.placeholder = 'At least 8 characters';
  password.value = newPasswordDraft;
  password.oninput = () => { newPasswordDraft = password.value; };
  password.onfocus = () => { recoveryPasswordFocused = true; };
  // Do not redraw from blur: mobile browsers dispatch blur before the tap's
  // click, and replacing the DOM here can swallow "Save password".
  password.onblur = () => { recoveryPasswordFocused = false; };
  panel.append(el('label', 'field-label', 'New password'), password);

  if (recoveryError) panel.append(el('div', 'banner small', recoveryError));

  const submit = document.createElement('button');
  submit.className = 'act';
  submit.textContent = recoveryBusy ? 'Saving…' : 'Save password';
  submit.disabled = recoveryBusy;
  submit.onclick = () => void (async () => {
    recoveryPasswordFocused = false;
    if (newPasswordDraft.length < 8) { recoveryError = 'password needs at least 8 characters'; rerender(); return; }
    recoveryBusy = true; recoveryError = null; rerender();
    try {
      await updatePassword(newPasswordDraft);
      newPasswordDraft = '';
      recoveryDone = true;
      // The recovery session belongs to whichever account owned the reset
      // link — likely a different account than whatever this browser had
      // signed in before. Same reasoning as signInWithPassword's success
      // path: refresh rather than leave the old identity on screen.
      loungeState.me = await myProfile();
      loungeState.isAnonymous = await isAnonymousUser();
    } catch (err) {
      recoveryError = err instanceof Error ? err.message : 'could not update password';
    } finally {
      recoveryBusy = false;
      rerender();
    }
  })();
  panel.appendChild(submit);
  return panel;
}

/**
 * "Come to this lounge" nudges from bredrins — the active counterpart to
 * the bredrins list's passive "here is where they last were." Same
 * not-a-modal posture as upgradePrompt below: this only ever renders inside
 * loungesView's normal branch, which loungeState.onlineGame's early return
 * already keeps off screen during a live hand, so there is nothing extra to
 * gate here.
 */
function inviteBanner(invites: Invite[], rerender: () => void): HTMLElement {
  const panel = el('div', 'panel upgrade-prompt');
  panel.append(el('div', 'eyebrow', 'Your people'));
  for (const invite of invites) {
    const lounge = loungeState.lounges.find((l) => l.id === invite.loungeId);
    const row = el('div', 'row');
    row.append(el('p', undefined,
      `${invite.fromUsername} wants you in ${lounge?.name ?? 'a lounge'}.`));
    const join = document.createElement('button');
    join.className = 'act';
    join.textContent = 'Join';
    join.onclick = () => void (async () => {
      join.disabled = true;
      loungeState.invites = loungeState.invites.filter((i) => i.id !== invite.id);
      rerender();
      try { await dismissInvite(invite.id); } catch { /* already gone either way */ }
      if (lounge) await openLounge(lounge, rerender);
    })();
    row.appendChild(join);
    const dismiss = document.createElement('button');
    dismiss.className = 'act ghost small';
    dismiss.textContent = 'Dismiss';
    dismiss.onclick = () => void (async () => {
      dismiss.disabled = true;
      loungeState.invites = loungeState.invites.filter((i) => i.id !== invite.id);
      rerender();
      try { await dismissInvite(invite.id); } catch { /* fine, it will just resurface once */ }
    })();
    row.appendChild(dismiss);
    panel.appendChild(row);
  }
  return panel;
}

/**
 * The moment a Yardie/VIP purchase is most likely to get secured: right
 * after paying, while it's front of mind, rather than buried in Edit
 * profile where nobody thinks to look until it's already too late. Not a
 * modal — client.md's rule against interrupting a live hand doesn't apply
 * here (this only ever shows on the Lounges screen right after a Stripe
 * redirect), but it should still be dismissable, not forced.
 */
function upgradePrompt(tier: Tier, rerender: () => void): HTMLElement {
  const panel = el('div', 'panel upgrade-prompt');
  panel.append(el('div', 'eyebrow', `Welcome to ${TIER_LABEL[tier]}`));
  panel.append(el('p', undefined,
    `You just paid for ${TIER_LABEL[tier]} — but this browser is still a guest session underneath `
    + 'it. Secure it with an email and password so a cleared browser or a new phone never costs you '
    + 'what you paid for.'));
  const secure = document.createElement('button');
  secure.className = 'act';
  secure.textContent = 'Secure my account';
  secure.onclick = () => {
    justUpgradedTier = null;
    accountOpen = true;
    accountMode = 'secure';
    accountError = null;
    accountMessage = null;
    rerender();
  };
  panel.appendChild(secure);
  const dismiss = document.createElement('button');
  dismiss.className = 'act ghost small';
  dismiss.textContent = 'Not now';
  dismiss.onclick = () => { justUpgradedTier = null; rerender(); };
  panel.appendChild(dismiss);
  return panel;
}

function accountPanel(rerender: () => void): HTMLElement {
  const panel = el('div', 'panel');
  panel.id = 'account-panel';
  const secure = accountMode === 'secure';
  panel.append(el('div', 'eyebrow', 'Account'));
  panel.append(el('h2', undefined, secure ? 'Secure this account' : 'Sign in'));
  panel.append(el('p', 'muted small', secure
    ? 'Keeps your name, tiles played, and anything else tied to this account '
      + 'reachable from any device — not just this browser.'
    : 'Switch this browser to an account you already secured.'));

  const email = document.createElement('input');
  email.type = 'email';
  email.className = 'field';
  email.autocomplete = 'email';
  email.setAttribute('autocapitalize', 'none');
  email.setAttribute('autocorrect', 'off');
  email.spellcheck = false;
  email.setAttribute('aria-label', 'Email');
  email.placeholder = 'you@example.com';
  email.value = accountEmailDraft;
  email.oninput = () => {
    accountEmailDraft = email.value;
  };
  email.onfocus = () => { accountFocusedField = 'email'; };
  email.onblur = () => {
    if (accountFocusedField === 'email') accountFocusedField = null;
  };
  panel.append(el('label', 'field-label', 'Email'), email);

  const password = document.createElement('input');
  password.type = 'password';
  password.className = 'field';
  password.autocomplete = secure ? 'new-password' : 'current-password';
  password.setAttribute('autocapitalize', 'none');
  password.setAttribute('autocorrect', 'off');
  password.spellcheck = false;
  password.setAttribute('aria-label', 'Password');
  password.placeholder = secure ? 'At least 8 characters' : 'Your password';
  password.value = accountPasswordDraft;
  password.oninput = () => {
    accountPasswordDraft = password.value;
  };
  password.onfocus = () => { accountFocusedField = 'password'; };
  password.onblur = () => {
    if (accountFocusedField === 'password') accountFocusedField = null;
  };
  panel.append(el('label', 'field-label', 'Password'), password);

  // A deliberate first focus is fine. What Android cannot tolerate is a
  // later background redraw repeatedly replacing and re-focusing this field.
  const requestedFocus = accountFocusRequest;
  accountFocusRequest = null;
  if (requestedFocus === 'email') requestAnimationFrame(() => email.focus());
  if (requestedFocus === 'password') requestAnimationFrame(() => password.focus());

  if (accountError) panel.append(el('div', 'banner small', accountError));
  if (accountMessage) panel.append(el('div', 'muted small', accountMessage));

  const submit = document.createElement('button');
  submit.className = 'act';
  submit.textContent = accountBusy
    ? (secure ? 'Securing…' : 'Signing in…')
    : (secure ? 'Secure account' : 'Sign in');
  submit.disabled = accountBusy;
  submit.onclick = () => void (async () => {
    accountFocusedField = null;
    const addr = email.value.trim();
    const pass = password.value;
    if (!addr || !pass) { accountError = 'email and password are both needed'; rerender(); return; }
    if (secure && pass.length < 8) { accountError = 'password needs at least 8 characters'; rerender(); return; }
    accountBusy = true; accountError = null; accountMessage = null; rerender();
    try {
      if (secure) {
        await secureAccount(addr, pass);
        accountMessage = `Check ${addr} for a confirmation link to finish.`;
        accountPasswordDraft = '';
        // Not fully secured until the confirmation link is clicked (still
        // anonymous till then), but the prompt has done its job — no reason
        // to keep nagging once they've started.
        justUpgradedTier = null;
      } else {
        await signInWithPassword(addr, pass);
        // The Supabase session has already swapped accounts at this point.
        // Clear the outgoing profile immediately rather than leaving it on
        // screen — under lounges.ts's tier badge, showing the WRONG
        // account's name/tier while the real session has moved on is worse
        // than a brief blank, given this app's history with admin flags.
        loungeState.me = null;
        rerender();
        loungeState.me = await myProfile();
        loungeState.isAnonymous = await isAnonymousUser();
        accountOpen = false;
        accountEmailDraft = '';
        accountPasswordDraft = '';
        accountFocusedField = null;
      }
    } catch (err) {
      accountError = err instanceof Error ? err.message : 'could not reach the account';
    } finally {
      accountBusy = false;
      rerender();
    }
  })();
  panel.appendChild(submit);

  // Only sign-in needs this — "secure" is for someone with no password yet.
  if (!secure) {
    if (resetRequested) {
      panel.append(el('p', 'muted small', `Check ${accountEmailDraft.trim() || 'your email'} for a reset link.`));
    } else {
      if (resetError) panel.append(el('div', 'banner small', resetError));
      const forgot = document.createElement('button');
      forgot.className = 'act ghost small';
      forgot.textContent = resetBusy ? 'Sending…' : 'Forgot password?';
      forgot.disabled = resetBusy;
      forgot.onclick = () => void (async () => {
        accountFocusedField = null;
        const addr = email.value.trim();
        if (!addr) { resetError = 'enter your email first'; rerender(); return; }
        resetBusy = true; resetError = null; rerender();
        try {
          await requestPasswordReset(addr);
          resetRequested = true;
        } catch (err) {
          resetError = err instanceof Error ? err.message : 'could not send that';
        } finally {
          resetBusy = false;
          rerender();
        }
      })();
      panel.appendChild(forgot);
    }
  }

  const switchMode = document.createElement('button');
  switchMode.className = 'act ghost small';
  switchMode.textContent = secure
    ? 'Already secured an account? Sign in instead.'
    : 'New here? Secure this account instead.';
  switchMode.onclick = () => {
    accountFocusedField = null;
    accountMode = secure ? 'signin' : 'secure';
    accountError = null;
    accountMessage = null;
    resetRequested = false;
    resetError = null;
    rerender();
  };
  panel.appendChild(switchMode);

  return panel;
}

// ----------------------------------------------------------- lounge list --
function loungeList(rerender: () => void, goToMembership: () => void): DocumentFragment {
  const frag = document.createDocumentFragment();
  const me = loungeState.me;
  const myTier: Tier = me?.tier ?? 'guest';

  const head = el('div', 'panel');
  head.append(el('div', 'eyebrow', 'Lounges'));
  head.append(el('h2', undefined, 'Find a four'));
  head.append(el('p', 'muted',
    'Every lounge is a room with people in it — talk, watch, and take a seat ' +
    'when one opens. You keep your rank wherever you play.'));
  // Signed-in status only, no editing here — people arrive at Lounges ready
  // to play, not to fill out a form. Profile, coins, account security, and
  // (for admins) reports all live under Membership now, one tap away.
  if (me) {
    const you = el('div', 'row');
    you.append(el('span', 'muted', `Signed in as ${me.username}`), tierBadge(me.tier));
    if (me.origin) you.append(originBadge(me.origin));
    const manage = document.createElement('button');
    manage.className = 'act ghost small';
    manage.textContent = 'Manage account';
    manage.onclick = () => goToMembership();
    you.append(manage);
    head.append(you);
    if (loungeState.isAnonymous) {
      head.append(el('p', 'muted small',
        'This is a guest session tied to this browser. Secure it under Membership so a '
        + 'cleared browser or a new phone never loses it.'));
    }
  }
  frag.appendChild(head);

  // Above the lounge cards: the countdown is the thing a player should not be
  // able to miss, and this is the screen they land on. Returns null with no
  // active tournament (the common case), so this costs nothing then.
  const tourney = tournamentPanel(me, (tableId) => void attachTable(tableId, rerender), rerender);
  if (tourney) frag.appendChild(tourney);

  if (loungeState.error) {
    frag.appendChild(el('div', 'banner', loungeState.error));
  }

  for (const lounge of loungeState.lounges) {
    // Live occupancy needs presence per room; the list shows the gate and the
    // cap, and the true head-count appears once you are inside.
    const gate = canEnter(lounge, myTier, 0);
    const card = el('div', 'lounge-card' + (gate.ok ? '' : ' locked'));

    const left = el('div');
    left.append(el('h3', undefined, lounge.name));
    if (lounge.description) left.append(el('div', 'desc', lounge.description));
    const tags = el('div', 'row');
    tags.style.marginTop = '6px';
    if (lounge.mode) {
      const modeTag = lounge.mode === 'partner' ? 'Partners'
        : lounge.mode === 'openhand' ? 'Open hand'
          : 'Cut throat';
      tags.append(el('span', 'gate', modeTag));
    }
    if (lounge.min_tier !== 'guest') {
      // "Yardie only" reads as excluding VIP, but canEnter() gates on tier
      // RANK — VIP clears every lower floor too. "+" says so; VIP itself has
      // nothing above it, so its own tag stays exact as "VIP only".
      const label = lounge.min_tier === 'vip'
        ? `${TIER_LABEL.vip} only`
        : `${TIER_LABEL[lounge.min_tier]}+`;
      tags.append(el('span', `gate ${lounge.min_tier}`, label));
    }
    left.append(tags);

    const right = el('div');
    if (gate.ok) {
      const enter = document.createElement('button');
      enter.className = 'act ghost';
      enter.textContent = 'Enter';
      enter.onclick = () => void openLounge(lounge, rerender);
      right.appendChild(enter);
    } else {
      right.append(el('div', 'muted', gate.why ?? 'Locked'));
    }

    card.append(left, right);
    frag.appendChild(card);
  }

  // Below the room list, not above it — a join code is a power-user path
  // (someone read it off another screen or heard it called out), not how
  // someone new finds a room. It used to sit right under the header,
  // pushing the actual list of rooms an extra section further down.
  frag.appendChild(joinByCodeField((tableId) => void attachTable(tableId, rerender)));

  return frag;
}

/**
 * The lounge's live chat, extracted so the live table view (which cannot
 * import this module — see TableSocial's doc comment in onlinetableview.ts
 * for why) can render the same panel while a hand is in progress. The
 * underlying channel and message list (loungeState.messages) are unchanged
 * either way — this only changes where the panel gets rendered, never
 * subscribes twice.
 */
export function chatPanel(lounge: Lounge, rerender: () => void): HTMLElement {
  const panel = el('div', 'panel');
  panel.append(el('div', 'eyebrow', 'Table talk'));

  const log = el('div', 'chat-log');
  if (loungeState.messages.length === 0) {
    log.append(el('div', 'muted', 'Quiet in here. Say something.'));
  }
  for (const msg of loungeState.messages) {
    const line = el('div', 'chat-msg');
    line.append(el('span', 'who', msg.username ?? 'player'));
    line.append(document.createTextNode(msg.body));
    line.append(el('span', 'when', new Date(msg.created_at).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit',
    })));
    log.appendChild(line);
  }
  panel.appendChild(log);
  requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  // Cap the rendered history; an all-day lounge otherwise grows without bound.
  if (loungeState.messages.length > 200) {
    loungeState.messages = loungeState.messages.slice(-200);
  }

  const form = el('div', 'chat-form');
  const input = document.createElement('input');
  input.placeholder = 'Chat here then send';
  input.maxLength = 500;
  input.value = draft;
  input.oninput = () => { draft = input.value; draftCaret = input.selectionStart ?? draft.length; };
  // Restore focus and caret only if the player was already typing here.
  if (draft) {
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(draftCaret, draftCaret);
    });
  }
  const send = document.createElement('button');
  send.className = 'act ghost';
  send.textContent = 'Send';
  const submit = async () => {
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    draft = '';
    draftCaret = 0;
    try {
      await sendMessage(lounge.id, body);
    } catch (err) {
      loungeState.error = err instanceof Error ? err.message : 'could not send';
      rerender();
    }
  };
  send.onclick = () => void submit();
  input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } };
  form.append(input, send);
  panel.appendChild(form);
  return panel;
}

// ------------------------------------------------------------- the room --
function room(lounge: Lounge, rerender: () => void): DocumentFragment {
  const frag = document.createDocumentFragment();

  const head = el('div', 'panel');
  const top = el('div', 'spread');
  const titles = el('div');
  titles.append(el('div', 'eyebrow', 'Lounge'), el('h2', undefined, lounge.name));
  const back = document.createElement('button');
  back.className = 'act ghost';
  back.textContent = 'Leave';
  back.onclick = () => { leaveCurrentLounge(); rerender(); };
  top.append(titles, back);
  head.appendChild(top);
  if (lounge.description) head.append(el('p', 'muted', lounge.description));
  frag.appendChild(head);

  const tablesPanel = document.createElement('div');
  void openTablesPanel(lounge.id, (tableId) => void attachTable(tableId, rerender),
    rerender).then((panel) => {
    tablesPanel.replaceWith(panel);
  });
  frag.appendChild(tablesPanel);

  const grid = el('div', 'room');

  // --- chat ---------------------------------------------------------------
  const chat = chatPanel(lounge, rerender);
  chat.appendChild(voicePanel(rerender));
  chat.appendChild(reactionBar(rerender));

  // --- roster -------------------------------------------------------------
  const rosterPanel = el('div', 'panel');
  const roster = el('div', 'roster');
  roster.append(el('div', 'head', `In here — ${loungeState.roster.length}`));
  if (loungeState.roster.length === 0) {
    roster.append(el('div', 'muted', 'Just you so far.'));
  }
  for (const person of loungeState.roster) {
    const line = el('div', 'person');
    const speaking = loungeState.speaking.has(person.user_id);
    if (speaking) line.classList.add('speaking');
    line.append(el('span', 'dot'));
    const nameBtn = document.createElement('button');
    nameBtn.className = 'link-plain';
    nameBtn.textContent = person.username;
    nameBtn.onclick = () => openPlayerProfile(person.user_id, rerender);
    line.append(nameBtn);
    if (person.tier !== 'guest') line.append(tierBadge(person.tier));
    // Bredrins is the paid "know where your people are" feature — only a
    // VIP gets the add affordance, and never on their own line.
    if (loungeState.me?.tier === 'vip' && person.user_id !== loungeState.me.id) {
      const added = justAddedBredrin.has(person.user_id);
      const add = document.createElement('button');
      add.className = 'dismiss';
      add.textContent = added ? 'Added' : '+ Bredrin';
      add.disabled = added;
      add.onclick = () => void (async () => {
        add.disabled = true;
        try {
          await addBredrin(person.user_id);
          justAddedBredrin.add(person.user_id);
          bredrinsList = null;
          if (bredrinsOpen) loadBredrins(rerender);
        } catch (err) {
          loungeState.error = err instanceof Error ? err.message : 'could not add';
        } finally {
          rerender();
        }
      })();
      line.appendChild(add);
    }
    if (speaking) {
      const wave = el('span', 'wave');
      wave.setAttribute('aria-label', 'speaking');
      for (let i = 0; i < 3; i++) wave.appendChild(document.createElement('i'));
      line.appendChild(wave);
    }
    const thrown = loungeState.reactions.get(person.user_id);
    if (thrown) {
      const label = reactionLabel(thrown);
      const img = document.createElement('img');
      img.className = 'thrown';
      img.src = `${import.meta.env.BASE_URL}reactions/${thrown}.webp`;
      img.alt = label;
      img.width = 28;
      img.height = 28;
      line.appendChild(img);
    }
    roster.appendChild(line);
  }
  rosterPanel.appendChild(roster);
  if (viewingProfileId) rosterPanel.appendChild(playerProfileCard(rerender));

  grid.append(chat, rosterPanel);
  frag.appendChild(grid);
  return frag;
}

export function loungesView(rerender: () => void, goToMembership: () => void): DocumentFragment | HTMLElement {
  if (!loungesAvailable) {
    const frag = document.createDocumentFragment();
    const panel = el('div', 'panel');
    panel.append(el('div', 'eyebrow', 'Lounges'));
    panel.append(el('h2', undefined, 'Not connected yet'));
    panel.append(el('div', 'offline-note',
      'Lounges need a Supabase project. Copy .env.example to .env, fill in your ' +
      'project URL and anon key, run the migrations, then reload. Local play ' +
      'against duppies works without any of that.'));
    frag.appendChild(panel);
    return frag;
  }
  if (loungeState.onlineGame) {
    const frag = document.createDocumentFragment();
    if (loungeState.error) {
      frag.appendChild(el('div', 'banner', loungeState.error));
    }
    if (loungeState.penaltyEvents) {
      const g = loungeState.onlineGame;
      const partnered = g.table.mode === 'partner' || g.table.mode === 'openhand';
      frag.appendChild(penaltyBanner(
        loungeState.penaltyEvents,
        (seat) => describeSeat(seat, g.seats, g.mySeat, partnered, g.mySide),
      ));
    }
    // Voice and reactions belong at the table more than anywhere — this is
    // where the four of you actually are. They ride the lounge channel, which
    // stays joined while you play, so this is a rendering change, not a second
    // connection.
    frag.appendChild(liveTableView(loungeState.onlineGame, rerender, () => {
      loungeState.onlineGame = null;
      // Back to the lounge — stop appearing in this table's watcher list.
      loungeState.room?.setTable(null);
      // Video is table-scoped, unlike voice: leaving the table you were
      // showing video AT means there is nothing left to publish to or pull
      // from, so it tears down here rather than lingering like voice does.
      if (loungeState.video) {
        loungeState.video.leave();
        loungeState.video = null;
        loungeState.videoStreams = new Map();
        loungeState.room?.setVideo(false);
      }
      rerender();
    }, {
      speaking: loungeState.speaking,
      reactions: loungeState.reactions,
      voicePanel: voicePanel(rerender),
      videoPanel: videoPanel(rerender),
      videoStreams: loungeState.videoStreams,
      reactionBar: reactionBar(rerender),
      quickChatBar: quickChatBar(rerender),
      watching: loungeState.roster.filter(
        (p) => p.table === loungeState.onlineGame!.table.id,
      ),
      chatPanel: loungeState.current ? chatPanel(loungeState.current, rerender) : null,
      loungeName: loungeState.current?.name ?? null,
    }));
    return frag;
  }
  const body = loungeState.current ? room(loungeState.current, rerender) : loungeList(rerender, goToMembership);
  if (loungeState.invites.length === 0) return body;
  const frag = document.createDocumentFragment();
  frag.appendChild(inviteBanner(loungeState.invites, rerender));
  frag.appendChild(body);
  return frag;
}

// --------------------------------------------------------- membership ----
export function membershipView(rerender: () => void, goToProfile: () => void): DocumentFragment {
  const frag = document.createDocumentFragment();
  const myTier: Tier = loungeState.me?.tier ?? 'guest';

  const head = el('div', 'panel');
  head.append(el('div', 'eyebrow', 'Membership'));
  head.append(el('h2', undefined, 'The game is free. Always.'));
  head.append(el('p', 'muted',
    'Every mode, ranked play, and the deal-checker cost nothing and always will. ' +
    'Membership buys the room, not the rules.'));
  // Quiet, not a button — this headline's whole job is "free, no login wall,"
  // so a returning player switching devices needs a fast way back to an
  // account they already secured, without that competing with the pitch a
  // brand-new guest sees first. Sign-in itself lives on the Profile tab now
  // (previously buried at the bottom of this pricing page) — this just
  // points there instead of asking a new player to scroll past pricing to
  // find it.
  if (loungeState.me && loungeState.isAnonymous) {
    const signIn = document.createElement('button');
    signIn.className = 'linky';
    signIn.textContent = 'Already have an account? Sign in under Profile';
    signIn.onclick = () => goToProfile();
    head.appendChild(signIn);
  }
  frag.appendChild(head);

  const grid = el('div', 'tiers');
  for (const tier of ['guest', 'yardie', 'vip'] as Tier[]) {
    const pitch = TIER_PITCH[tier];
    const card = el('div', `tier-card ${tier}`);
    card.append(el('h3', undefined, TIER_LABEL[tier]));
    card.append(el('div', 'price', pitch.price));

    const list = document.createElement('ul');
    for (const point of pitch.points) list.append(el('li', undefined, point));
    card.appendChild(list);

    if (tier === 'guest') {
      card.append(el('div', 'muted', myTier === 'guest' ? 'You are here' : 'Included'));
    } else if (TIER_RANK[myTier] >= TIER_RANK[tier]) {
      card.append(el('div', 'muted', 'Active'));
    } else {
      const buy = document.createElement('button');
      buy.className = 'act ghost';
      buy.textContent = `Get ${TIER_LABEL[tier]}`;
      buy.onclick = async () => {
        buy.disabled = true;
        buy.textContent = 'Opening checkout…';
        try {
          window.location.href = await startCheckout(tier as 'yardie' | 'vip');
        } catch (err) {
          loungeState.error = err instanceof Error ? err.message : 'checkout unavailable';
          rerender();
        }
      };
      card.appendChild(buy);
    }
    grid.appendChild(card);
  }
  frag.appendChild(grid);

  const note = el('div', 'panel');
  note.append(el('p', 'muted',
    'Card payment, active the second it clears. Cancel any time and you keep ' +
    'the year you paid for.'));
  frag.appendChild(note);

  return frag;
}

/**
 * Everything about the account lives here: editing who you are, coins,
 * feedback, security (secure/sign in), and your bredrins list — one screen
 * for a returning player to land on directly, reachable from Lounges'
 * "Manage account" button, the live table's You tab, and its own top-level
 * nav tab. Split out of membershipView (which used to bundle all of this
 * below the pricing cards) so an existing member doesn't have to scroll
 * past the guest/Yardie/VIP pitch every time they just want their profile.
 * Admin tools live on their own separate `adminDashboardView` now, not here.
 */
export function profileView(rerender: () => void): DocumentFragment {
  const frag = document.createDocumentFragment();

  // Ahead of everything else — someone who just clicked an emailed reset
  // link expects to land directly on setting a new password, not have to
  // find it under the rest of the account tools.
  if (recoveryMode) frag.appendChild(passwordRecoveryPanel(rerender));

  const me = loungeState.me;
  if (!me) {
    const head = el('div', 'panel');
    head.append(el('div', 'eyebrow', 'Profile'));
    head.append(el('p', 'muted', 'Loading…'));
    frag.appendChild(head);
    return frag;
  }

  // Returning members sign in here. Focus the email field so landing on
  // this tab via the Membership pointer link is immediate and unambiguous.
  const signInAtTop = accountOpen && accountMode === 'signin';
  if (signInAtTop) {
    const inlineAccount = accountPanel(rerender);
    inlineAccount.classList.add('inline-account-panel');
    frag.appendChild(inlineAccount);
  }

  // Right after a Stripe redirect — checkout itself starts from the
  // Membership tier cards, so this is where the nudge to secure it belongs,
  // not a screen the player has to happen to revisit.
  if (justUpgradedTier && loungeState.isAnonymous && !accountOpen) {
    frag.appendChild(upgradePrompt(justUpgradedTier, rerender));
  }

  // A paying member asked to see everything they get in one place, rather
  // than piece it together from the pricing cards on Membership they saw
  // once at signup. Same copy TIER_PITCH already shows there, just surfaced
  // where a Yardie/VIP actually lives day to day.
  if (me.tier !== 'guest') {
    const perks = el('div', 'panel');
    perks.append(el('div', 'eyebrow', TIER_LABEL[me.tier]));
    perks.append(el('h3', undefined, 'Your perks'));
    const list = document.createElement('ul');
    for (const point of TIER_PITCH[me.tier].points) list.append(el('li', undefined, point));
    perks.appendChild(list);
    frag.appendChild(perks);
  }

  frag.appendChild(profilePanel(me, rerender, (fresh) => { loungeState.me = fresh; }));

  const accountHead = el('div', 'row');
  const openAccount = (mode: 'secure' | 'signin') => {
    const alreadyActive = accountOpen && accountMode === mode;
    accountOpen = !alreadyActive;
    accountMode = mode;
    accountError = null;
    accountMessage = null;
    rerender();
  };
  const defaultMode = loungeState.isAnonymous ? 'secure' : 'signin';
  const accountBtn = document.createElement('button');
  accountBtn.className = 'act ghost small';
  accountBtn.textContent = (accountOpen && accountMode === defaultMode)
    ? 'Done'
    : (loungeState.isAnonymous ? 'Secure account' : 'Account');
  accountBtn.onclick = () => openAccount(defaultMode);
  accountHead.append(accountBtn);
  // A fresh browser always lands on a brand-new guest session — "Sign in"
  // to an account secured elsewhere was previously reachable only by
  // opening "Secure account" first and finding a toggle link buried
  // inside it. A player who already knows they have an account and just
  // wants back in should see that option up front, not one layer deep.
  if (loungeState.isAnonymous) {
    const signInBtn = document.createElement('button');
    signInBtn.className = 'act ghost small';
    signInBtn.textContent = (accountOpen && accountMode === 'signin') ? 'Done' : 'Sign in';
    signInBtn.onclick = () => openAccount('signin');
    accountHead.append(signInBtn);
  }
  frag.appendChild(accountHead);
  if (loungeState.isAnonymous && !accountOpen) {
    frag.appendChild(el('p', 'muted small',
      'This is a guest session tied to this browser. Secure account keeps it from being '
      + 'lost, or Sign in if you already secured one elsewhere.'));
  }
  if (accountOpen && !signInAtTop) frag.appendChild(accountPanel(rerender));

  const bredrinsBtn = document.createElement('button');
  bredrinsBtn.className = 'act ghost small';
  bredrinsBtn.textContent = bredrinsOpen ? 'Done' : 'Bredrins';
  bredrinsBtn.onclick = () => {
    bredrinsOpen = !bredrinsOpen;
    if (bredrinsOpen && me.tier === 'vip' && !bredrinsList) loadBredrins(rerender);
    rerender();
  };
  frag.appendChild(bredrinsBtn);
  if (bredrinsOpen) frag.appendChild(bredrinsPanel(me, rerender));

  return frag;
}

/**
 * Standalone admin dashboard — everything adminSection() (profile.ts) used
 * to render nested at the bottom of a player's own profile panel, now its
 * own top-level view reachable only via the nav tab main.ts shows exclusively
 * to a confirmed admin. Not gated again here: main.ts's dispatch already
 * refuses to reach this function at all unless loungeState.me.isAdmin, and
 * every action it triggers (reports, feedback, referral stats, grant/revoke
 * admin) re-checks is_admin server-side regardless.
 */
export function adminDashboardView(rerender: () => void): DocumentFragment {
  const frag = document.createDocumentFragment();
  const head = el('div', 'panel');
  head.append(el('div', 'eyebrow', 'Admin'));
  head.append(el('h2', undefined, 'Run the yard'));
  frag.appendChild(head);
  const wrap = el('div', 'panel');
  wrap.appendChild(adminSection(rerender));
  frag.appendChild(wrap);
  return frag;
}

// -------------------------------------------------------------- rankings --
// Two real categories, matching exactly what apply-rating.ts writes to —
// Partner also covers openhand and across (one shared column), and French
// shares Cut Throat's column since a French table is mode: 'cutthroat'
// under the hood. Not four tabs; the data can only actually back two.
let rankingCategory: RatingCategory = 'partner';
const rankingCache = new Map<RatingCategory, RankedPlayer[]>();
let rankingLoading = false;
let rankingError: string | null = null;

function loadRanking(rerender: () => void) {
  rankingLoading = true;
  rankingError = null;
  rerender();
  void topRanked(rankingCategory)
    .then((players) => { rankingCache.set(rankingCategory, players); })
    .catch((err) => { rankingError = err instanceof Error ? err.message : 'could not load'; })
    .finally(() => { rankingLoading = false; rerender(); });
}

/** Real photo first, then the chosen illustrated character, same fallback
 *  chain as a live table's seat identity (onlinetableview.ts). */
function rankedAvatar(p: RankedPlayer): HTMLElement {
  const shell = document.createElement('span');
  shell.className = 'avatar-shell';
  const img = document.createElement('img');
  img.className = 'avatar';
  img.width = 40;
  img.height = 40;
  img.alt = p.avatar ? (AVATAR_LABEL[p.avatar] ?? '') : '';
  img.src = photoUrl(p.userId);
  img.onerror = () => {
    if (p.avatar) {
      img.onerror = null;
      img.src = avatarUrl(p.avatar);
    } else {
      img.remove();
    }
  };
  shell.appendChild(img);
  if (p.avatarAccessory) {
    const flair = document.createElement('img');
    flair.className = `avatar-accessory avatar-accessory-${p.avatarAccessory}`;
    flair.src = avatarAccessoryUrl(p.avatarAccessory);
    flair.alt = '';
    flair.width = 22;
    flair.height = 22;
    shell.appendChild(flair);
  }
  return shell;
}

export function rankingsView(rerender: () => void): DocumentFragment {
  const frag = document.createDocumentFragment();
  const head = el('div', 'panel');
  head.append(el('div', 'eyebrow', 'Rankings'));
  head.append(el('h2', undefined, 'Who runs the yard'));
  head.append(el('p', 'muted',
    'Every rated set moves this. Duppy-filled tables never count — only real games.'));

  const tabs = el('div', 'choices');
  for (const [value, label] of [['partner', 'Partner'], ['cutthroat', 'Cut Throat']] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice';
    b.setAttribute('aria-pressed', String(rankingCategory === value));
    b.textContent = label;
    b.onclick = () => {
      if (rankingCategory === value) return;
      rankingCategory = value;
      if (!rankingCache.has(value)) loadRanking(rerender);
      else rerender();
    };
    tabs.appendChild(b);
  }
  head.appendChild(tabs);
  frag.appendChild(head);

  if (!rankingCache.has(rankingCategory) && !rankingLoading) loadRanking(rerender);

  const board = el('div', 'panel ranking-board');
  if (rankingError) board.append(el('div', 'banner small', rankingError));
  if (rankingLoading && !rankingCache.has(rankingCategory)) {
    board.append(el('p', 'muted small', 'Loading…'));
  } else {
    const players = rankingCache.get(rankingCategory) ?? [];
    if (players.length === 0) {
      board.append(el('p', 'muted small', 'Nobody has a real rating here yet — play a full rated set to be the first.'));
    } else {
      const list = el('div', 'ranking-list');
      players.forEach((p, i) => {
        const row = el('div', 'ranking-row');
        row.append(el('span', 'ranking-place', String(i + 1)));
        row.appendChild(rankedAvatar(p));
        row.append(el('span', 'ranking-name', p.username));
        row.append(el('span', 'ranking-rating', String(p.rating)));
        list.appendChild(row);
      });
      board.appendChild(list);
    }
  }
  frag.appendChild(board);
  return frag;
}
