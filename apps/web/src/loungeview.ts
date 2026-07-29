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
  REACTIONS, REACTION_EVENT, reactionLabel,
} from './lounges.ts';
import type { Lounge, LoungeMessage, LoungeRoom, PresenceEntry, Tier } from './lounges.ts';
import { ensureSignedIn, findActiveSeat } from './online.ts';
import { OnlineGame } from './onlinetable.ts';
import { openTablesPanel, joinByCodeField, liveTableView } from './onlinetableview.ts';
import { el } from './render.ts';
import { canSpeak, joinVoice } from './voice.ts';
import type { VoiceRoom } from './voice.ts';

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
  me: { id: string; username: string; tier: Tier } | null;
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
}

export const loungeState: LoungeState = {
  lounges: [], me: null, current: null, roster: [], messages: [],
  room: null, error: null, loading: false, onlineGame: null,
  voice: null, voiceJoining: false, speaking: new Set(), reactions: new Map(),
};

/** Timers clearing each reaction, so one person spamming cannot pile them up. */
const reactionTimers = new Map<string, number>();

function showReaction(userId: string, id: string, rerender: () => void) {
  if (!REACTIONS.some((r) => r.id === id)) return; // never render what a peer invents
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
    const [lounges, me] = await Promise.all([listLounges(), myProfile()]);
    loungeState.lounges = lounges;
    loungeState.me = me;
    loungeState.error = null;

    if (!loungeState.onlineGame) {
      const active = await findActiveSeat();
      if (active) {
        loungeState.onlineGame = await OnlineGame.open(active.tableId);
        // Reloading straight onto a seat skips the lounge, so the channel that
        // carries voice and reactions was never joined and the mic sat on
        // "Connecting…" forever. Enter the table's own lounge so the social
        // layer works whether you walked in or landed here. Best-effort: a
        // lounge we cannot enter must not stop the table from rendering.
        const home = lounges.find((l) => l.id === loungeState.onlineGame?.table.loungeId);
        if (home && !loungeState.room) {
          try { await openLounge(home, rerender); } catch { /* table still plays */ }
        }
        // OnlineGame's state arrives over Realtime, not from a call this
        // module makes — without this, moves and seat changes update the
        // model but nothing ever redraws the DOM to show them. It also emits
        // 'error' events (e.g. a 409 from a failed dealNext) that otherwise
        // have no listener anywhere and silently vanish.
        loungeState.onlineGame.on((e) => {
          if (e.type === 'error') loungeState.error = e.message;
          rerender();
        });
      }
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
    b.onclick = () => {
      if (!me || !loungeState.room) return;
      showReaction(me.id, r.id, rerender);
      void loungeState.room.channel.send({
        type: 'broadcast', event: REACTION_EVENT, payload: { from: me.id, id: r.id },
      });
    };
    bar.appendChild(b);
  }
  return bar;
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

function tierBadge(tier: Tier): HTMLElement {
  const b = el('span', `badge ${tier}`, TIER_LABEL[tier]);
  return b;
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
    head.append(you);
  }
  frag.appendChild(head);

  frag.appendChild(joinByCodeField((tableId) => void (async () => {
    loungeState.onlineGame?.leave();
    loungeState.onlineGame = await OnlineGame.open(tableId);
    loungeState.onlineGame.on((e) => {
      if (e.type === 'error') loungeState.error = e.message;
      rerender();
    });
    rerender();
  })()));

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
      tags.append(el('span', 'gate', lounge.mode === 'partner' ? 'Partners' : 'Cut throat'));
    }
    if (lounge.min_tier !== 'guest') {
      tags.append(el('span', `gate ${lounge.min_tier}`, `${TIER_LABEL[lounge.min_tier]} only`));
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
  void openTablesPanel(lounge.id, (tableId) => void (async () => {
    loungeState.onlineGame?.leave();
    loungeState.onlineGame = await OnlineGame.open(tableId);
    loungeState.onlineGame.on((e) => {
      if (e.type === 'error') loungeState.error = e.message;
      rerender();
    });
    rerender();
  })(), rerender).then((panel) => {
    tablesPanel.replaceWith(panel);
  });
  frag.appendChild(tablesPanel);

  const grid = el('div', 'room');

  // --- chat ---------------------------------------------------------------
  const chatPanel = el('div', 'panel');
  chatPanel.append(el('div', 'eyebrow', 'Table talk'));

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
  chatPanel.appendChild(log);
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
  chatPanel.appendChild(form);

  chatPanel.appendChild(voicePanel(rerender));
  chatPanel.appendChild(reactionBar(rerender));

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

  grid.append(chatPanel, rosterPanel);
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
      rerender();
    }, {
      speaking: loungeState.speaking,
      reactions: loungeState.reactions,
      voicePanel: voicePanel(rerender),
      reactionBar: reactionBar(rerender),
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
