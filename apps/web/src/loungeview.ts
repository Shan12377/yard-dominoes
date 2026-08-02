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
  saveProfile, ORIGIN_LABEL, AVATARS, AVATAR_LABEL, avatarUrl,
  BACKGROUNDS, BACKGROUND_LABEL, backgroundUrl,
  addBredrin, removeBredrin, whereAreMyBredrins,
  MIN_GIFT_COINS, COIN_PACK_LABEL, myCoinBalance, buyCoins, giftCoins,
} from './lounges.ts';
import type {
  Avatar, Background, Bredrin, Gender, Lounge, LoungeMessage, LoungeRoom, MyProfile, Origin, PresenceEntry, Tier,
} from './lounges.ts';
import {
  ensureSignedIn, findActiveSeat, videoSessionCall,
  secureAccount, signInWithPassword, isAnonymousUser,
} from './online.ts';
import { OnlineGame } from './onlinetable.ts';
import { openTablesPanel, joinByCodeField, liveTableView } from './onlinetableview.ts';
import { el } from './render.ts';
import { canSpeak, joinVoice } from './voice.ts';
import type { VoiceRoom } from './voice.ts';
import { canShowVideo, joinVideo, CAMERA_TRACK_NAME } from './video.ts';
import { fileReport, listReports, resolveReport, dismissReport, listAdmins, grantAdmin, revokeAdmin } from './reports.ts';
import type { Report, Admin } from './reports.ts';
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
}

export const loungeState: LoungeState = {
  lounges: [], me: null, current: null, roster: [], messages: [],
  room: null, error: null, loading: false, onlineGame: null,
  voice: null, voiceJoining: false, speaking: new Set(), reactions: new Map(),
  video: null, videoJoining: false, videoStreams: new Map(), isAnonymous: true,
};

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

/** Load lounges and profile. Safe to call repeatedly. */
export async function loadLounges(rerender: () => void) {
  if (!loungesAvailable || loungeState.loading) return;
  loungeState.loading = true;
  try {
    await ensureSignedIn();
    const [lounges, me, anon] = await Promise.all([listLounges(), myProfile(), isAnonymousUser()]);
    loungeState.lounges = lounges;
    loungeState.me = me;
    loungeState.isAnonymous = anon;
    loungeState.error = null;

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

/** The circular portrait worn on a seat. Alt text names the character, not
 *  the filename — a screen reader should hear "gold head-wrap", not "wrap". */
export function avatarImg(avatar: Avatar, alt = ''): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'avatar';
  img.src = avatarUrl(avatar);
  img.alt = alt;
  img.width = 32;
  img.height = 32;
  return img;
}

// -------------------------------------------------------------- profile --
let profileOpen = false;
let profileError: string | null = null;
let profileSaving = false;

/**
 * The first place in this app a player has ever been able to change anything
 * about themselves. Until now `profiles.username` was assigned at sign-up and
 * `flag` had sat unwritten since the very first migration.
 *
 * Three fields, and two of them are optional on purpose. "Did not say" is a
 * real answer to both where you play from and what to call you, so neither
 * question has a default and neither is ever inferred — not from a name, not
 * from a voice, not from an IP.
 */
// ----------------------------------------------------------------- photo --
// "Rank badge and profile photo" has been sold in TIER_PITCH.yardie since
// lounges.ts existed, with nothing to upload one until now. Live the moment
// it uploads, no review queue — the existing report-a-player flow is the
// moderation path, same as for any other conduct problem.
let photoBusy = false;
let photoError: string | null = null;
let photoVersion = 0;
/** null = not yet checked. Set by the preview <img>'s own load/error, since
 *  there is no has_photo column to ask instead — see photo.ts. */
let photoExists: boolean | null = null;

function photoSection(me: MyProfile, rerender: () => void): HTMLElement {
  const section = el('div', 'stack');
  section.append(el('label', 'field-label', 'Profile photo (optional)'));

  if (me.tier === 'guest') {
    section.append(el('p', 'muted small',
      `A real photo instead of a preset character — part of Yardie, ${TIER_PITCH.yardie.price}.`));
    return section;
  }

  section.append(el('p', 'muted small',
    'Shown wherever your seat card is, live the moment you upload it. The ' +
    'report button is the safety net if someone puts up something bad.'));

  if (photoError) section.append(el('div', 'banner small', photoError));

  const img = document.createElement('img');
  img.className = 'photo-preview';
  img.alt = '';
  img.width = 96;
  img.height = 96;
  img.src = `${photoUrl(me.id)}?v=${photoVersion}`;
  img.onload = () => { if (photoExists !== true) { photoExists = true; rerender(); } };
  img.onerror = () => {
    img.style.display = 'none';
    if (photoExists !== false) { photoExists = false; rerender(); }
  };
  section.appendChild(img);

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.display = 'none';
  input.onchange = () => void (async () => {
    const file = input.files?.[0];
    if (!file) return;
    photoBusy = true;
    photoError = null;
    rerender();
    try {
      await uploadMyPhoto(file);
      photoVersion += 1;
      photoExists = true;
    } catch (err) {
      photoError = err instanceof Error ? err.message : 'could not upload';
    } finally {
      photoBusy = false;
      rerender();
    }
  })();

  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'act ghost small';
  pick.textContent = photoBusy ? 'Uploading…' : 'Upload photo';
  pick.disabled = photoBusy;
  pick.onclick = () => input.click();

  const row = el('div', 'row');
  row.append(pick, input);

  if (photoExists) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'act ghost small';
    remove.textContent = 'Remove';
    remove.disabled = photoBusy;
    remove.onclick = () => void (async () => {
      photoBusy = true;
      photoError = null;
      rerender();
      try {
        await removeMyPhoto();
        photoVersion += 1;
        photoExists = false;
      } catch (err) {
        photoError = err instanceof Error ? err.message : 'could not remove';
      } finally {
        photoBusy = false;
        rerender();
      }
    })();
    row.appendChild(remove);
  }

  section.appendChild(row);
  return section;
}

