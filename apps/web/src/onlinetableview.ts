// apps/web/src/onlinetableview.ts
//
// Rendering only — same DOM-building style as loungeview.ts and main.ts.
// No state lives here; OnlineGame (onlinetable.ts) owns it, this module only
// reads it and calls back into it.

import { OnlineGame } from './onlinetable.ts';
import { coachReviewView } from './coachview.ts';
import type { SeatInfo } from './onlinetable.ts';
import {
  listLoungeTables, reactionLabel, quickChatLabel, avatarUrl, AVATAR_LABEL,
  avatarAccessoryUrl, backgroundUrl, myProfile,
  type OpenTable, type Avatar, type AvatarAccessory, type Background, type MyProfile,
} from './lounges.ts';
import { createTable, joinTable } from './online.ts';
import { profilePanel } from './profile.ts';
import { tileEl, renderBoard, scoreTrack, backsEl, el, crossRejectReason, frenchScoreBreakdown, frenchPenaltyLog, celebrateWinningTile } from './render.ts';
import { fileReport } from './reports.ts';
import { photoUrl } from './photo.ts';
import { seatPosition, type SeatSlot } from './seatlayout.ts';
import { describeMoveLine, describeSeat, seatName } from './movelog.ts';
import { tableRackPresentation } from './table-rack.ts';
import { duppyPersona, duppyPersonaUrl } from './duppy-persona.ts';
import {
  CLOCK_LABELS, CLOCK_NAMES, DUPPY_LABELS, DUPPY_LEVELS, DUPPY_PACE_LABELS, DUPPY_PACE_NAMES, duppyThinkSeconds,
  isPartnered, sideOf, type ClockName, type DuppyLevel, type DuppyPace, type GameMode,
} from '@yard/engine';
import * as sfx from './sfx.ts';

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
  const wrap = el('div', 'panel open-tables-panel');
  // Start with the thing almost every visitor came to do: make a table and
  // play. On a phone, putting this after a long list of waiting tables turns
  // a simple first action into a scroll hunt.
  wrap.append(el('div', 'eyebrow', 'Play now'), el('h2', undefined, 'Start a table'));
  wrap.appendChild(startTableForm(loungeId, onJoin));

  const open = el('section', 'open-tables-list');
  open.append(el('div', 'eyebrow', 'Open tables'), el('h3', undefined, 'Join a game already going'));

  let tables: OpenTable[] = [];
  try { tables = await listLoungeTables(loungeId); } catch { /* shown as empty below */ }
  // A player came here to sit down. Put available seats before spectating,
  // then fuller waiting tables first so the fastest game is the first choice.
  tables.sort((a, b) => {
    const aJoinable = a.status === 'waiting' ? 0 : 1;
    const bJoinable = b.status === 'waiting' ? 0 : 1;
    return aJoinable - bJoinable || b.occupiedSeats - a.occupiedSeats;
  });

  if (tables.length === 0) {
    open.append(el('p', 'muted', 'No tables running here yet. Your table can be the first.'));
  } else {
    // A lounge that's genuinely busy can have dozens of tables — show the
    // first handful and fold the rest behind a disclosure rather than
    // dumping every row on the page at once.
    const VISIBLE_CAP = 6;
    const buildRow = (t: OpenTable): HTMLElement => {
      const row = el('div', `open-table-card ${t.status === 'waiting' ? 'joinable' : 'watchable'}`);
      const modeLabel = t.mode === 'partner' ? 'Partner'
        : t.mode === 'openhand' ? 'Open hand'
          : t.mode === 'across' ? 'Across'
            : 'Cut throat';
      const formatLabel = t.format === 'sixlove' ? 'Six love'
        : t.format === 'french' ? 'French'
          : 'First to six';
      const details = el('div', 'open-table-details');
      details.append(
        el('strong', 'open-table-mode', modeLabel),
        el('span', 'open-table-format', formatLabel),
      );
      row.appendChild(details);
      row.append(el('span', 'open-table-seats', `${t.occupiedSeats}/${t.seatCount} seated`));
      const join = document.createElement('button');
      join.className = t.status === 'waiting' ? 'act' : 'act ghost';
      join.textContent = t.status === 'waiting' ? 'Sit down' : 'Watch';
      join.onclick = () => void (async () => {
        try {
          if (t.status === 'waiting') {
            await joinTable(t.joinCode);
          } else {
            // Not a fresh sit-down, but it might be reclaiming a seat this
            // player left within the rejoin window — try quietly. Anyone
            // else's "Watch" tap on a playing table just falls through to
            // spectating, exactly as before.
            try { await joinTable(t.joinCode); } catch { /* not a rejoin — spectate */ }
          }
          onJoin(t.id);
        } catch (err) {
          showInlineError(row, err);
        }
      })();
      row.appendChild(join);
      return row;
    };

    const list = el('div', 'open-table-grid');
    for (const t of tables.slice(0, VISIBLE_CAP)) list.appendChild(buildRow(t));
    open.appendChild(list);

    const rest = tables.slice(VISIBLE_CAP);
    if (rest.length > 0) {
      const more = document.createElement('details');
      more.className = 'collapsible';
      more.open = openTablesMoreOpen;
      more.addEventListener('toggle', () => { openTablesMoreOpen = more.open; });
      const moreSummary = document.createElement('summary');
      moreSummary.textContent = `${rest.length} more table${rest.length === 1 ? '' : 's'}`;
      more.appendChild(moreSummary);
      const moreList = el('div', 'open-table-grid');
      for (const t of rest) moreList.appendChild(buildRow(t));
      more.appendChild(moreList);
      open.appendChild(more);
    }
  }
  wrap.appendChild(open);
  return wrap;
}

/** One line under the Set picker — where a player actually needs to know
 *  what they're choosing, not a standalone guide bolted onto the lounge. */
const FORMAT_HINTS: Record<string, string> = {
  sixlove: 'Six wins in a row while the other side stays at zero — a bruk resets it.',
  firstToSix: 'Best of six. Straight race, no reset.',
  french: 'Race to 100 — lowest score wins. Doubles cost you double.',
};

let startTableAdvancedOpen = false;
let openTablesMoreOpen = false;

/**
 * The start-a-table form's choices, held outside the DOM.
 *
 * Same rule as the practice lobby's, and it bites harder here: a lounge
 * redraws on every chat message, every presence sync and every tick of a
 * tournament countdown, so a form left open for a few seconds is rebuilt
 * repeatedly. Without this, picking cut throat and first to six and then
 * pausing to read the room silently hands you a partner six-love table.
 */
let startMode = 'partner';
let startFormat = 'sixlove';
/** See main.ts's lobbyFormatChosen: an inherited six love must not ride along
 *  into Cut throat, only a format the host deliberately picked. */
let startFormatChosen = false;
let startSeatCount = '4';
let startDuppy: DuppyLevel = 'ranker';
let startClock: ClockName = 'yard';
let startPace: DuppyPace = 'yard';

