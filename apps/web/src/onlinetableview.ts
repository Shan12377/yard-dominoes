// apps/web/src/onlinetableview.ts
//
// Rendering only — same DOM-building style as loungeview.ts and main.ts.
// No state lives here; OnlineGame (onlinetable.ts) owns it, this module only
// reads it and calls back into it.

import { OnlineGame } from './onlinetable.ts';
import { dealOverlay, confirmTableExit, handTurnCue, stationTurnCue, frenchPhoneTab } from './table-experience.ts';
import { coachReviewView } from './coachview.ts';
import type { SeatInfo } from './onlinetable.ts';
import {
  listLoungeTables, reactionLabel, quickChatLabel, avatarUrl, AVATAR_LABEL, giftCoins, MIN_GIFT_COINS,
  avatarAccessoryUrl, backgroundUrl, myProfile,
  type OpenTable, type Avatar, type AvatarAccessory, type Background, type MyProfile,
} from './lounges.ts';
import { createTable, joinTable } from './online.ts';
import { profilePanel } from './profile.ts';
import { tileEl, renderBoard, scoreTrack, backsEl, el, crossRejectReason, frenchScoreBreakdown, frenchPenaltyLog, celebrateWinningTile, assertVisibleTilesDisjoint, liveTableUnit, liveLinearGeometry, liveAcrossRouteUnits, placeBoardChoices, reserveBoardStage, frenchCanvasUnit, phoneCrossGridKey, centreCrossOnPose, markPannable, keepTileInView, frenchTabBlocks, frenchPinwheelPhone, phonePracticeGeometry, DESK_FIRST_ROW_BONES, phoneRouteGeometryFits, deskRouteGeometry, DESK_ROUTE_STAGE_INSET, DESK_ROUTE_MIN_UNIT, ACROSS_CLIMB, placeSideInfo } from './render.ts';
import type { PhoneRouteGrid, StageRect } from './render.ts';
import { fileReport } from './reports.ts';
import { photoUrl } from './photo.ts';
import { seatPosition, type SeatSlot } from './seatlayout.ts';
import { describeMoveLine, describeSeat, seatName, seatNameWithLevel } from './movelog.ts';
import { tableRackPresentation } from './table-rack.ts';
import { duppyPersona, duppyPersonaUrl } from './duppy-persona.ts';
import {
  CLOCK_LABELS, CLOCK_NAMES, DUPPY_LABELS, DUPPY_LEVELS, DUPPY_PACE_LABELS, DUPPY_PACE_NAMES, duppyThinkSeconds,
  dealPlan, isPartnered, sideOf, type ClockName, type DuppyLevel, type DuppyPace, type GameMode,
} from '@yard/engine';
import type { Move, TileId } from '@yard/engine';
import * as sfx from './sfx.ts';
import { FELTS, felt as chosenFelt, setFelt } from './felt.ts';

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
  /** Who is looking, so a table only they can rejoin is shown only to them. */
  me?: MyProfile | null,
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

  // A playing table with nobody at it is finished in every sense that matters
  // — the last person walked out and only duppies are left moving. It keeps
  // `status = 'playing'` for up to three hours (0047's sweep), and the lounge
  // was offering to WATCH it: nought of four seated, nothing happening.
  // Reported directly after leaving a game mid-set.
  //
  // It still shows to the one player who can do something about it, because
  // this row is their only door back — "Watch" quietly tries a rejoin first
  // (below), and join-table keeps a seat claimable for five minutes.
  const meId = me?.id ?? null;
  tables = tables.filter((t) =>
    t.occupiedSeats > 0
    || t.status === 'waiting'
    || (meId !== null && t.recentLeavers.includes(meId)));

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
      // Your own seat, still claimable. Say "Rejoin" — "Watch" was actively
      // wrong here: it already attempts the rejoin, and calling it Watch told
      // the one player who could resume the game that all they could do was
      // spectate it.
      const canRejoin = meId !== null && t.recentLeavers.includes(meId);
      const join = document.createElement('button');
      join.className = t.status === 'waiting' || canRejoin ? 'act' : 'act ghost';
      join.textContent = t.status === 'waiting' ? 'Sit down' : canRejoin ? 'Rejoin' : 'Watch';
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
  french: 'Race to 100 — lowest score wins. A double left in your hand counts twice.',
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
let startPace: DuppyPace = 'brisk';

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
  advanced.className = 'collapsible table-start-options';
  // room() (loungeview.ts) rebuilds this whole form fresh on every rerender —
  // a plain `open` attribute would silently re-collapse this the instant
  // anything else (a chat message, a table filling a seat) ticks the room.
  // Same module-scope-state fix as profile.ts's collapsibleSection.
  advanced.open = startTableAdvancedOpen;
  advanced.addEventListener('toggle', () => {
    startTableAdvancedOpen = advanced.open;
    advancedAction.textContent = advanced.open ? 'Close' : 'Open';
  });
  const advancedSummary = document.createElement('summary');
  const advancedTitle = el('span', 'table-start-options-title', 'Table settings');
  const advancedHint = el('span', 'table-start-options-hint', 'Seats · turn clock · Duppies');
  const advancedAction = el('span', 'table-start-options-action', 'Open');
  advancedAction.textContent = advanced.open ? 'Close' : 'Open';
  const advancedCopy = el('span', 'table-start-options-copy');
  advancedCopy.append(advancedTitle, advancedHint);
  advancedSummary.append(advancedCopy, advancedAction);
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
/** Hand id whose pose-choice row the player has already answered with "Keep
 *  it". Module scope, not DOM state, because render() rebuilds the panel —
 *  see client.md on anything a player is mid-way through. */
let poseChoiceDismissed: string | null = null;
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
/** The board node itself, kept across rebuilds so played bones are never redrawn. */
let lastLineNode: HTMLElement | null = null;
let lastLineHandKey: string | null = null;
// A pre-deal board occupies the whole felt; a dealt local hand reserves the
// lower rail. Keep their measurements separate so the first dealt frame does
// not briefly render below the rail.
let lastFeltHasHandRail: boolean | null = null;
// Pin the French guard to its opening-hand measurement. Opponents losing
// bones must not make the played layout expand, contract or recenter.
let lastFrenchGuardKey: string | null = null;
/**
 * The last MEASURED board stage a French cross was fitted against, keyed by
 * viewport width. French is deliberately kept out of the after-paint refit
 * (rebuilding its route every move was the old movement bug), and `cachedBox`
 * below refuses to serve a cross -- so without this the French bone was chosen
 * from feltBox()'s window GUESS and never once compared against the board it
 * actually had to fit. That is what let a 510x442 canvas be drawn into a
 * 464x439 stage and clip 98% of hands from the seventh bone.
 */
let lastFrenchFitWidth = 0;
let lastFrenchFitBox: { width: number; height: number } | null = null;
/** The hand (and viewport) `lastFrenchFitBox` was measured for. */
let lastFrenchFitKey: string | null = null;
let lastFrenchGuardInset: string | null = null;
/**
 * Mobile French: the player tabs the pinwheel was laid round, and the hand
 * they were measured for. Measured once per hand, never again mid-hand.
 */
let lastFrenchBlockedKey: string | null = null;
let lastFrenchBlocked: Array<{ x: number; y: number; w: number; h: number }> | null = null;
/**
 * Phone Lounge boards use Practice's fixed JamDom route (owner, 2026-09-15:
 * "the same closeness of domino and directions ... so they are steady and
 * stationary the same"). Chosen once per hand and viewport width from the
 * measured stage, exactly as main.ts does; height is not in the key because
 * Safari's bars slide in and out mid-hand.
 */
/**
 * Across keeps one board rectangle for the whole hand. Its two hands swap
 * which one is live (and so its height and turn cue) every turn, and
 * re-measuring the stage from them re-laid the whole board (desktop Lounge,
 * 2026-09-15). Measured once per hand and viewport width, then kept.
 */
let lastAcrossStageKey: string | null = null;
let lastAcrossStageInset: string | null = null;
let lastPhoneRouteKey: string | null = null;
let lastPhoneRoute: (PhoneRouteGrid & { unit: number; left: number; top: number }) | null = null;
let lastPhoneRouteFit: { box: { width: number; height: number }; blocked: StageRect[] } | null = null;
let lastPhoneRouteInset: string | null = null;
function phoneRouteGridOf(geo: PhoneRouteGrid): PhoneRouteGrid {
  return { cols: geo.cols, rows: geo.rows, origin: geo.origin, blocked: geo.blocked, climb: geo.climb, ...(geo.firstRowBones === undefined ? {} : { firstRowBones: geo.firstRowBones }) };
}
const PHONE_BOARD_MAX_UNIT = 20;
const PHONE_BOARD_MIN_UNIT = 8;

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

/**
 * The opening shuffle at a Lounge table (owner, 2026-09-16), phone and
 * desktop. A Lounge hand cannot wait for it — the clock and the duppies run on
 * the server — so it is the short version, and it ends early the moment the
 * first bone is down.
 */
let dealShownFor: string | null = null;
let dealUntil = 0;
/** Moves already down when the shuffle began; a newer one ends it early. */
let dealSeenMoves = 0;
const LOUNGE_DEAL_MS = 2600;

/** Who was watching at the last render, so an arrival can be noticed. */
let watcherIdsSeen: Set<string> | null = null;
let watcherNotice: { text: string; at: number } | null = null;
const WATCHER_NOTICE_MS = 6000;

// -------------------------------------------------------------------- you --
// Profile editing — including coin balance and the buy-coins button, both
// folded into profilePanel itself (profile.ts) — reachable without leaving
// a live hand. Previously only existed in the lounge, so a seated player
// had no way to check their balance or fix a typo'd name mid-game short of
// quitting the table. A rail tab, not a modal, so it doesn't run into the
// no-modal-during-a-live-hand rule.
let myProfileCache: MyProfile | null = null;
let myProfileLoading = false;