function profilePanel(me: MyProfile, rerender: () => void): HTMLElement {
  const panel = el('div', 'panel');
  panel.append(el('div', 'eyebrow', 'Your profile'));
  panel.append(el('h2', undefined, 'Who yuh be'));

  panel.appendChild(photoSection(me, rerender));

  const name = document.createElement('input');
  name.className = 'field';
  name.value = me.username;
  name.maxLength = 24;
  name.setAttribute('aria-label', 'Your name');
  panel.append(el('label', 'field-label', 'Name'), name);

  panel.append(el('label', 'field-label', 'Where you play from'));
  panel.append(el('p', 'muted small',
    'Yard or foreign — both are Jamaican. Somebody in Brooklyn flying the '
    + 'flag is still foreign, and that is the point of asking.'));
  let origin: Origin | null = me.origin;
  const originRow = choiceRow(
    [['yardie', 'Yardie'], ['foreign', 'Foreign']],
    () => origin,
    (v) => { origin = v as Origin | null; },
  );
  panel.appendChild(originRow);

  panel.append(el('label', 'field-label', 'Call me (optional)'));
  let gender: Gender | null = me.gender;
  const genderRow = choiceRow(
    [['f', 'She'], ['m', 'He']],
    () => gender,
    (v) => { gender = v as Gender | null; },
  );
  panel.appendChild(genderRow);

  panel.append(el('label', 'field-label', 'Presence (optional)'));
  panel.append(el('p', 'muted small',
    'A character for the seat, if you would rather not show your face. '
    + '"Plain" is presence without one either.'));
  let avatar: Avatar | null = me.avatar;
  const avatarCaption = el('p', 'muted small', avatar ? AVATAR_LABEL[avatar] : 'None chosen');
  const avatarGrid = el('div', 'avatar-grid');
  const paintAvatars = () => {
    for (const btn of Array.from(avatarGrid.children) as HTMLButtonElement[]) {
      btn.setAttribute('aria-pressed', String(btn.dataset.value === avatar));
    }
    avatarCaption.textContent = avatar ? AVATAR_LABEL[avatar] : 'None chosen';
  };
  for (const id of AVATARS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'avatar-choice';
    btn.dataset.value = id;
    btn.setAttribute('aria-label', AVATAR_LABEL[id]);
    btn.appendChild(avatarImg(id));
    btn.onclick = () => { avatar = avatar === id ? null : id; paintAvatars(); };
    avatarGrid.appendChild(btn);
  }
  paintAvatars();
  panel.append(avatarGrid, avatarCaption);

  panel.append(el('label', 'field-label', 'Seat backdrop (optional)'));
  panel.append(el('p', 'muted small',
    'A cosmetic scene worn behind your seat card. Nobody else\'s tiles or '
    + 'turn get any harder to read — it just sits at the back.'));
  let background: Background | null = me.background;
  const backgroundCaption = el('p', 'muted small', background ? BACKGROUND_LABEL[background] : 'None chosen');
  const backgroundGrid = el('div', 'background-grid');
  const paintBackgrounds = () => {
    for (const btn of Array.from(backgroundGrid.children) as HTMLButtonElement[]) {
      btn.setAttribute('aria-pressed', String(btn.dataset.value === background));
    }
    backgroundCaption.textContent = background ? BACKGROUND_LABEL[background] : 'None chosen';
  };
  for (const id of BACKGROUNDS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'background-choice';
    btn.dataset.value = id;
    btn.setAttribute('aria-label', BACKGROUND_LABEL[id]);
    const img = document.createElement('img');
    img.src = backgroundUrl(id);
    img.alt = '';
    img.width = 96;
    img.height = 64;
    btn.appendChild(img);
    btn.onclick = () => { background = background === id ? null : id; paintBackgrounds(); };
    backgroundGrid.appendChild(btn);
  }
  paintBackgrounds();
  panel.append(backgroundGrid, backgroundCaption);

  if (profileError) panel.append(el('div', 'banner', profileError));

  const save = document.createElement('button');
  save.className = 'act';
  save.textContent = profileSaving ? 'Saving…' : 'Save';
  save.disabled = profileSaving;
  save.onclick = () => void (async () => {
    profileSaving = true;
    profileError = null;
    rerender();
    try {
      await saveProfile({ username: name.value, origin, gender, avatar, background });
      // Re-read rather than patching the local copy: the server is the only
      // thing that knows whether the name was actually accepted.
      loungeState.me = await myProfile();
      profileOpen = false;
    } catch (err) {
      profileError = err instanceof Error ? err.message : 'could not save';
    } finally {
      profileSaving = false;
      rerender();
    }
  })();
  panel.appendChild(save);
  return panel;
}

