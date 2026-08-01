import test from 'node:test';
import assert from 'node:assert/strict';
import { ratingUpdatesForSet } from './rating-update.ts';
import type { RatedSeat } from './rating-update.ts';
import { UNRATED } from './engine/index.ts';

function seat(userId: string | null, rating = UNRATED.rating, rd = UNRATED.rd): RatedSeat {
  return { userId, rating: { rating, rd } };
}

test('a table with any duppy seat is not rated at all', () => {
  const seats = [seat('a'), seat('b'), seat(null), seat('d')];
  assert.deepEqual(ratingUpdatesForSet('cutthroat', seats, 0), []);
});

test('cutthroat: the winner is rated against every loser, each loser only against the winner', () => {
  const seats = [seat('a', 1200), seat('b', 1200), seat('c', 1200), seat('d', 1200)];
  const updates = ratingUpdatesForSet('cutthroat', seats, 0);
  assert.equal(updates.length, 4);
  const winner = updates.find((u) => u.userId === 'a')!;
  const losers = updates.filter((u) => u.userId !== 'a');
  assert.ok(winner.next.rating > 1200, 'the winner should gain rating');
  for (const loser of losers) {
    assert.ok(loser.next.rating < 1200, `loser ${loser.userId} should lose rating`);
  }
  // The winner beat three opponents (more evidence) vs each loser's one game
  // against the winner — the winner's RD should shrink further this period.
  assert.ok(winner.next.rd < losers[0].next.rd);
});

test('cutthroat: losers move by the same amount as each other when they started identical', () => {
  const seats = [seat('a', 1200), seat('b', 1200), seat('c', 1200), seat('d', 1200)];
  const updates = ratingUpdatesForSet('cutthroat', seats, 0);
  const losers = updates.filter((u) => u.userId !== 'a').map((u) => u.next.rating);
  assert.equal(new Set(losers).size, 1, 'identical losers facing identical evidence should move identically');
});

test('partner: winners rated against the average of the losing side, not each loser separately', () => {
  // Seats 0,2 are one side; 1,3 the other (sideOf uses seat % 2 for partner).
  const seats = [seat('a', 1200), seat('b', 1200), seat('c', 1200), seat('d', 1200)];
  const updates = ratingUpdatesForSet('partner', seats, 0); // side 0 (seats 0,2) wins
  const winners = updates.filter((u) => u.userId === 'a' || u.userId === 'c');
  const losers = updates.filter((u) => u.userId === 'b' || u.userId === 'd');
  for (const w of winners) assert.ok(w.next.rating > 1200, `${w.userId} should gain`);
  for (const l of losers) assert.ok(l.next.rating < 1200, `${l.userId} should lose`);
});

test('partner: a stronger losing side costs the winners less than a weaker one would gain them', () => {
  // Winning against a team whose average rating is much higher is a bigger
  // upset than winning against a weak team — the winner's gain should scale
  // with how strong the beaten team's average was.
  const seats = [seat('a', 1200), seat('b', 1200), seat('c', 1200), seat('d', 1200)];
  const winStrong: RatedSeat[] = [seat('a', 1200), seat('b', 1600), seat('c', 1200), seat('d', 1600)];
  const gainVsPeers = ratingUpdatesForSet('partner', seats, 0).find((u) => u.userId === 'a')!.next.rating - 1200;
  const gainVsStrong = ratingUpdatesForSet('partner', winStrong, 0).find((u) => u.userId === 'a')!.next.rating - 1200;
  assert.ok(gainVsStrong > gainVsPeers, 'beating a stronger average opponent side should gain more');
});

test('openhand is partnered the same way partner is — not treated as cutthroat', () => {
  const seats = [seat('a', 1200), seat('b', 1200), seat('c', 1200), seat('d', 1200)];
  const partner = ratingUpdatesForSet('partner', seats, 0);
  const openhand = ratingUpdatesForSet('openhand', seats, 0);
  assert.deepEqual(partner, openhand);
});
