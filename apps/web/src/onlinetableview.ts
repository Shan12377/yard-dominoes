// apps/web/src/onlinetableview.ts
//
// Rendering only — same DOM-building style as loungeview.ts and main.ts.
// No state lives here; OnlineGame (onlinetable.ts) owns it, this module only
// reads it and calls back into it.

import { OnlineGame } from './onlinetable.ts';
import type { SeatInfo } from './onlinetable.ts';
import {
  listLoungeTables, reactionLabel, quickChatLabel, avatarUrl, AVATAR_LABEL, backgroundUrl,
  type OpenTable, type Avatar, type Background,
} from './lounges.ts';
import { createTable, joinTable } from './online.ts';
import { tileEl, renderBoard, scoreTrack, backsEl, el } from './render.ts';
import { fileReport } from './reports.ts';
import { photoUrl } from './photo.ts';
import { seatPosition } from './seatlayout.ts';
import { describeMoveLine } from './movelog.ts';
import { CLOCK_LABELS, CLOCK_NAMES, DUPPY_LABELS, DUPPY_LEVELS, isPartnered, sideOf } from '@yard/engine';
import type { ClockName, GameMode } from '@yard/engine';

/** Surface a failed request inline, next to whatever control triggered it —
 * same `.banner` treatment loungeview.ts uses for its room-level error, just
 * scoped to one row/form instead of the whole panel. Replaces any previous
 * banner in `host` so repeated failures update in place rather than stacking. */
function showInlineError(host: HTMLElement, err: unknown): void {
  host.querySelector('.banner')?.remove();
  const message = err instanceof Error ? err.message : 'something went wrong';
  host.appendChild(el('div', 'banner', message));
}

export async function openTablesPanel(
  loungeId: string,
  onJoin: (tableId: string) => void,
  rerender: () => void,
): Promise<HTMLElement> {
  const wrap = el('div', 'panel');
  wrap.append(el('div', 'eyebrow', 'Open tables'), el('h2', undefined, 'Sit down'));

  let tables: OpenTable[] = [];
  try { tables = await listLoungeTables(loungeId); } catch { /* shown as empty below */ }

  if (tables.length === 0) {
    wrap.append(el('p', 'muted', 'No tables running here yet. Start one.'));
  } else {
    const list = el('div', 'stack');
    for (const t of tables) {
      const row = el('div', 'row');
      const modeLabel = t.mode === 'partner' ? 'Partner'
        : t.mode === 'openhand' ? 'Open hand'
          : 'Cut throat';
      const formatLabel = t.format === 'sixlove' ? 'Six love'
        : t.format === 'french' ? 'French'
          : 'First to six';
      row.append(el('span', undefined, `${modeLabel} · ${formatLabel}`));
      row.append(el('span', 'muted', `${t.occupiedSeats}/${t.seatCount}`));
      const join = document.createElement('button');
      join.className = 'act ghost';
      join.textContent = t.status === 'waiting' ? 'Sit down' : 'Watch';
      join.onclick = () => void (async () => {
        try {
          if (t.status === 'waiting') await joinTable(t.joinCode);
          onJoin(t.id);
        } catch (err) {
          showInlineError(row, err);
        }
      })();
      row.appendChild(join);
      list.appendChild(row);
    }
    wrap.appendChild(list);
  }

  wrap.appendChild(startTableForm(loungeId, onJoin));
  return wrap;
}