/**
 * A row of choices where picking the one already chosen clears it. That is how
 * an optional question stays answerable with "actually, never mind" — without
 * it, a player who taps "She" by accident can never take it back.
 */
function choiceRow(
  options: [string, string][],
  get: () => string | null,
  set: (v: string | null) => void,
): HTMLElement {
  const row = el('div', 'choices');
  const paint = () => {
    for (const b of Array.from(row.children) as HTMLButtonElement[]) {
      b.setAttribute('aria-pressed', String(b.dataset.value === get()));
    }
  };
  for (const [value, label] of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice';
    b.dataset.value = value;
    b.textContent = label;
    b.onclick = () => { set(get() === value ? null : value); paint(); };
    row.appendChild(b);
  }
  paint();
  return row;
}

// ------------------------------------------------------------- bredrins --
let bredrinsOpen = false;
let bredrinsList: Bredrin[] | null = null;
let bredrinsLoading = false;
let bredrinsError: string | null = null;
/** Ids added this session, so a roster "+" swaps to a confirmation without
 *  waiting on a full bredrins reload. */
const justAddedBredrin = new Set<string>();

function loadBredrins(rerender: () => void) {
  bredrinsLoading = true;
  bredrinsError = null;
  rerender();
  void whereAreMyBredrins()
    .then((list) => { bredrinsList = list; })
    .catch((err) => { bredrinsError = err instanceof Error ? err.message : 'could not load'; })
    .finally(() => { bredrinsLoading = false; rerender(); });
}

/** Roughly how long ago, for a last-seen line — a coarse grain is the useful
 *  one here, not a live-ticking clock. */
