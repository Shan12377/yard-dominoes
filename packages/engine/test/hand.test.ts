import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  fullSet,
  handCount,
  dealPlan,
  sideOf,
  nextSeat,
  DOUBLE_SIX,
} from '../src/tiles.ts';
import {
  commit,
  provablyFairShuffle,
  verifyHand,
  randomSeed,
} from '../src/shuffle.ts';
import { deal, legalMoves, applyMove, knownVoids } from '../src/hand.ts';
import type { Board, HandState, Pip, TileId } from '../src/types.ts';

/** Build a hand mid-play with explicit holdings and a chosen pair of open ends. */
function makeHand(hands: TileId[][], leftEnd: Pip, rightEnd: Pip, turn = 0): HandState {
  const board: Board = {
    line: [{ tile: `${leftEnd}-${rightEnd}`, crosswise: leftEnd === rightEnd }],
    leftEnd,
    rightEnd,
  };
  return {
    seatCount: hands.length,
    mode: 'partner',
    hands: hands.map((h) => [...h]),
    boneyard: [],
    board,
    turn,
    consecutivePasses: 0,
    moveLog: [],
    status: 'active',
    result: null,
    poseMustBeDoubleSix: false,
    poser: 0,
  };
}

describe('the set of tiles', () => {
  test('a double-six set is 28 tiles', () => {
    assert.equal(fullSet().length, 28);
  });

  test('there are seven of every suit — the number the whole counting game rests on', () => {
    for (let suit = 0; suit <= 6; suit++) {
      const count = fullSet().filter((t) => t.split('-').map(Number).includes(suit)).length;
      assert.equal(count, 7, `suit ${suit} should appear on seven tiles`);
    }
  });

  test('the full set counts 168 pips', () => {
    assert.equal(handCount(fullSet()), 168);
  });

  test('deal sizes match the Jamaican convention', () => {
    assert.deepEqual(dealPlan(4, false), { perPlayer: 7, removeDoubleBlank: false });
    assert.deepEqual(dealPlan(3, false), { perPlayer: 9, removeDoubleBlank: true });
    assert.deepEqual(dealPlan(2, false), { perPlayer: 14, removeDoubleBlank: false });
    assert.deepEqual(dealPlan(2, true), { perPlayer: 7, removeDoubleBlank: false });
  });

  test('partners sit opposite and never play consecutively', () => {
    assert.equal(sideOf(0, 'partner'), sideOf(2, 'partner'));
    assert.equal(sideOf(1, 'partner'), sideOf(3, 'partner'));
    assert.notEqual(sideOf(0, 'partner'), sideOf(1, 'partner'));
    // The seat that follows you is never your partner.
    for (let s = 0; s < 4; s++) {
      assert.notEqual(sideOf(nextSeat(s, 4), 'partner'), sideOf(s, 'partner'));
    }
  });

  test('in cut throat every seat is its own side', () => {
    for (let s = 0; s < 4; s++) assert.equal(sideOf(s, 'cutthroat'), s);
  });
});

