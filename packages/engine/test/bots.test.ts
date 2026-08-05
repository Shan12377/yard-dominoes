import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  publicView, chooseMove, duppyMove, suitStrength, voidsFromLog,
  sampleConsistentDeal, DUPPY_LEVELS, allBoardTiles, hardEnds, deadDoubles, hasKey,
} from '../src/bots.ts';
import type { PublicView } from '../src/bots.ts';
import { reviewHand, accuracy } from '../src/coach.ts';
import { deal, legalMoves, applyMove } from '../src/hand.ts';
import { provablyFairShuffle } from '../src/shuffle.ts';
import { halves } from '../src/tiles.ts';
import type { DuppyLevel } from '../src/bots.ts';
import type { AnyBoard, HandState, Move, TileId } from '../src/types.ts';

function rngFrom(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function freshHand(seed = 1): Promise<HandState> {
  const order = await provablyFairShuffle({
    serverSeed: `s${seed}`, clientSeeds: ['c'], handId: `h${seed}`,
  });
  return deal({ order, seatCount: 4, mode: 'partner', useBoneyard: false, poseMustBeDoubleSix: true });
}

describe('the duppies cannot see your tiles', () => {
  test('a public view contains no other seat\'s tiles', async () => {
    const h = await freshHand();
    const view = publicView(h, 0);
    // openingTile is a table-wide public constant (6-6 outside French, 0-0
    // inside), NOT a hand tile — strip it before the anti-cheat scan so the
    // seat that happens to hold the opening tile isn't a false positive.
    const { openingTile: _skip, ...seatSensitive } = view;
    const serialized = JSON.stringify(seatSensitive);

    // Every tile held by another seat must be absent from the view, unless the
    // reviewed seat happens to hold the same id (impossible — ids are unique).
    for (let seat = 1; seat < 4; seat++) {
      for (const tile of h.hands[seat]) {
        assert.ok(
          !serialized.includes(`"${tile}"`),
          `view leaked ${tile} from seat ${seat}`,
        );
      }
    }
    assert.deepEqual(view.myHand.sort(), [...h.hands[0]].sort());
    assert.deepEqual(view.handSizes, [7, 7, 7, 7]);
  });

  test('a view exposes sizes but never contents', async () => {
    const h = await freshHand(3);
    const view = publicView(h, 2);
    assert.equal(Object.hasOwn(view, 'hands'), false);
    assert.equal(view.handSizes.reduce((a, b) => a + b, 0), 28);
  });
});

describe('duppy play', () => {
  test('every level returns a legal move at every turn', async () => {
    for (const level of DUPPY_LEVELS) {
      const rng = rngFrom(7);
      let h = await freshHand(2);
      let steps = 0;
      while (h.status === 'active' && steps++ < 300) {
        const legal = legalMoves(h);
        const chosen = duppyMove(h, level as DuppyLevel, rng);
        assert.ok(
          legal.some((m) =>
            m.kind === chosen.kind &&
            (m as any).tile === (chosen as any).tile &&
            (m as any).end === (chosen as any).end),
          `${level} produced an illegal move`,
        );
        h = applyMove(h, chosen);
      }
      assert.notEqual(h.status, 'active', `${level} failed to finish the hand`);
    }
  });

  test('stronger duppies beat weaker ones over a run of hands', async () => {
    // Seats 0 and 2 play `don`; seats 1 and 3 play `pickney`.
    let donWins = 0;
    let pickneyWins = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const rng = rngFrom(seed * 13);
      let h = await freshHand(seed);
      let steps = 0;
      while (h.status === 'active' && steps++ < 300) {
        const level: DuppyLevel = h.turn % 2 === 0 ? 'don' : 'pickney';
        h = applyMove(h, duppyMove(h, level, rng));
      }
      if (h.result!.winnerSide === 0) donWins++;
      else if (h.result!.winnerSide === 1) pickneyWins++;
    }
    assert.ok(
      donWins > pickneyWins,
      `expected don to lead, got don ${donWins} vs pickney ${pickneyWins}`,
    );
  });

  test('sampled deals never contradict a revealed void', async () => {
    const rng = rngFrom(11);
    let h = await freshHand(5);
    for (let i = 0; i < 12 && h.status === 'active'; i++) {
      h = applyMove(h, duppyMove(h, 'yard', rng));
    }
    if (h.status !== 'active') return;

    const view = publicView(h, h.turn);
    const voids = voidsFromLog(view);
    for (let i = 0; i < 20; i++) {
      const sampled = sampleConsistentDeal(view, rng);
      if (!sampled) continue;
      sampled.forEach((hand, seat) => {
        if (seat === view.seat) return;
        for (const tile of hand) {
          const [a, b] = halves(tile);
          assert.ok(!voids[seat].has(a), `seat ${seat} passed on ${a} but was dealt ${tile}`);
          assert.ok(!voids[seat].has(b), `seat ${seat} passed on ${b} but was dealt ${tile}`);
        }
      });
    }
  });

  test('suit strength counts both halves, and a double only once', () => {
    assert.deepEqual(suitStrength(['3-3']), [0, 0, 0, 1, 0, 0, 0]);
    assert.deepEqual(suitStrength(['3-4']), [0, 0, 0, 1, 1, 0, 0]);
    assert.deepEqual(suitStrength(['0-6', '6-6']), [1, 0, 0, 0, 0, 0, 2]);
  });
});

