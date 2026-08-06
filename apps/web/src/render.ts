import { halves, isDouble, matches } from '@yard/engine';
import type { AnyBoard, Board, CrossBoard, HandResult, PenaltyEvent, Pip, TileId } from '@yard/engine';
import { layoutLine, MIN_WIDTH_UNITS, orientLine } from './layout.ts';
import type { OrientedTile, TilePlacement } from './layout.ts';

/** Pip positions on a 3x3 grid, per face value, for a vertical half. */
const LAYOUT: Record<number, number[]> = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** Same pip pattern rotated a quarter turn, for halves lying sideways. */
const rot90 = (i: number) => (i % 3) * 3 + (2 - Math.floor(i / 3));

function face(value: number, sideways = false): HTMLElement {
  const half = document.createElement('div');
  half.className = 'half';
  const cells = (LAYOUT[value] ?? []).map((i) => (sideways ? rot90(i) : i));
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('span');
    if (cells.includes(i)) cell.appendChild(document.createElement('b'));
    half.appendChild(cell);
  }
  return half;
}

/** A vertical tile for the hand rack. Board tiles are built by renderBoard. */
export function tileEl(id: TileId): HTMLElement {
  const [a, b] = halves(id);
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.tile = id;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `${a} ${b}`);
  el.appendChild(face(a));
  const bar = document.createElement('div');
  bar.className = 'bar';
  el.appendChild(bar);
  el.appendChild(face(b));
  return el;
}

function boardTile(p: TilePlacement): HTMLElement {
  const el = document.createElement('div');
  el.className = 'tile ' + (p.orient === 'h' ? 'h' : 'v');
  el.dataset.tile = p.placed.tile;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `${p.faces[0]} ${p.faces[1]}`);
  el.appendChild(face(p.faces[0], p.orient === 'h'));
  const bar = document.createElement('div');
  bar.className = 'bar';
  el.appendChild(bar);
  el.appendChild(face(p.faces[1], p.orient === 'h'));
  return el;
}

/**
 * One layout unit is half a tile's short side — a tile is 2 units across and
 * 4 long (see layout.ts). The unit is therefore the single number deciding
 * whether the board reads as real dominoes or as counters, which is why it is
 * measured rather than guessed: it used to be a hardcoded 13 or 15, so the
 * felt stretched to the screen while the bones stayed the same size on a
 * phone and a 27-inch monitor alike.
 */
const MIN_UNIT = 11;
const MAX_UNIT = 28;

/** Felt border + felt padding + the line's own padding, both sides. */
const CHROME_X = 2 * (6 + 12 + 10);
const CHROME_Y = 2 * (6 + 14 + 10);

export interface BoardFit {
  /** Cap the width in units — the hero uses it to keep its demo line short. */
  maxUnits?: number;
  /** Pin the unit instead of fitting, for boards whose box is not the felt. */
  unit?: number;
  /** The real box to lay the line out inside, measured by the caller from
   *  the actual attached DOM element. Falls back to feltBox()'s
   *  window-based guess when omitted (main.ts's local play, the hero demo,
   *  and the very first render before the felt has been measured). */
  box?: BoardBox;
}

/** The box the grid has to live inside, in CSS pixels. */
export interface BoardBox { width: number; height: number }

/** What the felt actually offers: app column capped at 940, felt at 64vh. */
function feltBox(): BoardBox {
  return {
    width: Math.min(window.innerWidth, 1200) - 32 - CHROME_X,
    height: Math.min(window.innerHeight * 0.72, 680) - CHROME_Y,
  };
}

export function rowsOf(placements: TilePlacement[]): number {
  const min = Math.min(...placements.map((p) => p.row));
  const max = Math.max(...placements.map((p) => p.row + p.rowSpan));
  return max - min;
}

/**
 * The largest tiles this line fits in at. Pure, so it can be tested without
 * a browser — `feltBox()` is the only part that reads the window, and
 * `renderBoard` hands its result in.
 *
 * Bigger tiles mean fewer units across, which means more rows, which needs
 * more height — so the size cannot be solved directly and is searched for
 * instead, largest first. `layoutLine` is pure and a hand is at most 28
 * tiles, so trying every size costs nothing measurable.
 *
 * A four-tile opening therefore renders big and a full board still fits,
 * where before both rendered identically small.
 */
