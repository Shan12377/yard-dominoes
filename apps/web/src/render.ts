import { halves } from '@yard/engine';
import type { Board, TileId } from '@yard/engine';

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

/**
 * Real boards turn corners once they run out of table instead of scrolling
 * sideways forever. `.line` is a CSS Grid with a column count this function
 * sets directly (see the note on why it can't come from a CSS media query).
 * `board.line` is already physical left-to-right order (see `Board.line`'s
 * doc comment in packages/engine/src/types.ts) — a straight append would
 * just make one row that keeps growing sideways, which is the problem this
 * replaces. Every other row is reversed before appending, so DOM order still
 * matches the grid's natural fill order (top-to-bottom, left-to-right) while
 * the *visual* result reads as one continuous path that turns at the edge of
 * the table instead of jumping back to the left edge each wrap. Plain grid
 * auto-flow is not enough on its own, though: it packs a row's items starting
 * at column 1 regardless of how many items are in that row, so a reversed row
 * that isn't completely full — which is most rows, since a hand's tile count
 * is essentially never an exact multiple of the column count — would pack to
 * the LEFT instead of right-aligning under the previous row's endpoint. Only
 * a reversed row gets an explicit `grid-column` per tile to force that
 * right-alignment; a natural (unreversed) row is already correct under plain
 * auto-flow, full or partial, because it starts at column 1 either way.
 */
function boardCols(): number {
  const w = window.innerWidth;
  if (w >= 900) return 12;
  if (w >= 640) return 9;
  return 6;
}

export function renderBoard(host: HTMLElement, board: Board | null) {
  host.innerHTML = '';
  host.style.setProperty('--board-cols', String(boardCols()));
  if (!board) return;

  const cols = boardCols();
  for (let i = 0; i < board.line.length; i += cols) {
    const row = board.line.slice(i, i + cols);
    const rowIndex = i / cols;
    const reversed = rowIndex % 2 === 1;
    const ordered = reversed ? row.slice().reverse() : row;
    // A reversed row's first play-order tile (last in `ordered`) is the one
    // that connects to the previous row's endpoint, and it must land in the
    // rightmost column regardless of how many tiles are in this row — plain
    // auto-flow packs a partial row to the LEFT instead, breaking the
    // connection for every row except one that happens to be exactly full.
    const startCol = reversed ? cols - row.length + 1 : 1;
    ordered.forEach((placed, k) => {
      const node = tileEl(placed.tile, { cross: placed.crosswise });
      if (reversed) node.style.gridColumn = String(startCol + k);
      host.appendChild(node);
    });
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