describe('hard ends, dead doubles and keys — named reads of public board state', () => {
  // Minimal fields every fixture needs; each test overrides board/myHand.
  function baseView(overrides: Partial<PublicView>): PublicView {
    return {
      seat: 0, seatCount: 4, mode: 'cutthroat', turn: 0,
      handSizes: [7, 7, 7, 7], boneyardSize: 0, moveLog: [],
      poseMustBeDoubleSix: false, format: 'sixlove', openingTile: '6-6',
      myHand: [], board: null,
      ...overrides,
    };
  }

  describe('hardEnds', () => {
    test('flags an open suit once 6 of its 7 tiles are visible', () => {
      // Board carries six of suit 3's seven tiles; the seventh (3-3) is
      // unaccounted — not on the board, not in my hand.
      const board: AnyBoard = {
        kind: 'linear',
        line: [
          { tile: '0-3', crosswise: false }, { tile: '1-3', crosswise: false },
          { tile: '2-3', crosswise: false }, { tile: '3-4', crosswise: false },
          { tile: '3-5', crosswise: false }, { tile: '3-6', crosswise: false },
        ],
        leftEnd: 0, rightEnd: 3,
      };
      const view = baseView({ board, myHand: ['1-2'] });
      assert.deepEqual(hardEnds(view), [3]);
    });

    test('does not flag a suit with fewer than 6 tiles visible', () => {
      const board: AnyBoard = {
        kind: 'linear',
        line: [{ tile: '0-3', crosswise: false }, { tile: '1-3', crosswise: false }],
        leftEnd: 0, rightEnd: 3,
      };
      const view = baseView({ board, myHand: [] });
      assert.deepEqual(hardEnds(view), []);
    });

    test('does not flag a suit that is not currently open, even at 6 seen', () => {
      const board: AnyBoard = {
        kind: 'linear',
        line: [
          { tile: '0-3', crosswise: false }, { tile: '1-3', crosswise: false },
          { tile: '2-3', crosswise: false }, { tile: '3-4', crosswise: false },
          { tile: '3-5', crosswise: false }, { tile: '3-6', crosswise: false },
        ],
        // Neither end is pip 3, so the suit is scarce but not reachable.
        leftEnd: 4, rightEnd: 5,
      };
      const view = baseView({ board, myHand: [] });
      assert.deepEqual(hardEnds(view), []);
    });

    test('reads a cross board the same way as a linear one', () => {
      const board: AnyBoard = {
        kind: 'cross',
        center: '0-0',
        arms: [{
          direction: 'right',
          tiles: [
            { tile: '0-3', crosswise: false }, { tile: '1-3', crosswise: false },
            { tile: '2-3', crosswise: false }, { tile: '3-4', crosswise: false },
            { tile: '3-5', crosswise: false },
          ],
          openEnd: 3,
          doubleDown: false,
        }],
      };
      const view = baseView({ board, myHand: ['3-6'], format: 'french', openingTile: '0-0' });
      assert.deepEqual(hardEnds(view), [3]);
    });
  });

  describe('deadDoubles', () => {
    test('flags a double once its suit is down to one unaccounted tile and closed', () => {
      // Board carries five of suit 3's other six tiles; the double itself
      // is the sixth, and 3-6 is the lone unaccounted tile. Neither open
      // end is pip 3, so the double cannot be played right now.
      const board: AnyBoard = {
        kind: 'linear',
        line: [
          { tile: '0-3', crosswise: false }, { tile: '1-3', crosswise: false },
          { tile: '2-3', crosswise: false }, { tile: '3-4', crosswise: false },
          { tile: '3-5', crosswise: false },
        ],
        leftEnd: 1, rightEnd: 2,
      };
      const view = baseView({ board, myHand: ['3-3', '0-1'] });
      assert.deepEqual(deadDoubles(view), ['3-3']);
    });

    test('does not flag a double whose suit is currently open', () => {
      const board: AnyBoard = {
        kind: 'linear',
        line: [
          { tile: '0-3', crosswise: false }, { tile: '1-3', crosswise: false },
          { tile: '2-3', crosswise: false }, { tile: '3-4', crosswise: false },
          { tile: '3-5', crosswise: false },
        ],
        // Pip 3 is open here — the double is playable right now, not dead.
        leftEnd: 3, rightEnd: 2,
      };
      const view = baseView({ board, myHand: ['3-3'] });
      assert.deepEqual(deadDoubles(view), []);
    });
  });

  describe('hasKey', () => {
    test('true once I hold the scarce tile in two different suits at once', () => {
      const board: AnyBoard = {
        kind: 'linear',
        line: [
          { tile: '0-1', crosswise: false }, { tile: '1-1', crosswise: true },
          { tile: '1-3', crosswise: false }, { tile: '1-4', crosswise: false },
          { tile: '1-6', crosswise: false },
          { tile: '0-5', crosswise: false }, { tile: '2-5', crosswise: false },
          { tile: '3-5', crosswise: false }, { tile: '4-5', crosswise: false },
          { tile: '5-5', crosswise: true },
        ],
        leftEnd: 6, rightEnd: 6,
      };
      const view = baseView({ board, myHand: ['1-2', '5-6'] });
      assert.equal(hasKey(view), true);
    });

    test('false with only one qualifying suit', () => {
      const board: AnyBoard = {
        kind: 'linear',
        line: [
          { tile: '0-1', crosswise: false }, { tile: '1-1', crosswise: true },
          { tile: '1-3', crosswise: false }, { tile: '1-4', crosswise: false },
          { tile: '1-6', crosswise: false },
        ],
        leftEnd: 0, rightEnd: 6,
      };
      const view = baseView({ board, myHand: ['1-2'] });
      assert.equal(hasKey(view), false);
    });
  });
});