describe('provably fair shuffle', () => {
  test('is deterministic for the same inputs', async () => {
    const args = { serverSeed: 'abc', clientSeeds: ['x', 'y'], handId: 'h1' };
    assert.deepEqual(await provablyFairShuffle(args), await provablyFairShuffle(args));
  });

  test('produces a complete set with no duplicates or losses', async () => {
    const order = await provablyFairShuffle({
      serverSeed: randomSeed(),
      clientSeeds: ['a'],
      handId: 'h',
    });
    assert.equal(order.length, 28);
    assert.equal(new Set(order).size, 28);
    assert.deepEqual([...order].sort(), fullSet().sort());
  });

  test('drops the double-blank for a three-hander', async () => {
    const order = await provablyFairShuffle({
      serverSeed: 'seed',
      clientSeeds: ['a'],
      handId: 'h',
      removeDoubleBlank: true,
    });
    assert.equal(order.length, 27);
    assert.ok(!order.includes('0-0'));
  });

  test('a different client seed produces a different deal', async () => {
    const a = await provablyFairShuffle({ serverSeed: 's', clientSeeds: ['p1'], handId: 'h' });
    const b = await provablyFairShuffle({ serverSeed: 's', clientSeeds: ['p2'], handId: 'h' });
    assert.notDeepEqual(a, b);
  });

  test('a player can verify the hand they were dealt', async () => {
    const serverSeed = randomSeed();
    const commitment = await commit(serverSeed);
    const clientSeeds = ['alice', 'bob', 'carl', 'dee'];
    const handId = 'set1-hand1';
    const order = await provablyFairShuffle({ serverSeed, clientSeeds, handId });
    const dealt = [0, 1, 2, 3].map((s) => order.slice(s * 7, s * 7 + 7));

    const check = await verifyHand({
      handId, commitment, serverSeed, clientSeeds, removeDoubleBlank: false, dealt,
    });
    assert.equal(check.ok, true);
  });

  test('a server that swapped the seed after committing is caught', async () => {
    const commitment = await commit(randomSeed());
    const serverSeed = randomSeed(); // different seed, same published commitment
    const clientSeeds = ['a'];
    const order = await provablyFairShuffle({ serverSeed, clientSeeds, handId: 'h' });
    const check = await verifyHand({
      handId: 'h', commitment, serverSeed, clientSeeds,
      removeDoubleBlank: false, dealt: [order.slice(0, 7)],
    });
    assert.equal(check.ok, false);
    assert.match(check.reason!, /commitment/);
  });

  test('a server that dealt something other than the committed shuffle is caught', async () => {
    const serverSeed = randomSeed();
    const commitment = await commit(serverSeed);
    const clientSeeds = ['a'];
    const order = await provablyFairShuffle({ serverSeed, clientSeeds, handId: 'h' });
    const tampered = [...order.slice(0, 7)];
    tampered[0] = order[20]; // slipped the player a better tile
    const check = await verifyHand({
      handId: 'h', commitment, serverSeed, clientSeeds,
      removeDoubleBlank: false, dealt: [tampered],
    });
    assert.equal(check.ok, false);
    assert.match(check.reason!, /diverges/);
  });
});

describe('opening the hand', () => {
  test('tournament play forces the double-six to be led, not merely held', async () => {
    const order = await provablyFairShuffle({ serverSeed: 's', clientSeeds: ['a'], handId: 'h' });
    const h = deal({
      order, seatCount: 4, mode: 'partner', useBoneyard: false, poseMustBeDoubleSix: true,
    });
    assert.ok(h.hands[h.poser].includes(DOUBLE_SIX));
    const moves = legalMoves(h);
    assert.equal(moves.length, 1);
    assert.deepEqual(moves[0], { kind: 'pose', seat: h.poser, tile: DOUBLE_SIX });
  });

  test('casual play lets the opener go sporting with any tile', async () => {
    const order = await provablyFairShuffle({ serverSeed: 's', clientSeeds: ['a'], handId: 'h' });
    const h = deal({
      order, seatCount: 4, mode: 'partner', useBoneyard: false, poseMustBeDoubleSix: false,
    });
    assert.equal(legalMoves(h).length, 7);
  });

  test('the previous winner opens later hands and may pose anything', async () => {
    const order = await provablyFairShuffle({ serverSeed: 's', clientSeeds: ['a'], handId: 'h' });
    const h = deal({
      order, seatCount: 4, mode: 'partner', useBoneyard: false,
      poser: 2, poseMustBeDoubleSix: false,
    });
    assert.equal(h.poser, 2);
    assert.equal(h.turn, 2);
    assert.ok(legalMoves(h).every((m) => m.kind === 'pose' && m.seat === 2));
  });
});

describe('turn order', () => {
  test('play runs anti-clockwise — the seat to your right acts next', () => {
    const h = makeHand(
      [['0-1', '2-2'], ['1-1', '3-3'], ['0-2', '4-4'], ['1-2', '5-5']],
      0, 1, 0,
    );
    const next = applyMove(h, { kind: 'play', seat: 0, tile: '0-1', end: 'left' });
    assert.equal(next.turn, 1);
    const after = applyMove(next, { kind: 'play', seat: 1, tile: '1-1', end: 'left' });
    assert.equal(after.turn, 2);
  });
});

