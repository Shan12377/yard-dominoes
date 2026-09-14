import test from 'node:test';
import assert from 'node:assert/strict';
import { halves } from '@yard/engine';
import type { Board, Move, Pip, PlacedTile } from '@yard/engine';
import {
  layoutLine, layoutPhoneRoute, layoutPlayedRoute, orientLine, MIN_WIDTH_UNITS, phoneRouteFits,
  phoneRouteRects, playedRouteHeightUnits,
} from './layout.ts';
import { applyMove, deal, legalMoves } from '@yard/engine';
import type { OrientedTile, TilePlacement } from './layout.ts';

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

test('the live S route anchors the pose while both ends fill the table perimeter', () => {
  const pose = { placed: { tile: '6-6', crosswise: true }, inPip: 6, outPip: 6 } as const;
  const left = ['0-6', '0-1', '1-2', '2-3', '3-4'].map((tile) =>
    ({ placed: { tile, crosswise: false }, inPip: 0 as Pip, outPip: 1 as Pip }));
  const right = ['5-6', '4-5', '3-4x', '2-3x', '1-2x'].map((tile) =>
    ({ placed: { tile, crosswise: false }, inPip: 0 as Pip, outPip: 1 as Pip }));
  const moves: Move[] = [
    { kind: 'pose', seat: 0, tile: pose.placed.tile },
    ...left.map((tile) => ({ kind: 'play', seat: 1, tile: tile.placed.tile, end: 'left' as const })),
    ...right.map((tile) => ({ kind: 'play', seat: 2, tile: tile.placed.tile, end: 'right' as const })),
  ];
  const fullLine = [...left].reverse().concat([pose], right);
  const route = layoutPlayedRoute(fullLine, moves, 20);
  const poseAt = route.find((tile) => tile.placed.tile === '6-6')!;
  assert.deepEqual([poseAt.col, poseAt.row], [9, 46]);
  assert.equal(route.find((tile) => tile.placed.tile === left[2].placed.tile)?.orient, 'v');
  assert.equal(route.find((tile) => tile.placed.tile === right[2].placed.tile)?.orient, 'v');
  for (let i = 0; i < route.length; i += 1) {
    assert.ok(route[i].col >= 0 && route[i].col + route[i].colSpan <= 20,
      `${route[i].placed.tile} leaves the route width`);
    assert.ok(route[i].row >= 0, `${route[i].placed.tile} leaves the route top`);
    for (let j = 0; j < i; j += 1) {
      assert.ok(!overlaps(route[i], route[j]),
        `${route[i].placed.tile} overlaps ${route[j].placed.tile} at an elbow`);
    }
  }
  const rightDown = right.map((tile) => route.find((p) => p.placed.tile === tile.placed.tile)!)
    .filter((tile) => tile.orient === 'v');
  assert.equal(rightDown.length, 2, 'right arm must turn left after two downward bones');
  const leftUp = left.map((tile) => route.find((p) => p.placed.tile === tile.placed.tile)!)
    .filter((tile) => tile.orient === 'v');
  assert.equal(leftUp.length, 3, 'left arm must rise for three complete bones before crossing');
  const earlyMoves: Move[] = [moves[0], ...moves.slice(1, 3), ...moves.slice(1 + left.length, 3 + left.length)];
  const earlier = layoutPlayedRoute([...left.slice(0, 2)].reverse().concat([pose], right.slice(0, 2)), earlyMoves, 20);
  assert.deepEqual([earlier.find((tile) => tile.placed.tile === '6-6')!.col,
    earlier.find((tile) => tile.placed.tile === '6-6')!.row], [poseAt.col, poseAt.row]);
});

