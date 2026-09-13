import test from 'node:test';
import assert from 'node:assert/strict';
import { halves } from '@yard/engine';
import type { Board, CrossBoard, Pip, PlacedTile, TileId } from '@yard/engine';
import { orientLine, MIN_WIDTH_UNITS } from './layout.ts';
import { assertRenderableBoard, assertVisibleTilesDisjoint, armDirectionFor, boardGuardInsets, crossArmDirections, frenchCanvasUnit, paddingBoxOf, chooseCrossFit, chooseCrossUnit, chooseUnit, crossPlacements, crossRejectReason, liveAcrossRouteUnits, liveLinearGeometry, liveTableUnit, phoneCrossGrid, phoneCrossRoute, rowsOf } from './render.ts';
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
// The live phone stage after its top/side stations, local hand rail, and the
// line's own padding are reserved. This is deliberately narrower than PHONE,
// which also covers standalone/replay renderers without those live controls.
// A 390px phone leaves a 50px protected lane on each side for the edge racks;
// renderBoard receives the stage less its 7px visual padding on both sides.
const PHONE_LIVE_STAGE: BoardBox = { width: 213, height: 352 };

test('the renderer accepts a legal connected line and rejects mismatched or repeated bones', () => {
  const legal: Board = {
    kind: 'linear', leftEnd: 6, rightEnd: 4,
    line: [{ tile: '3-6', crosswise: false }, { tile: '3-4', crosswise: false }],
  };
  assert.doesNotThrow(() => assertRenderableBoard(legal));

  assert.throws(() => assertRenderableBoard({
    ...legal,
    line: [{ tile: '3-6', crosswise: false }, { tile: '3-6', crosswise: false }],
    rightEnd: 6,
  }), /duplicate rendered tile/);
  assert.throws(() => assertRenderableBoard({
    ...legal,
    line: [{ tile: '3-6', crosswise: false }, { tile: '1-4', crosswise: false }],
  }), /broken rendered join/);
});

test('the renderer rejects a French arm whose joins or declared open end are false', () => {
  const legal: CrossBoard = {
    kind: 'cross', center: '0-0', doublesPlayed: [0],
    arms: [{ direction: 'right', openEnd: 5, tiles: [{ tile: '0-5', crosswise: false }] }],
  };
  assert.doesNotThrow(() => assertRenderableBoard(legal));
  assert.throws(() => assertRenderableBoard({
    ...legal,
    arms: [{ direction: 'right', openEnd: 6, tiles: [{ tile: '0-5', crosswise: false }] }],
  }), /broken rendered right open end/);
  assert.throws(() => assertRenderableBoard({
    ...legal,
    arms: [{ direction: 'right', openEnd: 5, tiles: [{ tile: '1-5', crosswise: false }] }],
  }), /broken rendered right arm/);
});

test('a tile that has landed may not remain visible in its owner’s hand', () => {
  const board: Board = {
    kind: 'linear', leftEnd: 6, rightEnd: 3,
    line: [{ tile: '3-6', crosswise: false }],
  };
  assert.doesNotThrow(() => assertVisibleTilesDisjoint(board, ['0-0', '2-4']));
  assert.throws(() => assertVisibleTilesDisjoint(board, ['3-6', '2-4']), /played tile still visible in hand/);
});

test('the invisible board guard excludes every hand and opponent lane', () => {
  const felt = { top: 0, right: 1000, bottom: 800, left: 0 };
  const stage = { top: 60, right: 950, bottom: 720, left: 50 };
  const gap = 24;
  const guard = boardGuardInsets(felt, stage, [
    { edge: 'top', rect: { top: 10, right: 620, bottom: 150, left: 380 } },
    { edge: 'left', rect: { top: 220, right: 140, bottom: 610, left: 10 } },
    { edge: 'right', rect: { top: 220, right: 990, bottom: 610, left: 860 } },
    { edge: 'bottom', rect: { top: 620, right: 650, bottom: 790, left: 350 } },
  ], gap);
  assert.deepEqual(guard, { top: 174, right: 289, bottom: 204, left: 289 });
  assert.equal(1000 - guard.left - guard.right, 800 - guard.top - guard.bottom,
    'the measured board guard must be square');
});

test('a LINEAR guard keeps the full height instead of squaring away', () => {
  // Same felt and obstacles as above. Squaring is a French requirement — its
  // four arms need equal clearance every way. A linear chain snakes in rows,
  // so squaring just throws height away: measured on a real 430x932 phone it
  // cut the playable board to 247x246, and from 20 bones down every single
  // board overflowed and had to be scrolled mid-hand.
  const felt = { top: 0, right: 1000, bottom: 800, left: 0 };
  const stage = { top: 60, right: 950, bottom: 720, left: 50 };
  const obstacles = [
    { edge: 'top' as const, rect: { top: 10, right: 620, bottom: 150, left: 380 } },
    { edge: 'left' as const, rect: { top: 220, right: 140, bottom: 610, left: 10 } },
    { edge: 'right' as const, rect: { top: 220, right: 990, bottom: 610, left: 860 } },
    { edge: 'bottom' as const, rect: { top: 620, right: 650, bottom: 790, left: 350 } },
  ];
  const square = boardGuardInsets(felt, stage, obstacles, 24, true);
  const rect = boardGuardInsets(felt, stage, obstacles, 24, false);

  // The obstacles still hold the board off every station and the hand...
  assert.equal(rect.top, 174, 'still clear of the top station');
  assert.equal(rect.bottom, 204, 'still clear of the hand');
  assert.equal(rect.left, 164, 'still clear of the left lane');
  assert.equal(rect.right, 164, 'still clear of the right lane');

  // ...but the spare width is no longer spent making it a square.
  const squareH = 800 - square.top - square.bottom;
  const rectH = 800 - rect.top - rect.bottom;
  const rectW = 1000 - rect.left - rect.right;
  assert.equal(squareH, rectH, 'height was never the binding side here');
  assert.ok(rectW > 1000 - square.left - square.right,
    'a linear board keeps the width the square gave away');
});

