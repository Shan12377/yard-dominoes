import { halves } from '@yard/engine';
import type { Board, Pip, TileId } from '@yard/engine';
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
}

/** The box the grid has to live inside, in CSS pixels. */
export interface BoardBox { width: number; height: number }

/** What the felt actually offers: app column capped at 940, felt at 64vh. */
function feltBox(): BoardBox {
  return {
    width: Math.min(window.innerWidth, 940) - 32 - CHROME_X,
    height: Math.min(window.innerHeight * 0.64, 560) - CHROME_Y,
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
export function renderBoard(host: HTMLElement, board: Board | null, opts: BoardFit = {}) {
  host.innerHTML = '';
  if (!board || board.line.length === 0) {
    host.style.gridTemplateColumns = '';
    host.style.gridTemplateRows = '';
    return;
  }

  const { u, placements } = chooseUnit(orientLine(board), feltBox(), opts);

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

export function backsEl(count: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'backs';
  for (let i = 0; i < count; i++) wrap.appendChild(document.createElement('i'));
  return wrap;
}

/** Six pips per side. They light one at a time and go out all together. */
export function scoreTrack(label: string, score: number, opts: { us?: boolean; bruk?: boolean } = {}) {
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
    if (i < score) pip.classList.add('lit');
    pips.appendChild(pip);
  }
  wrap.appendChild(pips);

  if (score === 0) {
    const note = document.createElement('div');
    note.className = 'under-love';
    note.textContent = 'under love';
    wrap.appendChild(note);
  }
  return wrap;
}

export function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
