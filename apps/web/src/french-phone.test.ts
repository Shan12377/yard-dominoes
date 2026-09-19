import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, deal, legalMoves } from '@yard/engine';
import { phoneFrenchPinwheel, FRENCH_DESK_PINWHEEL_LEGS } from './render.ts';
import type { PhoneCrossSlot } from './render.ts';

// Mobile French, owner 2026-09-14: JamDom's four-way clockwise pinwheel. Each
// arm runs out from the double blank towards its player and turns clockwise, so no
// arm stacks rows on top of another. Since 2026-09-15 the first turn comes
// after JamDom's short legs: two bones left and right, three up and down. Doubles stand across
// the arm they arrive on; a double on a turn makes the L. Bones are laid in
// play order and a bone's place depends only on bones already down.

type Dir = 'up' | 'right' | 'down' | 'left';
type R = { x: number; y: number; w: number; h: number };
const DIRS: Dir[] = ['up', 'right', 'down', 'left'];
const CLOCKWISE: Record<Dir, Dir> = { up: 'right', right: 'down', down: 'left', left: 'up' };

const overlap = (a: R, b: R) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** Closer than one unit of felt, edges and corners included. */
const touching = (a: R, b: R) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
const sharedEdge = (a: R, b: R) => {
  if (overlap(a, b)) return 0;
  if (a.x + a.w === b.x || b.x + b.w === a.x) return Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (a.y + a.h === b.y || b.y + b.h === a.y) return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  return 0;
};
/** Which way the line travelled from `from` into the bone `to` that joins it. */
const travel = (from: R, to: R): Dir => to.x >= from.x + from.w ? 'right'
  : to.x + to.w <= from.x ? 'left' : to.y >= from.y + from.h ? 'down' : 'up';

const hubOf = (cols: number, rows: number): R => ({ x: cols / 2 - 1, y: Math.floor(rows / 2) - 2, w: 2, h: 4 });

function roundRobin(lengths: number[]): number[] {
  const order: number[] = [];
  const left = [...lengths];
  while (left.some((n) => n > 0)) left.forEach((n, arm) => { if (n > 0) { order.push(arm); left[arm] -= 1; } });
  return order;
}

function assertSound(slots: PhoneCrossSlot[][], cols: number, rows: number, blocked: R[] = [], label = '') {
  const hub = hubOf(cols, rows);
  const every = slots.flatMap((arm, a) => arm.map((s, i) => ({ s, a, i })));
  for (const { s, a, i } of every) {
    assert.ok(s.x >= 0 && s.x + s.w <= cols, `${label} arm ${a} bone ${i} leaves the ${cols}-column board`);
    assert.ok(!overlap(s, hub), `${label} arm ${a} bone ${i} covers the double blank`);
    for (const b of blocked) assert.ok(!overlap(s, b), `${label} arm ${a} bone ${i} covers a player tab`);
  }
  for (let p = 0; p < every.length; p++) for (let q = p + 1; q < every.length; q++) {
    const A = every[p], B = every[q];
    assert.ok(!overlap(A.s, B.s), `${label} arm ${A.a}#${A.i} overlaps arm ${B.a}#${B.i}`);
    if (A.a !== B.a) assert.ok(!touching(A.s, B.s), `${label} arm ${A.a}#${A.i} touches arm ${B.a}#${B.i}`);
  }
  slots.forEach((arm, a) => arm.forEach((s, i) => {
    const before = i === 0 ? hub : arm[i - 1];
    assert.ok(sharedEdge(before, s) >= 2, `${label} arm ${a} bone ${i} does not join ${i === 0 ? 'the double blank' : 'the bone before it'}`);
  }));
}

test('each arm heads out towards its player first, joined to the double blank', () => {
  const cols = 26;
  const rows = 38;
  const { slots, stuck } = phoneFrenchPinwheel({
    arms: DIRS.map((direction) => ({ direction, doubles: [false] })), order: [0, 1, 2, 3], cols, rows,
  });
  assert.equal(stuck, 0);
  const hub = hubOf(cols, rows);
  slots.forEach((arm, a) => assert.equal(travel(hub, arm[0]), DIRS[a], `arm ${a} must head ${DIRS[a]}`));
  assertSound(slots, cols, rows);
});