function startTableForm(loungeId: string, onJoin: (tableId: string) => void): HTMLElement {
  const form = el('div', 'row');
  const mode = document.createElement('select');
  mode.innerHTML = `<option value="partner">Partner — 2 v 2</option>`
    + `<option value="openhand">Open hand — partner sees your tiles</option>`
    + `<option value="cutthroat">Cut throat</option>`;
  const seatCount = document.createElement('select');
  seatCount.innerHTML = `<option value="4">4 players</option><option value="3">3 players</option><option value="2">2 players</option>`;
  const duppy = document.createElement('select');
  duppy.innerHTML = DUPPY_LEVELS.map((d) => `<option value="${d}">${DUPPY_LABELS[d]}</option>`).join('');
  // Without this the clock feature exists but nobody can reach it: every table
  // would take the database default and no speed room could ever be started.
  const clock = document.createElement('select');
  clock.innerHTML = CLOCK_NAMES.map((c) => `<option value="${c}">${CLOCK_LABELS[c]}</option>`).join('');
  clock.value = 'yard';

  // Partner AND openhand are both inherently 4-seat, 2-vs-2 formats — lock the
  // seat count when either is selected so the form can never submit an invalid
  // combination. The server enforces this too (the real gate); this is just so
  // a partnered table doesn't 422 on submit for no visible reason.
  const syncSeatCount = () => {
    if (mode.value === 'partner' || mode.value === 'openhand') {
      seatCount.value = '4';
      seatCount.disabled = true;
    } else {
      seatCount.disabled = false;
    }
  };
  syncSeatCount();
  mode.onchange = syncSeatCount;

  for (const [label, control] of [['Game', mode], ['Seats', seatCount], ['Clock', clock], ['Fill empty seats with', duppy]] as const) {
    const field = el('label', 'field');
    field.append(el('span', undefined, label), control);
    form.appendChild(field);
  }

  const go = document.createElement('button');
  go.className = 'act';
  go.textContent = 'Start table';
  go.onclick = () => void (async () => {
    go.disabled = true;
    try {
      const seats = Number(seatCount.value);
      const fill = new Array(Math.max(0, seats - 1)).fill(duppy.value);
      const { tableId } = await createTable({
        mode: mode.value as GameMode,
        format: mode.value === 'cutthroat' ? 'firstToSix' : 'sixlove',
        seatCount: seats as 2 | 3 | 4,
        duppies: fill,
        clock: clock.value as ClockName,
        loungeId,
      });
      onJoin(tableId);
    } catch (err) {
      showInlineError(form, err);
    } finally {
      go.disabled = false;
    }
  })();
  form.appendChild(go);
  return form;
}

export function joinByCodeField(onJoin: (tableId: string) => void): HTMLElement {
  const row = el('div', 'row');
  const input = document.createElement('input');
  input.placeholder = 'Join code';
  input.maxLength = 6;
  const go = document.createElement('button');
  go.className = 'act ghost';
  go.textContent = 'Join';
  go.onclick = () => void (async () => {
    const code = input.value.trim();
    if (!code) return;
    try {
      const { tableId } = await joinTable(code);
      onJoin(tableId);
    } catch (err) {
      showInlineError(row, err);
    }
  })();
  row.append(input, go);
  return row;
}

let pendingTile: string | null = null;
let countdownTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The social layer, handed in by whoever owns the Realtime channel it rides on.
 *
 * The table is rendered inside the lounge view, and the lounge channel stays
 * joined while you play — so voice and reactions are already connected here,
 * they just were not drawn. This module takes the state and the two prebuilt
 * controls rather than reaching for them: a view importing another view is a
 * circular import, and the channel is not this module's to own.
 *
 * Optional throughout. A table opened without a lounge channel (reloading
 * straight onto a seat) still plays dominoes — voice is additive and must
 * never take the table down with it.
 */
export interface TableSocial {
  /** User ids talking right now, so a seat shows who is speaking. */
  speaking: Set<string>;
  /** The reaction each person last threw, by user id. */
  reactions: Map<string, string>;
  voicePanel: HTMLElement | null;
  videoPanel?: HTMLElement | null;
  /** Pulled video streams, keyed by user id — VIP-gated, table-scoped. */
  videoStreams?: Map<string, MediaStream>;
  reactionBar: HTMLElement | null;
  quickChatBar?: HTMLElement | null;
  /** Everyone with this table open, seated players included. */
  watching?: { user_id: string; username: string }[];
  /** The lounge's live chat, prebuilt by loungeview.ts (same reasoning as
   *  voicePanel/videoPanel — this module cannot import loungeview.ts).
   *  Null when the table has no lounge context (e.g. a direct join-code
   *  attach with no lounge ever opened). */
  chatPanel?: HTMLElement | null;
}

/** Speaking ring and thrown reaction on a seat, keyed by the player's user id.
 * Duppy seats have no user id and are skipped — a bot never talks. */
