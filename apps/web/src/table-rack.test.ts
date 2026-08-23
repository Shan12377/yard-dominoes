import test from 'node:test';
import assert from 'node:assert/strict';
import { tableRackPresentation } from './table-rack.ts';

const base = {
  mode: 'partner' as const,
  mySeat: 0,
  partnerSeat: 2,
  count: 6,
  partnerTiles: null,
};

test('a seated player sees no duplicate own rack and three hidden racks', () => {
  assert.deepEqual(tableRackPresentation({ ...base, seat: 0 }), { kind: 'none' });
  for (const seat of [1, 2, 3]) {
    assert.deepEqual(tableRackPresentation({ ...base, seat }), { kind: 'hidden', count: 6 });
  }
});

test('a spectator sees every rack hidden, including the bottom seat', () => {
  for (const seat of [0, 1, 2, 3]) {
    assert.deepEqual(tableRackPresentation({ ...base, mySeat: null, partnerSeat: null, seat }),
      { kind: 'hidden', count: 6 });
  }
});

test('Open Hand reveals only the authorized partner rack', () => {
  const partnerTiles = ['0-1', '2-3', '4-5'] as const;
  assert.deepEqual(tableRackPresentation({
    ...base, mode: 'openhand', count: 3, partnerTiles: [...partnerTiles], seat: 2,
  }), { kind: 'open', tiles: [...partnerTiles] });
  assert.deepEqual(tableRackPresentation({
    ...base, mode: 'openhand', count: 3, partnerTiles: [...partnerTiles], seat: 1,
  }), { kind: 'hidden', count: 3 });
});

test('an Open Hand spectator never receives a face-up rack', () => {
  assert.deepEqual(tableRackPresentation({
    ...base, mode: 'openhand', mySeat: null, partnerSeat: null,
    count: 3, partnerTiles: null, seat: 2,
  }), { kind: 'hidden', count: 3 });
});

test('Open Hand falls back to the public count while private tiles catch up', () => {
  assert.deepEqual(tableRackPresentation({
    ...base, mode: 'openhand', count: 2, partnerTiles: ['0-1', '2-3', '4-5'], seat: 2,
  }), { kind: 'hidden', count: 2 });
});

test('Across keeps both controlled hands below the felt and opponents hidden', () => {
  assert.deepEqual(tableRackPresentation({ ...base, mode: 'across', seat: 2 }), { kind: 'none' });
  assert.deepEqual(tableRackPresentation({ ...base, mode: 'across', seat: 1 }),
    { kind: 'hidden', count: 6 });
  assert.deepEqual(tableRackPresentation({ ...base, mode: 'across', seat: 3 }),
    { kind: 'hidden', count: 6 });
});

test('a finished player has an empty hidden rack', () => {
  assert.deepEqual(tableRackPresentation({ ...base, count: 0, seat: 1 }),
    { kind: 'hidden', count: 0 });
});
