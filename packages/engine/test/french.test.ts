import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyHandResult, applyMove, createSet, deal, isDouble,
} from '../src/index.ts';
import type { HandResult, HandState, SetState } from '../src/index.ts';

/*
 * French — race to 100, lower is better. Losers add their remaining pip count
 * to their running total; if they hold any double, that hand's score doubles
 * — and doubles again (stacking to ×4) if the winner's own final tile was
 * itself a double. A blocked tie forces the chucha and replays flat for a
 * ±2 bonus rather than the sixlove-style escalating replay. Crossing 100
 * puts a seat OUT, not the set — play continues among survivors until one
 * remains. See docs/superpowers/plans/2026-07-30-french-debrief.md and
 * 2026-07-31-source-audit-and-followups.md §2 for the sourcing.
 */

function scoringResult(opts: {
  status: 'domino' | 'blocked';
  winnerSeat: number | null;
  counts: number[];
  doubles?: boolean[];
  tie?: boolean;
  winnerPlayedDouble?: boolean;
  penalties?: number[];
}): HandResult {
  const tie = opts.tie ?? false;
  return {
    status: opts.status,
    winnerSeat: tie ? null : opts.winnerSeat,
    winnerSide: tie ? null : opts.winnerSeat,
    tie,
    counts: opts.counts,
    doublesRemaining: opts.doubles ?? opts.counts.map(() => false),
    winnerPlayedDouble: opts.winnerPlayedDouble,
    penalties: opts.penalties,
  };
}

function frenchSet(scores: number[]): SetState {
  return { ...createSet({ format: 'french', mode: 'cutthroat', seatCount: 4 }), scores };
}

describe('French scoring', () => {
  it('the winner of a domino adds nothing (their hand is empty)', () => {
    const s = createSet({ format: 'french', mode: 'cutthroat', seatCount: 4 });
    const next = applyHandResult(s, scoringResult({ status: 'domino', winnerSeat: 0, counts: [0, 12, 8, 15] }));
    assert.deepEqual(next.scores, [0, 12, 8, 15]);
  });

  it('a seat holding any double has that hand\'s pips doubled', () => {
    const s = createSet({ format: 'french', mode: 'cutthroat', seatCount: 4 });
    const next = applyHandResult(s, scoringResult({
      status: 'domino', winnerSeat: 0, counts: [0, 12, 8, 15], doubles: [false, true, false, false],
    }));
    assert.deepEqual(next.scores, [0, 24, 8, 15]);
  });

  it('the winner ending on a double doubles every OTHER seat\'s score, whatever they held', () => {
    const s = createSet({ format: 'french', mode: 'cutthroat', seatCount: 4 });
    const next = applyHandResult(s, scoringResult({
      status: 'domino', winnerSeat: 0, counts: [0, 12, 8, 15], winnerPlayedDouble: true,
    }));
    assert.deepEqual(next.scores, [0, 24, 16, 30]);
  });

  it('the two doublings stack to ×4 when a seat holds its own double AND the winner ended on one', () => {
    const s = createSet({ format: 'french', mode: 'cutthroat', seatCount: 4 });
    const next = applyHandResult(s, scoringResult({
      status: 'domino', winnerSeat: 0, counts: [0, 12, 8, 15],
      doubles: [false, true, false, false], winnerPlayedDouble: true,
    }));
    assert.deepEqual(next.scores, [0, 48, 16, 30]);
  });

  it('penalties (board-pass, three-in-a-row) fold into the score alongside the pip total', () => {
    const s = createSet({ format: 'french', mode: 'cutthroat', seatCount: 4 });
    const next = applyHandResult(s, scoringResult({
      status: 'domino', winnerSeat: 0, counts: [0, 12, 8, 15], penalties: [0, 10, 0, 20],
    }));
    assert.deepEqual(next.scores, [0, 22, 8, 35]);
  });

  it('a blocked hand with a clear low-count winner: everyone (including the winner) adds their own pips', () => {
    const s = frenchSet([10, 10, 10, 10]);
    const next = applyHandResult(s, scoringResult({ status: 'blocked', winnerSeat: 3, counts: [3, 8, 5, 2] }));
    assert.deepEqual(next.scores, [13, 18, 15, 12]);
    assert.equal(next.handValue, 1);
  });

  it('the chucha is forced round 1 only — round 2 opens free, led by round 1\'s winner', () => {
    const s = createSet({ format: 'french', mode: 'cutthroat', seatCount: 4 });
    assert.equal(s.poseMustBeDoubleSix, true, 'round 1 starts forced onto the chucha');
    const next = applyHandResult(s, scoringResult({ status: 'domino', winnerSeat: 2, counts: [0, 12, 8, 15] }));
    assert.equal(next.poseMustBeDoubleSix, false, 'round 2 is not forced onto the chucha');
    assert.equal(next.poser, 2, 'round 1\'s winner poses round 2, free to lead any tile');
  });

  it('sixlove behavior is not disturbed: partner set still bruks under the sixlove rule', () => {
    const s: SetState = { ...createSet({ format: 'sixlove', mode: 'partner', seatCount: 4 }), scores: [4, 0] };
    const next = applyHandResult(s, {
      status: 'domino', winnerSeat: 1, winnerSide: 1, tie: false, counts: [0, 0, 5, 0],
    });
    // Side 1 (on 0) beat the leader — a bruk, resets to 0-0.
    assert.deepEqual(next.scores, [0, 0]);
  });
});