function decorateSeat(card: HTMLElement, userId: string | null, social?: TableSocial): void {
  if (!userId || !social) return;

  if (social.speaking.has(userId)) {
    card.classList.add('speaking');
    const wave = el('span', 'wave');
    wave.setAttribute('aria-label', 'speaking');
    for (let i = 0; i < 3; i++) wave.appendChild(document.createElement('i'));
    card.appendChild(wave);
  }

  const stream = social.videoStreams?.get(userId);
  if (stream) {
    const video = document.createElement('video');
    video.className = 'seat-video';
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true; // this is a picture, not a second audio path — voice already carries sound
    video.srcObject = stream;
    card.appendChild(video);
  }

  // Reactions and quick chat share this one slot, so a person is only ever
  // saying one thing at a time. A quick-chat id has words and no picture.
  const thrown = social.reactions.get(userId);
  if (!thrown) return;
  const said = quickChatLabel(thrown);
  if (said) {
    card.appendChild(el('span', 'said', said));
    return;
  }
  const img = document.createElement('img');
  img.className = 'thrown';
  img.src = `${import.meta.env.BASE_URL}reactions/${thrown}.webp`;
  img.alt = reactionLabel(thrown);
  img.width = 28;
  img.height = 28;
  card.appendChild(img);
}

// Mobile only — desktop shows all three rail sections at once (Task 5's
// .table-rail), a phone shows one at a time behind tabs. Module state, not
// per-render, so the choice survives a re-render the same way reportOpenFor
// and the chat draft already do.
let activeRailTab: 'chat' | 'watchers' | 'standings' | 'log' = 'chat';

// ---------------------------------------------------------------- reports --
// The terms of service promise a report button — this is it. Filing needs a
// tableId, which only exists here at the table, not in the lounge roster
// (loungeview.ts's giftButton lives there and has no such context). Module
// state, same reasoning as the chat draft in loungeview.ts: a render must
// never wipe out what someone is mid-way through typing.
let reportOpenFor: string | null = null;
let reportReason = '';
let reportBusy = false;
let reportError: string | null = null;
const reportSentFor = new Set<string>();

function reportButton(userId: string, tableId: string, rerender: () => void): HTMLElement {
  const wrap = el('div', 'report');
  if (reportSentFor.has(userId)) {
    wrap.append(el('span', 'muted small', 'Reported'));
    return wrap;
  }

  const toggle = document.createElement('button');
  toggle.className = 'act ghost small';
  toggle.textContent = reportOpenFor === userId ? 'Cancel' : 'Report';
  toggle.onclick = () => {
    reportOpenFor = reportOpenFor === userId ? null : userId;
    reportReason = '';
    reportError = null;
    rerender();
  };
  wrap.appendChild(toggle);

  if (reportOpenFor !== userId) return wrap;

  const form = el('div', 'report-form');
  const textarea = document.createElement('textarea');
  textarea.placeholder = 'What happened?';
  textarea.rows = 2;
  textarea.value = reportReason;
  textarea.oninput = () => { reportReason = textarea.value; };
  form.appendChild(textarea);

  if (reportError) form.appendChild(el('div', 'banner small', reportError));

  const submit = document.createElement('button');
  submit.className = 'act small';
  submit.textContent = reportBusy ? 'Sending…' : 'Send report';
  submit.disabled = reportBusy;
  submit.onclick = () => void (async () => {
    reportBusy = true;
    reportError = null;
    rerender();
    try {
      await fileReport(userId, tableId, reportReason);
      reportSentFor.add(userId);
      reportOpenFor = null;
      reportReason = '';
    } catch (err) {
      reportError = err instanceof Error ? err.message : 'could not send';
    } finally {
      reportBusy = false;
      rerender();
    }
  })();
  form.appendChild(submit);
  wrap.appendChild(form);
  return wrap;
}