function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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
      const where = b.lounge
        ? loungeState.lounges.find((l) => l.id === b.lounge)?.name ?? 'a lounge'
        : null;
      line.append(el('span', 'muted small',
        where ? `In ${where}` : b.lastSeen ? `Last seen ${timeAgo(b.lastSeen)}` : 'Never seen'));
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

// -------------------------------------------------------------- reports --
// Admin-only review queue. The report button itself lives at the table
// (onlinetableview.ts) — this is the other end of the terms of service's
// "There is a report button — use it, and we will look" promise, which
// had no way to actually look until now.
let reportsOpen = false;
let reportsList: Report[] | null = null;
let reportsLoading = false;
let reportsError: string | null = null;
let reportsBusy = false;

function loadReports(rerender: () => void) {
  reportsLoading = true;
  reportsError = null;
  rerender();
  void listReports()
    .then((list) => { reportsList = list; })
    .catch((err) => { reportsError = err instanceof Error ? err.message : 'could not load'; })
    .finally(() => { reportsLoading = false; rerender(); });
}

// Who else can review reports. A grant/revoke UI so is_admin stops being a
// SQL-only knob — the entire reason to build report-admin's grant-admin/
// revoke-admin actions was to get this out of "ask someone to run a query."
let adminsList: Admin[] | null = null;
let adminsLoading = false;
let adminsError: string | null = null;
let adminsBusy = false;
let grantUsername = '';

function loadAdmins(rerender: () => void) {
  adminsLoading = true;
  adminsError = null;
  rerender();
  void listAdmins()
    .then((list) => { adminsList = list; })
    .catch((err) => { adminsError = err instanceof Error ? err.message : 'could not load'; })
    .finally(() => { adminsLoading = false; rerender(); });
}

function adminsSection(rerender: () => void): HTMLElement {
  const section = el('div', 'stack');
  section.append(el('h3', undefined, 'Admins'));

  if (adminsError) section.append(el('div', 'banner small', adminsError));

  if (adminsLoading && !adminsList) {
    section.append(el('p', 'muted small', 'Loading…'));
    return section;
  }

  const list = el('div', 'roster');
  for (const a of adminsList ?? []) {
    const line = el('div', 'person');
    line.append(el('span', undefined, a.username));
    const remove = document.createElement('button');
    remove.className = 'dismiss';
    remove.textContent = 'Remove';
    remove.disabled = adminsBusy;
    remove.onclick = () => void (async () => {
      adminsBusy = true;
      adminsError = null;
      rerender();
      try {
        await revokeAdmin(a.id);
        adminsList = (adminsList ?? []).filter((x) => x.id !== a.id);
      } catch (err) {
        adminsError = err instanceof Error ? err.message : 'could not remove';
      } finally {
        adminsBusy = false;
        rerender();
      }
    })();
    line.appendChild(remove);
    list.appendChild(line);
  }
  section.appendChild(list);

  const form = el('div', 'row');
  const input = document.createElement('input');
  input.placeholder = 'username';
  input.value = grantUsername;
  input.oninput = () => { grantUsername = input.value; };
  form.appendChild(input);

  const add = document.createElement('button');
  add.className = 'act small';
  add.textContent = adminsBusy ? 'Adding…' : 'Make admin';
  add.disabled = adminsBusy;
  add.onclick = () => void (async () => {
    const username = grantUsername.trim();
    if (!username) return;
    adminsBusy = true;
    adminsError = null;
    rerender();
    try {
      const result = await grantAdmin(username);
      grantUsername = '';
      if (!result.already) {
        adminsList = [...(adminsList ?? []), { id: '', username: result.username }]
          .sort((x, y) => x.username.localeCompare(y.username));
        // The temporary id is fine here — the next loadAdmins() (panel
        // reopen) replaces it with the real one; Remove just isn't wired
        // for this row until then.
      }
    } catch (err) {
      adminsError = err instanceof Error ? err.message : 'could not add';
    } finally {
      adminsBusy = false;
      rerender();
    }
  })();
  form.appendChild(add);
  section.appendChild(form);

  return section;
}