describe('French: true elimination', () => {
  it('one seat crossing target does not end the set — three seats remain and keep playing', () => {
    const s = frenchSet([92, 40, 55, 88]);
    const next = applyHandResult(s, scoringResult({ status: 'domino', winnerSeat: 1, counts: [9, 3, 4, 7] }));
    assert.equal(next.scores[0], 101);
    assert.equal(next.winnerSide, null, 'seats 1, 2, and 3 are all still under target');
  });

  it('two of four crossing target in the same hand: the set still continues with the two survivors', () => {
    const s = frenchSet([95, 30, 97, 40]);
    const next = applyHandResult(s, scoringResult({ status: 'domino', winnerSeat: 3, counts: [8, 4, 6, 2] }));
    assert.ok(next.scores[0] >= 100 && next.scores[2] >= 100);
    assert.equal(next.winnerSide, null, 'seats 1 and 3 are both still under target');
  });

  it('the set ends the instant only one seat remains under target — that seat wins outright', () => {
    // Seats 0 and 2 already out from an earlier hand; 1 and 3 are the only
    // two still racing.
    const s = frenchSet([110, 40, 105, 92]);
    const next = applyHandResult(s, scoringResult({ status: 'domino', winnerSeat: 1, counts: [9, 3, 4, 9] }));
    assert.equal(next.scores[3], 101, 'seat 3 just crossed too');
    assert.equal(next.winnerSide, 1, 'seat 1 is the only one left under target');
  });

  it('every remaining seat crossing target in the same hand: lowest score wins even though nobody is under target', () => {
    const s = frenchSet([110, 94, 105, 92]);
    const next = applyHandResult(s, scoringResult({ status: 'blocked', winnerSeat: 3, counts: [9, 8, 4, 9] }));
    assert.ok(next.scores.every((v) => v >= 100));
    assert.equal(next.winnerSide, 3, 'seat 3 (92+9=101) edges seat 1 (94+8=102)');
  });
});