function seatCard(
  s: SeatInfo, game: OnlineGame, rerender: () => void, social?: TableSocial,
): HTMLElement {
  const card = el('div', 'seat');
  if (game.hand?.turn === s.seatIndex && game.hand.status === 'active') card.classList.add('turn');
  // Cosmetic only — plan §7.1. A faint backdrop behind the seat's own
  // content, never anything that could compete with tile/turn legibility.
  if (s.userId && s.background) {
    card.style.backgroundImage = `linear-gradient(rgba(255,251,240,0.86), rgba(255,251,240,0.86)), url(${backgroundUrl(s.background as Background)})`;
    card.style.backgroundSize = 'cover';
    card.style.backgroundPosition = 'center';
  }
  const who = el('div', 'who');
  // A real uploaded photo first, falling back to the preset character —
  // photo.ts has no has_photo flag to check, so this is genuinely a try:
  // the browser's own onerror is what "no photo" looks like. A duppy has
  // its own art elsewhere (design.md's five tiers) and never picks from
  // either set.
  if (s.userId) {
    const img = document.createElement('img');
    img.className = 'avatar';
    img.width = 32;
    img.height = 32;
    img.alt = s.avatar ? (AVATAR_LABEL[s.avatar as Avatar] ?? '') : '';
    img.src = photoUrl(s.userId);
    img.onerror = () => {
      if (s.avatar) {
        img.onerror = null;
        img.src = avatarUrl(s.avatar as Avatar);
      } else {
        img.remove();
      }
    };
    who.appendChild(img);
  }
  who.append(el('h3', undefined,
    s.userId ? (s.username ?? `Seat ${s.seatIndex}`) : `Duppy · ${s.duppyLevel}`));
  // Yard or foreign, if they said. A duppy is from nowhere.
  if (s.origin === 'yardie' || s.origin === 'foreign') {
    who.append(el('span', `badge origin-${s.origin}`,
      s.origin === 'yardie' ? 'Yardie' : 'Foreign'));
  }
  card.appendChild(who);
  const count = game.hand?.hand_sizes[s.seatIndex] ?? 0;
  card.append(el('div', 'meta', `${count} tile${count === 1 ? '' : 's'}`));
  const scoreIndex = isPartnered(game.table.mode) ? sideOf(s.seatIndex, game.table.mode) : s.seatIndex;
  const score = game.scores[scoreIndex] ?? 0;
  card.append(el('div', 'seat-score', String(score)));
  if (s.seatIndex !== game.mySeat) card.append(backsEl(count));
  decorateSeat(card, s.userId, social);
  if (s.userId && s.seatIndex !== game.mySeat) {
    card.appendChild(reportButton(s.userId, game.table.id, rerender));
  }
  return card;
}

