import test from 'node:test';
import assert from 'node:assert/strict';
import { seatPosition } from './seatlayout.ts';

test('4 seats: bottom is mine, then right/top/left going anti-clockwise from me', () => {
  assert.equal(seatPosition(2, 2, 4), 'bottom'); // mySeat
  assert.equal(seatPosition(3, 2, 4), 'right');  // mySeat+1
  assert.equal(seatPosition(0, 2, 4), 'top');    // mySeat+2 — the partner, opposite
  assert.equal(seatPosition(1, 2, 4), 'left');   // mySeat+3
});

test('4 seats: the mapping wraps correctly when mySeat is 0', () => {
  assert.equal(seatPosition(0, 0, 4), 'bottom');
  assert.equal(seatPosition(1, 0, 4), 'right');
  assert.equal(seatPosition(2, 0, 4), 'top');
  assert.equal(seatPosition(3, 0, 4), 'left');
});

test('3 seats: bottom/right/left, top is never used', () => {
  assert.equal(seatPosition(1, 1, 3), 'bottom');
  assert.equal(seatPosition(2, 1, 3), 'right');
  assert.equal(seatPosition(0, 1, 3), 'left');
});

test('2 seats: bottom is mine, top is the only other seat — never left/right', () => {
  assert.equal(seatPosition(0, 0, 2), 'bottom');
  assert.equal(seatPosition(1, 0, 2), 'top');
});

test('a spectator (mySeat null) anchors on seat 0 at the bottom', () => {
  assert.equal(seatPosition(0, null, 4), 'bottom');
  assert.equal(seatPosition(1, null, 4), 'right');
  assert.equal(seatPosition(2, null, 4), 'top');
  assert.equal(seatPosition(3, null, 4), 'left');
});

test('a seat count of 4 never returns null for any of the four seats', () => {
  for (let seat = 0; seat < 4; seat++) {
    assert.notEqual(seatPosition(seat, 0, 4), null);
  }
});
