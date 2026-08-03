import test from 'node:test';
import assert from 'node:assert/strict';
import { predictMyMove } from './predict.ts';
import type { PredictInput } from './predict.ts';

function baseInput(overrides: Partial<PredictInput> = {}): PredictInput {
  return {
    seatCount: 4,
    mode: 'cutthroat',
    format: 'sixlove',
    myTiles: ['6-6', '2-3', '0-0'],
    mySeat: 0,
    handSizes: [3, 7, 7, 7],
    boneyardSize: 0,
    board: null,
    moveLog: [],
    status: 'active',
    result: null,
    poseMustBeDoubleSix: false,
    poser: 0,
    ...overrides,
  };
}

test('posing the opening tile predicts a one-tile board and removes it from myTiles', () => {
  const result = predictMyMove(baseInput(), { kind: 'pose', seat: 0, tile: '6-6' });
  assert.ok(result);
  assert.equal(result!.board?.kind, 'linear');
  assert.equal((result!.board as any).line.length, 1);
  assert.equal((result!.board as any).line[0].tile, '6-6');
  assert.deepEqual(result!.myTiles.sort(), ['0-0', '2-3']);
});

test('playing onto an existing board extends the line and removes the tile from myTiles', () => {
  const opened = predictMyMove(baseInput(), { kind: 'pose', seat: 0, tile: '6-6' })!;
  const input = baseInput({ board: opened.board, myTiles: ['2-6', '0-0'] });
  const result = predictMyMove(input, { kind: 'play', seat: 0, tile: '2-6', end: 'right' });
  assert.ok(result);
  assert.equal((result!.board as any).line.length, 2);
  assert.deepEqual(result!.myTiles, ['0-0']);
});

test('a pass leaves the board and myTiles unchanged', () => {
  const opened = predictMyMove(baseInput(), { kind: 'pose', seat: 0, tile: '6-6' })!;
  const input = baseInput({ board: opened.board, myTiles: ['2-3', '0-0'] });
  const result = predictMyMove(input, { kind: 'pass', seat: 0 });
  assert.ok(result);
  assert.deepEqual(result!.board, opened.board);
  assert.deepEqual(result!.myTiles, ['2-3', '0-0']);
});

test('an illegal move returns null instead of throwing', () => {
  // Playing a tile not actually in hand — legalMovesForMe() would never
  // offer this, but predictMyMove must fail closed if it ever happens.
  const result = predictMyMove(baseInput(), { kind: 'play', seat: 0, tile: '5-5', end: 'left' });
  assert.equal(result, null);
});