function reportsPanel(rerender: () => void): HTMLElement {
  const panel = el('div', 'panel');
  panel.append(el('div', 'eyebrow', 'Admin'));
  panel.append(el('h2', undefined, 'Reports'));

  if (reportsError) panel.append(el('div', 'banner', reportsError));

  if (reportsLoading && !reportsList) {
    panel.append(el('p', 'muted', 'Loading…'));
  } else {
    const open = (reportsList ?? []).filter((r) => r.status === 'open');
    if (open.length === 0) {
      panel.append(el('p', 'muted', 'Nothing open.'));
    } else {
      const list = el('div', 'roster');
      for (const r of open) {
        const line = el('div', 'person');
        const who = `${r.reporter?.username ?? 'someone'} reported ${r.reported?.username ?? 'someone'}`;
        line.append(el('span', undefined, who));
        line.append(el('p', 'muted small', r.reason));
        line.append(el('span', 'muted small', timeAgo(r.created_at)));

        const act = (label: string, fn: (id: string) => Promise<unknown>) => {
          const b = document.createElement('button');
          b.className = 'dismiss';
          b.textContent = label;
          b.disabled = reportsBusy;
          b.onclick = () => void (async () => {
            reportsBusy = true;
            rerender();
            try {
              await fn(r.id);
              reportsList = (reportsList ?? []).map((x) => x.id === r.id ? { ...x, status: label === 'Resolve' ? 'resolved' as const : 'dismissed' as const } : x);
            } catch (err) {
              reportsError = err instanceof Error ? err.message : 'could not update';
            } finally {
              reportsBusy = false;
              rerender();
            }
          })();
          return b;
        };
        line.append(act('Resolve', resolveReport), act('Dismiss', dismissReport));
        list.appendChild(line);
      }
      panel.appendChild(list);
    }
  }

  panel.appendChild(adminsSection(rerender));
  return panel;
}

// ---------------------------------------------------------------- coins --
// Never cash out — money in, utility only. See lounges.ts's coins section
// for why that single rule keeps this out of a licensing regime.
let coinsOpen = false;
let coinBalance: number | null = null;
let coinBusy = false;
let coinError: string | null = null;

function loadCoinBalance(rerender: () => void) {
  void myCoinBalance().then((n) => { coinBalance = n; rerender(); });
}

function coinsPanel(rerender: () => void): HTMLElement {
  const panel = el('div', 'panel');
  panel.append(el('div', 'eyebrow', 'Coins'));
  panel.append(el('h2', undefined, 'Yours to spend'));
  panel.append(el('p', 'muted',
    'Never cash out — money in, utility only. Buy a bredrin a drink, or ' +
    'just carry a little weight.'));

  panel.append(el('div', 'coin-balance', coinBalance === null ? '…' : String(coinBalance)));

  if (coinError) panel.append(el('div', 'banner', coinError));

  const buy = document.createElement('button');
  buy.className = 'act';
  buy.textContent = coinBusy ? 'Opening checkout…' : `Buy ${COIN_PACK_LABEL}`;
  buy.disabled = coinBusy;
  buy.onclick = () => void (async () => {
    coinBusy = true; coinError = null; rerender();
    try {
      window.location.href = await buyCoins();
    } catch (err) {
      coinError = err instanceof Error ? err.message : 'checkout unavailable';
      coinBusy = false;
      rerender();
    }
  })();
  panel.appendChild(buy);
  return panel;
}

/** The "gift N coins" affordance dropped into a roster line, framed the way
 *  the gesture actually reads at a yard table — you buy a bredrin a drink,
 *  you don't "send them coins". No further detail than that: this is one
 *  word doing real work, not a menu of what's in the glass. Fixed at the
 *  floor — a full amount picker is more UI than "pure social flex" needs. */