test('phones lay two bones each way, then turn clockwise (owner, 2026-09-16)', () => {
  const cols = 26;
  const rows = 38;
  const lengths = [5, 5, 5, 5];
  const { slots, stuck } = phoneFrenchPinwheel({
    arms: DIRS.map((direction, a) => ({ direction, doubles: new Array<boolean>(lengths[a]).fill(false) })),
    order: roundRobin(lengths), cols, rows,
  });
  assert.equal(stuck, 0);
  assertSound(slots, cols, rows);
  const hub = hubOf(cols, rows);
  const legs: Record<Dir, number> = { up: 2, right: 2, down: 2, left: 2 };
  slots.forEach((arm, a) => {
    const out = DIRS[a];
    for (let i = 0; i < legs[out]; i++) {
      assert.equal(travel(i === 0 ? hub : arm[i - 1], arm[i]), out, `${out} arm bone ${i} still heads ${out}`);
    }
    assert.equal(travel(arm[legs[out] - 1], arm[legs[out]]), CLOCKWISE[out], `${out} arm turns ${CLOCKWISE[out]} after ${legs[out]}`);
  });
});

test('desktop lays four bones to each side and three up and down, then turns clockwise', () => {
  const cols = 58;
  const rows = 39;
  const lengths = [6, 6, 6, 6];
  const { slots, stuck } = phoneFrenchPinwheel({
    arms: DIRS.map((direction, a) => ({ direction, doubles: new Array<boolean>(lengths[a]).fill(false) })),
    order: roundRobin(lengths), cols, rows, legs: FRENCH_DESK_PINWHEEL_LEGS,
  });
  assert.equal(stuck, 0);
  assertSound(slots, cols, rows);
  const hub = hubOf(cols, rows);
  const legs: Record<Dir, number> = { up: 3, right: 4, down: 3, left: 4 };
  slots.forEach((arm, a) => {
    const out = DIRS[a];
    for (let i = 0; i < legs[out]; i++) {
      assert.equal(travel(i === 0 ? hub : arm[i - 1], arm[i]), out, `${out} arm bone ${i} still heads ${out}`);
    }
    assert.equal(travel(arm[legs[out] - 1], arm[legs[out]]), CLOCKWISE[out], `${out} arm turns ${CLOCKWISE[out]} after ${legs[out]}`);
  });
});

test('arms turn clockwise at the table edge and never stack rows like a comb', () => {
  const cols = 26;
  const rows = 38;
  const lengths = [8, 8, 8, 8];
  const { slots, stuck } = phoneFrenchPinwheel({
    arms: DIRS.map((direction, a) => ({ direction, doubles: new Array<boolean>(lengths[a]).fill(false) })),
    order: roundRobin(lengths), cols, rows,
  });
  assert.equal(stuck, 0);
  assertSound(slots, cols, rows);
  const hub = hubOf(cols, rows);
  slots.forEach((arm, a) => {
    let heading = travel(hub, arm[0]);
    let turns = 0;
    let spin = 0;
    for (let i = 1; i < arm.length; i++) {
      const next = travel(arm[i - 1], arm[i]);
      if (next !== heading) {
        // Clockwise first; once an arm has made its U it may only turn back
        // outward, never curl into itself (owner, 2026-09-16).
        spin += next === CLOCKWISE[heading] ? 1 : -1;
        assert.ok(Math.abs(spin) <= 2, `arm ${a} (${DIRS[a]}) turned ${heading}→${next} at bone ${i}: curls back on itself`);
        if (turns === 0) assert.equal(next, CLOCKWISE[heading], `arm ${a} (${DIRS[a]}) first turns clockwise`);
        heading = next;
        turns += 1;
      }
    }
    assert.ok(turns >= 1, `a ${lengths[a]}-bone ${DIRS[a]} arm reaches the edge and turns`);
  });
});