function startTableForm(loungeId: string, onJoin: (tableId: string) => void): HTMLElement {
  const form = el('div', 'row');
  // French used to live only as a third option inside Cut throat's "Set"
  // dropdown — a player who specifically wants French had no way to find it
  // without already knowing it was nested under Cut throat first. It's a
  // top-level Game choice now, same as Partner/Open hand/Cut throat, even
  // though under the hood it's still cutthroat mode + french format — the
  // server's own createSet() forces that pairing regardless of what this
  // form sends. See resolvedMode/resolvedFormat below.
  const mode = document.createElement('select');
  mode.innerHTML = `<option value="partner">Partner — 2 v 2</option>`
    + `<option value="openhand">Open hand — partner sees your tiles</option>`
    + `<option value="across">Across — 2 players, you play both hands</option>`
    + `<option value="cutthroat">Cut throat</option>`
    + `<option value="french">French — race to 100, lowest wins</option>`;
  mode.value = startMode;
  const resolvedMode = (): GameMode => mode.value === 'french' ? 'cutthroat' : (mode.value as GameMode);
  const resolvedFormat = (): 'sixlove' | 'firstToSix' | 'french' =>
    mode.value === 'french' ? 'french' : (format.value as 'sixlove' | 'firstToSix');

  const seatCount = document.createElement('select');
  seatCount.innerHTML = `<option value="4">4 players</option><option value="3">3 players</option><option value="2">2 players</option>`;
  seatCount.value = startSeatCount;
  seatCount.onchange = () => { startSeatCount = seatCount.value; };
  const format = document.createElement('select');
  const formatField = el('label', 'field');
  const duppy = document.createElement('select');
  duppy.innerHTML = DUPPY_LEVELS.map((d) => `<option value="${d}">${DUPPY_LABELS[d]}</option>`).join('');
  duppy.value = startDuppy;
  duppy.onchange = () => { startDuppy = duppy.value as DuppyLevel; };
  // Without this the clock feature exists but nobody can reach it: every table
  // would take the database default and no speed room could ever be started.
  const clock = document.createElement('select');
  clock.innerHTML = CLOCK_NAMES.map((c) => `<option value="${c}">${CLOCK_LABELS[c]}</option>`).join('');
  clock.value = startClock;
  clock.onchange = () => { startClock = clock.value as ClockName; };
  const duppyPace = document.createElement('select');
  duppyPace.innerHTML = DUPPY_PACE_NAMES.map((pace) =>
    `<option value="${pace}">${DUPPY_PACE_LABELS[pace]}</option>`).join('');
  duppyPace.value = startPace;
  duppyPace.onchange = () => { startPace = duppyPace.value as DuppyPace; };

  // Partner AND openhand are both inherently 4-seat, 2-vs-2 formats — lock the
  // seat count when either is selected so the form can never submit an invalid
  // combination. The server enforces this too (the real gate); this is just so
  // a partnered table doesn't 422 on submit for no visible reason. French is
  // cut-throat, 4-hand only in v1, so picking it locks seats the same way.
  const syncSeatCount = () => {
    if (mode.value === 'partner' || mode.value === 'openhand' || mode.value === 'across' || mode.value === 'french') {
      seatCount.value = '4';
      seatCount.disabled = true;
    } else {
      seatCount.disabled = false;
    }
  };
  // Mirrors main.ts's local-practice lobby.
  const syncFormat = () => {
    if (mode.value === 'french') {
      // French fully decides its own scoring — nothing left to pick here.
      formatField.style.display = 'none';
      return;
    }
    formatField.style.display = '';
    const partnered = mode.value === 'partner' || mode.value === 'openhand' || mode.value === 'across';
    format.innerHTML = partnered
      ? `<option value="sixlove">Six love</option><option value="firstToSix">First to six</option>`
      : `<option value="firstToSix">First to six</option><option value="sixlove">Six love — very long</option>`;
    // The rebuild resets the select to its first option. Put back a chosen
    // format; let an inherited one follow the mode, so Cut throat opens on
    // first to six instead of inheriting Partner's six love.
    if (startFormatChosen && [...format.options].some((o) => o.value === startFormat)) {
      format.value = startFormat;
    } else {
      startFormat = format.value;
    }
  };
  // One line under the picker, not a standalone guide — this is where the
  // actual confusion was (a player couldn't tell what a format meant, or
  // that French existed at all), not a gap the lounge screen as a whole
  // needed filling.
  const formatHint = el('div', 'muted small');
  const syncFormatHint = () => {
    formatHint.textContent = FORMAT_HINTS[resolvedFormat()] ?? '';
  };
  syncFormat();
  syncSeatCount();
  syncFormatHint();
  // syncSeatCount may have locked the count to 4 for a partnered mode, so the
  // remembered value follows what is actually on screen.
  startSeatCount = seatCount.value;
  mode.onchange = () => {
    startMode = mode.value;
    syncFormat(); syncSeatCount(); syncFormatHint();
    // syncSeatCount can force '4' for a partnered mode — keep the remembered
    // value honest rather than letting it disagree with what is on screen.
    startSeatCount = seatCount.value;
  };
  format.onchange = () => {
    startFormat = format.value;
    startFormatChosen = true;
    syncSeatCount(); syncFormatHint();
    startSeatCount = seatCount.value;
  };

  const gameField = el('label', 'field');
  gameField.append(el('span', undefined, 'Game'), mode);
  form.appendChild(gameField);
  formatField.append(el('span', undefined, 'Set'), format, formatHint);
  form.appendChild(formatField);

  // Seats/clock/pace/fill only matter once Game and Set are decided, and
  // most players never touch the defaults — folded under one disclosure so
  // "start a table" isn't six dropdowns deep before the button even shows.
  const advanced = document.createElement('details');
  advanced.className = 'collapsible';
  // room() (loungeview.ts) rebuilds this whole form fresh on every rerender —
  // a plain `open` attribute would silently re-collapse this the instant
  // anything else (a chat message, a table filling a seat) ticks the room.
  // Same module-scope-state fix as profile.ts's collapsibleSection.
  advanced.open = startTableAdvancedOpen;
  advanced.addEventListener('toggle', () => { startTableAdvancedOpen = advanced.open; });
  const advancedSummary = document.createElement('summary');
  advancedSummary.textContent = 'Seats, clock & duppies';
  advanced.appendChild(advancedSummary);
  const advancedRow = el('div', 'row');
  for (const [label, control] of [
    ['Seats', seatCount], ['Live-player clock', clock],
    ['Duppy pace', duppyPace], ['Fill empty seats with', duppy],
  ] as const) {
    const field = el('label', 'field');
    field.append(el('span', undefined, label), control);
    if (label === 'Live-player clock') {
      field.append(el('small', 'muted', 'This is the time a real player gets for each turn.'));
    }
    if (label === 'Duppy pace') {
      field.append(el('small', 'muted', 'How long the whole table can read each Duppy move.'));
    }
    if (label === 'Fill empty seats with') {
      field.append(el('small', 'muted', 'Duppies let the table start now. A real player can still take an empty seat before the hand begins.'));
    }
    advancedRow.appendChild(field);
  }
  advanced.appendChild(advancedRow);
  form.appendChild(advanced);

  const go = document.createElement('button');
  go.className = 'act';
  go.textContent = 'Start table';
  go.onclick = () => void (async () => {
    go.disabled = true;
    try {
      const seats = Number(seatCount.value);
      // Across's creator takes two seats (0&2), not one — the other side
      // (1&3) is exactly two duppy slots, not seatCount-1. create-table
      // reads duppies[0]/[1] as seat 1/seat 3 for across specifically.
      const fillCount = resolvedMode() === 'across' ? 2 : Math.max(0, seats - 1);
      const fill = new Array(fillCount).fill(duppy.value);
      const { tableId } = await createTable({
        mode: resolvedMode(),
        format: resolvedFormat(),
        seatCount: seats as 2 | 3 | 4,
        duppies: fill,
        clock: clock.value as ClockName,
        duppyPace: duppyPace.value as DuppyPace,
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
/** Which seat pendingTile was chosen from — only meaningful in across, where
 *  the interactive hand can switch (my seat one turn, my partner seat the
 *  next). A tile mid-chooser in one hand must not survive into the other
 *  just because the same tile id happens to also be in it — same "clear it
 *  the moment what it was about stops being true" rule client.md sets for
 *  pendingTile everywhere else. */
let pendingTileSeat: number | null = null;
let countdownTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * The felt's real measured size, cached across renders — see
 * liveTableView()'s requestAnimationFrame block. A Realtime update fires a
 * full rerender on every opponent move (an active table can see several a
 * second during a duppy-filled seat's turn), and re-measuring AND fully
 * rebuilding the board on each one flashed visibly. Once the real box is
 * known it very rarely changes (only an actual resize moves it), so the fix
 * is to trust the cache on every render after the first and only pay for a
 * real re-measure-and-rebuild when the box has actually changed.
 */
let lastFeltBox: { width: number; height: number } | null = null;
// A pre-deal board occupies the whole felt; a dealt local hand reserves the
// lower rail. Keep their measurements separate so the first dealt frame does
// not briefly render below the rail.
let lastFeltHasHandRail: boolean | null = null;

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
  /** The lounge's own name (e.g. "Yard Gate"), so a seated player still
   *  knows which room they're in — the lounge header that names it gets
   *  fully replaced by this view once seated. Null off a direct join-code
   *  attach with no lounge context. */
  loungeName?: string | null;
}

/** Speaking ring and thrown reaction on a seat, keyed by the player's user id.
 * Duppy seats have no user id and are skipped — a bot never talks. */
function decorateSeat(card: HTMLElement, userId: string | null, name: string, social?: TableSocial): void {
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
    video.setAttribute('aria-label', `${name}'s live camera`);
    video.srcObject = stream;
    // Every person gets one identity spot at the table. A live camera takes
    // over their photo/avatar there instead of adding a second floating tile
    // that would compete with their name or, worse, the domino board.
    const identity = card.querySelector<HTMLElement>('.avatar-shell');
    if (identity) {
      identity.classList.add('live-video');
      identity.replaceChildren(video);
    } else {
      card.prepend(video);
    }
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
let activeRailTab: 'chat' | 'watchers' | 'standings' | 'log' | 'you' = 'chat';

// -------------------------------------------------------------------- you --
// Profile editing — including coin balance and the buy-coins button, both
// folded into profilePanel itself (profile.ts) — reachable without leaving
// a live hand. Previously only existed in the lounge, so a seated player
// had no way to check their balance or fix a typo'd name mid-game short of
// quitting the table. A rail tab, not a modal, so it doesn't run into the
// no-modal-during-a-live-hand rule.
let myProfileCache: MyProfile | null = null;
let myProfileLoading = false;

function youPanel(rerender: () => void): HTMLElement {
  if (!myProfileCache && !myProfileLoading) {
    myProfileLoading = true;
    void myProfile().then((me) => { myProfileCache = me; myProfileLoading = false; rerender(); });
  }
  if (myProfileCache) {
    return profilePanel(myProfileCache, rerender, (fresh) => { myProfileCache = fresh; });
  }
  const wrap = el('div', 'panel');
  wrap.append(el('div', 'eyebrow', 'You'));
  wrap.append(el('p', 'muted small', 'Loading your profile…'));
  return wrap;
}

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

/**
 * The portrait belongs at the player's physical edge of the felt, alongside
 * their rack, rather than being repeated in the informational seat card.
 * That makes the four sides read as four people without giving up the compact
 * status summaries below and around the table.
 */
function tableSeatIdentity(s: SeatInfo, slot: SeatSlot, social?: TableSocial): HTMLElement {
  const identity = el('div', `table-seat-identity table-seat-identity-${slot}`);

  if (s.userId) {
    identity.setAttribute('aria-label', `Player ${s.seatIndex + 1}: ${seatName(s)}`);
    // A real uploaded photo first, then the chosen illustrated character. The
    // same fallback is used in the lounge and profile preview.
    const avatarShell = document.createElement('span');
    avatarShell.className = 'avatar-shell';
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
    avatarShell.appendChild(img);
    if (s.avatarAccessory) {
      const accessory = document.createElement('img');
      accessory.className = `avatar-accessory avatar-accessory-${s.avatarAccessory}`;
      accessory.src = avatarAccessoryUrl(s.avatarAccessory as AvatarAccessory);
      accessory.alt = '';
      accessory.width = 22;
      accessory.height = 22;
      avatarShell.appendChild(accessory);
    }
    identity.appendChild(avatarShell);
    decorateSeat(identity, s.userId, seatName(s), social);
  } else {
    // Duppies are fixed illustrated opponents, never a real profile. The
    // level and seat choose a stable face so a replay or coach view keeps the
    // same four-side table feeling without exposing a human-style presence.
    const level = (DUPPY_LEVELS.includes(s.duppyLevel as DuppyLevel)
      ? s.duppyLevel : 'pickney') as DuppyLevel;
    identity.setAttribute('aria-label', `Duppy ${s.seatIndex + 1}: ${DUPPY_LABELS[level]} AI opponent`);
    const duppy = el('span', 'table-seat-duppy');
    const portrait = document.createElement('img');
    portrait.className = 'avatar';
    portrait.src = duppyPersonaUrl(duppyPersona(level, s.seatIndex));
    portrait.alt = '';
    portrait.width = 32;
    portrait.height = 32;
    duppy.append(portrait, el('span', 'table-seat-duppy-cue', 'AI'));
    identity.appendChild(duppy);
  }
  return identity;
}

function seatCard(
  s: SeatInfo, game: OnlineGame, rerender: () => void,
): HTMLElement {
  const card = el('div', 'seat');
  if (s.seatIndex === game.mySeat) card.classList.add('mine');
  if (game.hand?.turn === s.seatIndex && game.hand.status === 'active') card.classList.add('turn');
  // Partner mode had no online cue at all for which seat is your partner —
  // the border existed only in offline play (main.ts's seats()). Seats are
  // numbered in play order (client.md's own convention), so partners are
  // always the two same-parity seats.
  const isMyPartner = isPartnered(game.table.mode) && game.mySeat !== null
    && s.seatIndex !== game.mySeat && s.seatIndex % 2 === game.mySeat % 2;
  if (isMyPartner) card.classList.add('partner');
  // The art keeps a deliberately quiet left-side text zone. This asymmetric
  // veil preserves that color at the outer edge while guaranteeing names and
  // scores remain readable over every scene.
  if (s.userId && s.background) {
    card.style.backgroundImage = `linear-gradient(90deg, rgba(5,24,50,.92) 0%, rgba(5,43,67,.72) 62%, rgba(5,43,67,.42) 100%), url(${backgroundUrl(s.background as Background)})`;
    card.style.backgroundSize = 'cover';
    card.style.backgroundPosition = 'center';
  }
  const who = el('div', 'who');
  // A stable ordinal, same idea as the roster label a real table already
  // has — "Player 2" is sayable over voice chat, a username or "Duppy ·
  // pickney" alone is not, and it's the one identifier every seat has
  // regardless of whether it's a real player or a bot filling the chair.
  who.append(el('span', 'seat-number', `Player ${s.seatIndex + 1}`));
  who.append(el('h3', undefined, seatName(s)));
  if (isMyPartner) who.append(el('span', 'badge partner-badge', 'Your partner'));
  // Yard or foreign, if they said. A duppy is from nowhere.
  if (s.origin === 'yardie' || s.origin === 'foreign') {
    who.append(el('span', `badge origin-${s.origin}`,
      s.origin === 'yardie' ? 'Yardie' : 'Foreign'));
  }
  card.appendChild(who);
  const count = game.hand?.hand_sizes[s.seatIndex];
  card.append(el('div', 'meta', count === undefined
    ? 'Waiting for deal'
    : `${count} tile${count === 1 ? '' : 's'}`));
  // Closes a gap CLAUDE.md names by name: rating and pace are the two things
  // JamDom shows per-seat that we didn't. Rating is the raw number (an
  // ordinal leaderboard rank needs a real ranked query — separate feature).
  // Speed is a lifetime average from profiles.total_move_ms/total_moves —
  // the only pace data that exists without adding new tracking — not this
  // hand's timing.
  if (s.userId && (s.rating !== null || s.avgMoveMs !== null)) {
    const bits: string[] = [];
    if (s.rating !== null) bits.push(`${s.rating} rated`);
    if (s.avgMoveMs !== null) bits.push(`avg ${(s.avgMoveMs / 1000).toFixed(1)}s`);
    card.append(el('div', 'meta seat-stats', bits.join(' · ')));
  }
  const scoreIndex = isPartnered(game.table.mode) ? sideOf(s.seatIndex, game.table.mode) : s.seatIndex;
  const score = game.scores[scoreIndex] ?? 0;
  card.append(el('div', 'seat-score', String(score)));
  if (s.userId && s.seatIndex !== game.mySeat) {
    card.appendChild(reportButton(s.userId, game.table.id, rerender));
  }
  return card;
}

/**
 * A physical-looking rack on the felt edge. Hidden racks are built only from
 * hand_sizes, which is already public; no opponent TileId ever reaches this
 * function. Open hand is the one exception the server authorizes, so the
 * partner's real bones can be shown face-up at their opposite seat.
 */
function tableRack(s: SeatInfo, game: OnlineGame, slot: 'top' | 'left' | 'right' | 'bottom'): HTMLElement | null {
  const count = game.hand?.hand_sizes[s.seatIndex];
  const presentation = tableRackPresentation({
    mode: game.table.mode,
    seat: s.seatIndex,
    mySeat: game.mySeat,
    partnerSeat: game.partnerSeat(),
    count,
    partnerTiles: game.partnerTiles,
  });
  if (presentation.kind === 'none') return null;

  const rack = el('div', `table-rack table-rack-${slot}`);
  if (presentation.kind === 'open') {
    rack.classList.add('table-rack-open');
    rack.setAttribute('aria-label', `${seatName(s)} has ${presentation.tiles.length} face-up tiles`);
    for (const tile of presentation.tiles) {
      const node = tileEl(tile);
      node.classList.add('sm', 'dead');
      rack.appendChild(node);
    }
  } else {
    rack.classList.add('table-rack-hidden');
    rack.setAttribute('aria-label', `${seatName(s)} has ${presentation.count} hidden tile${presentation.count === 1 ? '' : 's'}`);
    rack.appendChild(backsEl(presentation.count));
  }
  return rack;
}

/** The last confirmed pass stays visibly attached to that player's table side
 * until the next move replaces it. It is a public fact, not a private-hand cue. */
function passCallout(game: OnlineGame): HTMLElement | null {
  const lastMove = game.hand?.move_log.at(-1);
  if (!lastMove || lastMove.kind !== 'pass') return null;
  const slot = seatPosition(lastMove.seat, game.mySeat, game.table.seatCount);
  if (!slot) return null;
  const player = game.seats.find((seat) => seat.seatIndex === lastMove.seat);
  const name = player ? seatName(player) : `Player ${lastMove.seat + 1}`;
  const callout = el('div', `table-pass-callout table-pass-${slot}`, 'PASS');
  callout.setAttribute('role', 'status');
  callout.setAttribute('aria-label', `${name} passed`);
  return callout;
}

/** Keep the latest public tile beside the player who laid it until the next
 * move arrives. This lets someone follow the hand from the board itself,
 * without having to hunt through the activity log. */
function playCallout(game: OnlineGame): HTMLElement | null {
  const lastMove = game.hand?.move_log.at(-1);
  if (!lastMove || !('tile' in lastMove) || game.hand?.status !== 'active') return null;
  // Your own hand occupies the lower felt rail; you already know the tile
  // you chose, so reserve this in-board cue for the other seats rather than
  // covering a tile you may need to play next.
  if (game.mySeat !== null && lastMove.seat === game.mySeat) return null;
  const slot = seatPosition(lastMove.seat, game.mySeat, game.table.seatCount);
  if (!slot) return null;
  const player = game.seats.find((seat) => seat.seatIndex === lastMove.seat);
  const name = player ? seatName(player) : `Player ${lastMove.seat + 1}`;
  const callout = el('div', `table-play-callout table-play-${slot}`, `${name} · ${lastMove.tile}`);
  callout.setAttribute('role', 'status');
  callout.setAttribute('aria-label', `${name} played ${lastMove.tile}`);
  return callout;
}

/**
 * "The slam" — the winning tile drops in and lands hard, the felt shakes.
 * design.md calls this the emotional peak of the game; it existed only as
 * unused CSS (`.slammed`, `.table-felt.shake`) until now, offline included.
 *
 * Identity check against `game.justWonByDominoHandId`, not a one-shot flag
 * — see that field's own comment for why a "consume on first render" design
 * loses the race against the near-simultaneous `sets` broadcast. A tile's
 * own placement never repeats within a hand (a domino set holds each tile
 * once), so its `data-tile` value is a safe, shape-agnostic way to find it
 * again after `renderBoard` rebuilds the line from scratch, whether that's
 * a straight line or a French cross board.
 */
function tagWinningTile(line: HTMLElement, felt: HTMLElement, game: OnlineGame): void {
  if (!game.hand || game.justWonByDominoHandId !== game.hand.hand_id) return;
  const lastMove = game.hand.move_log[game.hand.move_log.length - 1];
  const tileId = lastMove && 'tile' in lastMove ? lastMove.tile : null;
  if (tileId) celebrateWinningTile(tileId, line, felt);
}

export function liveTableView(
  game: OnlineGame,
  rerender: () => void,
  onLeave: () => void,
  social?: TableSocial,
): DocumentFragment {
  const frag = document.createDocumentFragment();

  const head = el('div', 'panel live-table-head');
  if (social?.loungeName) head.append(el('div', 'eyebrow', social.loungeName));
  const top = el('div', 'spread');
  top.append(el('h2', undefined, `Table ${game.table.joinCode}`));
  const sfxOff = sfx.muted();
  const sound = document.createElement('button');
  sound.className = 'act ghost small';
  sound.textContent = sfxOff ? 'Sound off' : 'Sound on';
  sound.setAttribute('aria-pressed', String(!sfxOff));
  sound.onclick = () => { sfx.setMuted(!sfxOff); rerender(); };
  top.appendChild(sound);
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

  const scoreWrap = el('div', 'panel sticky-scores');
  const board = el('div', 'scoreboard');
  // French is race-to-100 (lower wins) and always cutthroat — createSet()
  // enforces both — so this only ever widens the `else` branch below, but
  // the max belongs on both for the same reason main.ts's local scoreboard
  // already carries it: without it scoreTrack() defaults to 6 and every
  // French score renders against the wrong scale, hiding exactly the "how
  // much do I need to lose" number this table is actually played around.
  const trackOpts = { bruk: game.lastResultBruk, max: game.table.format === 'french' ? 100 : 6 };
  const scoreboardPartnered = game.table.mode === 'partner';
  // How many tiles each side/seat has left — the pinned scoreboard is the
  // one place that stays on screen through the whole hand, so this is
  // where a player can actually track it without hunting the board.
  const handSizes = game.hand?.hand_sizes;
  const tilesOfSide = (side: number) => {
    if (!handSizes) return undefined;
    let sum = 0;
    for (let seat = 0; seat < handSizes.length; seat++) {
      if (sideOf(seat, game.table.mode) === side) sum += handSizes[seat];
    }
    return sum;
  };
  if (scoreboardPartnered) {
    board.append(
      scoreTrack('You & partner', game.scores[(game.mySide ?? 0)] ?? 0, { us: true, ...trackOpts, tiles: tilesOfSide(game.mySide ?? 0) }),
      scoreTrack('Them', game.scores[1 - (game.mySide ?? 0)] ?? 0, { ...trackOpts, tiles: tilesOfSide(1 - (game.mySide ?? 0)) }),
    );
  } else {
    // Named per seat (real username, or "Duppy · level" for a substitute),
    // not "Seat N" — the whole point of pinning this bar is so a player can
    // always tell whose score is whose at a glance, on French's four-way
    // individual scoring as much as cut throat's.
    game.scores.forEach((s, i) => board.append(
      scoreTrack(
        describeSeat(i, game.seats, game.mySeat, scoreboardPartnered, game.mySide),
        s,
        { us: i === game.mySeat, ...trackOpts, tiles: handSizes?.[i] },
      ),
    ));
  }
  scoreWrap.appendChild(board);
  frag.appendChild(scoreWrap);

  const cross = el('div', 'table-cross');

  // predictedBoard, when set, is play()'s optimistic guess at my own
  // just-tapped tile landing — see predict.ts. Preferred over the last
  // confirmed board until the real state arrives and clears it.
  const displayBoard = game.predictedBoard ?? game.hand?.board ?? null;

  const feltSlot = el('div', 'felt-slot');
  const feltShell = el('div', 'felt-shell');
  const felt = el('div', 'table-felt live-felt');
  // Keep a single controlled hand in the lower edge of the felt. Spectators
  // have no hand, and Across deliberately keeps its two controlled hands
  // below the board where both remain readable.
  const handOnFelt = !game.isSpectator && !!game.hand && game.table.mode !== 'across';
  const boardStage = handOnFelt ? el('div', 'board-stage') : felt;
  if (handOnFelt) felt.classList.add('hand-on-felt');
  // A French cross grows in four directions. Its mobile felt gets a little
  // more vertical room so late arms remain above—not underneath—the hand.
  if (handOnFelt && displayBoard?.kind === 'cross') felt.classList.add('french-cross-live');
  const line = el('div', 'line');
  if (!game.hand) line.classList.add('awaiting-deal');
  // First pass: the cached real box once we have one (near-instant, no
  // flash), or feltBox()'s window-based guess before the felt has ever been
  // measured.
  const cachedBox = lastFeltHasHandRail === handOnFelt ? lastFeltBox : null;
  renderBoard(line, displayBoard, cachedBox ? { box: cachedBox } : {});
  tagWinningTile(line, felt, game);
  boardStage.appendChild(line);
  if (handOnFelt) felt.appendChild(boardStage);
  feltShell.appendChild(felt);
  // Put each unplayed hand where that person is physically sitting. These
  // visual counters straddle the outer rim rather than consuming playable
  // felt. They are siblings of the scrolling felt so they cannot be clipped
  // or crossed by a long line of played bones.
  const tableIdentities = new Map<SeatSlot, HTMLElement>();
  for (const s of game.seats) {
    const slot = seatPosition(s.seatIndex, game.mySeat, game.table.seatCount);
    if (!slot) continue;
    const rack = tableRack(s, game, slot);
    if (rack) feltShell.appendChild(rack);
    // Identity stays at the physical table edge even for the local player,
    // whose playable hand deliberately has no duplicate rack.
    const identity = tableSeatIdentity(s, slot, social);
    // The local player's hand occupies the lower felt rail. Put that one
    // portrait in the rail header once it exists, never on top of a playable
    // bone. The other three remain beside their physical racks.
    if (handOnFelt && slot === 'bottom') tableIdentities.set(slot, identity);
    else feltShell.appendChild(identity);
  }
  const lastPass = passCallout(game);
  if (lastPass) feltShell.appendChild(lastPass);
  const lastPlay = playCallout(game);
  if (lastPlay) feltShell.appendChild(lastPlay);
  // An undealt table is still a game surface, not a form page. Keep the
  // only action needed to begin the game directly on the felt so nobody has
  // to scroll away from the board to find it.
  if (!game.hand) felt.appendChild(startHandPanel(game));
  feltSlot.appendChild(feltShell);
  // The felt isn't attached to the document yet at this point in the build,
  // so getBoundingClientRect() would read all zeros here — wait a frame for
  // real layout, then correct the cache and re-render ONLY if the real box
  // has actually moved (a resize) — not on every render. A Realtime update
  // fires this on every opponent move, and re-measuring plus fully
  // rebuilding the board on each one is the flash this guards against.
  requestAnimationFrame(() => {
    // -32 matches CHROME_X/CHROME_Y's existing padding-subtraction
    // convention (felt padding + line padding), not a new magic number.
    const fitHost = handOnFelt ? boardStage : felt;
    const box = handOnFelt
      ? { width: fitHost.clientWidth - 20, height: fitHost.clientHeight - 20 }
      : { width: felt.clientWidth - 32, height: felt.clientHeight - 32 };
    if (box.width <= 0 || box.height <= 0) return;
    const changed = lastFeltHasHandRail !== handOnFelt
      || !lastFeltBox || lastFeltBox.width !== box.width || lastFeltBox.height !== box.height;
    lastFeltBox = box;
    lastFeltHasHandRail = handOnFelt;
    if (changed) {
      renderBoard(line, displayBoard, { box });
      tagWinningTile(line, felt, game);
    }
  });
  // Docked directly under the felt so the board and the player's own hand
  // are always visible together — this used to be a separate panel
  // appended after .table-room closed, which pushed it below the fold.
  // Same guards as the old call site: only a seated player with a dealt
  // hand gets one.
  let handActions: HTMLElement | null = null;
  if (!game.isSpectator && game.hand) {
    if (game.table.mode === 'across') {
      // Both of my hands dock under the felt together — the reason across
      // exists at all is seeing (and playing) both while reading the same
      // board, so neither hand gets pushed below the fold the way a panel
      // rendered elsewhere on the page would. Whichever seat is actually
      // live renders first via myHandPanel's own active-seat logic; the
      // other renders alongside it as a plain, unselectable display.
      const activeSeat = game.activeSeat();
      const partnerIsActive = activeSeat !== null && activeSeat === game.partnerSeat();
      if (partnerIsActive) {
        if (game.myTiles.length) feltSlot.appendChild(myOtherHandPanel(game.myTiles));
        feltSlot.appendChild(myHandPanel(game, rerender));
      } else {
        if (game.partnerTiles) feltSlot.appendChild(myOtherHandPanel(game.partnerTiles));
        feltSlot.appendChild(myHandPanel(game, rerender));
      }
    } else {
      const hand = myHandPanel(game, rerender);
      if (handOnFelt) {
        hand.classList.add('in-felt-hand');
        handActions = takeHandActions(hand);
        const bottomIdentity = tableIdentities.get('bottom');
        if (bottomIdentity) hand.appendChild(bottomIdentity);
        felt.appendChild(hand);
      } else {
        feltSlot.appendChild(hand);
      }
    }
  }
  if (handActions) feltSlot.appendChild(handActions);
  // The two-end choice belongs immediately under the felt. Putting the
  // countdown before it made the arrows look disconnected from the tile a
  // player had just selected, especially on a phone.
  if (game.hand?.status === 'active' && game.hand.turn_expires_at) {
    feltSlot.appendChild(countdown(game, game.hand.turn_expires_at));
  }
  cross.appendChild(feltSlot);

  game.seats.forEach((s) => {
    const slot = seatPosition(s.seatIndex, game.mySeat, game.table.seatCount);
    if (!slot) return;
    const wrap = el('div', `seat-slot seat-slot-${slot}`);
    wrap.appendChild(seatCard(s, game, rerender));
    cross.appendChild(wrap);
  });

  // Keep the completed-hand actions with the game, directly below the
  // player's bottom seat. Appending this after `.table-room` made a tall
  // chat/standings rail push Verify, Coach and Deal next hand far below the
  // screen, where players had no reason to look for them.
  if (game.hand?.status !== 'active' && game.hand?.result) {
    const result = handResultPanel(game, rerender);
    result.classList.add('hand-result-dock');
    cross.appendChild(result);
  }

  const room = el('div', 'table-room');
  room.appendChild(cross);

  const rail = el('div', 'table-rail');

  const tabs = el('div', 'rail-tabs');
  const tabDefs: { id: typeof activeRailTab; label: string }[] = [
    { id: 'chat', label: 'Table talk' },
    { id: 'watchers', label: 'Watching' },
    { id: 'standings', label: 'Standings' },
    { id: 'log', label: 'Log' },
    { id: 'you', label: 'You' },
  ];
  for (const { id, label } of tabDefs) {
    const btn = document.createElement('button');
    btn.className = 'rail-tab' + (activeRailTab === id ? ' active' : '');
    btn.textContent = label;
    btn.onclick = () => { activeRailTab = id; rerender(); };
    tabs.appendChild(btn);
  }
  rail.appendChild(tabs);

  const talk = social?.chatPanel ?? el('div', 'panel');
  if (!social?.chatPanel) {
    talk.append(el('div', 'eyebrow', 'Table talk'));
    talk.append(el('p', 'muted', 'Connecting chat to this table…'));
  }
  if (social?.quickChatBar) {
    talk.append(el('div', 'rail-help', 'Quick words'), social.quickChatBar);
  }
  if (social?.reactionBar) {
    talk.append(el('div', 'rail-help', 'Stickers'), social.reactionBar);
  }
  talk.classList.add('rail-section', 'rail-section-chat');
  talk.classList.toggle('rail-section-active', activeRailTab === 'chat');
  rail.appendChild(talk);
  const crowd = watchersPanel(game, social);
  crowd.classList.add('rail-section', 'rail-section-watchers');
  crowd.classList.toggle('rail-section-active', activeRailTab === 'watchers');
  rail.appendChild(crowd);
  const standings = standingsPanel(game);
  standings.classList.add('rail-section', 'rail-section-standings');
  standings.classList.toggle('rail-section-active', activeRailTab === 'standings');
  rail.appendChild(standings);
  const log = moveLogPanel(game);
  log.classList.add('rail-section', 'rail-section-log');
  log.classList.toggle('rail-section-active', activeRailTab === 'log');
  rail.appendChild(log);
  const you = youPanel(rerender);
  you.classList.add('rail-section', 'rail-section-you');
  you.classList.toggle('rail-section-active', activeRailTab === 'you');
  rail.appendChild(you);
  room.appendChild(rail);

  frag.appendChild(room);

  const openTalk = document.createElement('button');
  openTalk.type = 'button';
  openTalk.className = 'table-talk-jump';
  openTalk.textContent = 'Chat & stickers';
  openTalk.setAttribute('aria-label', 'Open table chat, quick words and stickers');
  openTalk.onclick = () => {
    activeRailTab = 'chat';
    rerender();
    requestAnimationFrame(() => {
      document.querySelector('.table-rail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };
  frag.appendChild(openTalk);

  return frag;
}

/**
 * Who is leaning on the table watching. Seated players are filtered out —
 * they are already on screen as seats, and listing them twice makes a
 * four-hander look like it has an audience of four.
 *
 * Always returns a panel because the mobile tab must never open into a blank
 * space. The empty state also explains what watching means to a new player.
 */
function watchersPanel(game: OnlineGame, social?: TableSocial): HTMLElement {
  const panel = el('div', 'panel');
  panel.append(el('div', 'eyebrow', 'Watching'));
  panel.append(el('p', 'rail-help', 'People watching this table appear here. They can follow the hand without seeing anyone\'s hidden tiles.'));
  if (!social?.watching) {
    panel.append(el('div', 'muted', 'Nobody is watching yet.'));
    return panel;
  }
  const seated = new Set(game.seats.map((s) => s.userId).filter(Boolean));
  const crowd = social.watching.filter((p) => !seated.has(p.user_id));
  if (crowd.length === 0) {
    panel.append(el('div', 'muted', 'Nobody is watching yet.'));
    return panel;
  }
  panel.querySelector('.eyebrow')!.textContent = `Watching · ${crowd.length}`;
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
  panel.append(el('p', 'rail-help', 'The current set score. It updates when each hand ends.'));
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
      const label = seatName(s);
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
  panel.append(el('p', 'rail-help', 'A turn-by-turn record of every tile played, draw and pass in this hand.'));
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
  const panel = el('div', 'panel start-hand-panel');
  if (game.isSpectator) {
    panel.append(el('p', 'muted', 'No tiles have been dealt yet. Waiting for the players to start the first hand.'));
    return panel;
  }
  panel.append(el('p', 'muted', 'No tiles have been dealt yet. Everyone\'s seated—start the hand when the table is ready.'));
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
/**
 * Ticks itself via direct DOM mutation instead of calling the app's full
 * rerender() every second. It used to call rerender() on a 1s setTimeout,
 * which — since render() rebuilds the entire #app tree on every call —
 * tore down and recreated every element on the page once a second during
 * any active turn, table video included. A <video> element with a live
 * MediaStream doesn't survive that quietly: losing and reattaching
 * srcObject every second reads as the feed visibly shaking/stuttering,
 * which is exactly what a real user reported. The countdown's own tick
 * never needed anything else on the page to change in step with it — the
 * actual "turn expired, a duppy plays" transition already arrives
 * separately, pushed by the server over realtime, which rerenders on its
 * own when it lands.
 */
function countdown(game: OnlineGame, expiresAt: string): HTMLElement {
  const turn = game.hand?.turn ?? null;
  const isDuppyTurn = turn !== null && Boolean(game.seats[turn]?.duppyLevel);
  const bank = turn === null ? 0 : Math.round(game.seats[turn]?.timeBank ?? 0);
  const base = game.table?.turnSeconds ?? 0;
  const allowed = isDuppyTurn ? duppyThinkSeconds(game.table.duppyPace) : Math.max(base + bank, 1);

  const wrap = el('div', 'panel clock');
  const head = el('div', 'clock-head');
  const left = el('span', 'clock-left');
  const status = el('span', 'muted');
  head.append(left, status);
  // Only worth explaining when the bank is actually doing something.
  const bankLabel = !isDuppyTurn && bank > 0 ? el('span', 'clock-bank', `${base}s + ${bank}s banked`) : null;
  if (bankLabel) head.append(bankLabel);
  wrap.appendChild(head);

  const track = el('div', 'clock-track');
  const fill = el('div', 'clock-fill');
  track.appendChild(fill);
  wrap.appendChild(track);

  function tick() {
    const remaining = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
    left.textContent = remaining > 0 ? `${remaining}s` : 'Time';
    status.textContent = remaining > 0
      ? (isDuppyTurn ? `Duppy ${(turn ?? 0) + 1} thinking` : game.isMyTurn() ? 'to play' : 'for this seat')
      : (isDuppyTurn ? `Duppy ${(turn ?? 0) + 1} moving` : 'time up — a legal move is made');
    if (bankLabel) bankLabel.style.display = remaining > 0 ? '' : 'none';
    fill.style.width = `${Math.min(100, (remaining / allowed) * 100)}%`;
    // Urgency is earned by the last few seconds, not by a colour that
    // shouts through the whole turn.
    fill.classList.toggle('urgent', remaining > 0 && remaining <= 5);

    if (countdownTimer) clearTimeout(countdownTimer);
    if (remaining > 0) countdownTimer = setTimeout(tick, 1000);
  }
  tick();

  return wrap;
}

/**
 * Across only — whichever of my own two hands is NOT live right now. Same
 * plain, unselectable display as partnerHandPanel, labelled for what it
 * actually is here: my own second hand waiting its turn.
 */
function myOtherHandPanel(tiles: string[]): HTMLElement {
  const panel = el('div', 'panel partner-hand');
  panel.append(el('div', 'eyebrow', 'Your other hand'));
  const row = el('div', 'hand');
  for (const tile of tiles) {
    const node = tileEl(tile);
    node.classList.add('sm', 'dead');
    row.appendChild(node);
  }
  panel.appendChild(row);
  return panel;
}

/**
 * Matches CrossArm['direction'] — the felt lays a French board's four arms
 * out in exactly these screen positions. An arrow needs no translating the
 * way "Right"/"Up" did — a player who couldn't place what "Up arm" meant
 * can still match an arrow glyph straight to the arm pointing that way on
 * the felt. `label` stays for screen readers, which can't see the glyph.
 */
const ARM_DIRECTION_ARROW: Record<'right' | 'left' | 'up' | 'down', { glyph: string; label: string }> = {
  right: { glyph: '→', label: 'right' },
  left: { glyph: '←', label: 'left' },
  up: { glyph: '↑', label: 'top' },
  down: { glyph: '↓', label: 'bottom' },
};

function myHandPanel(game: OnlineGame, rerender: () => void): HTMLElement {
  const panel = el('div', 'panel my-hand-panel');
  // A tile tapped right before the hand ended (legal or not) must not carry
  // into the result screen, or wrongly pre-select a same-id tile if the
  // next deal happens to include it again — same reasoning as main.ts's
  // handOver handler, done here instead since OnlineGame has no equivalent
  // discrete event to hook.
  if (game.hand?.status !== 'active') { pendingTile = null; pendingTileSeat = null; }
  // The seat this panel is actually interactive for: my own seat for every
  // mode, or across's other seat when that one is what's actually live.
  // Falls back to my primary seat when it's not my turn at all, so the
  // panel still shows something sensible while waiting.
  const seat = game.activeSeat() ?? game.mySeat;
  const onPartnerSeat = game.table.mode === 'across' && seat !== null && seat === game.partnerSeat();
  // A prediction pending for THIS seat means a move was just tapped and
  // hasn't been confirmed by the server yet — game.hand.turn is still stale
  // at this point (the real update hasn't arrived), so legalMovesForMe()
  // would otherwise happily offer a second move before the first one has
  // even been processed. Freeze the hand — plain tiles, no chooser, no Pass
  // — until the real state lands and clears the prediction. Checked per-seat
  // (predictedTilesFor), not just predictedMyTiles, or an across move from
  // the partner seat would never freeze and could double-submit.
  const pending = seat !== null && game.predictedTilesFor(seat) !== null;
  const tiles = seat === null ? [] : (game.predictedTilesFor(seat) ?? game.tilesForSeat(seat));
  // A tile chosen in one of my two hands must not appear "chosen" in the
  // other just because it shares a tile id — see pendingTileSeat's comment.
  if (pendingTileSeat !== seat) { pendingTile = null; pendingTileSeat = seat; }
  const label = pending
    ? 'Sending…'
    : onPartnerSeat
      ? (game.isMyTurn() ? 'Your partner hand — your play' : 'Your partner hand')
      : (game.isMyTurn() ? 'Your play' : 'Your hand');
  panel.append(el('div', 'eyebrow', label));
  const legal = pending ? [] : game.legalMovesForMe();
  const playable = new Set(legal.flatMap((m) => ('tile' in m ? [m.tile] : [])));
  const hand = el('div', 'hand');

  for (const tile of tiles) {
    const node = tileEl(tile);
    const can = playable.has(tile);
    node.classList.add(can ? 'playable' : 'dead');
    if (pendingTile === tile) node.classList.add('chosen');
    // Every tile is selectable, playable or not — a real table never stops
    // your hand touching a tile that doesn't fit, it just won't land. The
    // 'playable' class is the hint; tapping a 'dead' one shows why it can't
    // be played instead of doing nothing. Still frozen while a move is
    // in flight (pending) — that guard exists so a second move can't queue
    // up before the server confirms the first.
    if (!pending) {
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

  if (pendingTile && game.hand?.status === 'active') {
    // The pip value on each end, not just the bare direction — "I thought
    // this was the right end" is a real argument at a real table, and the
    // number settles it before it starts.
    const board = game.predictedBoard ?? game.hand?.board ?? null;
    const linear = board?.kind === 'linear' ? board : null;
    const cross = board?.kind === 'cross' ? board : null;
    const options = legal.filter((m) => 'tile' in m && m.tile === pendingTile);
    const choice = el('div', 'row');
    if (options.length === 0) {
      const reason = cross ? crossRejectReason(cross, pendingTile) : null;
      choice.append(el('span', 'muted', reason ?? "That tile doesn't fit the board right now."));
    } else {
      choice.append(el('span', 'muted', 'Which end?'));
      for (const move of options) {
        const b = document.createElement('button');
        b.className = 'act ghost';
        if (cross && move.kind === 'playcross') {
          // Post-fill only — the fill phase always has exactly one legal arm
          // per tile, so a real choice here means two or more EXISTING arms
          // both expose the same pip and this tile answers both. An arrow
          // pointing the same way the arm actually runs on the felt needs no
          // reading — "Right end" twice, with no way to tell them apart, was
          // the original bug; "Right arm" / "Up arm" fixed the ambiguity but
          // still asked the player to translate a compass word into a screen
          // position. The glyph removes that step entirely.
          const arm = cross.arms[move.arm];
          if (arm) {
            const dir = ARM_DIRECTION_ARROW[arm.direction];
            b.textContent = `${dir.glyph} (${arm.openEnd})`;
            b.setAttribute('aria-label', `${dir.label} arm, opens on ${arm.openEnd}`);
          } else {
            b.textContent = 'New arm';
          }
        } else {
          // Same arrow language as the cross board's arms — a linear board's
          // left/right end is exactly the same "which end?" question, and
          // the felt lays them out left-to-right on screen too.
          const isLeft = (move as any).end === 'left';
          const arrow = isLeft ? '←' : '→';
          const pip = linear ? (isLeft ? linear.leftEnd : linear.rightEnd) : null;
          b.textContent = pip !== null
            ? `${arrow} ${isLeft ? 'Left' : 'Right'} end (${pip})`
            : `${arrow} ${isLeft ? 'Left end' : 'Right end'}`;
        }
        b.onclick = () => { pendingTile = null; void game.play(move); };
        choice.appendChild(b);
      }
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

  // French's paid reshuffle. The 50-70 window and the once-per-set limit
  // are both enforced server-side — this is just where the button shows up
  // once the window opens; the request itself surfaces whatever the server
  // says (already used it, score moved back out of range, etc).
  if (game.table.format === 'french' && game.mySeat !== null) {
    const myScore = game.scores[game.mySeat] ?? 0;
    if (myScore >= 50 && myScore <= 70) {
      const reshuffle = document.createElement('button');
      reshuffle.className = 'act ghost';
      reshuffle.textContent = game.reshufflePending ? 'Reshuffling…' : 'Reshuffle your hand — 2 coins';
      reshuffle.disabled = game.reshufflePending;
      reshuffle.onclick = () => void game.requestReshuffle();
      panel.appendChild(reshuffle);
    }
  }
  return panel;
}

/** See main.ts: preserve the fixed in-felt hand rail during a live choice. */
function takeHandActions(panel: HTMLElement): HTMLElement | null {
  const actions = [...panel.children].filter((child) =>
    !child.classList.contains('eyebrow') && !child.classList.contains('hand'),
  );
  if (!actions.length) return null;
  const dock = el('div', 'hand-actions-dock');
  actions.forEach((action) => dock.appendChild(action));
  return dock;
}

/** A completed hand's free, browser-verified visual deal receipt. */
function revealSection(game: OnlineGame): HTMLElement {
  const wrap = el('section', 'deal-check');
  const partnered = isPartnered(game.table.mode);

  if (game.revealedDeal && game.dealVerification) {
    const verification = game.dealVerification;
    const verdict = el('div', `deal-verdict ${verification.ok ? 'ok' : 'bad'}`);
    verdict.setAttribute('role', 'status');
    verdict.append(
      el('div', 'eyebrow', 'Visual deal check'),
      el('h2', undefined, verification.ok ? 'Deal verified' : 'Deal could not be verified'),
      el('p', 'muted', verification.ok
        ? 'Your browser rebuilt the locked shuffle. These are the exact starting hands it produced.'
        : `The reconstructed deal did not match: ${verification.reason ?? 'unknown difference'}.`),
    );
    wrap.appendChild(verdict);

    const checks = el('div', 'deal-checks');
    const messages = verification.ok
      ? ['Shuffle locked before play', 'Revealed key matches that lock', 'Every starting hand matches', 'Every tile is accounted for']
      : ['At least one verification check failed'];
    for (const message of messages) checks.append(el('div', undefined, `${verification.ok ? '✓' : '!'} ${message}`));
    wrap.appendChild(checks);

    const table = el('div', 'verified-table');
    for (let seat = 0; seat < game.revealedDeal.length; seat++) {
      const row = el('div', `reveal-hand verified-seat seat-${seat}`);
      row.append(el('strong', undefined, describeSeat(seat, game.seats, game.mySeat, partnered, game.mySide)));
      const tiles = el('div', 'hand');
      for (const tile of game.revealedDeal[seat]) {
        const t = tileEl(tile);
        t.classList.add('sm');
        tiles.appendChild(t);
      }
      row.appendChild(tiles);
      table.appendChild(row);
    }
    if (verification.boneyard.length > 0) {
      const yard = el('div', 'reveal-hand verified-boneyard');
      yard.append(el('strong', undefined, 'Boneyard'));
      const tiles = el('div', 'hand');
      for (const tile of verification.boneyard) { const t = tileEl(tile); t.classList.add('sm'); tiles.append(t); }
      yard.append(tiles);
      table.append(yard);
    }
    wrap.appendChild(table);

    const technical = document.createElement('details');
    technical.className = 'deal-technical';
    const summary = document.createElement('summary');
    summary.textContent = 'Technical details';
    technical.append(summary);
    const receipt = verification.receipt;
    technical.append(
      el('div', 'muted', 'Commitment'), el('code', 'seed', receipt.commitment),
      el('div', 'muted', 'Revealed key'), el('code', 'seed', receipt.serverSeed),
      el('div', 'muted', 'Hand'), el('code', 'seed', receipt.handId),
    );
    wrap.appendChild(technical);
    return wrap;
  }

  const button = document.createElement('button');
  button.className = 'act ghost';
  button.textContent = game.revealPending ? 'Checking the deal…' : 'Verify the deal — free';
  button.disabled = game.revealPending;
  button.onclick = () => void game.reveal();
  wrap.append(el('p', 'muted',
    'After the hand, your browser can rebuild the locked shuffle and show every starting hand.'));
  wrap.appendChild(button);
  return wrap;
}

/** The paid dispute-settler — full move log plus every seat's starting
 *  tiles, 2 coins. Separate from revealSection above on purpose: that one
 *  proves the shuffle wasn't rigged, this one shows what everyone actually
 *  chose to play or hold. See settle-hand's own header. */
function settleSection(game: OnlineGame): HTMLElement {
  const wrap = el('section', 'deal-check');
  const partnered = isPartnered(game.table.mode);

  if (game.settledDeal && game.settledMoveLog) {
    wrap.append(
      el('div', 'eyebrow', 'Settled'),
      el('h2', undefined, 'Every hand, every move'),
    );

    const table = el('div', 'verified-table');
    for (let seat = 0; seat < game.settledDeal.length; seat++) {
      const row = el('div', `reveal-hand verified-seat seat-${seat}`);
      row.append(el('strong', undefined, describeSeat(seat, game.seats, game.mySeat, partnered, game.mySide)));
      const tiles = el('div', 'hand');
      for (const tile of game.settledDeal[seat]) {
        const t = tileEl(tile);
        t.classList.add('sm');
        tiles.appendChild(t);
      }
      row.appendChild(tiles);
      table.appendChild(row);
    }
    wrap.appendChild(table);

    const list = el('div', 'move-log');
    for (const move of game.settledMoveLog) {
      const line = describeMoveLine(move, game.seats, game.mySeat, partnered, game.mySide);
      list.append(el('div', 'move-log-line', line));
    }
    wrap.appendChild(list);
    return wrap;
  }

  const button = document.createElement('button');
  button.className = 'act ghost';
  button.textContent = game.settlePending ? 'Settling…' : 'Settle it — every hand, every move (2 coins)';
  button.disabled = game.settlePending;
  button.onclick = () => void game.settle();
  wrap.append(el('p', 'muted',
    'Everyone\'s starting tiles and the full turn-by-turn log — for when you need to know '
    + 'exactly what somebody held and chose not to play.'));
  wrap.appendChild(button);
  return wrap;
}

/**
 * The Coach, online. Grades every real decision on the just-finished hand —
 * same engine, same grades (Best/Fine/Loose/Blunder), as the offline replay
 * in main.ts's coachPanel(). Free once a day on Guest, unlimited on
 * Yardie/VIP, gated server-side (RLS-equivalent — see billing.md's "never
 * gate a paid feature in the client") — a guest past today's free slot
 * gets a distinct ReviewLimitError instead of the generic error path, so
 * this can offer a 2-coin top-up inline rather than just a dead end.
 */
function coachSection(game: OnlineGame): HTMLElement {
  const wrap = el('div', 'panel');
  wrap.append(el('div', 'eyebrow', 'The coach'));

  if (game.review) {
    const r = game.review;
    const head = el('div', 'spread');
    const left = el('div', 'stack');
    left.append(el('h2', undefined, r.summary));
    left.append(el('div', 'muted',
      `${r.reviews.length} real decision${r.reviews.length === 1 ? '' : 's'} this hand`));
    const acc = el('div', 'stack');
    acc.style.textAlign = 'right';
    acc.append(el('div', 'accuracy', `${game.reviewAccuracy}%`), el('div', 'side-name', 'decision score'));
    head.append(left, acc);
    wrap.appendChild(head);

    wrap.append(el('div', 'muted',
      r.reviews.length === 0
        ? 'No real choices this hand.'
        : `${r.reviews.length} decision${r.reviews.length === 1 ? '' : 's'} reviewed · ` +
          `${r.counts.best + r.counts.fine} held up`));
    const open = document.createElement('button');
    open.className = 'act ghost';
    open.textContent = r.criticalPly === null ? 'Review the decisions' : 'Review the key decision';
    open.disabled = r.reviews.length === 0;
    open.onclick = () => {
      const reviewView = coachReviewView({
        review: r,
        score: game.reviewAccuracy ?? 100,
        onClose: () => reviewView.replaceWith(coachSection(game)),
        onLesson: () => {
          document.querySelector<HTMLButtonElement>('button[data-view="academy"]')?.click();
        },
      });
      wrap.replaceWith(reviewView);
      reviewView.scrollIntoView({ block: 'start' });
    };
    wrap.appendChild(open);
    return wrap;
  }

  if (game.reviewLimitMessage) {
    wrap.append(el('p', 'muted', game.reviewLimitMessage));
    const payButton = document.createElement('button');
    payButton.className = 'act ghost';
    payButton.textContent = game.reviewPending ? 'Unlocking…' : 'Pay 2 coins for this review';
    payButton.disabled = game.reviewPending;
    payButton.onclick = () => void game.requestCoachReview(true);
    wrap.appendChild(payButton);
    return wrap;
  }

  const button = document.createElement('button');
  button.className = 'act ghost';
  button.textContent = game.reviewPending ? 'Reviewing…' : 'Coach review this hand';
  button.disabled = game.reviewPending;
  button.onclick = () => void game.requestCoachReview();
  wrap.appendChild(button);
  return wrap;
}

function handResultPanel(game: OnlineGame, rerender: () => void): HTMLElement {
  const panel = el('div', 'panel');
  const r = game.hand!.result as any;
  const partnered = isPartnered(game.table.mode);

  if (game.winnerSide !== null && game.sixLove) {
    panel.append(el('div', 'banner six-love',
      game.winnerSide === game.mySide ? 'SIX LOVE' : 'Six love against you'));
  }
  const winnerName = r.winnerSeat !== null
    ? describeSeat(r.winnerSeat, game.seats, game.mySeat, partnered, game.mySide)
    : null;

  // A blocked hand used to just say "Hand over" here regardless of who won
  // or why — the engine had already correctly picked the lowest individual
  // count (packages/engine/src/set.ts), the score had already updated, but
  // nothing on screen said so. A player who won this way had no way to tell
  // the rule had actually fired for them. Domino (someone played out) is
  // self-evident from the empty hand, so it keeps a plain heading; blocked
  // is the case that actually needs the "why".
  let heading: string;
  if (r.tie) {
    // A tie is "two or more seats share the lowest count" — the tied seats
    // aren't necessarily seat 0, so the tied value is the minimum across
    // every seat's count, not a fixed index.
    heading = `Tied at ${Math.min(...r.counts)} — replay at ${game.handValue} points`;
  } else if (r.status === 'blocked' && winnerName !== null) {
    const count = r.counts[r.winnerSeat];
    heading = `Blocked — ${winnerName} ${winnerName === 'You' ? 'win' : 'wins'} on the count (${count})`;
  } else {
    heading = 'Hand over';
  }
  panel.append(el('h2', undefined, heading));

  // French scores every pip on every hand, not just blocked ones — this is
  // the one place a player can check the math for themselves, on domino
  // wins as much as blocked hands.
  if (game.table.format === 'french') {
    panel.appendChild(frenchScoreBreakdown(
      r, game.scoresBeforeHand, game.scores,
      (seat) => describeSeat(seat, game.seats, game.mySeat, partnered, game.mySide),
    ));
  }

  // French penalties (board pass, three-in-a-row pass, no double to pose)
  // accrue silently mid-hand — the live banner names the reason but vanishes
  // after 6 seconds, so this is where a player can still see WHY each +10
  // landed once the hand is over, not just that it did.
  if (game.table.format === 'french') {
    const penaltyLog = frenchPenaltyLog(
      r.penaltyLog ?? [],
      (seat) => describeSeat(seat, game.seats, game.mySeat, partnered, game.mySide),
    );
    if (penaltyLog) panel.appendChild(penaltyLog);
  }

  panel.appendChild(revealSection(game));
  panel.appendChild(settleSection(game));
  if (!game.isSpectator) panel.appendChild(coachSection(game));

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
    // Cutthroat's "side" is just the seat itself, so describeSeat resolves
    // it straight; partnered modes need the side-to-name mapping instead
    // since a side is two seats, not one.
    const setWinnerName = partnered
      ? (game.winnerSide === game.mySide ? 'You & partner' : 'Them')
      : describeSeat(game.winnerSide, game.seats, game.mySeat, partnered, game.mySide);
    panel.append(el('p', 'muted', `Set over — ${setWinnerName} won.`));
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
