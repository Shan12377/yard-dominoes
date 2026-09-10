import test from 'node:test';
import assert from 'node:assert/strict';
import { halves } from '@yard/engine';
import type { Board, CrossBoard, Pip, PlacedTile, TileId } from '@yard/engine';
import { orientLine, MIN_WIDTH_UNITS } from './layout.ts';
import { assertRenderableBoard, assertVisibleTilesDisjoint, boardGuardInsets, chooseCrossFit, chooseCrossUnit, chooseUnit, crossPlacements, crossRejectReason, liveTableUnit, rowsOf } from './render.ts';
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

test('a played-out live hand fits in its protected stage without a board scrollbar', () => {
  for (let seed = 1; seed <= 100; seed++) {
    for (const [label, box, viewportWidth, minUnit] of [
      ['phone', PHONE_LIVE_STAGE, 390, 10],
      ['desktop', DESKTOP, 1368, 11],
    ] as const) {
      const board = boardOf(28, mulberry32(seed));
      const line = orientLine(board);
      const { u, placements } = chooseUnit(line, box, {
        maxUnit: liveTableUnit(viewportWidth, board),
        minUnit,
        maxUnits: label === 'phone' ? 20 : 36,
      });
      const across = Math.max(...placements.map((p) => p.col + p.colSpan));
      assert.ok(across * u <= box.width,
        `${label} seed ${seed} needed ${across * u}px of ${box.width}px wide`);
      assert.ok(rowsOf(placements) * u <= box.height,
        `${label} seed ${seed} needed ${rowsOf(placements) * u}px of ${box.height}px high`);
      if (label === 'phone') assert.ok(u >= 10, 'phone board bones stay at least 20px wide');
      else assert.ok(u >= 18, 'desktop board bones remain visually comparable to the hand');
    }
  }
});

test('the width cap is respected even when there is room to be bigger', () => {
  const line = orientLine(boardOf(6, mulberry32(4)));
  const { placements } = chooseUnit(line, DESKTOP, { maxUnits: 16 });
  const across = Math.max(...placements.map((p) => p.col + p.colSpan));
  assert.ok(across <= 16, `capped at 16 units, laid out ${across}`);
});

test('a wide ordinary table uses its safe width before turning', () => {
  const line = orientLine(boardOf(20, mulberry32(404)));
  const roomy = chooseUnit(line, { width: 1600, height: 500 }, { maxUnit: 32 });
  const capped = chooseUnit(line, { width: 1600, height: 500 }, { maxUnit: 32, maxUnits: 36 });
  const firstVertical = (placements: typeof roomy.placements) =>
    placements.findIndex((placement) => placement.orient === 'v'
      && placement.faces[0] !== placement.faces[1]);
  assert.ok(firstVertical(roomy.placements) > firstVertical(capped.placements),
    'the wide line should travel farther horizontally than the retired 36-unit lane');
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