test('doubles stand across the arm, and a double on a turn makes the L', () => {
  const cols = 26;
  const rows = 38;
  // A double second on the right arm, with room ahead, and a double landing
  // where the up arm turns.
  const straight = phoneFrenchPinwheel({
    arms: DIRS.map((direction, a) => ({ direction, doubles: a === 1 ? [false, true, false] : [false] })),
    order: [0, 1, 2, 3, 1, 1], cols, rows,
  });
  assert.equal(straight.stuck, 0);
  const right = straight.slots[1];
  assert.equal(travel(right[0], right[1]), 'right');
  assert.ok(right[1].h > right[1].w, 'a double in a row running right stands upright, across the row');
  assert.equal(right[1].y + right[1].h / 2, right[0].y + right[0].h / 2, 'centred on the row');

  // The right arm turns down with room to spare past its row: a double
  // arriving there makes the L. Phones lay three side bones to the rim, so
  // the L is checked on a board wide enough to have room past the row.
  const wide = 34;
  const plainRight = phoneFrenchPinwheel({
    arms: DIRS.map((direction, a) => ({ direction, doubles: new Array<boolean>(a === 1 ? 5 : 1).fill(false) })),
    order: [0, 1, 2, 3, 1, 1, 1, 1], cols: wide, rows,
  }).slots[1];
  const rightTurn = plainRight.findIndex((s, i) => i > 0 && travel(plainRight[i - 1], s) !== 'right');
  assert.ok(rightTurn > 0, 'the right arm turns within five bones');
  const withL = phoneFrenchPinwheel({
    arms: DIRS.map((direction, a) => ({
      direction, doubles: a === 1 ? Array.from({ length: 5 }, (_, i) => i === rightTurn) : [false],
    })),
    order: [0, 1, 2, 3, 1, 1, 1, 1], cols: wide, rows,
  });
  assert.equal(withL.stuck, 0);
  assertSound(withL.slots, wide, rows);
  const lArm = withL.slots[1];
  const corner = lArm[rightTurn];
  const before = lArm[rightTurn - 1];
  assert.ok(before.w > before.h, 'the arm arrives along a row');
  assert.ok(corner.h > corner.w, 'the corner double stands across the row, never along it');
  assert.equal(corner.x, before.x + before.w, 'past the end of the row, touching its end');
  assert.equal(corner.y, before.y, 'one half level with the row, not docked at its waist');
  assert.equal(travel(corner, lArm[rightTurn + 1]), 'down', 'the line carries on clockwise from the other half');

  // At the very top edge there is no room past the climb for the L; the
  // double is laid where a turning bone goes, still across the climb.
  const plainUp = phoneFrenchPinwheel({
    arms: DIRS.map((direction, a) => ({ direction, doubles: new Array<boolean>(a === 0 ? 6 : 1).fill(false) })),
    order: [0, 1, 2, 3, 0, 0, 0, 0, 0], cols, rows,
  }).slots[0];
  const upTurn = plainUp.findIndex((s, i) => i > 0 && travel(plainUp[i - 1], s) !== 'up');
  const edge = phoneFrenchPinwheel({
    arms: DIRS.map((direction, a) => ({ direction, doubles: a === 0 ? Array.from({ length: 6 }, (_, i) => i === upTurn) : [false] })),
    order: [0, 1, 2, 3, 0, 0, 0, 0, 0], cols, rows,
  });
  assert.equal(edge.stuck, 0);
  assertSound(edge.slots, cols, rows);
  const edgeCorner = edge.slots[0][upTurn];
  assert.ok(edgeCorner.w > edgeCorner.h, 'a double at the top edge still lies across the climb, never along it');
});

test('a played bone never moves when later bones go down', () => {
  const cols = 26;
  const rows = 38;
  const arms = DIRS.map((direction, a) => ({ direction, doubles: [false, a === 2, false, true, false, false, a === 0, false] }));
  const order = roundRobin([8, 8, 8, 8]);
  const whole = phoneFrenchPinwheel({ arms, order, cols, rows }).slots;
  for (let n = 1; n < order.length; n++) {
    const prefix = order.slice(0, n);
    const counts = DIRS.map((_, a) => prefix.filter((arm) => arm === a).length);
    const early = phoneFrenchPinwheel({
      arms: arms.map((arm, a) => ({ ...arm, doubles: arm.doubles.slice(0, counts[a]) })), order: prefix, cols, rows,
    }).slots;
    early.forEach((arm, a) => arm.forEach((s, i) => assert.deepEqual(s, whole[a][i], `arm ${a} bone ${i} moved after play ${n}`)));
  }
});

