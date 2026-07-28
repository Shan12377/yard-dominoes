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

export function tileEl(id: TileId, opts: { cross?: boolean } = {}): HTMLElement {
  const [a, b] = halves(id);
  const el = document.createElement('div');
  el.className = 'tile' + (opts.cross ? ' cross' : '');
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

type Dir = 'right' | 'left';

interface Placement {
  tile: PlacedTile;
  row: number;
  col: number;
  dir: Dir;
}

/**
 * A real domino line only turns at a double — the natural, meaningful
 * turning point, laid crosswise on the table. Everything else continues
 * straight in whatever direction the current row is travelling.
 *
 * The path is a strict boustrophedon (the way text wraps, or an ox plows a
 * field): each row travels entirely in one direction, a turn drops to a new
 * row and reverses that direction, and `row` only ever increases. This is
 * what guarantees the path can never self-intersect — every row is a
 * disjoint horizontal band, and within a row, column only ever moves one
 * way, so no two tiles can ever land on the same cell. An earlier version
 * of this function let the path turn in all four compass directions
 * (right/down/left/up in a cycle), which reads as more literally "the path
 * turns a corner" — but a walk that can turn any of four ways coils into a
 * spiral whenever segment lengths (the gaps between doubles) aren't
 * strictly increasing, which real hands essentially never guarantee, and
 * the spiral closes on itself: two tiles land in the same cell and one
 * hides behind the other. Confirmed against 600 simulated real hands: the
 * four-direction version overlapped on roughly 70% of hands at the
 * narrowest breakpoint. This two-direction version cannot overlap by
 * construction.
 *
 * `maxRun` exists purely as a width safety net: if a genuinely long run of
 * non-doubles happens with nothing forcing a turn, the row would otherwise
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
      row += 1;
      dir = dir === 'right' ? 'left' : 'right';
      runLength = 0;
    } else {
      col += dir === 'right' ? 1 : -1;
    }
  }
  return placements;
}

function boardCols(): number {
  const w = window.innerWidth;
  if (w >= 900) return 12;
  if (w >= 640) return 9;
  return 6;
}

export function renderBoard(host: HTMLElement, board: Board | null) {
  host.innerHTML = '';
  if (!board || board.line.length === 0) {
    host.style.gridTemplateColumns = '';
    host.style.gridTemplateRows = '';
    return;
  }

  const placements = layoutPath(board.line, boardCols());
  const rows = placements.map((p) => p.row);
  const cols = placements.map((p) => p.col);
  const minRow = Math.min(...rows), maxRow = Math.max(...rows);
  const minCol = Math.min(...cols), maxCol = Math.max(...cols);

  host.style.gridTemplateColumns = `repeat(${maxCol - minCol + 1}, auto)`;
  host.style.gridTemplateRows = `repeat(${maxRow - minRow + 1}, auto)`;

  for (const p of placements) {
    const node = tileEl(p.tile.tile, { cross: p.tile.crosswise });
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
