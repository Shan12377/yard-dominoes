import test from 'node:test';
import assert from 'node:assert/strict';
import { halves } from '@yard/engine';
import type { Board, CrossBoard, Pip, PlacedTile } from '@yard/engine';
import { orientLine, MIN_WIDTH_UNITS } from './layout.ts';
import { chooseUnit, crossPlacements, crossRejectReason, rowsOf } from './render.ts';
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

// ------------------------------------------------------------ cross board --
// A crosswise double used to get the same 2x2 footprint as an inline tile —
// a 4x2 (or 2x4) domino squeezed into half its own width, which is exactly
// what "why some looks squeezed" was pointing at. These pin the fixed shape:
// a crosswise tile's footprint SWAPS which dimension is long (2 along the
// arm, 4 across it), centred on the arm's normal band.

function emptyCrossBoard(): CrossBoard {
  return { kind: 'cross', center: '0-0', arms: [], doublesPlayed: [] };
}

/** One arm, one tile, everything else empty. */
function crossBoardWithOneTile(
  armIndex: 0 | 1 | 2 | 3, tile: string, crosswise: boolean,
): CrossBoard {
  const arms: CrossBoard['arms'] = [
    { direction: 'right', tiles: [], openEnd: 0 },
    { direction: 'left', tiles: [], openEnd: 0 },
    { direction: 'up', tiles: [], openEnd: 0 },
    { direction: 'down', tiles: [], openEnd: 0 },
  ];
  arms[armIndex] = { ...arms[armIndex], tiles: [{ tile, crosswise }] };
  return { kind: 'cross', center: '0-0', arms, doublesPlayed: [] };
}

test('an empty cross board centres the chucha with room to spare on every side', () => {
  const { totalCols, totalRows, placements } = crossPlacements(emptyCrossBoard());
  assert.equal(placements.length, 1);
  const chucha = placements[0];
  assert.equal(chucha.colSpan, 2);
  assert.equal(chucha.rowSpan, 2);
  // Centred: equal buffer on both sides, not flush against one edge.
  assert.equal(chucha.col - 1, totalCols - (chucha.col + chucha.colSpan - 1));
  assert.equal(chucha.row - 1, totalRows - (chucha.row + chucha.rowSpan - 1));
});

// Regression: round 2+ can centre a French cross on ANY double the winner
// posed (3-3, 6-6, ...), not only the chucha. The centre placement's faces
// were hardcoded to [0, 0] from when the chucha was the only possible
// centre — a live board showed this exact bug, rendering a posed 6-6 as a
// blank tile. Faces must track board.center, whatever it actually is.
test('the centre tile renders the pips of whatever double was actually posed, not always blank', () => {
  const board: CrossBoard = { kind: 'cross', center: '6-6', arms: [], doublesPlayed: [6] };
  const { placements } = crossPlacements(board);
  assert.equal(placements.length, 1);
  assert.deepEqual(placements[0].faces, [6, 6], 'a 6-6 spinner must render as 6-6, not 0-0');
});

// Regression, same root cause as the centre-face bug above but worse: the
// first tile of each arm decides its inner/outer orientation against a
// hardcoded blank anchor. Live on a 1-1 spinner this put a 1-6 fill tile's
// 1 (the half that actually matches the centre) on the OUTER end and the
// unrelated 6 on the inner end — backwards. Anchor must track the centre's
// real pip value.
test('the first tile of an arm orients its centre-matching half inward, even on a non-chucha spinner', () => {
  const board: CrossBoard = {
    kind: 'cross',
    center: '1-1',
    arms: [{ direction: 'right', tiles: [{ tile: '1-6', crosswise: false }], openEnd: 6 }],
    doublesPlayed: [1],
  };
  const { placements } = crossPlacements(board);
  assert.equal(placements.length, 2);
  // Right arm is not reversed: faces = [inner, outer]. The 1 (matching the
  // 1-1 centre) must be inner; the unrelated 6 must be outer.
  assert.deepEqual(placements[1].faces, [1, 6], 'the 1 must face the centre, not the outer end');
});

test('a non-double lies along its arm: long side matches the arm direction', () => {
  const right = crossPlacements(crossBoardWithOneTile(0, '0-3', false)).placements[1];
  assert.equal(right.colSpan, 4, 'a horizontal-arm single should be wide');
  assert.equal(right.rowSpan, 2, 'and no taller than the line it sits on');

  const up = crossPlacements(crossBoardWithOneTile(2, '0-3', false)).placements[1];
  assert.equal(up.colSpan, 2, 'a vertical-arm single should be narrow');
  assert.equal(up.rowSpan, 4, 'and as long as the arm it lies along');
});

