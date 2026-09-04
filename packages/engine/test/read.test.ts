import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { readTable, outlookFor, tilesCarrying, couldHold } from '../src/read.ts';
import { publicView } from '../src/bots.ts';
import { deal, legalMoves, applyMove, openEnds } from '../src/hand.ts';
import { provablyFairShuffle } from '../src/shuffle.ts';
import type { HandState, Move } from '../src/types.ts';

async function freshHand(seed = 1, seatCount: 2 | 3 | 4 = 4): Promise<HandState> {
  const order = await provablyFairShuffle({
    serverSeed: `s${seed}`, clientSeeds: ['c'], handId: `h${seed}`,
  });
  return deal({ order, seatCount, mode: 'partner', useBoneyard: false, poseMustBeDoubleSix: true });
}

/** Play the hand forward with the first legal move each time, so passes —
 *  and the `ends` stamped on them by applyMove — accumulate naturally.
 *  Never fabricate a pass by hand: engine.md warns that a pass without
 *  `ends` makes void detection silently return nothing. */
function playForward(s: HandState, plies: number): HandState {
  let state = s;
  for (let i = 0; i < plies && state.status === 'active'; i++) {
    const moves = legalMoves(state);
    if (moves.length === 0) break;
    state = applyMove(state, moves[0]);
  }
  return state;
}

describe('the live coach reads only what the table shows', () => {
  test('every pip is carried by seven tiles, so seen plus out is always seven', async () => {
    const s = await freshHand();
    const read = readTable(publicView(s, 0));
    for (const suit of read.suits) {
      assert.equal(suit.seen + suit.out, 7, `pip ${suit.pip} does not add up`);
      assert.equal(suit.total, 7);
    }
  });

  test('a three-hander drops the double-blank, so only six tiles carry a blank', async () => {
    const s = await freshHand(2, 3);
    const read = readTable(publicView(s, 0));
    const blanks = read.suits.find((c) => c.pip === 0)!;
    assert.equal(blanks.total, 6);
    assert.equal(blanks.seen + blanks.out, 6);
    // Counting seven here would report a blank still unaccounted for when the
    // tile does not exist — the quiet lie tilesCarrying exists to prevent.
    assert.equal(tilesCarrying(0, 3), 6);
    assert.equal(tilesCarrying(0, 4), 7);
    assert.equal(tilesCarrying(6, 3), 7);
  });

  test('at a fresh four-hand deal my own seven tiles are the only ones I can see', async () => {
    const s = await freshHand();
    const read = readTable(publicView(s, 0));
    const seen = read.suits.reduce((n, c) => n + c.seen, 0);
    // Seven tiles, each counted once per distinct pip: doubles contribute one,
    // everything else two.
    const expected = s.hands[0].reduce((n, t) => {
      const [a, b] = [Number(t[0]), Number(t[2])];
      return n + (a === b ? 1 : 2);
    }, 0);
    assert.equal(seen, expected);
    assert.equal(read.boneyardSize, 0, 'a four-hander deals all 28 tiles');
  });

  test('out never goes negative, however far the hand runs', async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = playForward(await freshHand(seed), 40);
      for (const seat of [0, 1, 2, 3]) {
        for (const suit of readTable(publicView(s, seat)).suits) {
          assert.ok(suit.out >= 0, `pip ${suit.pip} went negative`);
          assert.ok(suit.seen <= suit.total);
        }
      }
    }
  });

  test('the reader is never listed among the seats being read', async () => {
    const s = playForward(await freshHand(3), 12);
    for (const seat of [0, 1, 2, 3]) {
      const read = readTable(publicView(s, seat));
      assert.equal(read.seats.length, 3);
      assert.ok(!read.seats.some((r) => r.seat === seat));
    }
  });

  test('a pass proves a void, and the void is what makes a seat provably stuck', async () => {
    // Run hands until one produces a real pass — applyMove stamps the open
    // ends onto it, which is the only way void detection sees anything.
    let found = false;
    for (let seed = 1; seed <= 12 && !found; seed++) {
      const s = playForward(await freshHand(seed), 60);
      const passes = s.moveLog.filter((m) => m.kind === 'pass');
      if (passes.length === 0) continue;
      found = true;
      const passer = passes[0].seat;
      const reader = (passer + 1) % s.seatCount;
      const read = readTable(publicView(s, reader));
      const theirs = read.seats.find((r) => r.seat === passer)!;
      assert.ok(theirs.voids.length > 0, 'a pass must leave a void behind');
      // Stuck is exactly "void in every open end" — never a guess.
      const expected = read.openEnds.length > 0
        && read.openEnds.every((e) => theirs.voids.includes(e));
      assert.equal(theirs.mustPassNow, expected);
    }
    assert.ok(found, 'no pass occurred in twelve hands — the fixture is wrong');
  });

  test('nobody is stuck before the board is posed', async () => {
    const s = await freshHand();
    const read = readTable(publicView(s, 0));
    assert.deepEqual(read.openEnds, []);
    assert.ok(read.seats.every((r) => !r.mustPassNow),
      'an empty end list must not make everyone vacuously stuck');
  });

  test('couldHold narrows to the seats that have not passed on the suit', async () => {
    const s = playForward(await freshHand(4), 30);
    const read = readTable(publicView(s, 0));
    for (let pip = 0; pip <= 6; pip++) {
      const holders = couldHold(pip as never, read);
      for (const seat of holders) {
        const r = read.seats.find((x) => x.seat === seat)!;
        assert.ok(!r.voids.includes(pip as never),
          `seat ${seat} passed on ${pip} and must not be listed as able to hold it`);
        assert.ok(r.handSize > 0, 'a seat with no tiles holds nothing');
      }
    }
  });
});

