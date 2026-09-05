import test from 'node:test';
import assert from 'node:assert/strict';
import { describeMoveLine, seatNameWithLevel } from './movelog.ts';
import type { SeatInfo } from './onlinetable.ts';

function seat(overrides: Partial<SeatInfo>): SeatInfo {
  return {
    seatIndex: 0, userId: null, username: null, origin: null,
    avatar: null, background: null, duppyLevel: null, timeBank: 0,
    ...overrides,
  };
}

const seats: SeatInfo[] = [
  seat({ seatIndex: 0, userId: 'u0', username: 'Alice' }),
  seat({ seatIndex: 1, userId: 'u1', username: 'Bob' }),
  seat({ seatIndex: 2, userId: null, duppyLevel: 'pickney' }),
  seat({ seatIndex: 3, userId: 'u3', username: null }),
];

test('a pose names the tile and the poser', () => {
  const line = describeMoveLine({ kind: 'pose', seat: 1, tile: '6-6' }, seats, 0, false, null);
  assert.equal(line, 'Bob posed 6-6');
});

test('a play names the tile', () => {
  const line = describeMoveLine({ kind: 'play', seat: 1, tile: '4-4', end: 'left' }, seats, 0, false, null);
  assert.equal(line, 'Bob played 4-4');
});

test('a French cross-board play reads the same as a plain play', () => {
  const line = describeMoveLine({ kind: 'playcross', seat: 1, tile: '4-4', arm: 0 }, seats, 0, false, null);
  assert.equal(line, 'Bob played 4-4');
});

test('a draw has no tile named', () => {
  const line = describeMoveLine({ kind: 'draw', seat: 1, tile: '2-3' }, seats, 0, false, null);
  assert.equal(line, 'Bob drew a tile');
});

test('a pass', () => {
  const line = describeMoveLine({ kind: 'pass', seat: 1 }, seats, 0, false, null);
  assert.equal(line, 'Bob passed');
});

test('the viewer\'s own move shows "You", not their name', () => {
  const line = describeMoveLine({ kind: 'pass', seat: 0 }, seats, 0, false, null);
  assert.equal(line, 'You passed');
});

test('in partner mode, the partner\'s seat shows "Partner", not their name', () => {
  // mySeat 0, mySide 0 — seat 2 is on side 0 too (partner), seat 1/3 are the opposing side.
  const line = describeMoveLine({ kind: 'pass', seat: 2 }, seats, 0, true, 0);
  assert.equal(line, 'Partner passed');
});

test('in partner mode, an opposing seat still shows their real name', () => {
  const line = describeMoveLine({ kind: 'pass', seat: 1 }, seats, 0, true, 0);
  assert.equal(line, 'Bob passed');
});

test('a duppy seat shows its stable player number, without the level', () => {
  // The level used to ride on the name here and on every seat card. It is the
  // one the player chose at setup, it does not change mid-hand, and repeated
  // down a whole turn log it is pure noise — while on a phone it ate the width
  // a two-hander's card needed and truncated the name to "Du…". It lives on
  // the card's title and aria-label now instead.
  const line = describeMoveLine({ kind: 'pass', seat: 2 }, seats, 0, false, null);
  assert.equal(line, 'Duppy 3 passed');
});

test('the level is still available where there is room to say it', () => {
  assert.equal(seatNameWithLevel(seats[2]), 'Duppy 3 · pickney');
  // A real player never gets a level appended, whatever is on the row.
  assert.equal(seatNameWithLevel(seats[1]), 'Bob');
});

test('a human seat with no username falls back to its one-based player number', () => {
  const line = describeMoveLine({ kind: 'pass', seat: 3 }, seats, 0, false, null);
  assert.equal(line, 'Player 4 passed');
});