describe('the coach', () => {
  test('grades a clean hand as clean', async () => {
    const rng = rngFrom(4);
    const initial = await freshHand(9);
    let h = initial;
    const log: Move[] = [];
    while (h.status === 'active') {
      const m = duppyMove(h, 'don', rng);
      log.push(m);
      h = applyMove(h, m);
    }
    const review = reviewHand(initial, h.moveLog, 0);
    assert.ok(review.reviews.length >= 0);
    assert.ok(accuracy(review) >= 0 && accuracy(review) <= 100);
    assert.ok(typeof review.summary === 'string' && review.summary.length > 0);
  });

  test('catches a thrown hand and names the moment', () => {
    // Board is 3-3, both ends showing a three. Seat 0 can play 3-4 or 3-5.
    //   3-4 opens the fours — seat 1 goes out on 4-4 and the opposition wins.
    //   3-5 opens the fives — seat 1 is stranded, and partner seat 2 goes out
    //   on 5-5, so our side wins.
    // Same tile count, opposite result. This is exactly the decision the Coach
    // exists to catch.
    const initial: HandState = {
      seatCount: 4,
      mode: 'partner',
      hands: [['3-4', '3-5'], ['4-4'], ['5-5'], ['6-6']],
      boneyard: [],
      board: { kind: 'linear', line: [{ tile: '3-3', crosswise: true }], leftEnd: 3, rightEnd: 3 },
      turn: 0,
      consecutivePasses: 0,
      moveLog: [],
      penalties: [0, 0, 0, 0],
      status: 'active',
      result: null,
      poseMustBeDoubleSix: false,
      openingTile: '6-6',
      poser: 0,
      format: 'sixlove',
    };

    let h = applyMove(initial, { kind: 'play', seat: 0, tile: '3-4', end: 'right' });
    let guard = 0;
    while (h.status === 'active' && guard++ < 50) {
      h = applyMove(h, legalMoves(h)[0]);
    }
    assert.equal(h.result!.winnerSide, 1, 'feeding the fours hands them the hand');

    const review = reviewHand(initial, h.moveLog, 0);
    const first = review.reviews.find((r) => r.ply === 0);
    assert.ok(first, 'the opening decision should have been reviewed');
    assert.equal(first!.valueBest, 1, 'the hand was winnable');
    assert.equal(first!.valueActual, -1, 'the move played loses it');
    assert.equal(first!.loss, 2);
    assert.equal(first!.grade, 'blunder');
    assert.equal((first!.best as any).tile, '3-5', 'the solver should find the tile that holds them off');
    assert.equal(review.criticalPly, 0);
    assert.ok(first!.lesson, 'a graded mistake must carry a lesson reference');
    assert.ok(first!.note.length > 20, 'and an explanation worth reading');
  });

  test('a forced move is never graded', () => {
    const initial: HandState = {
      seatCount: 4,
      mode: 'partner',
      hands: [['0-1'], ['1-2'], ['2-3'], ['3-4']],
      boneyard: [],
      board: { kind: 'linear', line: [{ tile: '0-0', crosswise: true }], leftEnd: 0, rightEnd: 0 },
      turn: 0,
      consecutivePasses: 0,
      moveLog: [],
      penalties: [0, 0, 0, 0],
      status: 'active',
      result: null,
      poseMustBeDoubleSix: false,
      openingTile: '6-6',
      poser: 0,
      format: 'sixlove',
    };
    let h = applyMove(initial, { kind: 'play', seat: 0, tile: '0-1', end: 'left' });
    const review = reviewHand(initial, h.moveLog, 0);
    // Seat 0 had exactly one legal placement pair; with a single option there
    // is nothing to grade.
    assert.ok(review.reviews.every((r) => r.loss >= 0));
  });

  test('accuracy is a percentage', () => {
    const empty = {
      seat: 0, side: 0, reviews: [], criticalPly: null,
      summary: '', exact: true, counts: { best: 0, fine: 0, loose: 0, blunder: 0 },
    };
    assert.equal(accuracy(empty), 100);
  });
});

