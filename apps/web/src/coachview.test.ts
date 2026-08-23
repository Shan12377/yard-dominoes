import test from 'node:test';
import assert from 'node:assert/strict';
import { outcomeReason } from './coachview.ts';
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
    'Your choice leaves a forced loss against best play. The stronger choice keeps a winning route.',
  );
});

test('the coach does not claim certainty when its search was not exact', () => {
  assert.equal(outcomeReason(reviewed({ exact: false })), null);
});