test('an arm with no room left grows past the bottom and moves nothing already down', () => {
  // A small board and one very long down arm: it must run out of room.
  const cols = 24;
  const rows = 20;
  const lengths = [2, 2, 16, 2];
  const arms = DIRS.map((direction, a) => ({ direction, doubles: new Array<boolean>(lengths[a]).fill(false) }));
  const order = roundRobin(lengths);
  // The growth rule itself, with short side legs so the small board is not
  // already full across its middle row.
  const legs = { left: 2, right: 2, up: 3, down: 3 };
  const whole = phoneFrenchPinwheel({ arms, order, cols, rows, legs });
  // Since phones let a side bone reach the rim (owner's three-bone sides,
  // 2026-09-15), this deliberately overfilled 24x20 board leaves two bones
  // with no clean place. Kept as a ceiling until the layout is revisited.
  assert.ok(whole.stuck <= 2, `growing past the bottom left ${whole.stuck} bones without room`);
  const all = whole.slots.flat();
  assert.ok(all.some((s) => s.y + s.h > rows), 'the long arm really did grow past the bottom');
  assert.ok(all.every((s) => s.y >= 0), 'nothing grows past the top, which would shift the whole board down');
  for (let n = 1; n < order.length; n++) {
    const prefix = order.slice(0, n);
    const counts = DIRS.map((_, a) => prefix.filter((arm) => arm === a).length);
    const early = phoneFrenchPinwheel({
      arms: arms.map((arm, a) => ({ ...arm, doubles: arm.doubles.slice(0, counts[a]) })), order: prefix, cols, rows, legs,
    }).slots;
    early.forEach((arm, a) => arm.forEach((s, i) => assert.deepEqual(s, whole.slots[a][i], `arm ${a} bone ${i} moved after play ${n}`)));
  }
});

test('real French hands lay out on a phone without touching arms or covering player tabs', () => {
  const tiles: string[] = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) tiles.push(`${a}-${b}`);
  let seed = 914;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const cols = 26;
  const rows = 38;
  // Collapsed player tabs sitting in the rim: left, right and the partner's at the top.
  const blocked: R[] = [{ x: 0, y: 21, w: 1, h: 2 }, { x: 25, y: 21, w: 1, h: 2 }, { x: 11, y: 0, w: 4, h: 1 }];
  let hands = 0;
  let clean = 0;
  let curls = 0;
  for (let k = 0; hands < 200 && k < 2000; k++) {
    const order = [...tiles];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    let hand = deal({
      order: order as never, seatCount: 4, mode: 'cutthroat', format: 'french', useBoneyard: false, poseMustBeDoubleSix: false, poser: 0,
    } as never);
    for (let guard = 0; guard < 400 && hand.status === 'active'; guard++) {
      const moves = legalMoves(hand);
      if (!moves.length) break;
      hand = applyMove(hand, moves[Math.floor(rand() * moves.length)]);
    }
    const board = hand.board;
    if (board?.kind !== 'cross') continue;
    hands += 1;
    const isDouble = (tile: string) => tile.split('-')[0] === tile.split('-')[1];
    const armOrder = hand.moveLog.flatMap((m) => m.kind === 'playcross' ? [m.arm] : []);
    const { slots, stuck } = phoneFrenchPinwheel({
      arms: board.arms.map((arm, a) => ({ direction: DIRS[a % 4], doubles: arm.tiles.map((t) => isDouble(t.tile)) })),
      order: armOrder, cols, rows, blocked,
    });
    // An arm turns back into itself only when the alternative is a bone drawn
    // on top of others (owner, 2026-09-16: "never turn back in on itself").
    let curled = false;
    slots.forEach((arm, a) => {
      let dir: Dir = DIRS[a % 4];
      let spin = 0;
      arm.forEach((s, i) => {
        if (i === 0) return;
        const d = travel(arm[i - 1], s);
        if (d !== dir) spin += CLOCKWISE[dir] === d ? 1 : -1;
        dir = d;
        if (Math.abs(spin) > 2) curled = true;
      });
    });
    if (curled) curls += 1;
    if (stuck === 0) {
      clean += 1;
      assertSound(slots, cols, rows, blocked, `hand ${k}`);
    }
  }
  assert.ok(hands >= 150, 'enough real French hands were simulated');
  // JamDom's short first legs (left/right 2, up/down 3) keep the pinwheel
  // tight but leave less room for a long late arm. The owner accepted about
  // one hand in eight or nine needing the fallback (2026-09-15: "only 2
  // difference and we can always see where to tweak later").
  // Owner, 2026-09-15: keep three side bones on phones for now even though
  // fewer real hands fit cleanly (87 of 200 here; 330 of 400 with two). This
  // floor guards against it getting worse while the layout is revisited.
  // Measured over 1000 hands: 384 curled before the guard, 93 after.
  assert.ok(curls / hands <= 0.12, `${curls} of ${hands} hands curled an arm back on itself`);
  assert.ok(clean / hands >= 0.4, `only ${clean} of ${hands} hands fit a 390px phone without a fallback`);
});