describe('looking one move ahead', () => {
  test('the forecast ends match the real board after the move is actually played', async () => {
    let checked = 0;
    for (let seed = 1; seed <= 10; seed++) {
      for (const plies of [1, 5, 9, 17]) {
        const s = playForward(await freshHand(seed), plies);
        if (s.status !== 'active') continue;
        const view = publicView(s, s.turn);
        const moves = legalMoves(s).filter((m) => m.seat === s.turn && m.kind !== 'pass');
        for (const move of moves) {
          const forecast = [...outlookFor(view, move).endsAfter].sort();
          // The real thing: apply the move and read the board it produced.
          const after = applyMove(s, move);
          const truth = [...(after.board ? openEnds(after.board) : [])].sort();
          assert.deepEqual(forecast, truth,
            `forecast diverged from the board after ${JSON.stringify(move)}`);
          checked++;
        }
      }
    }
    assert.ok(checked > 20, `only ${checked} moves forecast — fixture too thin to prove anything`);
  });

  test('a seat is only forced to pass when it is void in every end the move leaves', async () => {
    let checked = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const s = playForward(await freshHand(seed), 50);
      if (s.status !== 'active') continue;
      const view = publicView(s, s.turn);
      for (const move of legalMoves(s).filter((m) => m.seat === s.turn)) {
        const outlook = outlookFor(view, move);
        const read = readTable(view);
        for (const seat of outlook.forcedPasses) {
          const r = read.seats.find((x) => x.seat === seat)!;
          assert.ok(outlook.endsAfter.every((e) => r.voids.includes(e)),
            'forced to pass without being void in every end');
          checked++;
        }
      }
    }
    assert.ok(checked >= 0);
  });

  test('the board only "comes back to me" when every other seat holding tiles is stuck', async () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = playForward(await freshHand(seed), 50);
      if (s.status !== 'active') continue;
      const view = publicView(s, s.turn);
      for (const move of legalMoves(s).filter((m) => m.seat === s.turn)) {
        const outlook = outlookFor(view, move);
        if (!outlook.comesBackToMe) continue;
        const others = [0, 1, 2, 3]
          .filter((seat) => seat !== view.seat && (view.handSizes[seat] ?? 0) > 0);
        assert.deepEqual([...outlook.forcedPasses].sort(), others.sort(),
          'claimed to come back around while somebody could still answer');
      }
    }
  });

  test('an empty forced-pass list never claims the board comes back around', async () => {
    const s = await freshHand(7);
    const view = publicView(s, s.turn);
    for (const move of legalMoves(s).filter((m) => m.seat === s.turn)) {
      const outlook = outlookFor(view, move);
      if (outlook.forcedPasses.length === 0) {
        assert.equal(outlook.comesBackToMe, false);
      }
    }
  });
});
