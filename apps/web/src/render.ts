import { halves } from '@yard/engine';
import type { Board, Pip, TileId } from '@yard/engine';
import { layoutLine, orientLine } from './layout.ts';
import type { TilePlacement } from './layout.ts';

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

/** One layout unit is half a tile's short side doubled — see layout.ts. */
function unitPx(): number {
  return window.innerWidth < 640 ? 13 : 15;
}

function boardUnits(u: number): number {
  // App column is capped at 940px; subtract app padding, felt border+padding.
  const avail = Math.min(window.innerWidth, 940) - 32 - 36 - 20;
  return Math.floor(avail / u);
}

/**
 * Draw the line the way it sits on a real Jamaican table: tiles end to end
 * with touching halves matching, doubles crosswise in the line, and the line
 * snaking 90° at the table edge. Layout math lives in layout.ts.
 */
export function renderBoard(host: HTMLElement, board: Board | null, maxUnits?: number) {
  host.innerHTML = '';
  if (!board || board.line.length === 0) {
    host.style.gridTemplateColumns = '';
    host.style.gridTemplateRows = '';
    return;
  }

  const u = unitPx();
  const units = Math.min(boardUnits(u), maxUnits ?? Infinity);
  const placements = layoutLine(orientLine(board), units);

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
