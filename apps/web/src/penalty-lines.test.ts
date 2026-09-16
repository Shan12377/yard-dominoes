import { test } from 'node:test';
import assert from 'node:assert/strict';
import { penaltyLines } from './render.ts';

const name = (seat: number) => ['You', 'Duppy 2', 'Duppy 3', 'Duppy 4'][seat];

// Owner, 2026-09-16: a player fined for a board pass should see who shut the
// board, with which bone, and the number nobody had.
test('a board pass names who played what and the numbers nobody had', () => {
  assert.deepEqual(penaltyLines([
    { seat: 0, amount: 10, reason: 'board-pass', by: 1, tile: '3-5', ends: [3] },
    { seat: 2, amount: 10, reason: 'board-pass', by: 1, tile: '3-5', ends: [3] },
    { seat: 3, amount: 10, reason: 'board-pass', by: 1, tile: '3-5', ends: [3] },
  ], name), ['Board pass: Duppy 2 played 3/5, nobody had a 3 — You, Duppy 3 and Duppy 4 +10 each']);
});

test('blanks read as blanks, and other penalties keep their own lines', () => {
  assert.deepEqual(penaltyLines([
    { seat: 1, amount: 10, reason: 'triple-pass' },
    { seat: 2, amount: 10, reason: 'board-pass', by: 0, tile: '6-0', ends: [0, 5] },
  ], name), [
    'Duppy 2 passed three times running — +10',
    'Board pass: You played 6/0, nobody had a blank or a 5 — Duppy 3 +10',
  ]);
});

test('an older record without the details keeps the old wording', () => {
  assert.deepEqual(penaltyLines([{ seat: 3, amount: 10, reason: 'board-pass' }], name),
    ['Duppy 4 had no answer to the board — +10']);
});