export function chooseUnit(
  line: OrientedTile[], box: BoardBox, opts: BoardFit = {},
): { u: number; placements: TilePlacement[] } {
  const cap = opts.maxUnits ?? Infinity;

  const at = (u: number) => {
    const across = Math.min(Math.floor(box.width / u), cap);
    // Narrower than this and layoutLine has no room to turn the elbow.
    return across < MIN_WIDTH_UNITS ? null : layoutLine(line, across);
  };

  if (opts.unit) {
    const placements = at(opts.unit);
    if (placements) return { u: opts.unit, placements };
  }

  let last: { u: number; placements: TilePlacement[] } | null = null;
  for (let u = MAX_UNIT; u >= MIN_UNIT; u--) {
    const placements = at(u);
    if (!placements) continue;
    last = { u, placements };
    if (rowsOf(placements) * u <= box.height) return last;
  }
  // Nothing fit the height budget — take the smallest and let the felt
  // scroll, which is what it did for every board before this.
  return last ?? { u: MIN_UNIT, placements: layoutLine(line, MIN_WIDTH_UNITS) };
}

/**
 * Draw the line the way it sits on a real Jamaican table: tiles end to end
 * with touching halves matching, doubles crosswise in the line, and the line
 * snaking 90° at the table edge. Layout math lives in layout.ts.
 */
export function renderBoard(host: HTMLElement, board: AnyBoard | null, opts: BoardFit = {}) {
  host.innerHTML = '';
  if (!board) {
    host.style.gridTemplateColumns = '';
    host.style.gridTemplateRows = '';
    return;
  }
  if (board.kind === 'cross') return renderCross(host, board, opts);
  if (board.line.length === 0) {
    host.style.gridTemplateColumns = '';
    host.style.gridTemplateRows = '';
    return;
  }

  const { u, placements } = chooseUnit(orientLine(board), opts.box ?? feltBox(), opts);

  const maxCol = Math.max(...placements.map((p) => p.col + p.colSpan));
  const minRow = Math.min(...placements.map((p) => p.row));
  const maxRow = Math.max(...placements.map((p) => p.row + p.rowSpan));

  host.style.gridTemplateColumns = `repeat(${maxCol}, ${u}px)`;
  host.style.gridTemplateRows = `repeat(${maxRow - minRow}, ${u}px)`;

  placements.forEach((p, i) => {
    const node = boardTile(p);
    node.style.gridColumn = `${p.col + 1} / span ${p.colSpan}`;
    node.style.gridRow = `${p.row - minRow + 1} / span ${p.rowSpan}`;
    node.style.setProperty('--i', String(i));
    host.appendChild(node);
  });
}

interface CrossLayout {
  totalCols: number;
  totalRows: number;
  /**
   * Unlike TilePlacement's col/row (0-based, +1'd at DOM-application time —
   * see renderBoard's linear path), these are 1-based CSS grid line numbers,
   * applied directly. The cross board's centring math reads more clearly
   * that way, since the chucha's own position (centerCol/centerRow) is
   * naturally a 1-based grid line to begin with.
   */
  placements: TilePlacement[];
}

/**
 * French cross board, pure layout math — same split as chooseUnit/layoutLine
 * for the linear board, so this is unit-testable without a DOM.
 *
 * Whatever double opened the hand sits at centre — the chucha (0-0) in
 * round 1, or the winner's own choice in round 2+ (see
 * HandState.poseMustBeAnyDouble) — with up to 4 arms extending outward in
 * fixed order: right (0), left (1), up (2), down (3). Non-doubles lie along
 * their arm and occupy a 4×2 footprint (long side along the arm); doubles
 * lie CROSSWISE — jutting out to both sides, a 2×4 or 4×2 footprint with the
 * long side perpendicular to the arm. Pip halves are ordered so the touching
 * pips at every junction match — the anchor pip for tiles[i] is tiles[i-1]'s
 * exposed pip, or the centre's own pip value when i === 0.
 *
 * The grid gets a uniform 1-unit buffer beyond what the arms' own along-axis
 * spans require, on every side. Without it, a crosswise tile near the base
 * of an arm needs to request a column or row 1 short of centerCol/centerRow
 * to stay centred on its arm's band, which goes negative — off the explicit
 * grid — whenever the OPPOSITE arm hasn't grown that far yet. The buffer
 * means that column/row always exists, regardless of how lopsided the board
 * currently is.
 */
