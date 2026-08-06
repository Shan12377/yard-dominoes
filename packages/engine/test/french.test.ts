import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyHandResult, applyMove, createSet, deal, isDouble, legalMoves,
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

describe('French: the set ends the instant anyone crosses target', () => {
  it('one seat crossing target ends the set immediately — lowest score at that moment wins, even under target', () => {
    const s = frenchSet([92, 40, 55, 88]);
    // Seat 1 is this hand's domino winner, so their own count is 0.
    const next = applyHandResult(s, scoringResult({ status: 'domino', winnerSeat: 1, counts: [9, 0, 4, 7] }));
    assert.equal(next.scores[0], 101, 'seat 0 crossed target');
    assert.equal(next.winnerSide, 1, 'seat 1 (score 40) is lowest across the table — the set ends right here, not just for seat 0');
  });

  it('two seats crossing target in the same hand: still just the lowest score across everyone', () => {
    const s = frenchSet([95, 20, 97, 40]);
    // Seat 1 is this hand's domino winner, so their own count is 0.
    const next = applyHandResult(s, scoringResult({ status: 'domino', winnerSeat: 1, counts: [8, 0, 6, 5] }));
    assert.ok(next.scores[0] >= 100 && next.scores[2] >= 100, 'seats 0 and 2 both crossed');
    assert.equal(next.winnerSide, 1, 'seat 1 (score 20) is the lowest score at the table');
  });

  it('every seat crossing target in the same hand: lowest score still wins outright', () => {
    const s = frenchSet([110, 94, 105, 92]);
    const next = applyHandResult(s, scoringResult({ status: 'blocked', winnerSeat: 3, counts: [9, 8, 4, 9] }));
    assert.ok(next.scores.every((v) => v >= 100));
    assert.equal(next.winnerSide, 3, 'seat 3 (92+9=101) edges seat 1 (94+8=102)');
  });

  it('nobody at or over target: the set is not decided yet', () => {
    const s = frenchSet([50, 30, 55, 40]);
    const next = applyHandResult(s, scoringResult({ status: 'domino', winnerSeat: 1, counts: [9, 0, 4, 7] }));
    assert.ok(next.scores.every((v) => v < 100));
    assert.equal(next.winnerSide, null);
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

describe('French: round 2+ must pose a double', () => {
  it('the nominal poser (previous winner) leads it when they hold one — free choice among their own doubles', () => {
    const order = [
      '1-2', '1-3', '1-4', '1-5', '1-6', '5-5', '3-3', // seat 0 — nominal poser, holds two doubles
      '0-0', '0-1', '0-2', '0-3', '0-4', '0-5', '0-6', // seat 1
      '2-2', '2-3', '2-4', '2-5', '2-6', '4-4', '4-5', // seat 2
      '4-6', '6-6', '1-1', '3-4', '3-5', '3-6', '5-6', // seat 3
    ];
    const hand = deal({
      order, seatCount: 4, mode: 'cutthroat', useBoneyard: false,
      poser: 0, poseMustBeDoubleSix: false, poseMustBeAnyDouble: true,
      openingTile: '0-0', format: 'french',
    });
    assert.equal(hand.poser, 0, 'the nominal poser holds a double, so they pose');
    assert.equal(hand.turn, 0);
    assert.deepEqual(hand.penalties, [0, 0, 0, 0], 'no penalty when they could pose');

    const moves = legalMoves(hand);
    assert.deepEqual(
      moves.map((m) => (m as any).tile).sort(),
      ['3-3', '5-5'],
      'both of the poser\'s own doubles are legal — their free choice',
    );
  });

  it('a nominal poser holding no double is fined 10, and the pose passes to the first seat (in order) that has one', () => {
    const order = [
      '0-1', '0-2', '0-3', '0-4', '0-5', '0-6', '1-2', // seat 0 — nominal poser, NO doubles
      '1-1', '1-3', '1-4', '1-5', '1-6', '2-3', '2-4', // seat 1 — holds 1-1
      '0-0', '2-2', '2-5', '2-6', '3-3', '3-4', '3-5', // seat 2
      '3-6', '4-4', '4-5', '4-6', '5-5', '5-6', '6-6', // seat 3
    ];
    const hand = deal({
      order, seatCount: 4, mode: 'cutthroat', useBoneyard: false,
      poser: 0, poseMustBeDoubleSix: false, poseMustBeAnyDouble: true,
      openingTile: '0-0', format: 'french',
    });
    assert.equal(hand.poser, 1, 'seat 0 held nothing double — seat 1 is next in order and has one');
    assert.equal(hand.turn, 1);
    assert.deepEqual(hand.penalties, [10, 0, 0, 0], 'seat 0 is fined for not holding a double on their turn to pose');
    assert.deepEqual(hand.lastPenalties, [{ seat: 0, amount: 10, reason: 'no-double-to-pose' }]);

    const moves = legalMoves(hand);
    assert.deepEqual(moves.map((m) => (m as any).tile), ['1-1'], 'seat 1\'s only double is their only legal pose');
  });
});

// pagat.com/domino/cross/french.html: "the winner of the previous round poses
// a double of their choice"; the fill mechanic it then describes ("four bones
// ... played against the four sides of the posed double ... creates a
// cross-shaped layout with four arms") is stated generally, matching the
// standard cross-domino convention that whichever double opens a hand is
// that hand's own spinner — not only the chucha. A round-2+ pose of, say,
// 3-3 must build a fresh 4-arm cross centred on 3-3, exactly like the chucha
// does in round 1, not fall through to an ordinary 2-ended line.
describe('French: cross board — a round 2+ posed double is a spinner too', () => {
  it('posing a non-chucha double builds a cross, not a line', () => {
    const order = [
      '1-2', '1-3', '1-4', '1-5', '1-6', '5-5', '3-3', // seat 0 — poser, holds two doubles
      '0-0', '0-1', '0-2', '0-3', '0-4', '0-5', '0-6', // seat 1
      '2-2', '2-3', '2-4', '2-5', '2-6', '4-4', '4-5', // seat 2
      '4-6', '6-6', '1-1', '3-4', '3-5', '3-6', '5-6', // seat 3
    ];
    const hand = deal({
      order, seatCount: 4, mode: 'cutthroat', useBoneyard: false,
      poser: 0, poseMustBeDoubleSix: false, poseMustBeAnyDouble: true,
      openingTile: '0-0', format: 'french',
    });
    const posed = applyMove(hand, { kind: 'pose', seat: 0, tile: '3-3' });
    assert.equal(posed.board!.kind, 'cross', 'a French pose is always a double, so it always builds a cross');
    assert.equal((posed.board as any).center, '3-3');
    assert.deepEqual((posed.board as any).arms, [], 'nothing fills the fresh cross yet');

    // Fill phase now needs tiles carrying a "3" half, not a blank half —
    // the spinner's own value, whatever double was actually posed.
    const fillMoves = legalMoves(posed).filter((m) => m.kind === 'playcross');
    assert.ok(fillMoves.length > 0, 'someone at the table can start filling the 3-3 cross');
    for (const m of fillMoves) {
      const [a, b] = (m as any).tile.split('-').map(Number);
      assert.ok(a === 3 || b === 3, `${(m as any).tile} does not carry a 3 to attach to the 3-3 centre`);
    }
  });
});

// Doubles-must-lead is a BOARD-WIDE gate, per how the hand is actually
// played: once a suit's double lands anywhere, every arm showing that
// number is live for the rest of the hand, until all seven of that number
// are gone. It is not scoped to the specific arm the double happened to
// land on. (pagat.com/domino/cross/french.html describes a different,
// per-arm variant of the cross board — that read was tried first, shipped,
// and then reverted once it produced a live false rejection this ruleset
// doesn't have.)
describe('French: cross board — doubles must lead, board-wide', () => {
  function crossHand(overrides: Partial<HandState>): HandState {
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

  it('a number with no double played yet stays locked, even where a DIFFERENT number is already free', () => {
    const state = crossHand({
      hands: [['2-1'], [], [], []],
      turn: 0,
      board: {
        kind: 'cross',
        center: '0-0',
        arms: [
          { direction: 'right', tiles: [], openEnd: 2 }, // 2-2 already played
          { direction: 'left', tiles: [], openEnd: 1 },  // 1-1 not played anywhere yet
          { direction: 'up', tiles: [], openEnd: 5 },
          { direction: 'down', tiles: [], openEnd: 6 },
        ],
        doublesPlayed: [2],
      },
    });
    const moves = legalMoves(state).filter((m) => m.kind === 'playcross');
    assert.deepEqual(
      moves.map((m) => (m as any).arm),
      [0],
      '2-1 is legal on arm 0 (its 2 half — 2-2 has been played) but not arm 1 (its 1 half — 1-1 hasn\'t)',
    );
  });

  it('a double played on one arm DOES unlock a different arm exposing the same pip', () => {
    // Both arm 0 and arm 2 expose "3" — arm 0 got there via 3-3 actually
    // landing on it; arm 2 got there some other way (e.g. a tile like 4-3
    // laid down after 4-4 unlocked arm 2's own earlier number) and never had
    // 3-3 played on IT specifically. Board-wide means that doesn't matter —
    // 3-3 has been played, so every arm showing a 3 is live.
    const state = crossHand({
      hands: [['0-3'], [], [], []],
      turn: 0,
      board: {
        kind: 'cross',
        center: '0-0',
        arms: [
          { direction: 'right', tiles: [], openEnd: 3 }, // 3-3 led here
          { direction: 'left', tiles: [], openEnd: 1 },
          { direction: 'up', tiles: [], openEnd: 3 },    // same pip, reached another way
          { direction: 'down', tiles: [], openEnd: 6 },
        ],
        doublesPlayed: [3],
      },
    });
    const moves = legalMoves(state).filter((m) => m.kind === 'playcross');
    assert.deepEqual(
      moves.map((m) => (m as any).arm).sort(),
      [0, 2],
      'the non-double 0-3 may extend either arm showing a 3, since 3-3 has been played on the board',
    );
  });

  it('the centre value counts as already played, so an arm cycling back to it never needs a second copy of an impossible double', () => {
    const state = crossHand({
      hands: [['3-1'], [], [], []],
      turn: 0,
      board: {
        kind: 'cross',
        center: '3-3',
        arms: [
          { direction: 'right', tiles: [], openEnd: 3 }, // cycled back to the centre's own value
          { direction: 'left', tiles: [], openEnd: 6 },
          { direction: 'up', tiles: [], openEnd: 2 },
          { direction: 'down', tiles: [], openEnd: 5 },
        ],
        doublesPlayed: [3],
      },
    });
    const moves = legalMoves(state).filter((m) => m.kind === 'playcross');
    assert.deepEqual(moves.map((m) => (m as any).arm), [0], '3-1 extends the arm showing 3 — the centre already counts as 3-3 played');
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
    // The client's "when someone gets a 10" live banner is built entirely
    // off this — it must name the seat, the amount, and why, not just move
    // the running total.
    assert.deepEqual(next.lastPenalties, [{ seat: 1, amount: 10, reason: 'triple-pass' }]);
  });

  it('penaltyLog accumulates across the whole hand instead of only keeping the most recent move\'s events', () => {
    const state = frenchHand({
      board: { kind: 'linear', line: [{ tile: '6-6', crosswise: true }], leftEnd: 6, rightEnd: 6 },
      hands: [['1-1'], ['0-1', '0-2', '0-3'], ['2-2'], ['3-3']],
      turn: 1,
      moveLog: [
        { kind: 'pass', seat: 1, ends: [6, 6] },
        { kind: 'pass', seat: 1, ends: [6, 6] },
      ],
      // An earlier move this same hand already fined seat 2 — penaltyLog
      // must still carry it after a later, unrelated fine.
      penaltyLog: [{ seat: 2, amount: 10, reason: 'board-pass' }],
    });
    const next = applyMove(state, { kind: 'pass', seat: 1 });
    assert.deepEqual(next.penaltyLog, [
      { seat: 2, amount: 10, reason: 'board-pass' },
      { seat: 1, amount: 10, reason: 'triple-pass' },
    ], 'appended, not overwritten — this is what lets the hand-result screen show every penalty, not just the last one');
  });

  it('lastPenalties is empty on a move that costs nothing, even for a seat already carrying an earlier fine', () => {
    const state = frenchHand({
      board: { kind: 'linear', line: [{ tile: '6-6', crosswise: true }], leftEnd: 6, rightEnd: 6 },
      hands: [['1-1'], ['0-1', '0-2', '0-3'], ['2-2'], ['3-3']],
      turn: 1,
      moveLog: [{ kind: 'pass', seat: 1, ends: [6, 6] }],
      penalties: [0, 10, 0, 0],
    });
    const next = applyMove(state, { kind: 'pass', seat: 1 });
    assert.equal(next.penalties[1], 10, 'the earlier fine is still on the running total');
    assert.deepEqual(next.lastPenalties, [], 'but this particular pass earned nothing new');
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
    // One event per fined seat, all reason 'board-pass' — this is what lets
    // the live banner name every seat that just got boarded, not merely the
    // first one.
    assert.deepEqual(next.lastPenalties, [
      { seat: 1, amount: 10, reason: 'board-pass' },
      { seat: 2, amount: 10, reason: 'board-pass' },
      { seat: 3, amount: 10, reason: 'board-pass' },
    ]);
  });

  it('HandResult.penaltyLog carries the whole hand\'s penalty history through to hand end, not just the winning move\'s', () => {
    const state = frenchHand({
      board: { kind: 'linear', line: [{ tile: '6-6', crosswise: true }], leftEnd: 6, rightEnd: 6 },
      // Seat 1 can answer the new left end (0) once seat 0 goes out, so this
      // winning move earns no NEW board-pass — the log at hand-end should be
      // exactly the one entry from earlier in the hand, carried through.
      hands: [['0-6'], ['0-1'], ['2-2'], ['3-3']],
      turn: 0,
      penaltyLog: [{ seat: 2, amount: 10, reason: 'board-pass' }],
    });
    const next = applyMove(state, { kind: 'play', seat: 0, tile: '0-6', end: 'left' });
    assert.equal(next.status, 'domino');
    assert.deepEqual(next.result!.penaltyLog, [{ seat: 2, amount: 10, reason: 'board-pass' }]);
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