function giftButton(toUserId: string, rerender: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'dismiss';
  btn.textContent = `Buy a drink — ${MIN_GIFT_COINS} coins`;
  btn.title = `Buy a drink — ${MIN_GIFT_COINS} coins`;
  btn.onclick = () => void (async () => {
    btn.disabled = true;
    try {
      coinBalance = await giftCoins(toUserId, MIN_GIFT_COINS);
    } catch (err) {
      loungeState.error = err instanceof Error ? err.message : 'could not buy that drink';
    } finally {
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
// render() rebuilds this panel's DOM on every keystroke elsewhere on the
// lounge screen (the tournament countdown reruns rerender() on its own
// timer — see tournamentview.ts's scheduleTick). Same fix as the chat
// draft above: hold the values and caret outside the DOM and restore them.
let accountEmailDraft = '';
let accountEmailCaret = 0;
let accountPasswordDraft = '';
let accountPasswordCaret = 0;
let accountFocusedField: 'email' | 'password' | null = null;

function accountPanel(rerender: () => void): HTMLElement {
  const panel = el('div', 'panel');
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
  email.setAttribute('aria-label', 'Email');
  email.placeholder = 'you@example.com';
  email.value = accountEmailDraft;
  email.oninput = () => {
    accountEmailDraft = email.value;
    accountEmailCaret = email.selectionStart ?? accountEmailDraft.length;
  };
  email.onfocus = () => { accountFocusedField = 'email'; };
  panel.append(el('label', 'field-label', 'Email'), email);

  const password = document.createElement('input');
  password.type = 'password';
  password.className = 'field';
  password.autocomplete = secure ? 'new-password' : 'current-password';
  password.setAttribute('aria-label', 'Password');
  password.placeholder = secure ? 'At least 8 characters' : 'Your password';
  password.value = accountPasswordDraft;
  password.oninput = () => {
    accountPasswordDraft = password.value;
    accountPasswordCaret = password.selectionStart ?? accountPasswordDraft.length;
  };
  password.onfocus = () => { accountFocusedField = 'password'; };
  panel.append(el('label', 'field-label', 'Password'), password);

  // Restore focus and caret only to whichever field was actually being typed
  // in — otherwise both fields' focus() calls fight and the wrong one wins.
  if (accountFocusedField === 'email') {
    requestAnimationFrame(() => { email.focus(); email.setSelectionRange(accountEmailCaret, accountEmailCaret); });
  } else if (accountFocusedField === 'password') {
    requestAnimationFrame(() => {
      password.focus();
      password.setSelectionRange(accountPasswordCaret, accountPasswordCaret);
    });
  }

  if (accountError) panel.append(el('div', 'banner small', accountError));
  if (accountMessage) panel.append(el('div', 'muted small', accountMessage));

  const submit = document.createElement('button');
  submit.className = 'act';
  submit.textContent = accountBusy
    ? (secure ? 'Securing…' : 'Signing in…')
    : (secure ? 'Secure account' : 'Sign in');
  submit.disabled = accountBusy;
  submit.onclick = () => void (async () => {
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

  const switchMode = document.createElement('button');
  switchMode.className = 'act ghost small';
  switchMode.textContent = secure
    ? 'Already secured an account? Sign in instead.'
    : 'New here? Secure this account instead.';
  switchMode.onclick = () => {
    accountMode = secure ? 'signin' : 'secure';
    accountError = null;
    accountMessage = null;
    rerender();
  };
  panel.appendChild(switchMode);

  return panel;
}

// ----------------------------------------------------------- lounge list --
function loungeList(rerender: () => void): DocumentFragment {
  const frag = document.createDocumentFragment();
  const me = loungeState.me;
  const myTier: Tier = me?.tier ?? 'guest';

  const head = el('div', 'panel');
  head.append(el('div', 'eyebrow', 'Lounges'));
  head.append(el('h2', undefined, 'Find a four'));
  head.append(el('p', 'muted',
    'Every lounge is a room with people in it — talk, watch, and take a seat ' +
    'when one opens. You keep your rank wherever you play.'));
  if (me) {
    const you = el('div', 'row');
    you.append(el('span', 'muted', `Signed in as ${me.username}`), tierBadge(me.tier));
    if (me.origin) you.append(originBadge(me.origin));
    const edit = document.createElement('button');
    edit.className = 'act ghost small';
    edit.textContent = profileOpen ? 'Done' : 'Edit profile';
    edit.onclick = () => { profileOpen = !profileOpen; profileError = null; rerender(); };
    you.append(edit);
    const bredrinsBtn = document.createElement('button');
    bredrinsBtn.className = 'act ghost small';
    bredrinsBtn.textContent = bredrinsOpen ? 'Done' : 'Bredrins';
    bredrinsBtn.onclick = () => {
      bredrinsOpen = !bredrinsOpen;
      if (bredrinsOpen && me.tier === 'vip' && !bredrinsList) loadBredrins(rerender);
      rerender();
    };
    you.append(bredrinsBtn);
    const coinsBtn = document.createElement('button');
    coinsBtn.className = 'act ghost small';
    coinsBtn.textContent = coinsOpen ? 'Done' : (coinBalance === null ? 'Coins' : `${coinBalance} coins`);
    coinsBtn.onclick = () => {
      coinsOpen = !coinsOpen;
      if (coinsOpen && coinBalance === null) loadCoinBalance(rerender);
      rerender();
    };
    you.append(coinsBtn);
    if (me.isAdmin) {
      const reportsBtn = document.createElement('button');
      reportsBtn.className = 'act ghost small';
      reportsBtn.textContent = reportsOpen ? 'Done' : 'Reports';
      reportsBtn.onclick = () => {
        reportsOpen = !reportsOpen;
        if (reportsOpen && !reportsList) loadReports(rerender);
        if (reportsOpen && !adminsList) loadAdmins(rerender);
        rerender();
      };
      you.append(reportsBtn);
    }
    // Two entry points act like tabs onto the same panel — opening one while
    // the other's mode is showing switches mode rather than closing it;
    // only clicking the currently-active one closes the panel.
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
    you.append(accountBtn);
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
      you.append(signInBtn);
    }
    head.append(you);
    // "i am vip, where do i upload pic?" — the photo lives inside Edit
    // profile, same panel as name/origin/avatar, with nothing on this
    // screen pointing there first. One line is enough; it isn't worth a
    // banner for something that's one tap away once you know where to look.
    if (myTier !== 'guest' && !profileOpen) {
      head.append(el('p', 'muted small', 'Add your profile photo under Edit profile.'));
    }
    if (loungeState.isAnonymous && !accountOpen) {
      head.append(el('p', 'muted small',
        'This is a guest session tied to this browser. Secure account keeps it from being '
        + 'lost, or Sign in if you already secured one elsewhere.'));
    }
  }
  frag.appendChild(head);

  if (me && profileOpen) frag.appendChild(profilePanel(me, rerender));
  if (me && bredrinsOpen) frag.appendChild(bredrinsPanel(me, rerender));
  if (me && coinsOpen) frag.appendChild(coinsPanel(rerender));
  if (me && me.isAdmin && reportsOpen) frag.appendChild(reportsPanel(rerender));
  if (me && accountOpen) frag.appendChild(accountPanel(rerender));

  // Above the lounge cards: the countdown is the thing a player should not be
  // able to miss, and this is the screen they land on.
  const tourney = tournamentPanel(me, (tableId) => void attachTable(tableId, rerender), rerender);
  if (tourney) frag.appendChild(tourney);

  frag.appendChild(joinByCodeField((tableId) => void attachTable(tableId, rerender)));

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
    line.append(el('span', undefined, person.username));
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
    // Gifting is open to anyone with the coins, not a tier perk.
    if (loungeState.me && person.user_id !== loungeState.me.id) {
      line.appendChild(giftButton(person.user_id, rerender));
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

  grid.append(chat, rosterPanel);
  frag.appendChild(grid);
  return frag;
}

export function loungesView(rerender: () => void): DocumentFragment | HTMLElement {
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
    }));
    return frag;
  }
  return loungeState.current ? room(loungeState.current, rerender) : loungeList(rerender);
}

// --------------------------------------------------------- membership ----
export function membershipView(rerender: () => void): DocumentFragment {
  const frag = document.createDocumentFragment();
  const myTier: Tier = loungeState.me?.tier ?? 'guest';

  const head = el('div', 'panel');
  head.append(el('div', 'eyebrow', 'Membership'));
  head.append(el('h2', undefined, 'The game is free. Always.'));
  head.append(el('p', 'muted',
    'Every mode, ranked play, and the deal-checker cost nothing and always will. ' +
    'Membership buys the room, not the rules.'));
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
