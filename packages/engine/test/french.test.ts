import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyHandResult, createSet, deal, isDouble,
} from '../src/index.ts';
import type { HandResult, SetState } from '../src/index.ts';

/*
 * French — race to 100, lower is better. Losers add their remaining pip count
 * to their running total; if they hold any double, that hand's score doubles.
 * First seat to hit 100 triggers set end; winner is the seat with the lowest
 * score at that moment. See docs/superpowers/plans/2026-07-30-french-debrief.md
 * for the load-bearing rules and what is deferred (cross board, coin-tied
 * shuffle, true mid-set elimination).
 */

function scoringResult(counts: number[], doubles: boolean[], dominoSeat: number | null): HandResult {
  return {
    status: dominoSeat === null ? 'blocked' : 'domino',
    winnerSeat: dominoSeat,
    winnerSide: dominoSeat,
    tie: false,
    counts,
    doublesRemaining: doubles,
  };
}

describe('French scoring', () => {
  it('the winner of a domino adds nothing (their hand is empty)', () => {
    const s = createSet({ format: 'french', mode: 'cutthroat', seatCount: 4 });
    const next = applyHandResult(s, scoringResult([0, 12, 8, 15], [false, false, false, false], 0));
    assert.deepEqual(next.scores, [0, 12, 8, 15]);
  });

  it('a seat holding any double has that hand\'s pips doubled', () => {
    const s = createSet({ format: 'french', mode: 'cutthroat', seatCount: 4 });
    // Seat 1 has 12 pips and a double left; scores 24 this hand.
    const next = applyHandResult(s, scoringResult([0, 12, 8, 15], [false, true, false, false], 0));
    assert.deepEqual(next.scores, [0, 24, 8, 15]);
  });

  it('first seat to hit target loses; winner is the seat with the lowest score', () => {
    const s: SetState = { ...createSet({ format: 'french', mode: 'cutthroat', seatCount: 4 }), scores: [92, 40, 55, 88] };
    // Seat 0 crosses 100. Seat 1 has 40 — lowest — and wins the SET.
    const next = applyHandResult(s, scoringResult([9, 3, 4, 7], [false, false, false, false], 1));
    assert.equal(next.scores[0], 101);
    assert.equal(next.winnerSide, 1);
  });

  it('two seats crossing 100 in the same hand: still the lowest score wins', () => {
    const s: SetState = { ...createSet({ format: 'french', mode: 'cutthroat', seatCount: 4 }), scores: [95, 30, 97, 40] };
    const next = applyHandResult(s, scoringResult([8, 4, 6, 2], [false, false, false, false], 3));
    assert.ok(next.scores[0] >= 100 && next.scores[2] >= 100);
    assert.equal(next.winnerSide, 1); // 34 vs seat 3's 42
  });

  it('a blocked hand with no domino: everyone adds their pips, still no replay in French', () => {
    const s: SetState = { ...createSet({ format: 'french', mode: 'cutthroat', seatCount: 4 }), scores: [10, 10, 10, 10] };
    const next = applyHandResult(s, scoringResult([3, 8, 5, 2], [false, false, false, false], null));
    assert.deepEqual(next.scores, [13, 18, 15, 12]);
    assert.equal(next.handValue, 1); // no "replay at higher value"
    assert.equal(next.winnerSide, null);
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
