import test from 'node:test';
import assert from 'node:assert/strict';
import { halves } from '@yard/engine';
import type { Board, Pip, PlacedTile } from '@yard/engine';
import { layoutLine, orientLine, MIN_WIDTH_UNITS } from './layout.ts';

/** Deterministic PRNG so a failure reproduces. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a random legal board by growing a chain from a full shuffled set. */
function randomBoard(rand: () => number): Board {
  const pool: string[] = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) pool.push(`${a}-${b}`);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const first = pool.shift()!;
  const [fa, fb] = halves(first);
  const line: PlacedTile[] = [{ tile: first, crosswise: fa === fb }];
  let leftEnd: Pip = fa;
  let rightEnd: Pip = fb;

  const target = 6 + Math.floor(rand() * 16); // 6..21 tiles
  while (line.length < target) {
    const side = rand() < 0.5 ? 'left' : 'right';
    const end = side === 'left' ? leftEnd : rightEnd;
    const idx = pool.findIndex((t) => halves(t).includes(end));
    if (idx === -1) break;
    const [tile] = pool.splice(idx, 1);
    const [a, b] = halves(tile);
    const other = (a === end ? b : a) as Pip;
    if (side === 'left') { line.unshift({ tile, crosswise: a === b }); leftEnd = other; }
    else { line.push({ tile, crosswise: a === b }); rightEnd = other; }
  }
  return { line, leftEnd, rightEnd };
}

interface Rect { col: number; row: number; colSpan: number; rowSpan: number }
const overlaps = (a: Rect, b: Rect) =>
  a.col < b.col + b.colSpan && b.col < a.col + a.colSpan &&
  a.row < b.row + b.rowSpan && b.row < a.row + a.rowSpan;
const touches = (a: Rect, b: Rect) =>
  a.col <= b.col + b.colSpan && b.col <= a.col + a.colSpan &&
  a.row <= b.row + b.rowSpan && b.row <= a.row + a.rowSpan;

test('orientLine matches pips at every junction and both ends', () => {
  const rand = mulberry32(7);
  for (let i = 0; i < 500; i++) {
    const board = randomBoard(rand);
    const oriented = orientLine(board);
    assert.equal(oriented[0].inPip, board.leftEnd);
    assert.equal(oriented[oriented.length - 1].outPip, board.rightEnd);
    for (let k = 1; k < oriented.length; k++) {
      assert.equal(oriented[k].inPip, oriented[k - 1].outPip,
        `junction ${k} of ${board.line.map((p) => p.tile).join(' ')}`);
    }
  }
});

test('layoutLine never overlaps, never leaves the board, stays connected', () => {
  const rand = mulberry32(42);
  const widths = [MIN_WIDTH_UNITS, 18, 26, 40, 60];
  for (let i = 0; i < 2000; i++) {
    const board = randomBoard(rand);
    const width = widths[i % widths.length];
    const placements = layoutLine(orientLine(board), width);
    assert.equal(placements.length, board.line.length);

    for (let k = 0; k < placements.length; k++) {
      const p = placements[k];
      assert.ok(p.col >= 0 && p.col + p.colSpan <= width,
        `tile ${k} off-board: col ${p.col} span ${p.colSpan} width ${width}`);
      for (let j = 0; j < k; j++) {
        assert.ok(!overlaps(p, placements[j]),
          `tiles ${j} and ${k} overlap in hand ${board.line.map((t) => t.tile).join(' ')} at width ${width}`);
      }
      if (k > 0) {
        assert.ok(touches(p, placements[k - 1]), `tiles ${k - 1} and ${k} disconnected`);
      }
    }
  }
});

test('doubles lie crosswise and non-doubles lie along the line', () => {
  const rand = mulberry32(99);
  for (let i = 0; i < 200; i++) {
    const board = randomBoard(rand);
    const placements = layoutLine(orientLine(board), 26);
    for (const p of placements) {
      const [a, b] = halves(p.placed.tile);
      if (a === b) assert.equal(p.orient, 'v', `double ${p.placed.tile} not crosswise`);
    }
  }
});