test('a dense live route sends the right return down and keeps every bone clear', () => {
  const pose = { placed: { tile: 'pose', crosswise: true }, inPip: 6 as Pip, outPip: 6 as Pip };
  const arm = (side: string, count: number) => Array.from({ length: count }, (_, i) => ({
    placed: { tile: `${side}-${i}`, crosswise: false },
    inPip: 1 as Pip,
    outPip: 2 as Pip,
  }));
  const left = arm('left', 13);
  const right = arm('right', 14);
  const moves: Move[] = [
    { kind: 'pose', seat: 0, tile: pose.placed.tile as never },
    ...left.map((tile) => ({ kind: 'play' as const, seat: 1, tile: tile.placed.tile as never, end: 'left' as const })),
    ...right.map((tile) => ({ kind: 'play' as const, seat: 2, tile: tile.placed.tile as never, end: 'right' as const })),
  ];
  const route = layoutPlayedRoute([...left].reverse().concat([pose], right) as never, moves, 20);
  const secondRightDrop = route.find((tile) => tile.placed.tile === 'right-8')!;
  const precedingReturn = route.find((tile) => tile.placed.tile === 'right-7')!;
  assert.equal(secondRightDrop.orient, 'v', 'the right arm must turn down after crossing back');
  assert.ok(secondRightDrop.row >= precedingReturn.row + precedingReturn.rowSpan,
    'the second right-hand turn must grow away from the pose');
  for (let i = 0; i < route.length; i += 1) {
    const tile = route[i];
    assert.ok(tile.col >= 0 && tile.col + tile.colSpan <= 20, `${tile.placed.tile} leaves route width`);
    assert.ok(tile.row >= 0 && tile.row + tile.rowSpan <= playedRouteHeightUnits(20),
      `${tile.placed.tile} leaves route height`);
    for (let j = 0; j < i; j += 1) {
      assert.ok(!overlaps(tile, route[j]), `${tile.placed.tile} overlaps ${route[j].placed.tile}`);
    }
  }
});

test('crosswise doubles stay inside clean elbows on the live route', () => {
  const pose = { placed: { tile: 'pose', crosswise: true }, inPip: 6 as Pip, outPip: 6 as Pip };
  const arm = (side: string) => [0, 1, 2, 3, 4].map((i) => ({
    placed: { tile: `${side}-${i}`, crosswise: i === 2 },
    inPip: 0 as Pip,
    outPip: (i === 2 ? 0 : 1) as Pip,
  }));
  const left = arm('left');
  const right = arm('right');
  const moves: Move[] = [
    { kind: 'pose', seat: 0, tile: pose.placed.tile as never },
    ...left.map((tile) => ({ kind: 'play' as const, seat: 1, tile: tile.placed.tile as never, end: 'left' as const })),
    ...right.map((tile) => ({ kind: 'play' as const, seat: 2, tile: tile.placed.tile as never, end: 'right' as const })),
  ];
  const route = layoutPlayedRoute([...left].reverse().concat([pose], right) as never, moves, 20);
  for (let i = 0; i < route.length; i += 1) {
    const tile = route[i];
    assert.ok(tile.col >= 0 && tile.col + tile.colSpan <= 20, `${tile.placed.tile} leaves route width`);
    assert.ok(tile.row >= 0, `${tile.placed.tile} leaves route top`);
    for (let j = 0; j < i; j += 1) {
      assert.ok(!overlaps(tile, route[j]), `${tile.placed.tile} overlaps ${route[j].placed.tile}`);
    }
  }
});

test('a turn immediately after a double leaves from its centre without a gap or cover', () => {
  const pose = { placed: { tile: 'pose', crosswise: true }, inPip: 6 as Pip, outPip: 6 as Pip };
  const straight = { placed: { tile: '6-4', crosswise: false }, inPip: 6 as Pip, outPip: 4 as Pip };
  const double = { placed: { tile: '4-4', crosswise: true }, inPip: 4 as Pip, outPip: 4 as Pip };
  const turn = { placed: { tile: '4-1', crosswise: false }, inPip: 4 as Pip, outPip: 1 as Pip };
  const moves: Move[] = [
    { kind: 'pose', seat: 0, tile: 'pose' as never },
    { kind: 'play', seat: 1, tile: '6-4', end: 'right' },
    { kind: 'play', seat: 2, tile: '4-4', end: 'right' },
    { kind: 'play', seat: 3, tile: '4-1', end: 'right' },
  ];
  const route = layoutPlayedRoute([pose, straight, double, turn] as never, moves, 20);
  const doubleAt = route.find((tile) => tile.placed.tile === '4-4')!;
  const turnAt = route.find((tile) => tile.placed.tile === '4-1')!;
  assert.equal(turnAt.col + turnAt.colSpan / 2, doubleAt.col + doubleAt.colSpan / 2,
    'the downward bone must leave the middle of the crosswise double');
  assert.equal(turnAt.row, doubleAt.row + doubleAt.rowSpan,
    'the next bone must touch the double at one exact edge');
  assert.ok(!overlaps(doubleAt, turnAt), 'the next bone must not cover the double');
  assert.ok(touches(doubleAt, turnAt), 'the next bone must not float below the double');
});


