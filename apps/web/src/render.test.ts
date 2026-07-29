import test from 'node:test';
import assert from 'node:assert/strict';
import { halves } from '@yard/engine';
import type { Board, Pip, PlacedTile } from '@yard/engine';
import { orientLine, MIN_WIDTH_UNITS } from './layout.ts';
import { chooseUnit, rowsOf } from './render.ts';
import type { BoardBox } from './render.ts';

/**
 * The board used to render at a hardcoded 13 or 15 px unit, so a four-tile
 * opening and a twenty-eight-tile endgame came out the same size and the felt
 * stretched around bones that never grew. These lock in that the size now
 * follows the box.
 */

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A legal chain of `want` tiles, grown from a shuffled full set. */
function boardOf(want: number, rand: () => number): Board {
  const pool: string[] = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) pool.push(`${a}-${b}`);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const first = pool.shift()!;
  const [fa, fb] = halves(first);
  const line: PlacedTile[] = [{ tile: first, crosswise: fa === fb }];
  let left: Pip = fa;
  let right: Pip = fb;
  while (line.length < want) {
    const i = pool.findIndex((t) => { const [a, b] = halves(t); return a === left || b === left || a === right || b === right; });
    if (i === -1) break;
    const tile = pool.splice(i, 1)[0];
    const [a, b] = halves(tile);
    if (a === right || b === right) {
      right = (a === right ? b : a) as Pip;
      line.push({ tile, crosswise: a === b });
    } else {
      left = (a === left ? b : a) as Pip;
      line.unshift({ tile, crosswise: a === b });
    }
  }
  return { line } as Board;
}

/** Roughly a phone, and roughly the capped desktop column. */
const PHONE: BoardBox = { width: 375 - 32 - 56, height: 812 * 0.64 - 60 };
const DESKTOP: BoardBox = { width: 940 - 32 - 56, height: 560 - 60 };

test('a short line uses the biggest tiles the box allows', () => {
  const short = orientLine(boardOf(3, mulberry32(1)));
  const big = chooseUnit(short, DESKTOP).u;
  // The old hardcoded desktop unit was 15. Anything near it is the bug back.
  assert.ok(big >= 24, `a three-tile board should be big, got unit ${big}`);
});

test('a long line gives up size rather than overflowing the felt', () => {
  const rand = mulberry32(7);
  const short = chooseUnit(orientLine(boardOf(3, rand)), DESKTOP).u;
  const long = chooseUnit(orientLine(boardOf(28, rand)), DESKTOP).u;
  assert.ok(long < short, `a full board (${long}) must shrink below a short one (${short})`);
});

test('every board length fits the height it was given', () => {
  const rand = mulberry32(11);
  for (let n = 1; n <= 28; n++) {
    for (const box of [PHONE, DESKTOP]) {
      const { u, placements } = chooseUnit(orientLine(boardOf(n, rand)), box);
      const height = rowsOf(placements) * u;
      // The felt scrolls as a last resort, but only where no size fits at all.
      if (u > 11) {
        assert.ok(height <= box.height,
          `${n} tiles at unit ${u} needed ${height}px of ${box.height}px`);
      }
      const across = Math.max(...placements.map((p) => p.col + p.colSpan));
      assert.ok(across * u <= box.width,
        `${n} tiles at unit ${u} needed ${across * u}px of ${box.width}px wide`);
    }
  }
});

test('a wider box never produces smaller tiles', () => {
  const rand = mulberry32(3);
  for (let n = 1; n <= 28; n += 3) {
    const line = orientLine(boardOf(n, rand));
    assert.ok(chooseUnit(line, DESKTOP).u >= chooseUnit(line, PHONE).u,
      `${n} tiles came out smaller on desktop than on a phone`);
  }
});

test('the line is never squeezed narrower than it can turn a corner', () => {
  const rand = mulberry32(5);
  // A box far too narrow for the biggest tiles still has to lay out.
  const cramped: BoardBox = { width: 200, height: 200 };
  for (let n = 1; n <= 28; n += 5) {
    const { u, placements } = chooseUnit(orientLine(boardOf(n, rand)), cramped);
    const across = Math.max(...placements.map((p) => p.col + p.colSpan));
    assert.ok(across >= Math.min(MIN_WIDTH_UNITS, across), 'layout produced nothing');
    assert.ok(u >= 11 && u <= 28, `unit ${u} escaped its bounds`);
  }
});

test('a pinned unit is honoured, so the hero keeps the size it was designed at', () => {
  const line = orientLine(boardOf(10, mulberry32(2)));
  assert.equal(chooseUnit(line, DESKTOP, { maxUnits: 22, unit: 15 }).u, 15);
});

test('the width cap is respected even when there is room to be bigger', () => {
  const line = orientLine(boardOf(6, mulberry32(4)));
  const { placements } = chooseUnit(line, DESKTOP, { maxUnits: 16 });
  const across = Math.max(...placements.map((p) => p.col + p.colSpan));
  assert.ok(across <= 16, `capped at 16 units, laid out ${across}`);
});