export function liveTableView(
  game: OnlineGame,
  rerender: () => void,
  onLeave: () => void,
  social?: TableSocial,
): DocumentFragment {
  const frag = document.createDocumentFragment();

  const head = el('div', 'panel');
  const top = el('div', 'spread');
  top.append(el('h2', undefined, `Table ${game.table.joinCode}`));
  const leave = document.createElement('button');
  leave.className = 'act ghost';
  leave.textContent = 'Leave';
  leave.onclick = () => void (async () => { await game.leaveSeat(); onLeave(); })();
  top.appendChild(leave);
  head.appendChild(top);
  // A tournament table is an ordinary table — same view, same everything — so
  // this is one line saying which round you are in, not a second table screen.
  if (game.table.tournamentId && game.table.roundNo) {
    const round = game.table.roundNo;
    const name = game.table.tournamentName;
    head.append(el('div', 'eyebrow tourney-round',
      name ? `Round ${round} · ${name}` : `Round ${round}`));
  }
  if (game.isSpectator) head.append(el('div', 'muted', 'Watching — spectators never see anyone\'s tiles'));
  frag.appendChild(head);

  // Voice sits at the top, where a persistent control belongs — it is a state
  // you are in, not an action you take mid-hand.
  if (social?.voicePanel) frag.appendChild(social.voicePanel);
  if (social?.videoPanel) frag.appendChild(social.videoPanel);

  const board = el('div', 'scoreboard');
  if (game.table.mode === 'partner') {
    board.append(
      scoreTrack('You & partner', game.scores[(game.mySide ?? 0)] ?? 0, { us: true }),
      scoreTrack('Them', game.scores[1 - (game.mySide ?? 0)] ?? 0),
    );
  } else {
    game.scores.forEach((s, i) => board.append(scoreTrack(`Seat ${i}`, s, { us: i === game.mySeat })));
  }
  frag.appendChild(board);

  const cross = el('div', 'table-cross');

  const feltSlot = el('div', 'felt-slot');
  const felt = el('div', 'table-felt');
  const line = el('div', 'line');
  renderBoard(line, game.hand?.board ?? null);
  felt.appendChild(line);
  feltSlot.appendChild(felt);
  if (game.hand?.status === 'active' && game.hand.turn_expires_at) {
    feltSlot.appendChild(countdown(game, game.hand.turn_expires_at, rerender));
  }
  cross.appendChild(feltSlot);

  game.seats.forEach((s) => {
    const slot = seatPosition(s.seatIndex, game.mySeat, game.table.seatCount);
    if (!slot) return;
    const wrap = el('div', `seat-slot seat-slot-${slot}`);
    wrap.appendChild(seatCard(s, game, rerender, social));
    cross.appendChild(wrap);
  });

  const room = el('div', 'table-room');
  room.appendChild(cross);

  const rail = el('div', 'table-rail');

  const tabs = el('div', 'rail-tabs');
  const tabDefs: { id: typeof activeRailTab; label: string }[] = [
    { id: 'chat', label: 'Chat' },
    { id: 'watchers', label: 'Watching' },
    { id: 'standings', label: 'Standings' },
    { id: 'log', label: 'Log' },
  ];
  for (const { id, label } of tabDefs) {
    const btn = document.createElement('button');
    btn.className = 'rail-tab' + (activeRailTab === id ? ' active' : '');
    btn.textContent = label;
    btn.onclick = () => { activeRailTab = id; rerender(); };
    tabs.appendChild(btn);
  }
  rail.appendChild(tabs);

  if (social?.chatPanel) {
    social.chatPanel.classList.add('rail-section', 'rail-section-chat');
    social.chatPanel.classList.toggle('rail-section-active', activeRailTab === 'chat');
    rail.appendChild(social.chatPanel);
  }
  const crowd = watchersPanel(game, social);
  if (crowd) {
    crowd.classList.add('rail-section', 'rail-section-watchers');
    crowd.classList.toggle('rail-section-active', activeRailTab === 'watchers');
    rail.appendChild(crowd);
  }
  const standings = standingsPanel(game);
  standings.classList.add('rail-section', 'rail-section-standings');
  standings.classList.toggle('rail-section-active', activeRailTab === 'standings');
  rail.appendChild(standings);
  const log = moveLogPanel(game);
  log.classList.add('rail-section', 'rail-section-log');
  log.classList.toggle('rail-section-active', activeRailTab === 'log');
  rail.appendChild(log);
  room.appendChild(rail);

  frag.appendChild(room);

  if (!game.hand) {
    frag.appendChild(startHandPanel(game));
  } else {
    if (!game.isSpectator) {
      // In openhand the partner's tiles render above your own. Small,
      // non-interactive, labelled — the panel is information you may act on,
      // not a hand you play. Missing from every other mode by construction.
      if (game.partnerTiles) frag.appendChild(partnerHandPanel(game.partnerTiles));
      frag.appendChild(myHandPanel(game, rerender));
    }

    if (game.hand.status !== 'active' && game.hand.result) {
      frag.appendChild(handResultPanel(game, rerender));
    }
  }

  // Reactions and quick chat sit last, beside the hand — thumb reach, and free
  // for guests. Spectators get them too: heckling from the side of the yard is
  // the point. Words above pictures, because words are what get used mid-hand.
  if (social?.quickChatBar) frag.appendChild(social.quickChatBar);
  if (social?.reactionBar) frag.appendChild(social.reactionBar);

  return frag;
}

/**
 * Who is leaning on the table watching. Seated players are filtered out —
 * they are already on screen as seats, and listing them twice makes a
 * four-hander look like it has an audience of four.
 *
 * Returns null rather than an empty panel when nobody is watching: a standing
 * "Nobody is watching" is a worse thing to read every hand than no panel.
 */
function watchersPanel(game: OnlineGame, social?: TableSocial): HTMLElement | null {
  if (!social?.watching) return null;
  const seated = new Set(game.seats.map((s) => s.userId).filter(Boolean));
  const crowd = social.watching.filter((p) => !seated.has(p.user_id));
  if (crowd.length === 0) return null;

  const panel = el('div', 'panel');
  panel.append(el('div', 'eyebrow', `Watching — ${crowd.length}`));
  const list = el('div', 'watchers');
  for (const p of crowd) {
    const who = el('span', 'watcher', p.username);
    if (social.speaking.has(p.user_id)) who.classList.add('speaking');
    list.appendChild(who);
  }
  panel.appendChild(list);
  return panel;
}

/** One line per seat/side, for the rail — a glanceable summary that does
 *  not require finding the right position in the cross to compare scores. */