// ---------------------------------------------------------------- phone route
// Mobile Practice's board (owner, 2026-09-14): big bones on the whole felt.
// The centre row runs to the edge, then the left end snakes upward in rows and
// the right end downward, round the players' portraits and racks. No played
// bone ever moves, bones never overlap or cover a player, and every bone joins
// the one before it.

type RouteBone = { tile: string; double: boolean; end: 'left' | 'right' };
function routeCase(poseDouble: boolean, bones: RouteBone[]): { line: OrientedTile[]; moves: Move[] } {
  const pose = { placed: { tile: 'pose', crosswise: poseDouble }, inPip: 3, outPip: poseDouble ? 3 : 4 } as unknown as OrientedTile;
  const line: OrientedTile[] = [pose];
  const moves = [{ kind: 'pose', seat: 0, tile: 'pose' }] as unknown as Move[];
  for (const bone of bones) {
    const t = { placed: { tile: bone.tile, crosswise: bone.double }, inPip: 1, outPip: bone.double ? 1 : 2 } as unknown as OrientedTile;
    if (bone.end === 'left') line.unshift(t); else line.push(t);
    moves.push({ kind: 'play', seat: 0, tile: bone.tile, end: bone.end } as unknown as Move);
  }
  return { line, moves };
}
const rectOverlap = (a: TilePlacement, b: TilePlacement) => a.col < b.col + b.colSpan && b.col < a.col + a.colSpan
  && a.row < b.row + b.rowSpan && b.row < a.row + a.rowSpan;
const asPlacement = (r: { x: number; y: number; w: number; h: number }) =>
  ({ col: r.x, row: r.y, colSpan: r.w, rowSpan: r.h }) as TilePlacement;
const sharedEdge = (a: TilePlacement, b: TilePlacement) => {
  if (rectOverlap(a, b)) return 0;
  if (a.col + a.colSpan === b.col || b.col + b.colSpan === a.col) {
    return Math.min(a.row + a.rowSpan, b.row + b.rowSpan) - Math.max(a.row, b.row);
  }
  if (a.row + a.rowSpan === b.row || b.row + b.rowSpan === a.row) {
    return Math.min(a.col + a.colSpan, b.col + b.colSpan) - Math.max(a.col, b.col);
  }
  return 0;
};