export function crossPlacements(board: CrossBoard): CrossLayout {
  // Each arm's outward span: doubles occupy 2u along their arm axis (their
  // short side), non-doubles occupy 4u (their long side).
  const armSpan = (tiles?: typeof board.arms[number]['tiles']) =>
    (tiles ?? []).reduce((n, p) => n + (p.crosswise ? 2 : 4), 0);
  const rightSpan = armSpan(board.arms[0]?.tiles);
  const leftSpan = armSpan(board.arms[1]?.tiles);
  const upSpan = armSpan(board.arms[2]?.tiles);
  const downSpan = armSpan(board.arms[3]?.tiles);

  const totalCols = 4 + leftSpan + rightSpan;
  const totalRows = 4 + upSpan + downSpan;
  const centerCol = 2 + leftSpan;
  const centerRow = 2 + upSpan;

  const centerValue = halves(board.center)[0]; // center is always a double
  const placements: TilePlacement[] = [{
    placed: { tile: board.center, crosswise: true },
    orient: 'v',
    faces: [centerValue, centerValue],
    col: centerCol, row: centerRow, colSpan: 2, rowSpan: 2,
  }];

  /**
   * Lay tiles outward along an arm, tracking cumulative offset so crosswise
   * doubles pack tight against their neighbours. axis is the arm direction;
   * reverseHalves flips which half faces the chucha vs the outer end.
   */
  const placeArm = (
    tiles: typeof board.arms[number]['tiles'] | undefined,
    axis: 'h' | 'v',
    sign: 1 | -1,
    reverseHalves: boolean,
  ) => {
    if (!tiles) return;
    let offset = 0;
    // The first tile's inner half must match the CENTRE's own pip value —
    // hardcoded to 0 (blank) from when the chucha was the only possible
    // centre. A round 2+ cross can spin on any double (e.g. 1-1): a fill
    // tile like 1-6 has its inner/outer picked by `a === anchor`, so an
    // anchor stuck at 0 instead of the true centre value (1) put the 6
    // inward and the 1 outward — backwards, and specifically the "ones on
    // the outer side" bug seen live on a 1-1 spinner.
    let anchor: Pip = centerValue;
    tiles.forEach((p) => {
      const [a, b] = halves(p.tile);
      const inner: Pip = (a === anchor ? a : b) as Pip;
      const outer: Pip = (a === anchor ? b : a) as Pip;
      const faces: [Pip, Pip] = reverseHalves ? [outer, inner] : [inner, outer];
      const orient = p.crosswise ? (axis === 'h' ? 'v' : 'h') : axis;
      // A crosswise tile's footprint SWAPS which dimension is long: 2 units
      // along the arm (its short side), 4 units across it (its long side,
      // now perpendicular) — centred on the arm's normal 2-unit band, hence
      // the 1-unit shift back on the across axis.
      const alongSpan = p.crosswise ? 2 : 4;
      const acrossSpan = p.crosswise ? 4 : 2;
      const acrossShift = p.crosswise ? 1 : 0;
      let col: number;
      let row: number;
      let colSpan: number;
      let rowSpan: number;
      if (axis === 'h') {
        col = sign > 0 ? centerCol + 2 + offset : centerCol - alongSpan - offset;
        row = centerRow - acrossShift;
        colSpan = alongSpan;
        rowSpan = acrossSpan;
      } else {
        col = centerCol - acrossShift;
        row = sign > 0 ? centerRow + 2 + offset : centerRow - alongSpan - offset;
        colSpan = acrossSpan;
        rowSpan = alongSpan;
      }
      placements.push({ placed: p, orient, faces, col, row, colSpan, rowSpan });
      offset += alongSpan;
      anchor = outer;
    });
  };

  placeArm(board.arms[0]?.tiles, 'h', 1, false);   // right
  placeArm(board.arms[1]?.tiles, 'h', -1, true);   // left
  placeArm(board.arms[2]?.tiles, 'v', -1, true);   // up
  placeArm(board.arms[3]?.tiles, 'v', 1, false);   // down

  return { totalCols, totalRows, placements };
}

/**
 * Why `tile` can't be played on a French cross board right now — the message
 * behind the hand panel's "doesn't fit" line. Returns null when the tile
 * actually IS legal (callers only reach for this once legality already
 * failed, but staying honest here means a caller mistake shows up loudly
 * instead of lying to the player).
 *
 * A tile with a matching half is playable on an arm once that suit's own
 * double has been played anywhere on the board (board.doublesPlayed) — a
 * board-wide unlock, not scoped to whichever arm the double landed on. So
 * the only way a matching tile gets rejected here is when NO suit it carries
 * has had its double played yet at all.
 */
export function crossRejectReason(board: CrossBoard, tile: TileId): string | null {
  const [a, b] = halves(tile);
  if (board.arms.length < 4) {
    const centerValue = halves(board.center)[0];
    if (a === centerValue || b === centerValue) return null;
    return `Doesn't touch the ${centerValue} in the middle — a new arm has to start there.`;
  }
  const lockedEnds = new Set<Pip>();
  for (const arm of board.arms) {
    if (!matches(tile, arm.openEnd)) continue;
    const isSuitDouble = isDouble(tile) && halves(tile)[0] === arm.openEnd;
    if (isSuitDouble || board.doublesPlayed.includes(arm.openEnd)) return null;
    lockedEnds.add(arm.openEnd);
  }
  if (lockedEnds.size > 0) {
    const which = [...lockedEnds].join(' or ');
    return `The ${which} needs its own double played before anything else of that number can join the board.`;
  }
  return "Doesn't match any open end on the board.";
}