test('a double lies crosswise: long side is PERPENDICULAR to the arm, not squeezed to a single-tile footprint', () => {
  const right = crossPlacements(crossBoardWithOneTile(0, '3-3', true)).placements[1];
  assert.equal(right.colSpan, 2, 'crosswise in a horizontal arm: narrow along it');
  assert.equal(right.rowSpan, 4, 'crosswise in a horizontal arm: wide across it');

  const up = crossPlacements(crossBoardWithOneTile(2, '3-3', true)).placements[1];
  assert.equal(up.colSpan, 4, 'crosswise in a vertical arm: wide across it');
  assert.equal(up.rowSpan, 2, 'crosswise in a vertical arm: narrow along it');
});

test('a crosswise double is centred on its arm\'s own band, not flush to one side', () => {
  // The chucha's band is [chucha.col, chucha.col + 1] — a crosswise tile
  // across-span of 4 centred on that band starts exactly 1 unit earlier.
  const { placements } = crossPlacements(crossBoardWithOneTile(2, '3-3', true));
  const [chucha, up] = placements;
  assert.equal(up.col, chucha.col - 1);
});

test('a crosswise double never requests a column or row below the grid start, even when the opposite arm is still empty', () => {
  for (const armIndex of [0, 1, 2, 3] as const) {
    const { placements } = crossPlacements(crossBoardWithOneTile(armIndex, '3-3', true));
    for (const p of placements) {
      assert.ok(p.col >= 1, `arm ${armIndex}: col ${p.col} is off the explicit grid`);
      assert.ok(p.row >= 1, `arm ${armIndex}: row ${p.row} is off the explicit grid`);
    }
  }
});

// ------------------------------------------------------------ crossRejectReason --
// Doubles-must-lead is board-wide: once a suit's double has been played
// ANYWHERE on the board (CrossBoard.doublesPlayed), every arm showing that
// number is live, regardless of which arm the double actually landed on.
// The legality check is tested directly in packages/engine/test/hand.test.ts;
// this covers the player-facing "why can't I play this" message built on
// top of the same board.doublesPlayed field.

test('names the exact number that needs its own double, when it has not been played anywhere yet', () => {
  const board: CrossBoard = {
    kind: 'cross',
    center: '0-0',
    arms: [
      { direction: 'right', tiles: [], openEnd: 6 },
      { direction: 'left', tiles: [], openEnd: 1 },
      { direction: 'up', tiles: [], openEnd: 2 },
      { direction: 'down', tiles: [], openEnd: 3 },
    ],
    doublesPlayed: [],
  };
  const reason = crossRejectReason(board, '6-5');
  assert.match(reason ?? '', /\b6\b/, 'must name the 6 by number');
});

test('returns null once that suit\'s double has been played anywhere on the board, not only on this arm', () => {
  const board: CrossBoard = {
    kind: 'cross',
    center: '0-0',
    arms: [
      // 6-6 landed on the LEFT arm; the RIGHT arm reached 6 some other way
      // (e.g. a 2-6) and never had 6-6 played on it specifically — board-wide
      // means that doesn't matter.
      { direction: 'right', tiles: [], openEnd: 6 },
      { direction: 'left', tiles: [], openEnd: 3 },
      { direction: 'up', tiles: [], openEnd: 1 },
      { direction: 'down', tiles: [], openEnd: 4 },
    ],
    doublesPlayed: [6],
  };
  assert.equal(crossRejectReason(board, '6-5'), null);
});

test('a tile matching no open end at all gets the generic reason, not a fabricated arm number', () => {
  const board: CrossBoard = {
    kind: 'cross',
    center: '0-0',
    arms: [
      { direction: 'right', tiles: [], openEnd: 1 },
      { direction: 'left', tiles: [], openEnd: 2 },
      { direction: 'up', tiles: [], openEnd: 3 },
      { direction: 'down', tiles: [], openEnd: 4 },
    ],
    doublesPlayed: [],
  };
  assert.equal(crossRejectReason(board, '6-5'), "Doesn't match any open end on the board.");
});

test('during the fill phase, names the centre value the next arm has to touch', () => {
  const board: CrossBoard = { kind: 'cross', center: '3-3', arms: [], doublesPlayed: [3] };
  const reason = crossRejectReason(board, '6-5');
  assert.match(reason ?? '', /\b3\b/, 'must name the centre value (3), not the tile\'s own numbers');
});