test('the phone route snakes in rows: centre row to the edge, two bones up, back across', () => {
  const W = 26;
  const H = 44;
  const plays = Array.from({ length: 18 }, () => ({ end: 'left' as const, double: false }));
  const { rects, overflow } = phoneRouteRects(plays, W, H, true);
  assert.equal(overflow, 0);
  const vertical = (r: { w: number; h: number }) => r.h > r.w;
  const firstUp = rects.findIndex(vertical);
  assert.ok(firstUp > 1, 'the left end runs out along the centre row first');
  assert.ok(rects.slice(0, firstUp).every((r) => r.y + r.h / 2 === 0), 'that run stays on the centre row');
  assert.ok(rects[firstUp - 1].x <= -W / 2 + 6, 'and reaches the edge before it turns');
  assert.ok(vertical(rects[firstUp + 1]), 'the climb is two bones, so the rows keep wood between them');
  assert.ok(!vertical(rects[firstUp + 2]) && rects[firstUp + 2].x > rects[firstUp + 1].x, 'then the line comes back across');
  assert.equal(rects[firstUp + 2].y + 1, -8, 'two bones above the centre row');
  const three = phoneRouteRects(plays, W, H, true, { climb: 3 }).rects;
  assert.equal(three.findIndex((r, i) => i > firstUp && !vertical(r)), firstUp + 3, 'a climb of three is three bones');
  const rowStarts = rects.map((r, i) => i > 0 && !vertical(r) && vertical(rects[i - 1]) ? i : -1).filter((i) => i > 0);
  assert.ok(rowStarts.length >= 2, 'the end reaches a third row');
  assert.ok(vertical(rects[rowStarts[1] - 2]) && !vertical(rects[rowStarts[1] - 3]), 'the second climb is two dominoes too');
  const right = phoneRouteRects(plays.map((p) => ({ ...p, end: 'right' as const })), W, H, true).rects;
  const firstDown = right.findIndex(vertical);
  assert.ok(right[firstDown + 2].x < right[firstDown + 1].x, 'the right end drops two bones and comes back to the left');
  assert.equal(right[firstDown + 2].y + 1, 8, 'two bones below the centre row');
  for (const r of rects) assert.ok(r.y + r.h <= 2, 'the left end never enters the lower half');
  for (const r of right) assert.ok(r.y >= -2, 'the right end never enters the upper half');
});

test('a double on a turn makes the JamDom L: one half level with the line, the other out into the turn', () => {
  const H = 44;
  const left = (n: number) => Array.from({ length: n }, () => ({ end: 'left' as const, double: false }));
  const W = 26;
  const turn = phoneRouteRects(left(10), W, H, true).rects.findIndex((r) => r.h > r.w);
  assert.ok(turn > 0);
  // Row into climb.
  let { rects, overflow } = phoneRouteRects([...left(turn), { end: 'left', double: true }, ...left(1)], W, H, true);
  assert.equal(overflow, 0);
  const endBone = rects[turn - 1];
  const corner = rects[turn];
  const next = rects[turn + 1];
  assert.ok(endBone.w > endBone.h, 'the line arrives along a row');
  assert.ok(corner.h > corner.w, 'the double stands across that row, never along it');
  assert.equal(corner.x + corner.w, endBone.x, 'past the end of the row, touching its end');
  assert.equal(corner.y + corner.h, endBone.y + endBone.h, 'its lower half level with the row, not docked at its waist');
  assert.ok(next.h > next.w && next.x === corner.x && next.y + next.h === corner.y, 'the climb carries on from the upper half');
  // Climb into row.
  ({ rects, overflow } = phoneRouteRects([...left(turn + 2), { end: 'left', double: true }, ...left(1)], W, H, true));
  assert.equal(overflow, 0);
  const top = rects[turn + 1];
  const elbow = rects[turn + 2];
  const row = rects[turn + 3];
  assert.ok(top.h > top.w, 'the line arrives climbing');
  assert.ok(elbow.w > elbow.h, 'the double lies across the climb');
  assert.equal(elbow.y + elbow.h, top.y, 'past the top of the climb');
  assert.equal(elbow.x, top.x, 'its left half over the climb');
  assert.ok(row.w > row.h && row.x === elbow.x + elbow.w && row.y === elbow.y, 'the row carries on from its right half');
});