function renderCross(host: HTMLElement, board: CrossBoard, _opts: BoardFit) {
  const box = feltBox();
  const { totalCols, totalRows, placements } = crossPlacements(board);

  const wantU = Math.min(
    Math.floor(box.width / totalCols),
    Math.floor(box.height / totalRows),
  );
  const u = Math.max(MIN_UNIT, Math.min(MAX_UNIT, wantU || MIN_UNIT));
  host.style.gridTemplateColumns = `repeat(${totalCols}, ${u}px)`;
  host.style.gridTemplateRows = `repeat(${totalRows}, ${u}px)`;

  placements.forEach((p) => {
    const node = boardTile(p);
    node.style.gridColumn = `${p.col} / span ${p.colSpan}`;
    node.style.gridRow = `${p.row} / span ${p.rowSpan}`;
    host.appendChild(node);
  });
}

export function backsEl(count: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'backs';
  for (let i = 0; i < count; i++) wrap.appendChild(document.createElement('i'));
  return wrap;
}

/** Six pips per side. They light one at a time and go out all together. */
export function scoreTrack(label: string, score: number, opts: { us?: boolean; bruk?: boolean; max?: number } = {}) {
  const max = opts.max ?? 6;
  const wrap = document.createElement('div');
  wrap.className = 'side-score';

  const name = document.createElement('div');
  name.className = 'side-name' + (opts.us ? ' us' : '');
  name.textContent = label;
  wrap.appendChild(name);

  const pips = document.createElement('div');
  pips.className = 'pips' + (opts.bruk ? ' bruk' : '');
  for (let i = 0; i < 6; i++) {
    const pip = document.createElement('i');
    if (Math.round(i / 6 * max) < score) pip.classList.add('lit');
    pips.appendChild(pip);
  }
  wrap.appendChild(pips);

  if (score === 0) {
    const note = document.createElement('div');
    note.className = 'under-love';
    note.textContent = 'under love';
    wrap.appendChild(note);
  } else if (max > 6) {
    const note = document.createElement('div');
    note.className = 'under-love';
    note.textContent = String(score);
    wrap.appendChild(note);
  }
  return wrap;
}

const PENALTY_REASON_TEXT: Record<PenaltyEvent['reason'], string> = {
  'board-pass': 'had no answer to the board',
  'triple-pass': 'passed three times running',
  'no-double-to-pose': 'had no double to pose',
};

/**
 * "X just got a 10, and why" — the live counterpart to the hand-result
 * panel's after-the-fact "Penalties this hand" breakdown. Every seat at the
 * table sees the same PenaltyEvent[] (hand_public.last_penalties online,
 * HandState.lastPenalties locally), so this renders identically for
 * everyone, not just the seat it happened to.
 */
export function penaltyBanner(events: PenaltyEvent[], seatLabel: (seat: number) => string): HTMLElement {
  const line = events
    .map((e) => `${seatLabel(e.seat)} ${PENALTY_REASON_TEXT[e.reason]} — +${e.amount}`)
    .join('  ·  ');
  return el('div', 'banner penalty', line);
}

/**
 * "Did the losing hands add up right" — every seat's pip count from the
 * hand that just ended, any doubling that applied, what it actually added
 * to their score, and their new running total. The delta (`after - before`)
 * is read off the real scores the engine/server already computed rather
 * than reimplementing applyHandResult()'s doubling formula here, so this
 * can never drift out of sync with the number that actually landed —
 * including penalties folded into the same hand, which a hand-count-only
 * view would otherwise leave unexplained.
 */
export function frenchScoreBreakdown(
  result: Pick<HandResult, 'counts' | 'doublesRemaining' | 'winnerPlayedDouble' | 'winnerSeat'>,
  scoresBefore: number[],
  scoresAfter: number[],
  seatLabel: (seat: number) => string,
): HTMLElement {
  const wrap = el('div', 'french-breakdown');
  wrap.append(el('div', 'eyebrow', 'Count this hand'));
  result.counts.forEach((pips, seat) => {
    const tags: string[] = [];
    if (result.doublesRemaining?.[seat]) tags.push('held a double ×2');
    if (result.winnerPlayedDouble && seat !== result.winnerSeat) tags.push('winner played a double ×2');
    const tagText = tags.length ? ` (${tags.join(', ')})` : '';
    const added = (scoresAfter[seat] ?? 0) - (scoresBefore[seat] ?? 0);
    const line = `${seatLabel(seat)} — ${pips} pip${pips === 1 ? '' : 's'}${tagText} → `
      + `+${added}, now ${scoresAfter[seat] ?? 0}`;
    wrap.append(el('div', 'muted small', line));
  });
  return wrap;
}

export function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