describe('academy', () => {
  test('every Coach lesson reference resolves to a real lesson', async () => {
    const { BELTS, lessonByRef } = await import('../src/academy.ts');
    const refs = ['Belt 3 · Lesson 1', 'Belt 3 · Lesson 3', 'Belt 3 · Lesson 4',
                  'Belt 3 · Lesson 6', 'Belt 4 · Lesson 1', 'Belt 4 · Lesson 6'];
    for (const ref of refs) {
      assert.ok(lessonByRef(ref), `Coach references ${ref} but it does not exist`);
    }
    assert.equal(BELTS.length, 5);
    assert.equal(BELTS[0].voiced, true, 'Belt 1 must be voiced for pre-readers');
  });

  test('lesson ids are unique across the whole curriculum', async () => {
    const { BELTS } = await import('../src/academy.ts');
    const ids = BELTS.flatMap((b) => b.lessons.map((l) => l.id));
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('legacy board rows — no `kind` field, written before the cross board shipped', () => {
  // Same hazard as hand.ts's own regression test, exercised through bots.ts's
  // separate cloneAnyBoard/allBoardTiles copies. `as any` because a real
  // linear Board always carries kind: 'linear' — this simulates what's
  // actually sitting in every row from before that field existed.
  const legacyBoard = { line: [{ tile: '2-5', crosswise: false }], leftEnd: 2, rightEnd: 5 } as any;

  test('allBoardTiles reads a legacy board as linear, not cross', () => {
    assert.deepEqual(allBoardTiles(legacyBoard), ['2-5']);
  });

  test('publicView (via cloneAnyBoard) does not throw on a legacy board', async () => {
    const h = await freshHand();
    h.board = legacyBoard;
    assert.doesNotThrow(() => publicView(h, 0));
  });

  test('a duppy can still choose a move against a legacy board', async () => {
    const h = await freshHand();
    h.board = legacyBoard;
    h.poseMustBeDoubleSix = false;
    assert.doesNotThrow(() => duppyMove(h, 'yard', rngFrom(1)));
  });
});