test('every climb between rows is two full dominoes in every hand, short only at the table edge', () => {
  const rand = mulberry32(916);
  const full: string[] = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) full.push(`${a}-${b}`);
  const W = 31;
  const H = 44;
  const isDouble = (tile: string) => tile.split('-')[0] === tile.split('-')[1];
  let climbs = 0;
  for (let k = 0; k < 300; k++) {
    const order = [...full];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    let hand = deal({ order: order as never, seatCount: 4, mode: 'partner', useBoneyard: false, poseMustBeDoubleSix: k % 2 === 0, poser: 0 });
    for (let guard = 0; guard < 200 && hand.status === 'active'; guard++) {
      const moves = legalMoves(hand);
      if (!moves.length) break;
      hand = applyMove(hand, moves[Math.floor(rand() * moves.length)]);
    }
    const pose = hand.moveLog.find((m) => m.kind === 'pose');
    const plays = hand.moveLog.flatMap((m) => m.kind === 'play' ? [{ end: m.end, double: isDouble(m.tile) }] : []);
    const { rects, overflow } = phoneRouteRects(plays, W, H, pose?.kind === 'pose' && isDouble(pose.tile), { climb: 2 });
    if (overflow) continue;
    for (const end of ['left', 'right'] as const) {
      const mine = rects.map((r, i) => ({ r, double: plays[i].double })).filter((x) => x.r.end === end);
      // A bone climbs when it sits directly above or below the bone it joins.
      const climbing = mine.map((x, i) => i > 0 && (x.r.y >= mine[i - 1].r.y + mine[i - 1].r.h || x.r.y + x.r.h <= mine[i - 1].r.y));
      for (let i = 0; i < mine.length;) {
        if (!climbing[i]) { i++; continue; }
        let j = i;
        while (j < mine.length && climbing[j]) j++;
        if (j < mine.length) {
          // The corner double that starts a climb sits beside the row, not above it.
          const start = i > 0 && mine[i - 1].double && !climbing[i - 1] && i > 1 ? i - 1 : i;
          const dominoes = mine.slice(start, j).filter((x) => !x.double).length;
          // Only the table itself may cut a climb short: its top or bottom edge.
          const outer = mine[j - 1].r;
          const atEdge = outer.y - 6 < -H / 2 || outer.y + outer.h + 6 > H / 2;
          if (!(dominoes < 2 && atEdge)) {
            assert.equal(dominoes, 2, `hand ${k} ${end} end: a climb of ${dominoes} full dominoes`);
          }
          climbs++;
        }
        i = j;
      }
    }
  }
  assert.ok(climbs > 300, 'real hands climb often enough to prove the rule');
});

test('phone route bones never cover a player', () => {
  const W = 26;
  const H = 44;
  const origin = { x: 13, y: 22 };
  // Side players across the centre row's ends and the partner along the top.
  const blocked = [{ x: 0, y: 17, w: 2, h: 14 }, { x: 24, y: 17, w: 2, h: 14 }, { x: 4, y: 0, w: 18, h: 4 }];
  const rand = mulberry32(915);
  for (let k = 0; k < 300; k++) {
    const plays = Array.from({ length: 24 }, () => ({ end: rand() < 0.5 ? 'left' as const : 'right' as const, double: rand() < 0.25 }));
    const { rects, overflow } = phoneRouteRects(plays, W, H, rand() < 0.5, { origin, blocked });
    if (overflow) continue;
    for (const r of rects) {
      const abs = { x: r.x + origin.x, y: r.y + origin.y, w: r.w, h: r.h };
      for (const b of blocked) {
        assert.ok(!(abs.x < b.x + b.w && b.x < abs.x + abs.w && abs.y < b.y + b.h && b.y < abs.y + abs.h),
          `a bone at ${JSON.stringify(abs)} covers the player at ${JSON.stringify(b)}`);
      }
    }
  }
});

test('a double into an ordinary bone meets edge to edge: 4-4 then 4-1', () => {
  const { line, moves } = routeCase(true, [{ tile: '4-1', double: false, end: 'right' }]);
  const placed = layoutPhoneRoute(line, moves, 30, 48)!;
  const pose = placed.find((p) => p.placed.tile === 'pose')!;
  const next = placed.find((p) => p.placed.tile === '4-1')!;
  assert.equal(pose.orient, 'v', 'the double stands crosswise');
  assert.equal(next.col, pose.col + pose.colSpan, 'the bone starts exactly at the double\'s edge');
  assert.equal(next.row + next.rowSpan / 2, pose.row + pose.rowSpan / 2, 'and is centred on it');
  assert.ok(!rectOverlap(pose, next), 'nothing covers the double');
});

