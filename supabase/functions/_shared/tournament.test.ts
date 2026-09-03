// `loadQueue` needs a live client and is not covered here. `standingFor` and
// `signupsOpen` are pure and are — the file's only jsr import is `import type`,
// which Node erases, so this whole half was always testable.

import test from 'node:test';
import assert from 'node:assert/strict';
import { signupsOpen, standingFor, type QueuedPlayer } from './tournament.ts';

const NOW = Date.parse('2026-08-02T12:00:00Z');
const LIVE = '2026-09-01T00:00:00Z';

/** Queue rows in the order `loadQueue` would already have sorted them. */
const player = (
  userId: string,
  tier = 'guest',
  over: Partial<QueuedPlayer> = {},
): QueuedPlayer => ({
  userId,
  username: userId,
  tier,
  tierExpiresAt: tier === 'guest' ? null : LIVE,
  signedUpAt: '2026-08-02T09:00:00Z',
  status: 'signed_up',
  round: null,
  tableId: null,
  gender: null,
  ...over,
});

const queue = (n: number) => Array.from({ length: n }, (_, i) => player(`p${i}`));

// ------------------------------------------------------------- the cut ----
test('a player inside the last full table is above the cut', () => {
  const s = standingFor(queue(8), 4, 'p7', NOW);
  assert.equal(s.position, 8);
  assert.equal(s.aboveCut, true);
});

test('the first player past the last full table is below it — and is a '
  + 'substitute, which is a sold benefit rather than a rejection', () => {
  const s = standingFor(queue(9), 4, 'p8', NOW);
  assert.equal(s.position, 9);
  assert.equal(s.aboveCut, false);
});

test('nobody is above the cut until there are enough for one full table', () => {
  const s = standingFor(queue(3), 4, 'p0', NOW);
  assert.equal(s.position, 1);
  assert.equal(s.aboveCut, false, 'first in line still has no table to sit at');
});

test('the cut agrees with drawCutLine at every turnout up to 40', () => {
  for (let n = 0; n <= 40; n++) {
    const ordered = queue(n);
    const expected = Math.floor(n / 4) * 4;
    for (let i = 0; i < n; i++) {
      assert.equal(standingFor(ordered, 4, `p${i}`, NOW).aboveCut, i < expected,
        `n=${n}, player ${i}`);
    }
  }
});

// -------------------------------------------------------- vips ahead ------
test('vipsAhead counts the live VIPs in front — this is the sentence that '
  + 'sells the upgrade', () => {
  const ordered = [player('v1', 'vip'), player('v2', 'vip'), player('y', 'yardie'), player('me')];
  assert.equal(standingFor(ordered, 4, 'me', NOW).vipsAhead, 2);
});

test('a yardie ahead of you is not a VIP ahead of you', () => {
  const ordered = [player('y', 'yardie'), player('me')];
  assert.equal(standingFor(ordered, 4, 'me', NOW).vipsAhead, 0);
});

test('an expired VIP ahead of you does not count — they are not jumping you '
  + 'either, so telling you they are would be a lie', () => {
  const lapsed = player('ghost', 'vip', { tierExpiresAt: '2026-07-01T00:00:00Z' });
  assert.equal(standingFor([lapsed, player('me')], 4, 'me', NOW).vipsAhead, 0);
});

test('VIPs behind you are not counted', () => {
  const ordered = [player('me'), player('v', 'vip')];
  assert.equal(standingFor(ordered, 4, 'me', NOW).vipsAhead, 0);
});

// ------------------------------------------------------- not in the queue --
test('somebody who never signed up has no position, but still sees the turnout', () => {
  const s = standingFor(queue(5), 4, 'stranger', NOW);
  assert.equal(s.position, null);
  assert.equal(s.aboveCut, false);
  assert.equal(s.total, 5);
});

test('a signed-out visitor gets the same shape rather than a crash', () => {
  const s = standingFor(queue(5), 4, null, NOW);
  assert.equal(s.position, null);
  assert.equal(s.total, 5);
});