test('a short line uses the biggest tiles the box allows', () => {
  const short = orientLine(boardOf(3, mulberry32(1)));
  const big = chooseUnit(short, DESKTOP).u;
  // The old hardcoded desktop unit was 15. Anything near it is the bug back.
  assert.ok(big >= 24, `a three-tile board should be big, got unit ${big}`);
});

test('an UNPINNED line gives up size rather than overflowing its box', () => {
  // Still correct, but only for the views that do not pin a unit: Watch Back,
  // the Coach and the landing hero, which show a finished hand in a fixed box
  // and should fit it. A LIVE table pins its unit and never takes this path —
  // see 'linear bone size is fixed from the pose through the late hand'.
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

test('a live phone can cap a new board bone to the rack bone size', () => {
  const line = orientLine(boardOf(3, mulberry32(31)));
  assert.equal(chooseUnit(line, DESKTOP, { maxUnit: 20 }).u, 20,
    'a seven- or fourteen-bone phone rack uses a 40px short side');
  assert.equal(chooseUnit(line, DESKTOP, { maxUnit: 15 }).u, 15,
    'a nine-bone phone rack uses a 30px short side');
});

test('live tables start with a deliberate readable hand and rack tier', () => {
  assert.equal(liveTableUnit(390, null), 14, 'phone bones have a 28px short side');
  assert.equal(liveTableUnit(1368, null), 26, 'desktop bones have a generous 52px short side');
  assert.equal(liveTableUnit(390, null, true), 14,
    'French keeps a readable 28px short side on phone');
  assert.equal(liveTableUnit(938, null, true), 15,
    'French keeps JamDom’s 30px baseline on compact desktop');
  assert.equal(liveTableUnit(1368, emptyCrossBoard()), 17,
    'French scales the reference proportion on desktop');
  assert.equal(chooseCrossUnit(emptyCrossBoard(), PHONE, { maxUnit: 14 }), 14,
    'French board and hand honour the same readable ceiling');
});

test('desktop linear geometry fits a complete hand before locking its bone size', () => {
  const cases = [
    { viewport: 1368, box: { width: 852, height: 500 } },
    { viewport: 2056, box: { width: 1200, height: 704 } },
  ];
  for (const { viewport, box } of cases) {
    const geometry = liveLinearGeometry(viewport, box);
    for (let seed = 1; seed <= 100; seed += 1) {
      const placements = chooseUnit(orientLine(boardOf(28, mulberry32(seed))), box, {
        unit: geometry.unit,
        maxUnits: geometry.maxUnits,
      }).placements;
      const width = Math.max(...placements.map((p) => p.col + p.colSpan)) * geometry.unit;
      const height = rowsOf(placements) * geometry.unit;
      assert.ok(width <= box.width, `${viewport}px seed ${seed}: ${width}px > ${box.width}px wide`);
      assert.ok(height <= box.height, `${viewport}px seed ${seed}: ${height}px > ${box.height}px tall`);
    }
  }
  assert.deepEqual(liveLinearGeometry(390, { width: 213, height: 352 }), { unit: 14, maxUnits: 20 },
    'phones keep their readable fixed tier and deliberate pan route');
});

test('Across keeps its readable floor when the board stage is short', () => {
  const geometry = liveLinearGeometry(1440, { width: 1200, height: 400 }, 22);
  assert.equal(geometry.unit, 22,
    'stage height must not silently turn the 44px Across bone back into a tiny counter');
});

test('Across derives its route from the locked bone and never exceeds the measured stage', () => {
  assert.equal(liveAcrossRouteUnits(null, 22), 32,
    'first paint uses the stable complete-hand route instead of guessing a wide felt');
  assert.equal(liveAcrossRouteUnits({ width: 1200, height: 500 }, 22), 40,
    'a wide felt caps the run instead of stretching a hand into one long strip');
  assert.equal(liveAcrossRouteUnits({ width: 1200, height: 700 }, 32), 37,
    'a larger locked bone uses the measured route while its arrow clamps inside');

  for (const { box, unit } of [
    { box: { width: 980, height: 480 }, unit: 22 },
    { box: { width: 1200, height: 700 }, unit: 32 },
    { box: { width: 520, height: 420 }, unit: 22 },
  ]) {
    const maxUnits = liveAcrossRouteUnits(box, unit);
    assert.ok(maxUnits * unit <= box.width,
      `${maxUnits} route units at ${unit}px must stay inside ${box.width}px`);
    for (let seed = 1; seed <= 100; seed += 1) {
      const placements = chooseUnit(orientLine(boardOf(28, mulberry32(seed))), box, {
        unit,
        maxUnits,
      }).placements;
      const minCol = Math.min(...placements.map((p) => p.col));
      const maxCol = Math.max(...placements.map((p) => p.col + p.colSpan));
      const width = (maxCol - minCol) * unit;
      assert.ok(width <= box.width,
        `Across seed ${seed} needed ${width}px of ${box.width}px wide`);
    }
  }
});

test('Across complete-hand route fits the measured 1440px desktop table without hiding', () => {
  // Across now moves its rail below the felt at ordinary desktop widths and
  // gives the board a stable 560px floor. Keep that measured floor here: the
  // old 677x488 side-rail lane was the geometry that repeatedly clipped.
  const box = { width: 1200, height: 560 };
  const unit = 22;
  const maxUnits = liveAcrossRouteUnits(box, unit);
  for (let seed = 1; seed <= 200; seed += 1) {
    const placements = chooseUnit(orientLine(boardOf(28, mulberry32(seed))), box, {
      unit,
      maxUnits,
    }).placements;
    const minCol = Math.min(...placements.map((p) => p.col));
    const maxCol = Math.max(...placements.map((p) => p.col + p.colSpan));
    assert.ok((maxCol - minCol) * unit <= box.width,
      `seed ${seed} crossed the protected horizontal edge`);
    assert.ok(rowsOf(placements) * unit <= box.height,
      `seed ${seed} crossed the protected vertical edge`);
  }
});

test('a phone linear board never changes tier as the hand fills', () => {
  // Was 'phone board tiers only step down as a linear hand fills', asserting
  // [14, 12, 10]. That is the behaviour being removed: the bone must not move
  // at all. Kept as its own test rather than folded into the invariant above
  // so the phone case — where the stepping was most visible — stays explicit.
  const board = boardOf(28, mulberry32(81));
  const tiers: number[] = [];
  for (let n = 0; n <= board.line.length; n++) {
    tiers.push(liveTableUnit(390, { ...board, line: board.line.slice(0, n) }));
  }
  assert.deepEqual([...new Set(tiers)], [14],
    'one tier and one only, from empty board to twenty-eight played');
});

test('linear bone size is fixed from the pose through the late hand', () => {
  // The twin of the French test below, and the whole reason a JamDom player
  // does not recognise this table: a bone is one physical object from deal to
  // final play. A crowded board is absorbed by the ROUTE — the line turns and
  // snakes — never by the bone shrinking under the player's hand.
  //
  // This replaces two tests that locked in the opposite behaviour ('a long
  // line gives up size rather than overflowing the felt', and 'phone board
  // tiers only step down as a linear hand fills'). Those encoded a real
  // earlier fix — the board had been a hardcoded 13-15px unit and a four-tile
  // opening looked marooned — but they solved it by making the bone elastic
  // instead of making it bigger. Empty wood around a short chain is what a
  // real table looks like; see docs/prototypes/.
  const board = boardOf(28, mulberry32(81));
  const at = (played: number) => ({ ...board, line: board.line.slice(0, played) });
  for (const width of [390, 938, 1368]) {
    const opening = liveTableUnit(width, at(1));
    for (const played of [4, 10, 18, 28]) {
      assert.equal(liveTableUnit(width, at(played)), opening,
        `${width}px viewport: bone changed between 1 and ${played} played`);
    }
  }
});

test('French bone size is fixed from opening pose through the late hand', () => {
  const at = (played: number): CrossBoard => ({
    ...emptyCrossBoard(),
    arms: [{
      direction: 'right', openEnd: 1,
      tiles: Array.from({ length: Math.max(0, played - 1) }, () => ({
        tile: '0-1' as TileId, crosswise: false,
      })),
    }],
  });
  assert.deepEqual([1, 11, 15, 19].map((n) => liveTableUnit(846, at(n), true)),
    [15, 15, 15, 15]);
  assert.deepEqual([1, 11, 15, 19].map((n) => liveTableUnit(1900, at(n), true)),
    [24, 24, 24, 24]);
});

test('a played-out live hand fits desktop without scrolling while phone keeps deliberate pan', () => {
  // Desktop chooses one physical bone size from the measured, complete-hand
  // route before the pose is dealt. It must therefore fit every later state
  // without changing size or exposing a mystery scrollbar. A phone preserves
  // its larger readable tier and may pan the protected board stage instead.
  const tall: Record<string, number> = { phone: 0, desktop: 0 };
  for (let seed = 1; seed <= 100; seed++) {
    for (const [label, box, viewportWidth, minUnit] of [
      ['phone', PHONE_LIVE_STAGE, 390, 10],
      ['desktop', DESKTOP, 1368, 11],
    ] as const) {
      const board = boardOf(28, mulberry32(seed));
      const line = orientLine(board);
      const geometry = liveLinearGeometry(viewportWidth, box);
      const unit = geometry.unit;
      const { u, placements } = chooseUnit(line, box, {
        unit,
        maxUnit: unit,
        minUnit,
        maxUnits: geometry.maxUnits,
      });
      assert.equal(u, unit, `${label} seed ${seed}: the pinned bone must be honoured`);
      const across = Math.max(...placements.map((p) => p.col + p.colSpan));
      assert.ok(across * u <= box.width,
        `${label} seed ${seed} needed ${across * u}px of ${box.width}px wide`);
      if (rowsOf(placements) * u > box.height) tall[label] += 1;
      if (label === 'desktop') assert.ok(u >= 18, 'desktop bones stay comparable to the hand');
      else assert.ok(u >= 14, 'a phone bone holds its 28px short side however full the board');
    }
  }
  // Measured, and recorded here so the next person does not have to guess how
  // often the pan actually engages on a full board.
  assert.ok(tall.phone >= 90,
    `a phone board is expected to be taller than its stage nearly always, got ${tall.phone}/100`);
  assert.equal(tall.desktop, 0,
    `desktop must show the complete hand without a board scrollbar, got ${tall.desktop}/100 tall`);
});

test('a short landscape or Across stage keeps a controlled pan instead of clipping', () => {
  const box = { width: 520, height: 146 };
  const geometry = liveLinearGeometry(1368, box);
  let needsPan = 0;
  for (let seed = 1; seed <= 100; seed += 1) {
    const placements = chooseUnit(orientLine(boardOf(28, mulberry32(seed))), box, {
      unit: geometry.unit,
      maxUnits: geometry.maxUnits,
    }).placements;
    if (rowsOf(placements) * geometry.unit > box.height) needsPan += 1;
  }
  assert.ok(needsPan > 0,
    'the short-stage fixture must exercise the measured overflow fallback');
});

test('the width cap is respected even when there is room to be bigger', () => {
  const line = orientLine(boardOf(6, mulberry32(4)));
  const { placements } = chooseUnit(line, DESKTOP, { maxUnits: 16 });
  const across = Math.max(...placements.map((p) => p.col + p.colSpan));
  assert.ok(across <= 16, `capped at 16 units, laid out ${across}`);
});

test('a live desktop line uses its complete-hand lane even when more width is available', () => {
  const line = orientLine(boardOf(20, mulberry32(404)));
  const box = { width: 1600, height: 704 };
  const geometry = liveLinearGeometry(2056, box);
  const roomy = chooseUnit(line, box, { unit: geometry.unit });
  const routed = chooseUnit(line, box, { unit: geometry.unit, maxUnits: geometry.maxUnits });
  const firstVertical = (placements: typeof roomy.placements) =>
    placements.findIndex((placement) => placement.orient === 'v'
      && placement.faces[0] !== placement.faces[1]);
  assert.equal(geometry.maxUnits, 32);
  assert.ok(firstVertical(roomy.placements) > firstVertical(routed.placements),
    'the live route should turn inside its precomputed complete-hand lane');
});

test('Watch Back may use compact tiles to fit a completed hand without a horizontal pan', () => {
  const line = orientLine(boardOf(28, mulberry32(23)));
  const replayBox: BoardBox = { width: 300, height: 272 };
  const { u, placements } = chooseUnit(line, replayBox, { minUnit: 8 });
  const across = Math.max(...placements.map((p) => p.col + p.colSpan));
  assert.ok(u >= 8 && u <= 32, `replay unit ${u} escaped its compact bounds`);
  assert.ok(across * u <= replayBox.width,
    `replay needed ${across * u}px of ${replayBox.width}px wide`);
  assert.ok(rowsOf(placements) * u <= replayBox.height,
    `replay needed ${rowsOf(placements) * u}px of ${replayBox.height}px high`);
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

test('the same live phone cap applies to an early French cross', () => {
  const board: CrossBoard = { kind: 'cross', center: '0-0', arms: [], doublesPlayed: [0] };
  assert.equal(chooseCrossUnit(board, DESKTOP, { maxUnit: 20 }), 20);
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

test('Watch Back fits a dense French cross to its measured replay box', () => {
  const arms: CrossBoard['arms'] = [
    { direction: 'right', openEnd: 0, tiles: Array.from({ length: 5 }, () => ({ tile: '0-0', crosswise: true })) },
    { direction: 'left', openEnd: 0, tiles: Array.from({ length: 5 }, () => ({ tile: '0-0', crosswise: true })) },
    { direction: 'up', openEnd: 0, tiles: Array.from({ length: 5 }, () => ({ tile: '0-0', crosswise: true })) },
    { direction: 'down', openEnd: 0, tiles: Array.from({ length: 5 }, () => ({ tile: '0-0', crosswise: true })) },
  ];
  const board: CrossBoard = { kind: 'cross', center: '0-0', arms, doublesPlayed: [0] };
  const box: BoardBox = { width: 300, height: 272 };
  const { totalCols, totalRows } = crossPlacements(board);
  const u = chooseCrossUnit(board, box, { minUnit: 8 });
  assert.ok(u >= 8 && u <= 32, `French replay unit ${u} escaped compact bounds`);
  assert.ok(totalCols * u <= box.width, `French replay needed ${totalCols * u}px of ${box.width}px wide`);
  assert.ok(totalRows * u <= box.height, `French replay needed ${totalRows * u}px of ${box.height}px high`);
});

test('an active French cross fits a dense ordinary hand above its protected rail', () => {
  // A realistic early spread can already have four normal bones on every
  // arm. This is the constrained area left above a docked mobile hand: it
  // must show the whole cross before asking the player to pan, while keeping
  // the bones larger than the old six-pixel fallback.
  const arm = (direction: CrossBoard['arms'][number]['direction']) => ({
    direction,
    openEnd: 0 as Pip,
    tiles: Array.from({ length: 4 }, () => ({ tile: '0-1' as const, crosswise: false })),
  });
  const board: CrossBoard = {
    kind: 'cross', center: '0-0',
    arms: [arm('right'), arm('left'), arm('up'), arm('down')],
    doublesPlayed: [0],
  };
  // A French-specific 520px felt leaves roughly this real stage after its
  // hand rail, felt chrome and line padding are reserved. The French-only
  // phone gutter borrows enough width for the complete four-arm overview.
  const box: BoardBox = { width: 302, height: 331 };
  const { totalCols, totalRows } = crossPlacements(board);
  const u = chooseCrossUnit(board, box);
  assert.ok(u >= 14, `folding the arms should keep a readable French bone, got ${u}`);
  assert.ok(totalCols * u <= box.width && totalRows * u <= box.height,
    'a dense French board must remain wholly visible above the protected hand rail');
});

test('long French arms turn into four separate quadrants instead of shrinking as straight rays', () => {
  const arm = (direction: CrossBoard['arms'][number]['direction']) => ({
    direction,
    openEnd: 0 as Pip,
    tiles: Array.from({ length: 6 }, (_, i) => ({
      tile: (i === 2 ? '1-1' : '0-1') as const,
      crosswise: i === 2,
    })),
  });
  const board: CrossBoard = {
    kind: 'cross', center: '0-0',
    arms: [arm('right'), arm('left'), arm('up'), arm('down')],
    doublesPlayed: [0, 1],
  };
  const { totalCols, totalRows, placements } = crossPlacements(board);
  assert.ok(totalCols <= 30 && totalRows <= 30,
    `single-turn cross unexpectedly occupied ${totalCols}×${totalRows} cells`);
  for (let i = 0; i < placements.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = placements[i];
      const b = placements[j];
      const overlap = a.col < b.col + b.colSpan && b.col < a.col + a.colSpan
        && a.row < b.row + b.rowSpan && b.row < a.row + a.rowSpan;
      assert.equal(overlap, false, `folded French placements ${j} and ${i} overlap`);
    }
  }
  assert.ok(chooseCrossUnit(board, { width: 768, height: 768 }) >= 25,
    'a roomy table keeps at least 50px bones instead of miniaturising the four arms');
});

test('each French arm turns at most once and the tight route elbows after two ordinary bones', () => {
  const arm = (direction: CrossBoard['arms'][number]['direction']) => ({
    direction,
    openEnd: 0 as Pip,
    tiles: Array.from({ length: 6 }, () => ({ tile: '0-1' as const, crosswise: false })),
  });
  const board: CrossBoard = {
    kind: 'cross', center: '0-0',
    arms: [arm('right'), arm('left'), arm('up'), arm('down')],
    doublesPlayed: [0],
  };
  const { placements } = crossPlacements(board, 8);
  for (let armIndex = 0; armIndex < 4; armIndex++) {
    const route = placements.filter((p) => p.crossArm === armIndex)
      .sort((a, b) => (a.crossStep ?? 0) - (b.crossStep ?? 0));
    const centres = route.map((p) => [p.col + p.colSpan / 2, p.row + p.rowSpan / 2] as const);
    const axes = centres.slice(1).map(([x, y], index) => {
      const [px, py] = centres[index];
      return Math.abs(x - px) >= Math.abs(y - py) ? 'h' : 'v';
    });
    const bends = axes.slice(1).filter((axis, index) => axis !== axes[index]).length;
    assert.equal(bends, 1, `${route[0]?.placed.tile} arm ${armIndex} must turn exactly once`);
    assert.notEqual(axes[0], axes[1], `arm ${armIndex} must elbow after its second ordinary bone`);
    assert.ok(axes.slice(1).every((axis) => axis === axes[1]),
      `arm ${armIndex} turned back toward its earlier bones`);
  }
});

test('every folded French arm remains one physically touching chain through every elbow', () => {
  // This is deliberately a mixed run with the 5-5 crosswise in the middle:
  // the exact shape that can look like a broken 5 when an end marker or an
  // elbow is positioned from a compass guess instead of the rendered route.
  const tiles: CrossBoard['arms'][number]['tiles'] = [
    { tile: '0-5', crosswise: false },
    { tile: '5-5', crosswise: true },
    { tile: '2-5', crosswise: false },
    { tile: '2-6', crosswise: false },
    { tile: '1-6', crosswise: false },
    { tile: '1-3', crosswise: false },
  ];
  const touchesAlongAnEdge = (a: (typeof placements)[number], b: (typeof placements)[number]) => {
    const verticalEdge = (a.col + a.colSpan === b.col || b.col + b.colSpan === a.col)
      && Math.max(a.row, b.row) < Math.min(a.row + a.rowSpan, b.row + b.rowSpan);
    const horizontalEdge = (a.row + a.rowSpan === b.row || b.row + b.rowSpan === a.row)
      && Math.max(a.col, b.col) < Math.min(a.col + a.colSpan, b.col + b.colSpan);
    return verticalEdge || horizontalEdge;
  };

  for (const [armIndex, direction] of (['right', 'left', 'up', 'down'] as const).entries()) {
    const board: CrossBoard = {
      kind: 'cross', center: '0-0', doublesPlayed: [0, 5],
      arms: [{ direction, tiles, openEnd: 3 }],
    };
    const { placements } = crossPlacements(board, 8);
    const hub = placements[0];
    const arm = placements.filter((p) => p.crossArm === 0)
      .sort((a, b) => (a.crossStep ?? 0) - (b.crossStep ?? 0));
    assert.equal(arm.length, tiles.length, `${direction} lost a played bone`);
    assert.ok(touchesAlongAnEdge(hub, arm[0]), `${direction} arm broke away from the spinner`);
    for (let i = 1; i < arm.length; i++) {
      assert.ok(touchesAlongAnEdge(arm[i - 1], arm[i]),
        `${direction} arm broke between steps ${i - 1} and ${i}`);
    }
    assert.equal(arm.at(-1)?.crossStep, tiles.length - 1,
      `arm ${armIndex} marker must identify the true exposed bone`);
  }
});

test('a roomy French table keeps a three-bone arm straight instead of taking the first short lane', () => {
  const board: CrossBoard = {
    kind: 'cross', center: '0-0', doublesPlayed: [0],
    arms: [{
      direction: 'right', openEnd: 3,
      tiles: [
        { tile: '0-1', crosswise: false },
        { tile: '1-2', crosswise: false },
        { tile: '2-3', crosswise: false },
      ],
    }],
  };
  const fit = chooseCrossFit(board, { width: 900, height: 460 }, { maxUnit: 32 });
  const arm = fit.placements.filter((p) => p.crossArm === 0)
    .sort((a, b) => (a.crossStep ?? 0) - (b.crossStep ?? 0));
  const rows = new Set(arm.map((p) => p.row));
  assert.equal(rows.size, 1, '1-3 has room to continue horizontally and must not bend early');
});

test('an uneven 23-bone French endgame refits completely inside its measured square', () => {
  const arm = (direction: CrossBoard['arms'][number]['direction'], ids: TileId[]) => ({
    direction,
    openEnd: 0 as const,
    tiles: ids.map((tile) => ({ tile, crosswise: tile[0] === tile[2] })),
  });
  // Captured from a browser-played hand: one arm took twelve bones while the
  // other three stayed short. This is the shape that exposed stale straight
  // routing at the right edge even though the guard itself was square.
  const board: CrossBoard = {
    kind: 'cross', center: '0-0', doublesPlayed: [0],
    arms: [
      arm('right', ['0-6', '6-6', '1-6', '1-1', '1-5', '5-6', '3-6', '3-4', '4-4', '4-5', '3-5', '1-3']),
      arm('left', ['0-3', '3-3', '2-3', '2-2']),
      arm('up', ['0-2', '2-6', '4-6']),
      arm('down', ['0-5', '5-5', '2-5']),
    ],
  };
  const box = { width: 481, height: 482 };
  const fit = chooseCrossFit(board, box, { maxUnit: 16, minUnit: 11, maxUnits: 36 });
  assert.ok(fit.totalCols * fit.u <= box.width,
    `endgame width ${fit.totalCols * fit.u} crossed ${box.width}px guard`);
  assert.ok(fit.totalRows * fit.u <= box.height,
    `endgame height ${fit.totalRows * fit.u} crossed ${box.height}px guard`);
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

test('the board guard measures the box a CSS inset actually resolves against', () => {
  // Found against a real 430x932 phone, on video: the flank stations had been
  // shrunk to 38px and still the chain sat ~55px in from each felt edge, and a
  // bone was clipped off the bottom of a nearly played-out hand.
  //
  // reserveBoardStage() measured every obstacle against the felt's BORDER box,
  // because that is what getBoundingClientRect() returns. But it then writes
  // the result to boardStage.style.inset, and `inset` on an absolutely
  // positioned child resolves against its containing block's PADDING box. The
  // phone felt has a 7px border, so every edge was over-inset by exactly that
  // border width -- 14px of width and 14px of height given away on each phone,
  // silently, on all four sides at once.
  const border = { top: 7, right: 7, bottom: 7, left: 7 };
  const feltBorderBox = { top: 100, right: 414, bottom: 845, left: 16 };
  const inner = paddingBoxOf(feltBorderBox, border);
  assert.deepEqual(inner, { top: 107, right: 407, bottom: 838, left: 23 });

  // A left station reaching x=49 needs the board held 38px off the padding box
  // (49 - 23 + 12), not the 45px the border box implied (49 - 16 + 12).
  //
  // The stage here sits where the STYLESHEET puts it -- reserveBoardStage()
  // clears the previous inline inset before measuring, precisely so an earlier
  // (larger) guard cannot ratchet the board smaller forever. The phone floor is
  // 24px off the padding box, so x = 23 + 24.
  const stage = { top: 180, right: 383, bottom: 700, left: 47 };
  const obstacles = [{ edge: 'left' as const, rect: { top: 200, right: 49, bottom: 400, left: 11 } }];
  const fixed = boardGuardInsets(inner, stage, obstacles, 12, false);
  const old = boardGuardInsets(feltBorderBox, stage, obstacles, 12, false);
  assert.equal(fixed.left, 38, 'measured from the box the inset resolves against');
  assert.equal(old.left, 45, 'the border box double-counts the border');
  assert.equal(old.left - fixed.left, border.left, 'the error is exactly the border width');
});

test('a French canvas is capped to the board it must fit, so desktop stops clipping', () => {
  // The French board is a FIXED 450x390 logical canvas scaled from the bone:
  // canvas = 30u wide by 26u tall. Nothing ever checked it against the stage it
  // is drawn into, and liveTableUnit() sized the bone from viewport WIDTH while
  // the stage is driven by HEIGHT. Every short-but-wide monitor therefore drew
  // a canvas bigger than its stage and clipped the overflow:
  //
  //   1368x900   bone 34px  canvas 510x442  stage 464x439
  //   1440x900   bone 36px  canvas 540x468  stage 454x429
  //   1920x1080  bone 48px  canvas 720x624  stage 574x551
  //
  // Simulating 800 real French hands against that 1368x900 geometry: 786 of
  // them (98%) cut a bone off, starting from the SEVENTH. The tell is
  // 1368x1200 -- same width, same bone, fits fine, because it is tall.
  assert.equal(frenchCanvasUnit({ width: 464, height: 439 }), 15, '1368x900 -> 30px bone');
  assert.equal(frenchCanvasUnit({ width: 454, height: 429 }), 15, '1440x900 -> 30px bone');
  assert.equal(frenchCanvasUnit({ width: 574, height: 551 }), 19, '1920x1080 -> 38px bone');
  assert.equal(frenchCanvasUnit({ width: 734, height: 733 }), 24, 'a tall desktop earns a BIGGER bone');

  // 30px is not a number I chose: it is JamDom's own measured bone, the
  // reference this board was built from. Capping to fit makes desktop French
  // more authentic, not smaller.
  const canvas = (u: number) => ({ width: 30 * u, height: 26 * u });
  for (const box of [{ width: 464, height: 439 }, { width: 574, height: 551 }]) {
    const u = frenchCanvasUnit(box);
    const c = canvas(u);
    assert.ok(c.width <= box.width && c.height <= box.height, 'the capped canvas must fit');
    const bigger = canvas(u + 1);
    assert.ok(bigger.width > box.width || bigger.height > box.height, 'and must be the largest that does');
  }
});

test('a French arm points at the player who opened it, from the viewer\'s own seat', () => {
  // The owner's rule, 2026-09-12: the opening bones run TOWARDS whoever laid
  // them, the way they do on a real table. Direction is therefore relative to
  // the VIEWER -- my right is the opposite seat's left -- and the same board
  // is sent to all four seats, which is why the engine records the seat and
  // this maps it. Play is anti-clockwise, so seat+1 is the player on my
  // physical right (CLAUDE.md, "Rules competitors get wrong").
  assert.equal(armDirectionFor(2, 2), 'down', 'my own arm comes towards me');
  assert.equal(armDirectionFor(3, 2), 'right', 'the seat after mine is on my right');
  assert.equal(armDirectionFor(0, 2), 'up', 'the seat opposite is across the table');
  assert.equal(armDirectionFor(1, 2), 'left', 'the seat before mine is on my left');
  // Same board, different chair: every arm rotates with the viewer.
  assert.equal(armDirectionFor(2, 0), 'up', 'seat 2 is opposite seat 0');
  assert.equal(armDirectionFor(2, 3), 'left');
});

test('two arms opened by one player still get separate directions', () => {
  // A seat that holds two of the four opening bones can open two arms -- the
  // others pass, the turn comes round. Naively both would claim the same
  // direction and be drawn on top of each other, so the second takes the
  // nearest free lane instead of colliding.
  const dirs = crossArmDirections([{ seat: 1 }, { seat: 1 }, { seat: 2 }, { seat: 3 }], 0);
  assert.equal(new Set(dirs).size, 4, 'four arms, four distinct directions');
  assert.equal(dirs[0], 'right', 'the first claim wins the seat\'s own lane');
  assert.ok(dirs.includes('down') && dirs.includes('up') && dirs.includes('left'));
});

test('a cross dealt before arms recorded a seat still renders', () => {
  // CrossArm.seat is optional: a hand already in flight when this shipped has
  // arms without it. Those must keep their stored fill-order direction rather
  // than collapsing to one lane.
  const dirs = crossArmDirections(
    [{ seat: undefined, direction: 'right' }, { seat: undefined, direction: 'left' },
     { seat: undefined, direction: 'up' }, { seat: undefined, direction: 'down' }], 0);
  assert.deepEqual(dirs, ['right', 'left', 'up', 'down']);
});

test('the French fit cap outranks the readable-minimum floor', () => {
  // These two can disagree, and for a RIGID canvas the floor must not win.
  // Measured on a 390x700 phone: the stage is 292px, the phone's readable
  // floor is unit 10, and a unit-10 French canvas is 300px -- so the floor was
  // pushing the board 8px past its own guard and clipping it again, which is
  // exactly what the cap exists to stop. A capped cross bottoms out around a
  // 16px bone on the narrowest phone; a cross with an arm cut off is not
  // readable at any size.
  const box = { width: 274, height: 330 };   // the real 390x700 measurement
  assert.equal(frenchCanvasUnit(box), 9, 'only unit 9 fits that stage');
  assert.ok(30 * 9 <= box.width, 'and a unit-9 canvas really does fit');
  assert.ok(30 * 10 > box.width, 'while the unit-10 floor would overflow it');
});

test('a phone French route never leaves the board width, and no arm touches another', () => {
  // Owner's screenshot, 2026-09-13: the desktop route is 30 units wide, so on
  // a phone every arm turned in columns that fell off the screen and a
  // turned-back run looked like dominoes floating on their own.
  type R = { x: number; y: number; w: number; h: number };
  const overlap = (a: R, b: R) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  // Touching includes edges and corners: anything closer than one unit.
  const near = (a: R, b: R) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
  const joined = (a: R, b: R) => !overlap(a, b) && (
    ((a.x + a.w === b.x || b.x + b.w === a.x) && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) >= 2)
    || ((a.y + a.h === b.y || b.y + b.h === a.y) && Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) >= 2));
  const heads = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const;
  for (const cols of [12, 14, 16, 18, 20, 22, 24]) for (const rows of [16, 23, 26, 32, 39]) {
    const hub = { x: cols / 2 - 1, y: Math.floor(rows / 2) - 2, w: 2, h: 4 };
    const placed: { arm: string; r: R }[] = [];
    for (const dir of ['up', 'right', 'down', 'left'] as const) {
      const route = phoneCrossRoute(dir, cols, rows, 16);
      assert.equal(route.length, 16);
      assert.ok(joined(hub, route[0]), `${dir} first bone must join the chucha (${cols}x${rows})`);
      const [hx, hy] = heads[dir];
      const firstCentre = [route[0].x + route[0].w / 2 - cols / 2, route[0].y + route[0].h / 2 - Math.floor(rows / 2)];
      assert.ok(firstCentre[0] * hx + firstCentre[1] * hy > 0, `${dir} first bone must head towards its player`);
      route.forEach((s, i) => {
        assert.ok(s.x >= 0 && s.x + s.w <= cols, `${dir}#${i} leaves the ${cols}-column board`);
        assert.equal(s.orient, s.w === 4 ? 'h' : 'v');
        if (i) assert.ok(joined(route[i - 1], s), `${dir}#${i} does not join the bone before it (${cols}x${rows})`);
        assert.ok(!overlap(hub, s), `${dir}#${i} covers the chucha`);
        for (const other of placed) {
          assert.ok(!near(other.r, s), `${dir}#${i} touches the ${other.arm} arm (${cols}x${rows})`);
        }
      });
      placed.push(...route.map((r) => ({ arm: dir, r })));
    }
  }
});

test('a phone French board holds an ordinary hand without panning', () => {
  // 2,000 simulated French hands: an arm reaches 6 bones typically, 9 at the
  // 95th percentile, 11 at the 99th and 14 at most. A longer arm grows past
  // the top or bottom and pans vertically, still joined to the centre.
  const inside = (cols: number, rows: number, dir: 'up' | 'right' | 'down' | 'left') => {
    const route = phoneCrossRoute(dir, cols, rows, 16);
    const firstOutside = route.findIndex((s) => s.y < 0 || s.y + s.h > rows);
    return firstOutside < 0 ? route.length : firstOutside;
  };
  for (const dir of ['up', 'right', 'down', 'left'] as const) {
    assert.ok(inside(20, 36, dir) >= 9, `a 430px phone must hold a 95th-percentile ${dir} arm`);
    assert.ok(inside(22, 32, dir) >= 14, `a roomier phone must hold the longest ${dir} arm seen`);
  }
  // The grid follows the measured stage and never shrinks the bone.
  assert.deepEqual(phoneCrossGrid({ width: 293, height: 558 }, 14), { cols: 20, rows: 39 });
  assert.deepEqual(phoneCrossGrid({ width: 320, height: 440 }, 14), { cols: 22, rows: 31 });
  // A 360px phone measured a 247x322 stage: it must route in 16 columns, not
  // be forced wider than the screen and pan sideways.
  assert.deepEqual(phoneCrossGrid({ width: 247, height: 322 }, 14), { cols: 16, rows: 23 });
  assert.deepEqual(phoneCrossGrid({ width: 120, height: 120 }, 14), { cols: 12, rows: 16 });
});