describe('blocked hands', () => {
  test('the lowest INDIVIDUAL count wins — a partner\'s tiles never rescue him', () => {
    // The canonical example. Seats: 0 North, 1 East, 2 South, 3 West.
    // North 5-5 = 10, East 2-2 = 4, South 1-1 = 2, West 5-1 = 6.
    // Side 0 (North+South) holds 12 pips. Side 1 (East+West) holds 10.
    // Side 1 has FEWER pips in total, and still loses — because South alone
    // holds the lowest count in the hand.
    let h = makeHand([['5-5'], ['2-2'], ['1-1'], ['5-1']], 3, 3, 0);
    for (let seat = 0; seat < 4; seat++) {
      h = applyMove(h, { kind: 'pass', seat });
    }
    assert.equal(h.status, 'blocked');
    assert.equal(h.result!.winnerSeat, 2, 'South holds the lowest single count');
    assert.equal(h.result!.winnerSide, 0);
    assert.equal(h.result!.tie, false);

    const side0 = h.result!.counts[0] + h.result!.counts[2];
    const side1 = h.result!.counts[1] + h.result!.counts[3];
    assert.equal(side0, 12);
    assert.equal(side1, 10);
    assert.ok(side0 > side1, 'the winning team is holding more pips overall');
  });

  test('equal lowest counts tie the hand rather than deciding it', () => {
    // Two players both sitting on a count of 6.
    let h = makeHand([['4-2'], ['3-3'], ['4-4'], ['6-6']], 5, 5, 0);
    for (let seat = 0; seat < 4; seat++) {
      h = applyMove(h, { kind: 'pass', seat });
    }
    assert.equal(h.status, 'blocked');
    assert.equal(h.result!.tie, true);
    assert.equal(h.result!.winnerSeat, null);
    assert.equal(h.result!.winnerSide, null);
  });

  test('the double-blank counts zero and wins a block outright', () => {
    let h = makeHand([['0-0'], ['0-1'], ['1-1'], ['2-2']], 5, 5, 0);
    for (let seat = 0; seat < 4; seat++) h = applyMove(h, { kind: 'pass', seat });
    assert.equal(h.result!.winnerSeat, 0);
    assert.equal(h.result!.counts[0], 0);
  });

  test('playing your last tile ends the hand immediately', () => {
    const h = makeHand([['0-1'], ['3-3'], ['4-4'], ['5-5']], 0, 6, 0);
    const done = applyMove(h, { kind: 'play', seat: 0, tile: '0-1', end: 'left' });
    assert.equal(done.status, 'domino');
    assert.equal(done.result!.winnerSeat, 0);
    assert.equal(done.result!.winnerSide, 0);
  });
});

describe('legality', () => {
  test('a tile that matches neither end cannot be played', () => {
    const h = makeHand([['2-3'], ['1-1'], ['4-4'], ['5-5']], 0, 6, 0);
    const moves = legalMoves(h);
    assert.equal(moves.length, 1);
    assert.equal(moves[0].kind, 'pass');
    assert.throws(() => applyMove(h, { kind: 'play', seat: 0, tile: '2-3', end: 'left' }));
  });

  test('you cannot act out of turn', () => {
    const h = makeHand([['0-1'], ['1-6'], ['4-4'], ['5-5']], 0, 6, 0);
    assert.throws(() => applyMove(h, { kind: 'play', seat: 1, tile: '1-6', end: 'right' }), /turn/);
  });

  test('a tile matching both ends offers both placements', () => {
    const h = makeHand([['0-6'], ['1-1'], ['4-4'], ['5-5']], 0, 6, 0);
    const moves = legalMoves(h);
    assert.equal(moves.length, 2);
    assert.deepEqual(moves.map((m) => (m as any).end).sort(), ['left', 'right']);
  });

  test('a drawn tile does not end your turn', () => {
    const h = makeHand([['2-3'], ['1-1'], ['4-4'], ['5-5']], 0, 6, 0);
    h.boneyard = ['0-6'];
    const moves = legalMoves(h);
    assert.equal(moves[0].kind, 'draw');
    const after = applyMove(h, moves[0]);
    assert.equal(after.turn, 0, 'still your play after drawing');
    assert.ok(after.hands[0].includes('0-6'));
    assert.equal(after.boneyard.length, 0);
  });
});

describe('reading the table', () => {
  test('a pass permanently reveals a void in both open suits', () => {
    let h = makeHand([['0-1', '6-6'], ['3-4'], ['2-2'], ['5-5']], 0, 6, 0);
    h = applyMove(h, { kind: 'play', seat: 0, tile: '0-1', end: 'left' }); // ends now 1 and 6
    h = applyMove(h, { kind: 'pass', seat: 1 });                            // East void in 1 and 6
    const voids = knownVoids(h);
    assert.deepEqual([...voids[1]].sort(), [1, 6]);
    assert.equal(voids[0].size, 0);
    assert.equal(voids[2].size, 0);
  });
});