test('a seated player carries their table through, which is what the client '
  + 'reads to offer "Take your seat"', () => {
  const seated = player('me', 'guest', { status: 'seated', round: 2, tableId: 'tbl-7' });
  const s = standingFor([seated], 4, 'me', NOW);
  assert.equal(s.status, 'seated');
  assert.equal(s.round, 2);
  assert.equal(s.tableId, 'tbl-7');
});

// ---------------------------------------------------------- signup window --
test('sign-ups are shut unless the event says they are open', () => {
  assert.equal(signupsOpen({ status: 'announced', signups_open_at: null }, NOW), false);
  assert.equal(signupsOpen({ status: 'seating', signups_open_at: null }, NOW), false);
  assert.equal(signupsOpen({ status: 'running', signups_open_at: null }, NOW), false);
  assert.equal(signupsOpen({ status: 'cancelled', signups_open_at: null }, NOW), false);
});

test('a null opening time means open as soon as the event says so', () => {
  assert.equal(signupsOpen({ status: 'signups_open', signups_open_at: null }, NOW), true);
});

test('a future opening time still holds sign-ups shut', () => {
  assert.equal(signupsOpen(
    { status: 'signups_open', signups_open_at: '2026-08-02T18:00:00Z' }, NOW), false);
});

test('sign-ups open exactly on the stroke, not a second after', () => {
  const opensAt = '2026-08-02T12:00:00Z';
  assert.equal(signupsOpen({ status: 'signups_open', signups_open_at: opensAt }, NOW), true);
});

// ------------------------------------------------- a themed cut line ----
//
// For an open event "above the cut" and "in the first N of the queue" are the
// same sentence. For a theme they are not, and telling somebody the wrong one
// is telling them they are playing on Sunday when they are not.

test('a themed standing follows the draw, not the queue position', () => {
  // Six women and two men, in queue order. One table can be made, and it is
  // the first two of each side: w1, m1, w2, m2 — who sit at queue positions
  // 1, 2, 5 and 7. Position alone would have said positions 1-4 were in.
  const ordered: QueuedPlayer[] = [
    player('w1', 'guest', { gender: 'f' }),
    player('w2', 'guest', { gender: 'f' }),
    player('w3', 'guest', { gender: 'f' }),
    player('w4', 'guest', { gender: 'f' }),
    player('m1', 'guest', { gender: 'm' }),
    player('w5', 'guest', { gender: 'f' }),
    player('m2', 'guest', { gender: 'm' }),
    player('w6', 'guest', { gender: 'f' }),
  ];

  const seated = ['w1', 'w2', 'm1', 'm2'];
  for (const p of ordered) {
    const s = standingFor(ordered, 4, p.userId, NOW, 'battle_of_the_sexes');
    assert.equal(s.aboveCut, seated.includes(p.userId),
      `${p.userId} was told the wrong thing about whether they are playing`);
  }

  // The two the old positional rule would have got wrong, stated outright.
  assert.equal(standingFor(ordered, 4, 'w3', NOW, 'battle_of_the_sexes').aboveCut, false,
    'position 3 is a woman with no man to face — she is not seated');
  assert.equal(standingFor(ordered, 4, 'm2', NOW, 'battle_of_the_sexes').aboveCut, true,
    'position 7 plays, because his side is the short one');
});

test('the same queue read as an open event seats the first four instead', () => {
  const ordered: QueuedPlayer[] = [
    player('w1', 'guest', { gender: 'f' }),
    player('w2', 'guest', { gender: 'f' }),
    player('w3', 'guest', { gender: 'f' }),
    player('w4', 'guest', { gender: 'f' }),
    player('m1', 'guest', { gender: 'm' }),
  ];
  for (const id of ['w1', 'w2', 'w3', 'w4']) {
    assert.equal(standingFor(ordered, 4, id, NOW).aboveCut, true);
  }
  assert.equal(standingFor(ordered, 4, 'm1', NOW).aboveCut, false);
});
