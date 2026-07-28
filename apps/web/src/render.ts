import { halves } from '@yard/engine';
import type { Board, PlacedTile, TileId } from '@yard/engine';

/** Pip positions on a 3x3 grid, per face value. */
const LAYOUT: Record<number, number[]> = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function face(value: number): HTMLElement {
  const half = document.createElement('div');
  half.className = 'half';
  const cells = LAYOUT[value] ?? [];
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('span');
    if (cells.includes(i)) cell.appendChild(document.createElement('b'));
    half.appendChild(cell);
  }
  return half;
}

export function tileEl(id: TileId, opts: { cross?: 'h' | 'v' } = {}): HTMLElement {
  const [a, b] = halves(id);
  const el = document.createElement('div');
  el.className = 'tile' + (opts.cross ? ` cross-${opts.cross}` : '');
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

function boardCols(): number {
  const w = window.innerWidth;
  if (w >= 900) return 12;
  if (w >= 640) return 9;
  return 6;
}

type Dir = 'right' | 'down' | 'left' | 'up';

/** Clockwise turn order — after a turn, whatever direction came next in this
 * cycle becomes the new travel direction. The choice of clockwise vs.
 * counter-clockwise is arbitrary; what matters is picking one and staying
 * consistent, so the path never doubles back on a turn it already made. */
const TURN_ORDER: Dir[] = ['right', 'down', 'left', 'up'];
const STEP: Record<Dir, { dr: number; dc: number }> = {
  right: { dr: 0, dc: 1 },
  down: { dr: 1, dc: 0 },
  left: { dr: 0, dc: -1 },
  up: { dr: -1, dc: 0 },
};

interface Placement {
  tile: PlacedTile;
  row: number;
  col: number;
  /** The direction this tile's run was travelling in when it was placed —
   * for a double, this is the INCOMING direction (the turn happens after
   * placing it, not before), which is exactly what decides whether its
   * crosswise overflow should be horizontal or vertical. */
  dir: Dir;
}

/**
 * A real domino line only turns at a double — the natural, meaningful
 * turning point, laid crosswise on the table. Everything else continues
 * straight in whatever direction the line is currently travelling.
 * `maxRun` exists purely as a width safety net: if a genuinely long run of
 * non-doubles happens with nothing forcing a turn, the board would otherwise
 * grow arbitrarily wide off the visible table. Hitting the cap turns the
 * path exactly like a double would, just without one actually being played.
 *
 * This produces one continuous bending path, never a fork — the engine's
 * `Board` type has exactly two ends (no spinner variant), so a real branch
 * would visually claim a rule this game doesn't have.
 */
function layoutPath(line: PlacedTile[], maxRun: number): Placement[] {
  const placements: Placement[] = [];
  let row = 0, col = 0, dir: Dir = 'right', runLength = 0;

  for (const tile of line) {
    placements.push({ tile, row, col, dir });
    runLength++;

    const turn = tile.crosswise || runLength >= maxRun;
    if (turn) {
      dir = TURN_ORDER[(TURN_ORDER.indexOf(dir) + 1) % 4];
      runLength = 0;
    }
    const step = STEP[dir];
    row += step.dr;
    col += step.dc;
  }
  return placements;
}

export function renderBoard(host: HTMLElement, board: Board | null) {
  host.innerHTML = '';
  if (!board || board.line.length === 0) return;

  const placements = layoutPath(board.line, boardCols());
  const rows = placements.map((p) => p.row);
  const cols = placements.map((p) => p.col);
  const minRow = Math.min(...rows), maxRow = Math.max(...rows);
  const minCol = Math.min(...cols), maxCol = Math.max(...cols);

  host.style.gridTemplateColumns = `repeat(${maxCol - minCol + 1}, auto)`;
  host.style.gridTemplateRows = `repeat(${maxRow - minRow + 1}, auto)`;

  for (const p of placements) {
    const cross: 'h' | 'v' | undefined = p.tile.crosswise
      ? (p.dir === 'up' || p.dir === 'down' ? 'v' : 'h')
      : undefined;
    const node = tileEl(p.tile.tile, { cross });
    node.style.gridColumn = String(p.col - minCol + 1);
    node.style.gridRow = String(p.row - minRow + 1);
    host.appendChild(node);
  }
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