function standingsPanel(game: OnlineGame): HTMLElement {
  const panel = el('div', 'panel');
  panel.append(el('div', 'eyebrow', 'Standings'));
  const list = el('div', 'standings');
  if (isPartnered(game.table.mode)) {
    const labels = ['You & partner', 'Them'];
    for (let side = 0; side < 2; side++) {
      const line = el('div', 'standing-row');
      line.append(el('span', undefined, side === (game.mySide ?? 0) ? labels[0] : labels[1]));
      line.append(el('span', 'seat-score', String(game.scores[side] ?? 0)));
      list.appendChild(line);
    }
  } else {
    game.seats.forEach((s) => {
      const line = el('div', 'standing-row');
      const label = s.userId ? (s.username ?? `Seat ${s.seatIndex}`) : `Duppy · ${s.duppyLevel}`;
      line.append(el('span', undefined, label));
      line.append(el('span', 'seat-score', String(game.scores[s.seatIndex] ?? 0)));
      list.appendChild(line);
    });
  }
  panel.appendChild(list);
  return panel;
}

/** Turn-by-turn history for the current hand — JamDom shows this as a
 *  live scrolling log; game.hand.move_log already carries everything
 *  needed, just never rendered during an online hand until now. */
function moveLogPanel(game: OnlineGame): HTMLElement {
  const panel = el('div', 'panel');
  panel.append(el('div', 'eyebrow', 'Log'));
  const list = el('div', 'move-log');
  const moves = game.hand?.move_log ?? [];
  if (moves.length === 0) {
    list.append(el('div', 'muted', 'No moves yet.'));
  } else {
    const partnered = isPartnered(game.table.mode);
    for (const move of moves) {
      const line = describeMoveLine(move, game.seats, game.mySeat, partnered, game.mySide);
      list.append(el('div', 'move-log-line', line));
    }
  }
  panel.appendChild(list);
  requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  return panel;
}

function startHandPanel(game: OnlineGame): HTMLElement {
  const panel = el('div', 'panel');
  if (game.isSpectator) {
    panel.append(el('p', 'muted', 'Waiting for the players to start the first hand.'));
    return panel;
  }
  panel.append(el('p', 'muted', 'Everyone\'s seated. Ready when you are.'));
  const go = document.createElement('button');
  go.className = 'act';
  go.textContent = 'Start hand';
  go.onclick = () => void (async () => {
    go.disabled = true;
    try {
      await game.dealNext(false);
    } catch (err) {
      showInlineError(panel, err);
    } finally {
      go.disabled = false;
    }
  })();
  panel.appendChild(go);
  return panel;
}

/**
 * The turn clock. Time is a budget here, not a flat allowance: a seat is given
 * a base every turn and keeps what it does not spend, so the number counting
 * down is often larger than the base and the player deserves to know why.
 *
 * The remaining seconds come from the server's deadline, never from a local
 * count — a client whose tab was asleep would otherwise show time it no longer
 * has.
 */
function countdown(game: OnlineGame, expiresAt: string, rerender: () => void): HTMLElement {
  const left = (Date.parse(expiresAt) - Date.now()) / 1000;
  const remaining = Math.max(0, Math.floor(left));
  const turn = game.hand?.turn ?? null;
  const bank = turn === null ? 0 : Math.round(game.seats[turn]?.timeBank ?? 0);
  const base = game.table?.turnSeconds ?? 0;
  const allowed = Math.max(base + bank, 1);

  const wrap = el('div', 'panel clock');
  const head = el('div', 'clock-head');
  head.append(el('span', 'clock-left', remaining > 0 ? `${remaining}s` : 'Time'));
  head.append(el('span', 'muted', remaining > 0
    ? (game.isMyTurn() ? 'to play' : 'for this seat')
    : 'up — a duppy plays this seat'));
  // Only worth explaining when the bank is actually doing something.
  if (bank > 0 && remaining > 0) {
    head.append(el('span', 'clock-bank', `${base}s + ${bank}s banked`));
  }
  wrap.appendChild(head);

  const track = el('div', 'clock-track');
  const fill = el('div', 'clock-fill');
  fill.style.width = `${Math.min(100, (remaining / allowed) * 100)}%`;
  // Urgency is earned by the last few seconds, not by a colour that shouts
  // through the whole turn.
  if (remaining <= 5) fill.classList.add('urgent');
  track.appendChild(fill);
  wrap.appendChild(track);

  if (countdownTimer) clearTimeout(countdownTimer);
  if (remaining > 0) countdownTimer = setTimeout(rerender, 1000);
  return wrap;
}