describe('French: blocked-hand tie reshuffle', () => {
  it('a tied blocked hand voids its own scoring and forces the chucha, instead of the sixlove escalating replay', () => {
    const s = frenchSet([10, 10, 10, 10]);
    const next = applyHandResult(s, scoringResult({
      status: 'blocked', winnerSeat: null, counts: [5, 5, 8, 9], tie: true,
    }));
    assert.deepEqual(next.scores, [10, 10, 10, 10], 'no pips added for a tied hand');
    assert.equal(next.poseMustBeDoubleSix, true, 'chucha forced for the reshuffle');
    assert.equal(next.handValue, 1, 'flat value — this is not the sixlove escalating replay');
  });

  it('winning the reshuffle scores a flat +2, not the normal pip total', () => {
    let s = frenchSet([10, 10, 10, 10]);
    s = applyHandResult(s, scoringResult({ status: 'blocked', winnerSeat: null, counts: [5, 5, 8, 9], tie: true }));
    const next = applyHandResult(s, scoringResult({ status: 'domino', winnerSeat: 0, counts: [0, 6, 4, 3] }));
    assert.deepEqual(next.scores, [12, 10, 10, 10], 'seat 0 gets +2 flat, nobody else scores this hand');
    assert.equal(next.poser, 0);
    assert.equal(next.poseMustBeDoubleSix, false, 'the reshuffle is over; back to a free pose');
  });

  it('a tie during the reshuffle itself just repeats it, never escalating in value', () => {
    let s = frenchSet([10, 10, 10, 10]);
    s = applyHandResult(s, scoringResult({ status: 'blocked', winnerSeat: null, counts: [5, 5, 8, 9], tie: true }));
    const next = applyHandResult(s, scoringResult({
      status: 'blocked', winnerSeat: null, counts: [2, 2, 8, 9], tie: true,
    }));
    assert.deepEqual(next.scores, [10, 10, 10, 10]);
    assert.equal(next.poseMustBeDoubleSix, true);
    assert.equal(next.handValue, 1);
  });

  it('penalties still land during a reshuffle hand even though pip scoring is suspended', () => {
    let s = frenchSet([10, 10, 10, 10]);
    s = applyHandResult(s, scoringResult({ status: 'blocked', winnerSeat: null, counts: [5, 5, 8, 9], tie: true }));
    const next = applyHandResult(s, scoringResult({
      status: 'domino', winnerSeat: 0, counts: [0, 6, 4, 3], penalties: [0, 10, 0, 0],
    }));
    assert.deepEqual(next.scores, [12, 20, 10, 10]);
  });
});

describe('French: chucha opens round 1', () => {
  it('the double-blank holder is picked as opener when openingTile is "0-0"', () => {
    // Build a deal order that puts 0-0 in seat 2's hand and 6-6 in seat 0's.
    // dealPlan(4, false) → 7 tiles each in seat order.
    const order = [
      '6-6', '6-5', '6-4', '6-3', '6-2', '6-1', '6-0', // seat 0
      '5-5', '5-4', '5-3', '5-2', '5-1', '5-0', '4-4', // seat 1
      '0-0', '4-3', '4-2', '4-1', '4-0', '3-3', '3-2', // seat 2 — has chucha
      '3-1', '3-0', '2-2', '2-1', '2-0', '1-1', '1-0', // seat 3
    ];
    const hand = deal({
      order, seatCount: 4, mode: 'cutthroat', useBoneyard: false,
      poseMustBeDoubleSix: true, openingTile: '0-0',
    });
    assert.equal(hand.poser, 2, 'chucha holder should open round 1');
    assert.equal(hand.turn, 2);
    // And they must actually LEAD the chucha, not any other tile.
    assert.equal(hand.openingTile, '0-0');
  });

  it('sixlove hand is unchanged: the double-six holder opens', () => {
    const order = [
      '5-5', '5-4', '5-3', '5-2', '5-1', '5-0', '4-4',
      '6-6', '6-5', '6-4', '6-3', '6-2', '6-1', '6-0', // seat 1 has double-six
      '0-0', '4-3', '4-2', '4-1', '4-0', '3-3', '3-2',
      '3-1', '3-0', '2-2', '2-1', '2-0', '1-1', '1-0',
    ];
    const hand = deal({
      order, seatCount: 4, mode: 'cutthroat', useBoneyard: false,
      poseMustBeDoubleSix: true,
    });
    assert.equal(hand.poser, 1);
    assert.equal(hand.openingTile, '6-6');
  });
});

// A trivial guard against a bug shape: isDouble('0-0') must be true. If someone
// accidentally special-cases blanks somewhere, the chucha stops opening the arm.
describe('French: chucha is still a double', () => {
  it('isDouble("0-0") === true', () => {
    assert.equal(isDouble('0-0'), true);
  });
});

