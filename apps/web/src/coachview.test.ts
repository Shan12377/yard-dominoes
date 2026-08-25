import test from 'node:test';
import assert from 'node:assert/strict';
import { outcomeReason, practicalReason } from './coachview.ts';
import type { MoveReview } from '@yard/engine';

function reviewed(values: Partial<MoveReview>): MoveReview {
  return {
    ply: 0,
    seat: 0,
    move: { kind: 'play', seat: 0, tile: '3-5', end: 'left' },
    best: { kind: 'play', seat: 0, tile: '3-6', end: 'left' },
    valueActual: -1,
    valueBest: 1,
    loss: 2,
    grade: 'blunder',
    note: '',
    lesson: null,
    exact: true,
    position: { board: null, hand: ['3-5', '3-6'], legal: [], ends: [3, 3] },
    ...values,
  };
}

test('the coach names a forced loss and the winning alternative plainly', () => {
  assert.equal(
    outcomeReason(reviewed({})),
    'On this completed deal, your choice leaves a forced loss against best play. The stronger choice keeps a winning route.',
  );
});

test('the coach does not claim certainty when its search was not exact', () => {
  assert.equal(outcomeReason(reviewed({ exact: false })), null);
});

test('the coach explains the actual board and hand difference behind a stronger tile', () => {
  const explanation = practicalReason(reviewed({
    move: { kind: 'play', seat: 0, tile: '1-6', end: 'right' },
    best: { kind: 'play', seat: 0, tile: '2-6', end: 'right' },
    position: {
      board: null, hand: ['1-6', '2-6'], legal: [], ends: [6, 4],
      after: {
        actual: { ends: [1, 4], hand: ['2-6'] },
        best: { ends: [2, 4], hand: ['1-6'] },
      },
    },
  }));
  assert.match(explanation ?? '', /1–6 leaves one and four open/);
  assert.match(explanation ?? '', /2–6 leaves two and four open/);
  assert.match(explanation ?? '', /keeps 2–6 in your hand instead of 1–6/);
});

test('the coach does not invent a contrast when the same move was best', () => {
  assert.equal(practicalReason(reviewed({
    best: { kind: 'play', seat: 0, tile: '3-5', end: 'left' },
    position: {
      board: null, hand: ['3-5'], legal: [], ends: [3, 5],
      after: {
        actual: { ends: [3, 5], hand: [] },
        best: { ends: [3, 5], hand: [] },
      },
    },
  })), null);
});
