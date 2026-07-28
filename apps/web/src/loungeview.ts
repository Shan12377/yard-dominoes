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
} from './lounges.ts';
import type { Lounge, LoungeMessage, PresenceEntry, Tier } from './lounges.ts';
import { ensureSignedIn, findActiveSeat } from './online.ts';
import { OnlineGame } from './onlinetable.ts';
import { openTablesPanel, joinByCodeField, liveTableView } from './onlinetableview.ts';
import { el } from './render.ts';

interface LoungeState {
  lounges: Lounge[];
  me: { id: string; username: string; tier: Tier } | null;
  current: Lounge | null;
  roster: PresenceEntry[];
  messages: LoungeMessage[];
  room: { leave: () => void } | null;
  error: string | null;
  loading: boolean;
  onlineGame: OnlineGame | null;
}

export const loungeState: LoungeState = {
  lounges: [], me: null, current: null, roster: [], messages: [],
  room: null, error: null, loading: false, onlineGame: null,
};

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
      onPresence: (roster) => { loungeState.roster = roster; rerender(); },
      onMessage: (msg) => { loungeState.messages = [...loungeState.messages, msg]; rerender(); },
    },
  );
  rerender();
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
      enter.className = 'act';
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
  send.className = 'act';
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

  // Voice is scaffolded, not faked. See CLAUDE.md.
  chatPanel.append(el('p', 'muted',
    'Voice comes next — text for now, so nobody pays for a microphone nobody is using yet.'));

  // --- roster -------------------------------------------------------------
  const rosterPanel = el('div', 'panel');
  const roster = el('div', 'roster');
  roster.append(el('div', 'head', `In here — ${loungeState.roster.length}`));
  if (loungeState.roster.length === 0) {
    roster.append(el('div', 'muted', 'Just you so far.'));
  }
  for (const person of loungeState.roster) {
    const line = el('div', 'person');
    line.append(el('span', 'dot'));
    line.append(el('span', undefined, person.username));
    if (person.tier !== 'guest') line.append(tierBadge(person.tier));
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
    frag.appendChild(liveTableView(loungeState.onlineGame, rerender, () => {
      loungeState.onlineGame = null;
      rerender();
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
      buy.className = 'act';
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