test('an ordinary pose is never covered by its first bones', () => {
  const { line, moves } = routeCase(false, [
    { tile: 'a', double: false, end: 'right' }, { tile: 'b', double: false, end: 'left' },
    { tile: 'c', double: true, end: 'right' }, { tile: 'd', double: true, end: 'left' },
  ]);
  const placed = layoutPhoneRoute(line, moves, 30, 48)!;
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    assert.ok(!rectOverlap(placed[i], placed[j]), `${placed[i].placed.tile} covers ${placed[j].placed.tile}`);
  }
});

test('phone route bones never move, never overlap, always join and stay on a board that fits', () => {
  const rand = mulberry32(914);
  for (const [W, H] of [[30, 48], [34, 52], [26, 40]] as const) {
    if (!phoneRouteFits(W, H)) continue;
    for (let k = 0; k < 400; k++) {
      let left = 0;
      let right = 0;
      let doubles = 6;
      const bones: RouteBone[] = [];
      const total = Math.floor(rand() * 25);
      for (let i = 0; i < total; i++) {
        const end = rand() < 0.5 ? 'left' : 'right';
        if ((end === 'left' ? left : right) >= 18) continue;
        if (end === 'left') left += 1; else right += 1;
        const double = doubles > 0 && rand() < 0.3;
        if (double) doubles -= 1;
        bones.push({ tile: `t${i}`, double, end });
      }
      const poseDouble = rand() < 0.5;
      const { line, moves } = routeCase(poseDouble, bones);
      const placed = layoutPhoneRoute(line, moves, W, H)!;
      assert.ok(placed, 'every tile must be placed');
      for (const p of placed) {
        assert.ok(p.col >= 0 && p.col + p.colSpan <= W, `${p.placed.tile} leaves the ${W}-column board`);
        assert.ok(p.row >= 0 && p.row + p.rowSpan <= H, `${p.placed.tile} leaves the ${H}-row board`);
      }
      for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
        assert.ok(!rectOverlap(placed[i], placed[j]), `${placed[i].placed.tile} overlaps ${placed[j].placed.tile}`);
      }
      for (let i = 1; i < placed.length; i++) {
        assert.ok(sharedEdge(placed[i - 1], placed[i]) >= 2,
          `${placed[i - 1].placed.tile} and ${placed[i].placed.tile} do not join`);
      }
      const half = routeCase(poseDouble, bones.slice(0, Math.floor(bones.length / 2)));
      for (const early of layoutPhoneRoute(half.line, half.moves, W, H)!) {
        const later = placed.find((p) => p.placed.tile === early.placed.tile)!;
        assert.deepEqual([later.col, later.row, later.orient], [early.col, early.row, early.orient],
          `${early.placed.tile} moved after later plays`);
      }
    }
  }
});

test('real engine hands lay out on a phone board with no overflow, overlap or broken join', () => {
  const rand = mulberry32(2026);
  const full: string[] = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) full.push(`${a}-${b}`);
  const W = 30;
  const H = 48;
  assert.ok(phoneRouteFits(W, H), 'the test board must be one the sizing accepts');
  for (let k = 0; k < 300; k++) {
    const order = [...full];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    let hand = deal({ order: order as never, seatCount: 4, mode: 'partner', useBoneyard: false, poseMustBeDoubleSix: k % 2 === 0, poser: 0 });
    for (let guard = 0; guard < 200 && hand.status === 'active'; guard++) {
      const moves = legalMoves(hand);
      if (!moves.length) break;
      hand = applyMove(hand, moves[Math.floor(rand() * moves.length)]);
    }
    if (hand.board?.kind !== 'linear') continue;
    const placed = layoutPhoneRoute(orientLine(hand.board), hand.moveLog, W, H);
    assert.ok(placed, 'a real hand must lay out');
    for (let i = 0; i < placed!.length; i++) for (let j = i + 1; j < placed!.length; j++) {
      assert.ok(!rectOverlap(placed![i], placed![j]), `real hand ${k}: ${placed![i].placed.tile} overlaps ${placed![j].placed.tile}`);
    }
    for (const p of placed!) {
      assert.ok(p.col >= 0 && p.col + p.colSpan <= W && p.row >= 0 && p.row + p.rowSpan <= H,
        `real hand ${k}: ${p.placed.tile} leaves the board`);
    }
  }
});