/**
 * The built profile form, kept between renders (owner, 2026-09-15: flicker).
 * It carries the avatar grid, accessories and backdrops — about fifty images —
 * and a live table rebuilt all of them every couple of seconds even with this
 * tab closed, which is most of the table's redraw cost. Anything the player
 * does inside it clears the cache first (see the wrapped rerender), so the
 * form still updates itself exactly as before.
 */
let youPanelNode: HTMLElement | null = null;
let youPanelFor: unknown = null;

function youPanel(rerender: () => void): HTMLElement {
  if (!myProfileCache && !myProfileLoading) {
    myProfileLoading = true;
    void myProfile().then((me) => { myProfileCache = me; myProfileLoading = false; rerender(); });
  }
  if (myProfileCache) {
    if (youPanelNode && youPanelFor === myProfileCache) return youPanelNode;
    const rebuild = () => { youPanelNode = null; youPanelFor = null; rerender(); };
    youPanelNode = profilePanel(myProfileCache, rebuild, (fresh) => { myProfileCache = fresh; youPanelNode = null; youPanelFor = null; });
    youPanelFor = myProfileCache;
    return youPanelNode;
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
/**
 * Portraits that survive a rebuild (owner, 2026-09-15: "the avatar keeps
 * flickering ... even when its not my turn"). A Realtime update rebuilds the
 * whole table — measured at 1,848 fresh <img> elements in thirty seconds —
 * and every new element re-decodes its image, which is the flicker. The same
 * node, kept per role and moved into the new tree, does not.
 */
const portraitCache = new Map<string, HTMLImageElement>();

function portrait(key: string, src: string, size: number, alt: string, className: string): HTMLImageElement {
  const cached = portraitCache.get(key);
  const img = cached ?? document.createElement('img');
  if (!cached) portraitCache.set(key, img);
  img.className = className;
  img.width = size;
  img.height = size;
  img.alt = alt;
  img.onerror = null;
  if (img.getAttribute('src') !== src) img.src = src;
  return img;
}

function tableSeatIdentity(s: SeatInfo, slot: SeatSlot, social?: TableSocial): HTMLElement {
  const identity = el('div', `table-seat-identity table-seat-identity-${slot}`);

  if (s.userId) {
    identity.setAttribute('aria-label', `Player ${s.seatIndex + 1}: ${seatName(s)}`);
    // A real uploaded photo first, then the chosen illustrated character. The
    // same fallback is used in the lounge and profile preview.
    const avatarShell = document.createElement('span');
    avatarShell.className = 'avatar-shell';
    const img = portrait(`seat:${slot}:${s.userId}`, photoUrl(s.userId), 32,
      s.avatar ? (AVATAR_LABEL[s.avatar as Avatar] ?? '') : '', 'avatar');
    img.onerror = () => {
      if (s.avatar) {
        img.onerror = null;
        img.src = avatarUrl(s.avatar as Avatar);
      } else {
        // A player who has not chosen a portrait still occupies a visible
        // physical seat. Falling back to the neutral local portrait keeps the
        // four-corner table intact instead of leaving an empty blue card.
        img.onerror = null;
        img.src = '/avatars/plain.webp';
      }
    };
    avatarShell.appendChild(img);
    if (s.avatarAccessory) {
      const accessory = portrait(`accessory:${slot}:${s.userId}`,
        avatarAccessoryUrl(s.avatarAccessory as AvatarAccessory), 22, '',
        `avatar-accessory avatar-accessory-${s.avatarAccessory}`);
      avatarShell.appendChild(accessory);
    }
    identity.appendChild(avatarShell);
    // VIP wears it at the table (owner, 2026-09-16), in the brand's gold.
    if (s.tier === 'vip') identity.appendChild(el('span', 'seat-vip', 'VIP'));
    decorateSeat(identity, s.userId, seatName(s), social);
  } else {
    // Duppies are fixed illustrated opponents, never a real profile. The
    // level and seat choose a stable face so a replay or coach view keeps the
    // same four-side table feeling without exposing a human-style presence.
    const level = (DUPPY_LEVELS.includes(s.duppyLevel as DuppyLevel)
      ? s.duppyLevel : 'pickney') as DuppyLevel;
    identity.setAttribute('aria-label', `Duppy ${s.seatIndex + 1}: ${DUPPY_LABELS[level]} AI opponent`);
    const duppy = el('span', 'table-seat-duppy');
    const face = portrait(`duppy:${slot}:${s.seatIndex}`,
      duppyPersonaUrl(duppyPersona(level, s.seatIndex)), 32, '', 'avatar');
    duppy.append(face, el('span', 'table-seat-duppy-cue', 'AI'));
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
  // The duppy's level is off the name now (see seatName) but still one hover
  // or screen reader away, which matters when a seat somebody walked out of
  // has been filled with a different level to the rest of the table.
  if (!s.userId) card.title = seatNameWithLevel(s);
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
    // Buy a bredrin a drink, at the table as well as in the lounge roster
    // (owner, 2026-09-16: "Gifts should be on there 2").
    card.appendChild(tableGiftButton(s.userId, rerender));
    card.appendChild(reportButton(s.userId, game.table.id, rerender));
  }
  return card;
}

/** The lounge's drink, offered at the table. One amount, the floor — see loungeview's own. */
let tableGiftBusy: string | null = null;
let tableGiftError: string | null = null;

function tableGiftButton(toUserId: string, rerender: () => void): HTMLElement {
  const wrap = el('div', 'seat-gift');
  const btn = document.createElement('button');
  btn.className = 'act ghost small';
  btn.dataset.gift = toUserId;
  btn.textContent = tableGiftBusy === toUserId ? 'Buying…' : `Buy a drink — ${MIN_GIFT_COINS} coins`;
  btn.disabled = tableGiftBusy !== null;
  btn.onclick = () => void (async () => {
    tableGiftBusy = toUserId;
    tableGiftError = null;
    rerender();
    try {
      await giftCoins(toUserId, MIN_GIFT_COINS);
    } catch (err) {
      tableGiftError = err instanceof Error ? err.message : 'could not buy that drink';
    } finally {
      tableGiftBusy = null;
      rerender();
    }
  })();
  wrap.appendChild(btn);
  if (tableGiftError && tableGiftBusy === null) wrap.append(el('div', 'muted small', tableGiftError));
  return wrap;
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
  rack.classList.toggle('table-rack-many', presentation.kind === 'hidden' && presentation.count >= 10);
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

  // Somebody came to watch (owner, 2026-09-16). Quiet and short-lived: a line
  // under the table name for a few seconds, never a modal — a live hand is
  // never interrupted (CLAUDE.md's settled rule).
  const watchingNow = new Set((social?.watching ?? [])
    .map((w) => w.user_id)
    .filter((id) => id !== game.viewerId && !game.seats.some((seat) => seat.userId === id)));
  if (watcherIdsSeen === null) {
    watcherIdsSeen = watchingNow;
  } else if (social?.watching) {
    const names = new Map((social.watching ?? []).map((w) => [w.user_id, w.username]));
    const arrived = [...watchingNow].filter((id) => !watcherIdsSeen!.has(id));
    const left = [...watcherIdsSeen].filter((id) => !watchingNow.has(id));
    if (arrived.length || left.length) {
      const who = (ids: string[]) => ids.map((id) => names.get(id) ?? 'somebody').join(', ');
      watcherNotice = arrived.length
        ? { text: `${who(arrived)} ${arrived.length > 1 ? 'came' : 'came'} to watch`, at: Date.now() }
        : { text: `${who(left)} stopped watching`, at: Date.now() };
      watcherIdsSeen = watchingNow;
      const mine = watcherNotice;
      setTimeout(() => { if (watcherNotice === mine) { watcherNotice = null; rerender(); } }, WATCHER_NOTICE_MS);
    }
  }

  const head = el('div', 'panel live-table-head');
  // Which game this is, beside the lounge name (owner, 2026-09-16: "where it
  // says Yard Gate, can it say if its cut throat"). French is a format, not a
  // mode, so it is named on its own.
  const gameName = game.table.format === 'french'
    ? 'French'
    : game.table.mode === 'partner' ? 'Partner'
      : game.table.mode === 'openhand' ? 'Open hand'
        : game.table.mode === 'across' ? 'Across'
          : 'Cut throat';
  head.append(el('div', 'eyebrow',
    social?.loungeName ? `${social.loungeName} · ${gameName}` : gameName));
  if (watcherNotice && Date.now() - watcherNotice.at < WATCHER_NOTICE_MS) {
    const notice = el('div', 'watcher-notice', watcherNotice.text);
    notice.setAttribute('role', 'status');
    head.appendChild(notice);
  }
  const top = el('div', 'spread');
  top.append(el('h2', undefined, `Table ${game.table.joinCode}`));
  const sfxOff = sfx.muted();
  const sound = document.createElement('button');
  sound.className = 'act ghost small';
  sound.textContent = sfxOff ? 'Sound off' : 'Sound on';
  sound.setAttribute('aria-pressed', String(!sfxOff));
  sound.onclick = () => { sfx.setMuted(!sfxOff); rerender(); };
  top.appendChild(sound);
  // The table's colour, the same choice Practice has (owner, 2026-09-15: "can
  // the choice to change color be in lounge as well"). One saved setting for
  // the whole app, so a colour picked here is the colour Practice opens with.
  const colour = el('div', 'felt-pick');
  colour.setAttribute('role', 'group');
  colour.setAttribute('aria-label', 'Table colour');
  for (const f of FELTS) {
    const b = document.createElement('button');
    b.dataset.felt = f.id;
    b.title = f.label;
    b.setAttribute('aria-label', f.label);
    b.setAttribute('aria-pressed', String(f.id === chosenFelt()));
    b.onclick = () => { setFelt(f.id); rerender(); };
    colour.appendChild(b);
  }
  top.appendChild(colour);
  const leave = document.createElement('button');
  leave.className = 'act ghost';
  leave.textContent = 'Leave table';
  leave.onclick = () => confirmTableExit('You will leave your seat and return to the lounge. Play follows this table’s rules while you are away.', async () => {
    await game.leaveSeat(); onLeave();
  });
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

  // The status strip is the safe home for the turn clock: it is above the
  // felt, outside every portrait/rack and never competes with either hand.
  // Keep the clock as a sibling of the score tracks so it cannot float over
  // the board as the chain grows.
  const scoreWrap = el('div', 'panel sticky-scores table-status-strip');
  const board = el('div', 'scoreboard');
  // French is race-to-100 (lower wins) and always cutthroat — createSet()
  // enforces both — so this only ever widens the `else` branch below, but
  // the max belongs on both for the same reason main.ts's local scoreboard
  // already carries it: without it scoreTrack() defaults to 6 and every
  // French score renders against the wrong scale, hiding exactly the "how
  // much do I need to lose" number this table is actually played around.
  const trackOpts = {
    bruk: game.lastResultBruk,
    max: game.table.format === 'french' ? 100 : 6,
    french: game.table.format === 'french',
  };
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
  if (game.hand?.status === 'active' && game.hand.turn_expires_at) {
    const clock = countdown(game, game.hand.turn_expires_at);
    clock.classList.add('turn-clock-top');
    scoreWrap.appendChild(clock);
  }
  frag.appendChild(scoreWrap);

  const cross = el('div', 'table-cross');

  // predictedBoard, when set, is play()'s optimistic guess at my own
  // just-tapped tile landing — see predict.ts. Preferred over the last
  // confirmed board until the real state arrives and clears it.
  const displayBoard = game.predictedBoard ?? game.hand?.board ?? null;
  // Always the log that matches the board being drawn (see predictedMoveLog).
  const displayMoveLog = game.predictedBoard ? (game.predictedMoveLog ?? game.hand?.move_log) : game.hand?.move_log;
  if (!game.isSpectator && game.mySeat !== null) {
    assertVisibleTilesDisjoint(displayBoard, game.predictedTilesFor(game.mySeat) ?? game.myTiles);
  }

  const feltSlot = el('div', 'felt-slot');
  // Across renders both controlled hands on the wood. Keep the board's fitted
  // physical scale on their common host so those hands cannot silently fall
  // back to the generic hand size.
  feltSlot.classList.add('shared-table-hand-scale');
  const feltShell = el('div', 'felt-shell');
  feltShell.classList.add(`seat-count-${game.table.seatCount}`);
  const felt = el('div', 'table-felt live-felt');
  // Keep controlled hands at their physical edges of the table. Across owns
  // the bottom and opposite seats, so both readable hands live on the felt.
  // Across follows the Open Hand composition: one full-size playable hand
  // docks at the player's edge, while the other hand is shown in the normal
  // companion panel. Across changes who may play, not where the furniture
  // moves when the turn changes.
  const handOnFelt = !game.isSpectator && !!game.hand;
  // Spectators still need the same invisible protected rectangle; no hand is
  // allowed to let a chain cross the corner portraits or side racks.
  const boardStage = el('div', 'board-stage');
  if (handOnFelt) felt.classList.add('hand-on-felt');
  if (handOnFelt && game.myTiles.length >= 10) felt.classList.add('hand-many');
  // A French cross grows in four directions. Its mobile felt gets a little
  // more vertical room so late arms remain above—not underneath—the hand.
  if (handOnFelt && displayBoard?.kind === 'cross') felt.classList.add('french-cross-live');
  // The played board survives a rebuild too, for the same reason as the
  // portraits: a fresh .line means renderBoard redraws every bone that is
  // already down, which the owner sees as the middle of the table flickering.
  // Reused, its data-phone-route still matches and nothing is redrawn.
  const lineHandKey = game.hand?.hand_id ?? 'undealt';
  const line = lastLineNode && lastLineHandKey === lineHandKey ? lastLineNode : el('div', 'line');
  lastLineNode = line;
  lastLineHandKey = lineHandKey;
  line.classList.toggle('awaiting-deal', !game.hand);
  // First pass: the cached real box once we have one (near-instant, no
  // flash), or feltBox()'s window-based guess before the felt has ever been
  // measured.
  const cachedBox = lastFeltHasHandRail === handOnFelt && displayBoard?.kind !== 'cross'
    ? lastFeltBox : null;
  // A cross still may not use lastFeltBox (that is a LINE's box), but it may
  // use the French stage measured at this exact viewport. With it, the very
  // first pass already fits; without it the first hand at a new size renders
  // once from the guess and is corrected below.
  const crossBox = displayBoard?.kind === 'cross' && lastFrenchFitWidth === window.innerWidth
    ? lastFrenchFitBox : null;
  const frenchTable = game.table.format === 'french';
  // Desktop French: the JamDom pinwheel over the whole felt, steering round
  // the corner cards, side racks and the hand, as Practice does (owner,
  // 2026-09-15: "a lot of space in the desktop for french").
  const frenchDeskPinwheel = frenchTable && window.innerWidth > 700;
  const FRENCH_DESK_BLOCKERS = '.table-seat-identity, .table-rack, .in-felt-hand, .desktop-self-identity';
  if (frenchDeskPinwheel) boardStage.classList.add('french-desk-stage');
  // Mobile French takes the whole felt; its players are tabs at the rim.
  // Every phone table runs the felt edge to edge (owner, 2026-09-16: "i want
  // all the tables for mobile to fill out the width like the french game
  // table ... so the dominoes can show bigger"). Width only: the route, the
  // direction of play and everything else are untouched — the board simply
  // measures a wider stage and picks a bigger bone.
  if (window.innerWidth <= 700) feltShell.classList.add('phone-wide-shell');
  if (frenchTable && frenchPinwheelPhone()) {
    boardStage.classList.add('french-phone-stage');
    // The Lounge's own padding and rim left the phone board 316-340px wide,
    // 22 columns, so it fell back to the row route (five bones across).
    // Edge to edge like Practice, it gets the pinwheel's seven (owner,
    // 2026-09-15).
    feltShell.classList.add('french-phone-shell');
  }
  /**
   * The Lounge's stage guard measures its own rim and wrote an inset that
   * reached 8px past an edge-to-edge French felt, making the PAGE wider than
   * the phone (390px screen, 402px page). That inset is also pinned and
   * restored every render, so the board is held inside the felt wherever it
   * is applied, not only where it is first measured.
   */
  const holdFrenchPhoneStage = () => {
    if (!frenchTable || !frenchPinwheelPhone()) return;
    // An 8px gap from the screen edge: no bone touches the side.
    boardStage.style.left = '8px';
    boardStage.style.right = '8px';
  };
  // Cut throat, partner and open hand on a phone: Practice's fixed board.
  // Every width since 2026-09-15, at the desktop bone size on desktop. Across
  // too: its own rules decide who plays, not where bones go, and its old
  // growing line shifted every bone when one went on the left end.
  const phoneFixedRoute = !frenchTable;
  const phoneRouteKey = phoneFixedRoute ? `${game.hand?.hand_id ?? 'undealt'}:${window.innerWidth}` : null;
  const lockedPhoneRoute = phoneRouteKey !== null && phoneRouteKey === lastPhoneRouteKey ? lastPhoneRoute : null;
  const phoneRouteLabel = (geo: { unit: number; cols: number; rows: number; climb: number; firstRowBones?: number }) => `${geo.unit}:${geo.cols}x${geo.rows}:${geo.climb}${geo.firstRowBones ? `:r${geo.firstRowBones}` : ''}`;
  // Pinned at one offset for the whole hand; flex-centring let a 1px change
  // in the tray nudge every played bone.
  const pinPhoneRoute = (geo: { left: number; top: number }) => {
    line.style.position = 'absolute';
    line.style.left = `${geo.left}px`;
    line.style.top = `${geo.top}px`;
    line.style.margin = '0';
  };
  if (phoneFixedRoute) {
    felt.classList.add('phone-route-table');
    boardStage.classList.add('phone-route-stage');
    const measuredHere = lastPhoneRoute && lastPhoneRouteKey?.endsWith(`:${window.innerWidth}`);
    feltSlot.style.setProperty('--hand-bone-short', `${(measuredHere ? lastPhoneRoute!.unit : 13) * 2}px`);
  }
  const frenchGuardKey = frenchTable && handOnFelt
    ? `${game.hand?.hand_id ?? 'undealt'}:${window.innerWidth}`
    : null;
  if (!frenchDeskPinwheel && frenchGuardKey === lastFrenchGuardKey && lastFrenchGuardInset) {
    boardStage.style.inset = lastFrenchGuardInset;
    holdFrenchPhoneStage();
    boardStage.dataset.boardGuard = 'pinned-hand-square';
  }
  const acrossStageKey = game.table.mode === 'across' && game.hand
    ? `${game.hand.hand_id}:${window.innerWidth}` : null;
  if (acrossStageKey !== null && acrossStageKey === lastAcrossStageKey && lastAcrossStageInset) {
    boardStage.style.inset = lastAcrossStageInset;
  }
  const tableCapUnit = liveTableUnit(window.innerWidth, null, frenchTable, window.innerHeight);
  const tableMinUnit = window.innerWidth <= 700 ? 10 : game.table.mode === 'across' ? 22 : 11;
  // First solve the physical bone. Across's route width is calculated only
  // after that, from this exact unit; using the smaller readability floor here
  // made tall desktops request a line wider than their protected stage.
  const openingLinearGeometry = frenchTable ? null : liveLinearGeometry(
    window.innerWidth, cachedBox, tableMinUnit, 32);
  const tableUnit = openingLinearGeometry?.unit
    ?? liveTableUnit(window.innerWidth, displayBoard, frenchTable, window.innerHeight);
  const acrossLaneUnitsFor = (box?: { width: number } | null) => game.table.mode === 'across'
    ? liveAcrossRouteUnits(box, tableUnit)
    : 32;
  // Match Practice: phone keeps its readable tier and deliberate pan. Desktop
  // locks a measured complete-hand route before the pose so the physical bone
  // never changes size and the board never gains a scrollbar mid-hand.
  const tableMaxUnits = frenchTable ? undefined
    : game.table.mode === 'across' ? acrossLaneUnitsFor(cachedBox)
      : (openingLinearGeometry?.maxUnits ?? (window.innerWidth <= 700 ? 20 : 32));
  feltShell.style.setProperty('--table-bone-cap-short', `${tableCapUnit * 2}px`);
  // Begin the whole physical set at the readable deal-size tier. The fitted
  // unit below updates board, visible hand and perimeter racks together.
  feltShell.style.setProperty('--table-bone-short', `${tableCapUnit * 2}px`);
  feltSlot.style.setProperty('--table-bone-short', `${tableCapUnit * 2}px`);
  // .table-felt declares a desktop fallback of its own, so set the live value
  // on the felt as well; otherwise Lounge hands stay at 42px on a 390px phone
  // while the surrounding racks correctly use 28px.
  felt.style.setProperty('--table-bone-short', `${tableCapUnit * 2}px`);
  const fittedUnit = renderBoard(line, displayBoard, {
    ...(crossBox ? { box: crossBox } : cachedBox ? { box: cachedBox } : {}),
    maxUnit: tableUnit,
    // PIN, not a ceiling — and for every mode, not only French. Passing just
    // maxUnit let chooseUnit search downward from it until the whole chain
    // fitted the stage, which is precisely the shrinking a JamDom player
    // notices. French already pinned; the linear game is the same physical
    // table and gets the same treatment.
    unit: tableUnit,
    minUnit: tableMinUnit,
    maxUnits: tableMaxUnits,
    ...(lockedPhoneRoute ? {
      unit: lockedPhoneRoute.unit,
      maxUnit: lockedPhoneRoute.unit,
      phoneRoute: phoneRouteGridOf(lockedPhoneRoute),
      moveLog: displayMoveLog,
    } : {}),
    across: game.table.mode === 'across',
    // Landscape shrinks the rigid French canvas to fit; a phone keeps its
    // readable bone and pans instead. See BoardFit.fitCrossToBox.
    fitCrossToBox: window.innerWidth > 700,
    // Mobile French lays its pinwheel in play order.
    moveLog: displayMoveLog,
    ...(frenchTable && frenchGuardKey !== null
      && frenchGuardKey === lastFrenchBlockedKey && lastFrenchBlocked
      ? { phoneCrossBlocked: lastFrenchBlocked } : {}),
    frenchPinwheel: frenchDeskPinwheel,
    // A French arm runs towards the seat that opened it -- relative to me. A
    // spectator has no seat, so their arms keep the stored fill order.
    ...(game.mySeat === null ? {} : { viewerSeat: game.mySeat }),
  });
  // The played chain, visible hand and concealed racks are one physical set.
  // Keep all three on the renderer's actual fitted size, especially when a
  // four-arm French board is denser than its opening-size ceiling.
  if (fittedUnit) {
    felt.style.setProperty('--table-bone-short', `${fittedUnit * 2}px`);
    feltShell.style.setProperty('--table-bone-short', `${fittedUnit * 2}px`);
    feltSlot.style.setProperty('--table-bone-short', `${fittedUnit * 2}px`);
  }
  // Every Realtime update rebuilds the line. A locked board must be pinned
  // at its offset on this render too, not only when the refit draws it, or
  // the whole board jumps to the top of the table after each move (owner's
  // 390px cut throat recording, 2026-09-15). Practice does the same.
  if (lockedPhoneRoute && displayBoard) {
    line.dataset.phoneRoute = phoneRouteLabel(lockedPhoneRoute);
    pinPhoneRoute(lockedPhoneRoute);
  }
  tagWinningTile(line, felt, game);
  boardStage.appendChild(line);
  felt.appendChild(boardStage);
  feltShell.appendChild(felt);
  // Put each unplayed hand where that person is physically sitting. These
  // visual counters straddle the outer rim rather than consuming playable
  // felt. They are siblings of the scrolling felt so they cannot be clipped
  // or crossed by a long line of played bones.
  const tableIdentities = new Map<SeatSlot, HTMLElement>();
  const tableStations = new Map<SeatSlot, HTMLElement>();
  for (const s of game.seats) {
    const slot = seatPosition(s.seatIndex, game.mySeat, game.table.seatCount);
    if (!slot) continue;
    const rack = tableRack(s, game, slot);
    // Identity stays at the physical table edge even for the local player,
    // whose playable hand deliberately has no duplicate rack.
    const identity = tableSeatIdentity(s, slot, social);
    // The local player's hand occupies the lower felt rail. Put that one
    // portrait in the rail header once it exists, never on top of a playable
    // bone. The other three remain beside their physical racks.
    if (handOnFelt && slot === 'bottom') {
      tableIdentities.set(slot, identity);
    } else if (rack) {
      const count = game.hand?.hand_sizes[s.seatIndex] ?? 0;
      const scoreIndex = isPartnered(game.table.mode)
        ? sideOf(s.seatIndex, game.table.mode) : s.seatIndex;
      const score = game.scores[scoreIndex] ?? 0;
      const copy = el('span', 'table-seat-copy');
      copy.append(
        el('strong', undefined, seatName(s)),
        el('small', undefined, `${count} bone${count === 1 ? '' : 's'} · ${score} pt${score === 1 ? '' : 's'}`),
      );
      identity.appendChild(copy);
      const station = el('div', `table-player-station table-player-station-${slot}`);
      station.append(identity, rack);
      stationTurnCue(station, game.hand?.status === 'active' && game.hand.turn === s.seatIndex);
      // Mobile French gives the pinwheel the felt: players become tabs.
      // Only where the pinwheel runs; a narrower phone keeps its full badges.
      if (frenchTable && frenchPinwheelPhone()) {
        frenchPhoneTab(station, slot, count);
      }
      feltShell.appendChild(station);
      tableStations.set(slot, station);
    } else {
      if (game.table.mode === 'across' && (slot === 'top' || slot === 'bottom')) {
        const count = game.hand?.hand_sizes[s.seatIndex] ?? 0;
        const scoreIndex = sideOf(s.seatIndex, game.table.mode);
        const score = game.scores[scoreIndex] ?? 0;
        const copy = el('span', 'table-seat-copy');
        copy.append(
          el('strong', undefined, slot === 'bottom' ? 'You' : 'Your partner seat'),
          el('small', undefined, `${count} bone${count === 1 ? '' : 's'} · ${score} pt${score === 1 ? '' : 's'}`),
        );
        identity.appendChild(copy);
        identity.classList.add('across-controlled-identity');
        identity.classList.toggle('turn', game.hand?.status === 'active' && game.hand.turn === s.seatIndex);
      }
      feltShell.appendChild(identity);
    }
  }
  const lastMove = game.hand?.move_log.at(-1);
  const lastMoveSlot = lastMove
    ? seatPosition(lastMove.seat, game.mySeat, game.table.seatCount)
    : null;
  const calloutHost = lastMoveSlot
    ? tableStations.get(lastMoveSlot)?.querySelector<HTMLElement>('.table-seat-copy')
    : null;
  const lastPass = passCallout(game);
  if (lastPass) (calloutHost ?? feltShell).appendChild(lastPass);
  const lastPlay = playCallout(game);
  if (lastPlay) (calloutHost ?? feltShell).appendChild(lastPlay);
  // An undealt table is still a game surface, not a form page. Keep the
  // only action needed to begin the game directly on the felt so nobody has
  // to scroll away from the board to find it.
  if (!game.hand) felt.appendChild(startHandPanel(game));
  const gameOver = onlineGameOverCard(game, rerender);
  if (gameOver) felt.appendChild(gameOver);
  feltSlot.appendChild(feltShell);
  // The felt isn't attached to the document yet at this point in the build,
  // so getBoundingClientRect() would read all zeros here — wait a frame for
  // real layout, then correct the cache and re-render ONLY if the real box
  // has actually moved (a resize) — not on every render. A Realtime update
  // fires this on every opponent move, and re-measuring plus fully
  // rebuilding the board on each one is the flash this guards against.
  const refitMeasuredBoard = () => {
    if (!boardStage.isConnected) return;
    // The stage box removes the line's 14px padding plus 4px for grid/border
    // rounding. Without that allowance a dense row could cross the invisible
    // guard by one pixel and be clipped.
    const fitHost = boardStage;
    const phoneStageLocked = phoneFixedRoute && !!displayBoard
      && phoneRouteKey === lastPhoneRouteKey && lastPhoneRouteInset !== null;
    if (phoneStageLocked) {
      boardStage.style.inset = lastPhoneRouteInset!;
    } else if (!frenchDeskPinwheel && frenchGuardKey === lastFrenchGuardKey && lastFrenchGuardInset) {
      boardStage.style.inset = lastFrenchGuardInset;
      holdFrenchPhoneStage();
      boardStage.dataset.boardGuard = 'pinned-hand-square';
    } else if (frenchDeskPinwheel) {
      // The whole felt; the pinwheel keeps clear of people itself.
    } else if (acrossStageKey !== null && acrossStageKey === lastAcrossStageKey && lastAcrossStageInset) {
      boardStage.style.inset = lastAcrossStageInset;
    } else {
      // Square the guard for French only. A linear chain snakes in rows and
      // keeps the full rectangle — squaring it cost ~155px of height on a
      // phone and made every board past 20 bones overflow.
      // NOTHING is squared any more, French included.
      //
      // Squaring was meant to give a four-arm cross equal clearance every way.
      // But the French board is a FIXED 450x390 canvas -- a rectangle, 1.15:1
      // -- so its own shape already guarantees that, and squaring the stage to
      // hold it just discards whichever dimension is not binding. On a phone
      // that cost height (360x780 lost 135px, holding the cross to six bones
      // on a felt with room for nine). On desktop it cost width, catastrophi-
      // cally: measured in a real 1920x1080 Lounge, a 1728px felt was inset
      // 609px on EACH side to make a square, leaving the board 490px of 1708
      // and forcing a 30px bone on a table with room for 48px. That is the
      // "where is the space on desktop" the owner reported.
      // Mobile French routes round its players' tabs instead of keeping the
      // whole side of the table clear (phoneFrenchPinwheel's `blocked`).
      // The fixed phone board routes round the players itself, like French.
      reserveBoardStage(felt, boardStage,
        (window.innerWidth <= 700 && frenchTable) || phoneFixedRoute ? [] : tableStations.values(),
        felt.querySelector<HTMLElement>('.in-felt-hand'), false);
      // A French phone too narrow for the pinwheel (a 360px screen) keeps the
      // row route, which does not know about the tabs: keep them off its width.
      if (frenchTable && window.innerWidth <= 700 && !frenchPinwheelPhone()) {
        reserveBoardStage(felt, boardStage, tableStations.values(),
          felt.querySelector<HTMLElement>('.in-felt-hand'), false);
      }
      // The guard measures the Lounge's own rim and writes an inline inset
      // that reached past the felt on a phone, making the PAGE wider than the
      // screen (390px viewport, 402px page). The edge-to-edge French felt is
      // already the whole screen: hold the board inside it.
      holdFrenchPhoneStage();
      if (frenchGuardKey && boardStage.style.inset) {
        lastFrenchGuardKey = frenchGuardKey;
        lastFrenchGuardInset = boardStage.style.inset;
      }
      if (acrossStageKey && boardStage.style.inset) {
        lastAcrossStageKey = acrossStageKey;
        lastAcrossStageInset = boardStage.style.inset;
      }
    }
    // A fixed board locked for this hand and already drawn at its grid with
    // every bone placed: nothing below changes it, and each size read forced a
    // full layout of the freshly rebuilt table (Android smoothness, 2026-09-15).
    if (phoneStageLocked && lastPhoneRoute && displayBoard?.kind !== 'cross'
      && line.dataset.phoneRoute === phoneRouteLabel(lastPhoneRoute)
      && (!line.dataset.phoneRouteOverflow || line.dataset.phoneRouteOverflow === '0')) {
      return;
    }
    const box = { width: fitHost.clientWidth - 18, height: fitHost.clientHeight - 18 };
    if (box.width <= 0 || box.height <= 0) return;
    const changed = lastFeltHasHandRail !== handOnFelt
      || !lastFeltBox || lastFeltBox.width !== box.width || lastFeltBox.height !== box.height;
    // A move can add a cross-board row while the table rectangle stays
    // unchanged. Refit that newly overflowed grid against the measured guard
    // in Lounge exactly as Practice does.
    const boardOverflowedGuard = line.scrollWidth > fitHost.clientWidth
      || line.scrollHeight > fitHost.clientHeight;
    lastFeltBox = box;
    lastFeltHasHandRail = handOnFelt;
    if (phoneFixedRoute && displayBoard?.kind !== 'cross') {
      const routeMaxUnit = window.innerWidth <= 700 ? PHONE_BOARD_MAX_UNIT : tableUnit;
      // Desktop may step down to any readable bone rather than lay one past the
      // wood (Across stopped at 22px and hid 6/1 under the table edge).
      const routeMinUnit = window.innerWidth <= 700 ? PHONE_BOARD_MIN_UNIT : DESK_ROUTE_MIN_UNIT;
      // Desktop turns its centre row after three bones each side, like the phone.
      const routeFirstRow = window.innerWidth <= 700 ? undefined : DESK_FIRST_ROW_BONES;
      // Same as Practice: keep measuring until the pose is down, then the
      // grid and bone are fixed for the hand.
      if (!displayBoard || phoneRouteKey !== lastPhoneRouteKey || !lastPhoneRoute) {
        // Desktop: the board takes the whole felt and flows round the people
        // and hands on it (owner, 2026-09-15: "domino should play until it
        // fills the board"), exactly as the phone board does.
        if (window.innerWidth > 700) boardStage.style.inset = DESK_ROUTE_STAGE_INSET;
        const stageBox = { width: fitHost.clientWidth, height: fitHost.clientHeight };
        const stageRect = fitHost.getBoundingClientRect();
        const originX = stageRect.left + fitHost.clientLeft;
        const originY = stageRect.top + fitHost.clientTop;
        // Desktop stations are display: contents; their corner cards and side
        // racks are the real boxes the route must keep clear of.
        const blockers: HTMLElement[] = window.innerWidth <= 700
          ? [...tableStations.values()]
          : [...feltShell.querySelectorAll<HTMLElement>('.table-seat-identity, .table-rack, .desktop-self-identity, .across-hand-own, .across-hand-partner, .in-felt-hand, .in-felt-actions, .hand-side-info')];
        const blocked = blockers.map((station) => {
          const r = station.getBoundingClientRect();
          return { left: r.left - originX, top: r.top - originY, right: r.right - originX, bottom: r.bottom - originY };
        }).filter((r) => r.right > 0 && r.bottom > 0 && r.left < stageBox.width && r.top < stageBox.height);
        lastPhoneRouteFit = { box: stageBox, blocked };
        // Desktop keeps its bone (owner). The centre-row rule is used when a
        // full hand fits with it at that bone; otherwise the ordinary rows.
        const deskTrim = window.innerWidth > 700;
        // Phones: the ordinary rows at their own bone. Desktop: the centre-row
        // S at the biggest bone every hand fits (deskRouteGeometry).
        // Across climbs three dominoes between rows; every other game two.
        const layoutClimb = game.table.mode === 'across' ? ACROSS_CLIMB : undefined;
        const plainRoute = deskTrim
          ? deskRouteGeometry(stageBox, blocked, routeMinUnit, undefined, layoutClimb)
          : phonePracticeGeometry(stageBox, routeMaxUnit, routeMinUnit, blocked, undefined, false, undefined, undefined, layoutClimb);
        const withRule = routeFirstRow === undefined ? null : plainRoute;
        const ruleFits = !!withRule && phoneRouteGeometryFits(withRule);
        lastPhoneRoute = plainRoute;
        // QA hook: which layout the hand chose, and the space it was measured in.
        boardStage.dataset.routeRule = withRule ? (ruleFits ? 'on' : 'off') : 'none';
        boardStage.dataset.routeRuleBox = `${stageBox.width}x${stageBox.height}:u${plainRoute.unit}:b${blocked.length}`;
        lastPhoneRouteKey = phoneRouteKey;
        lastPhoneRouteInset = boardStage.style.inset || null;
      } else if (line.dataset.phoneRouteOverflow && line.dataset.phoneRouteOverflow !== '0'
        && lastPhoneRouteFit && lastPhoneRoute.unit > routeMinUnit) {
        const relayClimb = game.table.mode === 'across' ? ACROSS_CLIMB : undefined;
        lastPhoneRoute = window.innerWidth > 700
          ? deskRouteGeometry(lastPhoneRouteFit.box, lastPhoneRouteFit.blocked, routeMinUnit, lastPhoneRoute.unit - 1, relayClimb)
          : phonePracticeGeometry(lastPhoneRouteFit.box, lastPhoneRoute.unit - 1, routeMinUnit, lastPhoneRouteFit.blocked, undefined, false, undefined, undefined, relayClimb);
      }
      const geo = lastPhoneRoute;
      feltSlot.style.setProperty('--hand-bone-short', `${geo.unit * 2}px`);
      if (displayBoard && line.dataset.phoneRoute !== phoneRouteLabel(geo)) {
        const drawn = renderBoard(line, displayBoard, {
          unit: geo.unit, maxUnit: geo.unit, minUnit: geo.unit,
          moveLog: displayMoveLog,
          phoneRoute: phoneRouteGridOf(geo),
          ...(game.mySeat === null ? {} : { viewerSeat: game.mySeat }),
        });
        line.dataset.phoneRoute = phoneRouteLabel(geo);
        pinPhoneRoute(geo);
        if (drawn) {
          felt.style.setProperty('--table-bone-short', `${drawn * 2}px`);
          feltShell.style.setProperty('--table-bone-short', `${drawn * 2}px`);
          feltSlot.style.setProperty('--table-bone-short', `${drawn * 2}px`);
        }
        tagWinningTile(line, felt, game);
      }
      boardStage.scrollTop = 0;
      boardStage.scrollLeft = 0;
      return;
    }
    // French uses the same fixed route and opening guard for every move. A
    // second render here caused Lounge to visibly jump after Realtime updates.
    if (frenchTable) {
      // Record the real stage so every later French render at this viewport
      // starts already fitted, then correct THIS render if the guess was wrong.
      // Guarded on a genuine difference, so the steady state is no rebuild at
      // all -- render() fires every ~420ms during duppy turns and an
      // unconditional rebuild here is exactly the flash this whole block
      // exists to prevent.
      // Measure once per hand, then keep it. Once a long arm makes the stage
      // pan, a scrollbar can narrow clientWidth, and re-measuring then
      // re-routed every bone already played mid-hand (360px phone,
      // 2026-09-13). The key already carries the viewport width, so a real
      // resize still measures again.
      if (!frenchGuardKey || frenchGuardKey !== lastFrenchFitKey
        || lastFrenchFitWidth !== window.innerWidth || !lastFrenchFitBox) {
        lastFrenchFitWidth = window.innerWidth;
        // A phone French board has no line padding, so it fits the stage's
        // whole inner box. Keeping the linear line's 18px cost a 375px phone
        // two columns, which is what kept it off the pinwheel. Bones keep
        // their size; only the columns they fit across change.
        lastFrenchFitBox = window.innerWidth <= 700 || frenchDeskPinwheel
          ? { width: fitHost.clientWidth, height: fitHost.clientHeight }
          : box;
        lastFrenchFitKey = frenchGuardKey;
      }
      const lockedBox = lastFrenchFitBox ?? box;
      // A cross reads outward from its centre, so when it is bigger than the
      // stage the pose must stay in the middle rather than being start-aligned
      // into a corner with an arm off-screen.
      centreCrossOnPose(boardStage, line);
      const want = window.innerWidth > 700 && !frenchDeskPinwheel
        ? Math.min(tableUnit, frenchCanvasUnit(lockedBox))
        : tableUnit;
      // A phone routes inside its measured width, so a first pass drawn from
      // the window guess must be redrawn once the real stage is known.
      const phoneGridStale = (window.innerWidth <= 700 || frenchDeskPinwheel)
        && line.dataset.crossGrid !== phoneCrossGridKey(lockedBox, tableUnit);
      if (fittedUnit && (want !== fittedUnit || phoneGridStale)) {
        const corrected = renderBoard(line, displayBoard, {
          box: lockedBox,
          maxUnit: tableUnit,
          unit: tableUnit,
          minUnit: tableMinUnit,
          maxUnits: tableMaxUnits,
          fitCrossToBox: window.innerWidth > 700,
          frenchPinwheel: frenchDeskPinwheel,
          ...(frenchGuardKey === lastFrenchBlockedKey && lastFrenchBlocked ? { phoneCrossBlocked: lastFrenchBlocked } : {}),
          // Mobile French lays its pinwheel in play order.
          moveLog: displayMoveLog,
          ...(game.mySeat === null ? {} : { viewerSeat: game.mySeat }),
        });
        if (corrected) {
          felt.style.setProperty('--table-bone-short', `${corrected * 2}px`);
          feltShell.style.setProperty('--table-bone-short', `${corrected * 2}px`);
          feltSlot.style.setProperty('--table-bone-short', `${corrected * 2}px`);
        }
      }
      // Mobile French routes round the players' tabs. Measure them against
      // where the grid sits in the stage on this hand's first measured render
      // (usually before any arm bone), lay the board round them, and keep that
      // for the whole hand.
      if ((window.innerWidth <= 700 || frenchDeskPinwheel) && frenchGuardKey && frenchGuardKey !== lastFrenchBlockedKey) {
        lastFrenchBlockedKey = frenchGuardKey;
        lastFrenchBlocked = frenchTabBlocks(boardStage, feltShell, lockedBox, tableUnit,
          frenchDeskPinwheel ? FRENCH_DESK_BLOCKERS : '.station-tab');
        renderBoard(line, displayBoard, {
          box: lockedBox,
          maxUnit: tableUnit,
          unit: tableUnit,
          minUnit: tableMinUnit,
          maxUnits: tableMaxUnits,
          fitCrossToBox: false,
          frenchPinwheel: frenchDeskPinwheel,
          moveLog: displayMoveLog,
          ...(game.mySeat === null ? {} : { viewerSeat: game.mySeat }),
          phoneCrossBlocked: lastFrenchBlocked,
        });
      }
      return;
    }
    if (changed || boardOverflowedGuard) {
      const measuredGeometry = liveLinearGeometry(
        window.innerWidth, box, tableMinUnit, acrossLaneUnitsFor(box));
      const measuredUnit = renderBoard(line, displayBoard, {
        box,
        maxUnit: game.table.mode === 'across' ? tableUnit : measuredGeometry.unit,
        // Pinned, same as the first render and same as Practice — see the note
        // there. A ceiling here let the measured refit undo the pin.
        unit: game.table.mode === 'across' ? tableUnit : measuredGeometry.unit,
        minUnit: tableMinUnit,
        maxUnits: measuredGeometry.maxUnits,
        across: game.table.mode === 'across',
        ...(game.mySeat === null ? {} : { viewerSeat: game.mySeat }),
      });
      if (measuredUnit) {
        felt.style.setProperty('--table-bone-short', `${measuredUnit * 2}px`);
        feltShell.style.setProperty('--table-bone-short', `${measuredUnit * 2}px`);
        feltSlot.style.setProperty('--table-bone-short', `${measuredUnit * 2}px`);
      }
      tagWinningTile(line, felt, game);
    }
    // Same as Practice: with the bone fixed, a phone board pans, so whatever
    // just landed must be scrolled to rather than left below the fold.
    const lastMove = game.hand?.move_log[game.hand.move_log.length - 1];
    const lastTile = lastMove && 'tile' in lastMove ? lastMove.tile : null;
    // Any board that pans must show it, not only a French cross.
    markPannable(boardStage);
    keepTileInView(boardStage,
      lastTile ? line.querySelector(`[data-tile="${lastTile}"]`) : null);
  };
  {
    const hand = game.hand;
    const played = hand?.move_log?.length ?? 0;
    // A forced opening (the double-six) can already be down by the first
    // picture of a hand, so "new" means at most the pose.
    const fresh = !!hand && hand.status === 'active' && played <= 1;
    if (fresh && hand && dealShownFor !== hand.hand_id) {
      dealShownFor = hand.hand_id;
      dealSeenMoves = played;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      dealUntil = Date.now() + (reduced ? 260 : LOUNGE_DEAL_MS);
      game.holdDuppiesUntil(dealUntil);
      setTimeout(() => rerender(), (reduced ? 260 : LOUNGE_DEAL_MS) + 30);
    }
    if (hand && dealShownFor === hand.hand_id && played <= dealSeenMoves && Date.now() < dealUntil) {
      felt.classList.add('practice-dealing');
      felt.appendChild(dealOverlay(() => { dealUntil = 0; game.holdDuppiesUntil(0); rerender(); }, true));
    }
  }
  requestAnimationFrame(() => requestAnimationFrame(refitMeasuredBoard));
  // Realtime updates can replace the pre-measurement node just as Practice
  // Duppy turns do. Fit synchronously when this exact fragment is attached.
  const stageMeasure = new MutationObserver(() => {
    if (!boardStage.isConnected) return;
    stageMeasure.disconnect();
    refitMeasuredBoard();
  });
  stageMeasure.observe(document.body, { childList: true, subtree: true });
  // Docked directly under the felt so the board and the player's own hand
  // are always visible together — this used to be a separate panel
  // appended after .table-room closed, which pushed it below the fold.
  // Same guards as the old call site: only a seated player with a dealt
  // hand gets one.
  let handActions: HTMLElement | null = null;
  let choiceHandHost: HTMLElement | null = null;
  if (!game.isSpectator && game.hand) {
    const activeSeat = game.table.mode === 'across' ? game.activeSeat() : game.mySeat;
    const hand = myHandPanel(game, rerender, activeSeat);
    choiceHandHost = hand;
    hand.classList.add('in-felt-hand');
    handActions = takeHandActions(hand);
    const bottomIdentity = tableIdentities.get('bottom');
    if (bottomIdentity) {
      bottomIdentity.classList.toggle('turn', game.isMyTurn() && activeSeat === game.mySeat);
      if (window.innerWidth > 900) {
        bottomIdentity.classList.add('desktop-self-identity');
        const copy = el('span', 'table-seat-copy');
        copy.append(el('strong', undefined, activeSeat === game.partnerSeat() ? 'Your partner hand' : 'You'));
        bottomIdentity.append(copy);
        feltShell.appendChild(bottomIdentity);
      } else hand.appendChild(bottomIdentity);
    }
    if (game.table.mode === 'across') {
      // Across: my hand at the bottom, my partner's hand at the top, both on
      // the table (owner, 2026-09-15). Whichever seat is on turn is the live,
      // playable panel; the other is read-only until its turn comes.
      hand.classList.remove('in-felt-hand');
      const partnerSeat = game.partnerSeat();
      const activeIsPartner = partnerSeat !== null && activeSeat === partnerSeat;
      const own = activeIsPartner ? myHandPanel(game, rerender, game.mySeat, true) : hand;
      const top = partnerSeat === null ? null
        : activeIsPartner ? hand : myHandPanel(game, rerender, partnerSeat, true);
      const both = el('div', 'in-felt-across-hands');
      own.classList.add('across-hand-own');
      both.appendChild(own);
      if (top) {
        top.classList.add('across-hand-partner');
        both.appendChild(top);
      }
      felt.classList.add('across-hands-on-felt');
      feltShell.classList.add('across-hands-on-felt');
      felt.appendChild(both);
    } else {
      felt.appendChild(hand);
    }
  }
  // Desktop: the turn line and Pass sit down the side, not across the middle
  // (owner, 2026-09-15). Same strip as Practice.
  if (window.innerWidth > 700 && !frenchTable) {
    // Across has two hands on the felt; only MY own bottom hand's line moves to
    // the side, or the partner hand at the top loses its label.
    const ownPanel = felt.querySelector<HTMLElement>('.in-felt-across-hands > .across-hand-own')
      ?? felt.querySelector<HTMLElement>('.my-hand-panel.in-felt-hand');
    const eyebrows = ownPanel ? [...ownPanel.querySelectorAll<HTMLElement>(':scope > .eyebrow')] : [];
    if (eyebrows.length) {
      const side = el('div', 'hand-side-info');
      for (const brow of eyebrows) side.appendChild(brow);
      // The pace chooser stays with the bones: it is a setting, not the turn,
      // and it made the side strip too tall to sit beside my own hand.
      for (const pace of [...side.querySelectorAll<HTMLElement>('.practice-hand-pace, select')]) {
        ownPanel?.appendChild(pace);
      }
      felt.appendChild(side);
      requestAnimationFrame(() => { if (side.isConnected) placeSideInfo(felt, side); });
    }
  }

  handActions = placeBoardChoices(boardStage, handActions, choiceHandHost);
  if (handActions) {
    handActions.classList.add('in-felt-actions');
    felt.appendChild(handActions);
  }
  cross.appendChild(feltSlot);

  // Wrapped, but `display: contents` on desktop so each slot still lands in
  // its own cross area (top/left/right/bottom) exactly as before. On a phone
  // the wrapper becomes a real flex strip ABOVE the felt: seats used to sit
  // under the board, off the bottom of the screen, and the four fixed grid
  // columns stranded a two-hander's cards at opposite edges squeezed to a
  // quarter width each — which is how "Candy" rendered as "C…". Reported from
  // a 2-player cut throat table, 2026-09-05.
  const seatStrip = el('div', 'seat-strip');
  game.seats.forEach((s) => {
    const slot = seatPosition(s.seatIndex, game.mySeat, game.table.seatCount);
    if (!slot) return;
    const wrap = el('div', `seat-slot seat-slot-${slot}`);
    wrap.appendChild(seatCard(s, game, rerender));
    seatStrip.appendChild(wrap);
  });
  cross.appendChild(seatStrip);

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
  room.classList.toggle('across-room', game.table.mode === 'across');
  room.appendChild(cross);

  const rail = el('div', 'table-rail');

  // Voice/video controls remain available, but below the playing surface.
  // Keeping these two bars above a live hand cost almost 100px of every
  // laptop viewport—the exact space the board needs to stay readable.
  const liveExtras = el('div', 'table-live-extras');
  if (social?.voicePanel) liveExtras.appendChild(social.voicePanel);
  if (social?.videoPanel) liveExtras.appendChild(social.videoPanel);
  if (liveExtras.childElementCount) rail.appendChild(liveExtras);

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

  const backToTable = document.createElement('button');
  backToTable.type = 'button';
  backToTable.className = 'table-return-jump';
  backToTable.textContent = 'Back to table';
  backToTable.onclick = () => {
    document.querySelector('.table-cross, .table-felt')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  rail.appendChild(backToTable);

  const talk = social?.chatPanel ?? el('div', 'panel');
  if (!social?.chatPanel) {
    talk.append(el('div', 'eyebrow', 'Table talk'));
    talk.append(el('p', 'muted', 'Connecting chat to this table…'));
  }
  if (social?.quickChatBar) {
    talk.append(el('div', 'rail-help', 'Quick chat'), social.quickChatBar);
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
      await game.dealNext();
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
/**
 * My own bones, kept between rebuilds. Keyed by seat and tile, because Across
 * puts two of my hands on the table at once and the same tile id must not be
 * shared between them. Handlers and classes are re-applied by the caller.
 */
const handBoneCache = new Map<string, HTMLElement>();

function handBone(seat: number | null, tile: string): HTMLElement {
  const key = `${seat}:${tile}`;
  const cached = handBoneCache.get(key);
  if (cached) {
    cached.onclick = null;
    cached.onkeydown = null;
    cached.removeAttribute('tabindex');
    return cached;
  }
  const node = tileEl(tile as TileId);
  handBoneCache.set(key, node);
  return node;
}

function myOtherHandPanel(tiles: string[], label = 'Your other hand'): HTMLElement {
  const panel = el('div', 'panel partner-hand');
  panel.append(el('div', 'eyebrow', label));
  const row = el('div', 'hand');
  // One seat holds at most seven bones. The old forced two-row rack spent a
  // whole extra panel-height even after only a few bones remained, which in
  // turn starved the shared board/hand scale and made Across unreadably tiny.
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

function myHandPanel(
  game: OnlineGame,
  rerender: () => void,
  fixedSeat: number | null = null,
  /**
   * Across shows both of a player's hands on the table (owner, 2026-09-15:
   * partner hand at the top). The hand not on turn is drawn read-only and
   * must not touch the chosen-tile state the live hand owns.
   */
  passive = false,
): HTMLElement {
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
  const seat = fixedSeat ?? game.activeSeat() ?? game.mySeat;
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
  handTurnCue(panel, !passive && game.isMyTurn(), pending);
  if (!passive && (!game.isMyTurn() || pending)) pendingTile = null;
  const tiles = seat === null ? [] : (game.predictedTilesFor(seat) ?? game.tilesForSeat(seat));
  // A tile chosen in one of my two hands must not appear "chosen" in the
  // other just because it shares a tile id — see pendingTileSeat's comment.
  if (!passive && pendingTileSeat !== seat) { pendingTile = null; pendingTileSeat = seat; }
  const label = passive
    ? (onPartnerSeat ? 'Your partner hand' : 'Your hand')
    : pending
    ? 'Sending…'
    : onPartnerSeat
      ? (game.isMyTurn()
          ? (pendingTile ? 'Choose where it goes' : 'Your partner hand — your turn')
          : 'Your partner hand')
      : (game.isMyTurn() ? (pendingTile ? 'Choose where it goes' : 'Your turn') : 'Your hand');
  panel.append(el('div', 'eyebrow', label));
  const legal = pending || passive ? [] : game.legalMovesForMe();
  const playable = new Set(legal.flatMap((m) => ('tile' in m ? [m.tile] : [])));
  const hand = el('div', 'hand');
  // The in-felt rail shares its width across exactly this many bones. A
  // two-hander deals fourteen, not seven — see the .in-felt-hand rule.
  // Keep rack bones at their dealt size as the hand empties. Otherwise every
  // play made the survivors grow, so the same domino visibly changed scale
  // between the hand and the table.
  const dealCount = dealPlan(game.table.seatCount, false).perPlayer;
  hand.style.setProperty('--hand-count', String(Math.max(dealCount, 1)));
  hand.classList.toggle('double-row', dealCount >= 10);

  for (const tile of tiles) {
    // The same bone across rebuilds (owner, 2026-09-15: flicker). A live table
    // rebuilds every couple of seconds and rebuilt all seven bones each time.
    const node = handBone(seat, tile);
    node.className = 'tile';
    const can = playable.has(tile);
    node.classList.add(can ? 'playable' : 'dead');
    if (!passive && pendingTile === tile) node.classList.add('chosen');
    // Every tile is selectable, playable or not — a real table never stops
    // your hand touching a tile that doesn't fit, it just won't land. The
    // 'playable' class is the hint; tapping a 'dead' one shows why it can't
    // be played instead of doing nothing. Still frozen while a move is
    // in flight (pending) — that guard exists so a second move can't queue
    // up before the server confirms the first.
    if (!passive && !pending && game.isMyTurn()) {
      node.tabIndex = 0;
      const choose = () => {
        if (!game.isMyTurn()) return;
        // SELECT, never play. A single-ended bone used to go down on one tap,
        // instantly and with no way back — so a thumb landing a few pixels off
        // played the wrong domino, which is exactly what was reported on a
        // phone. Every tap now lifts the bone and the commit happens on the
        // board, a far bigger target well away from the rack, naming the end
        // it is going to. "No auto-play" gets stronger, not weaker: the system
        // still never picks an end for you, and now it never lays a bone
        // without a second deliberate tap either.
        pendingTile = pendingTile === tile ? null : tile;
        rerender();
      };
      node.onclick = choose;
      node.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } };
    }
    hand.appendChild(node);
  }
  panel.appendChild(hand);

  // The pose decision, made with the tiles in front of you rather than on a
  // result screen before the deal. It goes into the panel body, so
  // takeHandActions() lifts it onto the felt with every other hand decision.
  if (!passive && game.canPassPoseNow() && poseChoiceDismissed !== game.hand?.hand_id) {
    const row = el('div', 'row');
    row.append(el('span', 'muted', 'Yours to pose — or hand it across?'));
    const keep = document.createElement('button');
    keep.className = 'act';
    keep.textContent = 'Keep it';
    // Keeping needs no server call: the pose is already sitting with me. The
    // button exists so the choice reads as a choice and the row can be
    // dismissed rather than hovering over the whole opening.
    keep.dataset.keepPose = 'true';
    keep.onclick = () => { poseChoiceDismissed = game.hand?.hand_id ?? null; rerender(); };
    const pass = document.createElement('button');
    pass.className = 'act ghost';
    pass.textContent = 'Pass to partner';
    // Same marker Practice carries, so a check can find this choice.
    pass.dataset.passPose = 'true';
    pass.onclick = () => void game.passPose();
    row.append(keep, pass);
    panel.appendChild(row);
  }

  if (!passive && pendingTile && game.hand?.status === 'active') {
    // The pip value on each end, not just the bare direction — "I thought
    // this was the right end" is a real argument at a real table, and the
    // number settles it before it starts.
    const board = game.predictedBoard ?? game.hand?.board ?? null;
    const linear = board?.kind === 'linear' ? board : null;
    const cross = board?.kind === 'cross' ? board : null;
    const options = legal.filter((m) => 'tile' in m && m.tile === pendingTile);
    const choice = el('div', 'row');
    choice.dataset.boardChoice = 'true';
    if (options.length === 0) {
      const reason = cross ? crossRejectReason(cross, pendingTile) : null;
      choice.append(el('span', 'muted', reason ?? "That tile doesn't fit the board right now."));
    } else {
      choice.append(el('span', 'muted', options.length === 1 ? 'Play it?' : 'Which end?'));
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
            b.dataset.crossArm = String(move.arm);
            b.dataset.openPip = String(arm.openEnd);
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
          b.dataset.linearEnd = isLeft ? 'left' : 'right';
          if (pip !== null) b.dataset.openPip = String(pip);
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

  // French round 2+ with no double: fined 10 and the player names who poses
  // (owner, 2026-09-15). Same place and look as Practice.
  const askMoves = legal.filter((move) => move.kind === 'askpose');
  if (game.isMyTurn() && askMoves.length > 0) {
    const partnered = isPartnered(game.table.mode);
    const askRow = el('div', 'pass-action-row ask-pose-row');
    askRow.setAttribute('role', 'group');
    askRow.setAttribute('aria-label', 'You have no double to pose. Choose who poses; it costs you 10.');
    askRow.append(el('strong', undefined, 'No double (+10). Who poses?'));
    for (const move of askMoves) {
      if (move.kind !== 'askpose') continue;
      const b = document.createElement('button');
      b.className = 'act pass-action';
      b.textContent = describeSeat(move.target, game.seats, game.mySeat, partnered, game.mySide);
      b.dataset.askPose = String(move.target);
      b.onclick = () => void game.play(move);
      askRow.appendChild(b);
    }
    // In the header, like Practice: a row under the bones grew the hand panel
    // up into the fixed board (2026-09-15).
    (panel.querySelector<HTMLElement>(':scope > .eyebrow') ?? panel).appendChild(askRow);
  }

  const onlyPass = legal.length === 1 && legal[0].kind === 'pass';
  if (game.isMyTurn() && onlyPass) {
    const passRow = el('div', 'pass-action-row');
    passRow.setAttribute('role', 'status');
    passRow.append(el('strong', undefined, 'No matching bone'));
    const b = document.createElement('button');
    b.className = 'act pass-action';
    b.textContent = 'Pass';
    b.dataset.passAction = 'true';
    b.onclick = () => void game.play(legal[0]);
    passRow.appendChild(b);
    // In the header, like Practice: under the bones it grew the panel into
    // the fixed board and laid its bottom row under the hand.
    (panel.querySelector<HTMLElement>(':scope > .eyebrow') ?? panel).appendChild(passRow);
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
    !child.classList.contains('eyebrow')
      && !child.classList.contains('hand')
      && !child.classList.contains('pass-action-row'),
  );
  if (!actions.length) return null;
  const dock = el('div', 'hand-actions-dock');
  actions.forEach((action) => dock.appendChild(action));
  return dock;
}

/** A completed hand's free, browser-verified visual deal receipt. */
function revealSection(game: OnlineGame, rerender: () => void): HTMLElement {
  const wrap = el('section', 'deal-check');
  const partnered = isPartnered(game.table.mode);

  const checkHandId = game.hand?.hand_id ?? '';
  if (game.revealedDeal && game.dealVerification && dealCheckOpen.has(checkHandId)) {
    const verification = game.dealVerification;
    const hide = document.createElement('button');
    hide.type = 'button';
    hide.className = 'act ghost small deal-check-hide';
    hide.dataset.hideDealCheck = 'true';
    hide.textContent = 'Hide deal check';
    hide.onclick = () => { dealCheckOpen.delete(checkHandId); rerender(); };
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
    wrap.appendChild(hide);
    return wrap;
  }

  const button = document.createElement('button');
  button.className = 'act ghost';
  button.textContent = game.revealPending && dealCheckOpen.has(checkHandId) ? 'Checking the deal…' : 'Verify the deal — free';
  button.disabled = game.revealPending && dealCheckOpen.has(checkHandId);
  button.onclick = () => {
    dealCheckOpen.add(checkHandId);
    if (game.revealedDeal) rerender();
    else void game.reveal();
  };
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

let gameOverDismissedHand: string | null = null;
const ONLINE_RESULT_ID = 'online-hand-result';
/** Hands whose deal check the player opened; Hide closes it (owner, 2026-09-15). */
const dealCheckOpen = new Set<string>();
/** Hands whose starting deal was fetched to show the hands left, so a failure is not retried every render. */
const handsLeftRequested = new Set<string>();

/**
 * The bones each seat still held when the hand ended: its starting hand, plus
 * anything it drew, less everything it played. Worked out in the browser from
 * the free post-hand deal reveal and the public move log, so nothing hidden
 * is ever sent while a hand is live.
 */
function handsLeft(deal: readonly TileId[][], moves: readonly Move[]): TileId[][] {
  const left = deal.map((hand) => [...hand]);
  for (const move of moves) {
    if (move.kind === 'draw') left[move.seat]?.push(move.tile);
    else if (move.kind === 'pose' || move.kind === 'play' || move.kind === 'playcross') {
      const hand = left[move.seat];
      const at = hand ? hand.indexOf(move.tile) : -1;
      if (hand && at >= 0) hand.splice(at, 1);
    }
  }
  return left;
}

/**
 * The same GAME OVER card Practice shows (owner, 2026-09-14): on a phone the
 * result sits under the table and nothing said it was there. Closing it is
 * remembered per hand, in module scope, because Realtime re-renders the felt.
 */
function onlineGameOverCard(game: OnlineGame, rerender: () => void): HTMLElement | null {
  const hand = game.hand;
  const r = hand?.result as any;
  if (!hand || !r || hand.status === 'active' || gameOverDismissedHand === hand.hand_id) return null;
  const partnered = isPartnered(game.table.mode);
  const name = (seat: number) => describeSeat(seat, game.seats, game.mySeat, partnered, game.mySide);
  const setOver = game.winnerSide !== null;
  const card = el('div', 'table-game-over');
  card.setAttribute('role', 'status');
  card.append(el('strong', 'table-game-over-title', setOver ? 'SET OVER' : 'GAME OVER'));
  const line = setOver
    ? (game.isSpectator ? 'The set is decided' : game.winnerSide === game.mySide ? 'You win the set' : 'The set goes against you')
    : r.tie
      ? 'Tied on count'
      : r.status === 'blocked' && r.winnerSeat !== null
        ? `Blocked · ${name(r.winnerSeat)} ${name(r.winnerSeat) === 'You' ? 'win' : 'wins'} on count`
        : r.winnerSeat !== null
          ? `${name(r.winnerSeat)} played out`
          : 'Hand over';
  card.append(el('span', 'table-game-over-line', line));
  const see = document.createElement('button');
  see.type = 'button';
  see.className = 'table-game-over-see';
  see.dataset.seeResult = 'true';
  see.textContent = game.isSpectator ? 'See scores ▼' : 'See hands left & scores ▼';
  see.onclick = () => {
    document.getElementById(ONLINE_RESULT_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'table-game-over-close';
  close.setAttribute('aria-label', 'Hide and look at the board');
  close.textContent = '×';
  close.onclick = () => { gameOverDismissedHand = hand.hand_id; rerender(); };
  // Straight on to the next deal without reading the results (owner,
  // 2026-09-15), for a seated player while the set is still live.
  if (!setOver && !game.isSpectator) {
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'table-game-over-next';
    go.dataset.gameOverNext = 'true';
    go.textContent = 'Deal next hand';
    go.onclick = () => { go.disabled = true; void game.dealNext(); };
    card.append(go);
  }
  card.append(see, close);
  return card;
}

function handResultPanel(game: OnlineGame, rerender: () => void): HTMLElement {
  const panel = el('div', 'panel');
  panel.id = ONLINE_RESULT_ID;
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

  // Hands left on the table, as in Practice and at a real table where every
  // hand is turned over at the end (owner, 2026-09-15). Players only: the
  // free reveal answers the people who played the hand.
  const handId = game.hand!.hand_id;
  if (!game.isSpectator) {
    if (!game.revealedDeal && !game.revealPending && !handsLeftRequested.has(handId)) {
      handsLeftRequested.add(handId);
      void game.reveal();
    }
    const remaining = el('div', 'hands-left');
    remaining.append(el('div', 'eyebrow', 'Hands left on the table'));
    if (game.revealedDeal) {
      const left = handsLeft(game.revealedDeal, (game.hand!.move_log ?? []) as Move[]);
      const revealed = el('div', 'revealed-hands');
      left.forEach((hand, seat) => {
        const seatHand = el('div', 'reveal-hand');
        seatHand.append(el('strong', undefined, describeSeat(seat, game.seats, game.mySeat, partnered, game.mySide)));
        seatHand.append(el('small', 'muted', `${hand.length} tile${hand.length === 1 ? '' : 's'} left`));
        const tiles = el('div', 'hand revealed-tiles');
        for (const id of hand) { const tile = tileEl(id); tile.classList.add('sm'); tiles.appendChild(tile); }
        seatHand.appendChild(tiles);
        revealed.appendChild(seatHand);
      });
      remaining.appendChild(revealed);
    } else {
      remaining.append(el('p', 'muted small', game.revealPending ? 'Turning the hands over…' : 'The hands could not be shown just now.'));
    }
    panel.appendChild(remaining);
  }

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

  panel.appendChild(revealSection(game, rerender));
  panel.appendChild(settleSection(game));
  if (!game.isSpectator) panel.appendChild(coachSection(game));

  // The pose choice used to live here, BEFORE the deal — so the winner picked
  // blind. It now sits on the table with the tiles in hand; see
  // canPassPoseNow() and the row in myHandPanel().

  if (game.winnerSide === null && !game.isSpectator) {
    const next = document.createElement('button');
    next.className = 'act';
    next.textContent = 'Deal next hand';
    next.onclick = () => void game.dealNext();
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