describe('French: pass penalties', () => {
  function frenchHand(overrides: Partial<HandState>): HandState {
    return {
      seatCount: 4,
      mode: 'cutthroat',
      hands: [[], [], [], []],
      boneyard: [],
      board: null,
      format: 'french',
      turn: 0,
      consecutivePasses: 0,
      moveLog: [],
      penalties: [0, 0, 0, 0],
      status: 'active',
      result: null,
      poseMustBeDoubleSix: false,
      openingTile: '0-0',
      poser: 0,
      ...overrides,
    };
  }

  it('a seat\'s own third real pass in a row costs 10 points', () => {
    const state = frenchHand({
      board: { kind: 'linear', line: [{ tile: '6-6', crosswise: true }], leftEnd: 6, rightEnd: 6 },
      hands: [['1-1'], ['0-1', '0-2', '0-3'], ['2-2'], ['3-3']],
      turn: 1,
      moveLog: [
        { kind: 'pass', seat: 1, ends: [6, 6] },
        { kind: 'pass', seat: 1, ends: [6, 6] },
      ],
    });
    const next = applyMove(state, { kind: 'pass', seat: 1 });
    assert.equal(next.penalties[1], 10);
  });

  it('two consecutive passes are not yet a penalty', () => {
    const state = frenchHand({
      board: { kind: 'linear', line: [{ tile: '6-6', crosswise: true }], leftEnd: 6, rightEnd: 6 },
      hands: [['1-1'], ['0-1', '0-2', '0-3'], ['2-2'], ['3-3']],
      turn: 1,
      moveLog: [{ kind: 'pass', seat: 1, ends: [6, 6] }],
    });
    const next = applyMove(state, { kind: 'pass', seat: 1 });
    assert.equal(next.penalties[1], 0);
  });

  it('a play that leaves every other seat with nothing to answer costs each of them 10 points', () => {
    const state = frenchHand({
      board: { kind: 'linear', line: [{ tile: '5-6', crosswise: false }], leftEnd: 5, rightEnd: 6 },
      hands: [['6-0', '1-1'], ['1-2', '1-3'], ['2-3', '2-4'], ['3-4', '4-4']],
      turn: 0,
    });
    const next = applyMove(state, { kind: 'play', seat: 0, tile: '6-0', end: 'right' });
    assert.deepEqual(next.penalties, [0, 10, 10, 10]);
  });

  it('a play that leaves even one other seat with an answer costs nobody', () => {
    const state = frenchHand({
      board: { kind: 'linear', line: [{ tile: '5-6', crosswise: false }], leftEnd: 5, rightEnd: 6 },
      // Seat 2 holds a 0, which will still match the new right end.
      hands: [['6-0', '1-1'], ['1-2', '1-3'], ['0-4', '2-4'], ['3-4', '4-4']],
      turn: 0,
    });
    const next = applyMove(state, { kind: 'play', seat: 0, tile: '6-0', end: 'right' });
    assert.deepEqual(next.penalties, [0, 0, 0, 0]);
  });

  it('non-French formats never accrue penalties', () => {
    const state: HandState = {
      seatCount: 4,
      mode: 'cutthroat',
      hands: [['1-1'], ['0-1', '0-2', '0-3'], ['2-2'], ['3-3']],
      boneyard: [],
      board: { kind: 'linear', line: [{ tile: '6-6', crosswise: true }], leftEnd: 6, rightEnd: 6 },
      format: 'firstToSix',
      turn: 1,
      consecutivePasses: 0,
      moveLog: [
        { kind: 'pass', seat: 1, ends: [6, 6] },
        { kind: 'pass', seat: 1, ends: [6, 6] },
      ],
      penalties: [0, 0, 0, 0],
      status: 'active',
      result: null,
      poseMustBeDoubleSix: false,
      openingTile: '6-6',
      poser: 0,
    };
    const next = applyMove(state, { kind: 'pass', seat: 1 });
    assert.equal(next.penalties[1], 0);
  });
});