function partnerHandPanel(tiles: string[]): HTMLElement {
  const panel = el('div', 'panel partner-hand');
  panel.append(el('div', 'eyebrow', 'Partner'));
  const row = el('div', 'hand');
  for (const tile of tiles) {
    const node = tileEl(tile);
    node.classList.add('sm', 'dead');
    row.appendChild(node);
  }
  panel.appendChild(row);
  return panel;
}

function myHandPanel(game: OnlineGame, rerender: () => void): HTMLElement {
  const panel = el('div', 'panel');
  panel.append(el('div', 'eyebrow', game.isMyTurn() ? 'Your play' : 'Your hand'));
  const legal = game.legalMovesForMe();
  const playable = new Set(legal.flatMap((m) => ('tile' in m ? [m.tile] : [])));
  const hand = el('div', 'hand');

  for (const tile of game.myTiles) {
    const node = tileEl(tile);
    const can = playable.has(tile);
    node.classList.add(can ? 'playable' : 'dead');
    if (pendingTile === tile) node.classList.add('chosen');
    if (can) {
      node.tabIndex = 0;
      const choose = () => {
        const options = legal.filter((m) => 'tile' in m && m.tile === tile);
        if (options.length === 1) { pendingTile = null; void game.play(options[0]); }
        else { pendingTile = pendingTile === tile ? null : tile; rerender(); }
      };
      node.onclick = choose;
      node.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } };
    }
    hand.appendChild(node);
  }
  panel.appendChild(hand);

  if (pendingTile) {
    const choice = el('div', 'row');
    choice.append(el('span', 'muted', 'Which end?'));
    for (const move of legal.filter((m) => 'tile' in m && m.tile === pendingTile)) {
      const b = document.createElement('button');
      b.className = 'act ghost';
      b.textContent = (move as any).end === 'left' ? 'Left end' : 'Right end';
      b.onclick = () => { pendingTile = null; void game.play(move); };
      choice.appendChild(b);
    }
    panel.appendChild(choice);
  }

  const onlyPass = legal.length === 1 && legal[0].kind === 'pass';
  if (game.isMyTurn() && onlyPass) {
    const b = document.createElement('button');
    b.className = 'act';
    b.textContent = 'Pass';
    b.onclick = () => void game.play(legal[0]);
    panel.appendChild(b);
  }
  return panel;
}

function handResultPanel(game: OnlineGame, rerender: () => void): HTMLElement {
  const panel = el('div', 'panel');
  const r = game.hand!.result as any;
  panel.append(el('h2', undefined, r.tie ? 'Tied on count — replay' : 'Hand over'));

  if (game.canChoosePose()) {
    const row = el('div', 'row');
    row.append(el('span', 'muted', 'Who should pose?'));
    const pass = document.createElement('button');
    pass.className = 'act ghost';
    pass.textContent = 'Pass pose';
    pass.onclick = () => void game.dealNext(true);
    const keep = document.createElement('button');
    keep.className = 'act';
    keep.textContent = 'Keep pose';
    keep.onclick = () => void game.dealNext(false);
    row.append(pass, keep);
    panel.appendChild(row);
    return panel;
  }

  if (game.winnerSide === null && !game.isSpectator) {
    const next = document.createElement('button');
    next.className = 'act';
    next.textContent = 'Deal next hand';
    next.onclick = () => void game.dealNext(false);
    panel.appendChild(next);
  } else if (game.winnerSide !== null) {
    panel.append(el('p', 'muted', 'Set over.'));
    // Absent for a spectator, a duppy-mixed table (never rated), or while
    // the server's write is still catching up to this broadcast — see
    // onlinetable.ts's loadRatingAfter. Nothing shown beats a fabricated +0.
    if (game.ratingBefore !== null && game.ratingAfter !== null) {
      const delta = game.ratingAfter - game.ratingBefore;
      if (delta !== 0) {
        const sign = delta > 0 ? '+' : '';
        panel.append(el('p', `rating-delta ${delta > 0 ? 'up' : 'down'}`,
          `Rating ${sign}${delta} — now ${game.ratingAfter}`));
      }
    }
  }
  return panel;
}
