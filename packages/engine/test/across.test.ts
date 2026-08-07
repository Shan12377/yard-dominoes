// Across is partner mode with a different visibility change than openhand:
// instead of a seat seeing its partner's tiles read-only, one real person is
// signed into BOTH seats of a side and plays each in its own turn. That
// account-binding lives in Supabase (seats/seat_hands), not the engine — the
// engine has no concept of "one entity playing two seats" and does not need
// one, since every move is still validated per-seat exactly as if two
// different people were sitting there. What the engine DOES need to get
// right is pairing and rules parity with partner, which is what this file
// pins down.

import test from 'node:test';
import assert from 'node:assert/strict';
import { isPartnered, sideOf, sideCount, seatsOfSide } from '../src/tiles.ts';

test('across pairs seats exactly like partner — 0&2, 1&3, and the same side count', () => {
  for (let seat = 0; seat < 4; seat++) {
    assert.equal(sideOf(seat, 'across'), sideOf(seat, 'partner'),
      `seat ${seat} maps to a different side under across`);
  }
  assert.equal(sideCount(4, 'across'), sideCount(4, 'partner'));
  assert.deepEqual(seatsOfSide(0, 4, 'across'), seatsOfSide(0, 4, 'partner'));
  assert.deepEqual(seatsOfSide(1, 4, 'across'), seatsOfSide(1, 4, 'partner'));
  assert.equal(isPartnered('across'), true);
});

test('isPartnered still refuses cutthroat and openhand is unaffected by across existing', () => {
  assert.equal(isPartnered('cutthroat'), false);
  assert.equal(isPartnered('openhand'), true);
  assert.equal(isPartnered('partner'), true);
});
