import test from 'node:test';
import assert from 'node:assert/strict';
import { updateRating, UNRATED, RD_FLOOR } from '../src/index.ts';
import type { RatingState, Opponent } from '../src/index.ts';

test('matches Glickman\'s own published worked example exactly', () => {
  // From "The Glicko system" (Mark Glickman): a player rated 1500, RD 200,
  // plays three opponents (1400/RD30 win, 1550/RD100 loss, 1700/RD300 loss)
  // and the paper's own arithmetic lands on rating 1464, RD 151.4. Pinning
  // the published example, not just internal consistency, catches a
  // subtly-wrong formula that would otherwise still look plausible.
  const player: RatingState = { rating: 1500, rd: 200 };
  const opponents: Opponent[] = [
    { rating: 1400, rd: 30, score: 1 },
    { rating: 1550, rd: 100, score: 0 },
    { rating: 1700, rd: 300, score: 0 },
  ];
  const next = updateRating(player, opponents);
  assert.equal(next.rating, 1464);
  // The paper rounds to 151.4; this module rounds to the nearest integer.
  assert.equal(next.rd, 151);
});

test('no opponents this period leaves the rating untouched', () => {
  const player: RatingState = { rating: 1350, rd: 80 };
  assert.deepEqual(updateRating(player, []), player);
});

test('a brand-new account swings harder than an established one for the same result', () => {
  const opponent: Opponent = { rating: 1200, rd: 100, score: 0 }; // lost to a peer-rated 1200
  const newAccount = updateRating(UNRATED, [opponent]);
  const established = updateRating({ rating: 1200, rd: 40 }, [opponent]);
  const newDrop = UNRATED.rating - newAccount.rating;
  const establishedDrop = 1200 - established.rating;
  assert.ok(newDrop > establishedDrop,
    `a new account (RD ${UNRATED.rd}) should move MORE than an established one (RD 40) for the same loss — that swing is the whole point, it is what replaces JamDom's frequency wall. Got a drop of ${newDrop} vs ${establishedDrop}`);
});

test('RD never drops below the floor, however many games are folded in', () => {
  const player: RatingState = { rating: 1200, rd: 31 };
  const manyWins: Opponent[] = Array.from({ length: 20 }, () => (
    { rating: 1200, rd: 50, score: 1 as const }
  ));
  const next = updateRating(player, manyWins);
  assert.ok(next.rd >= RD_FLOOR, `RD ${next.rd} fell below the floor of ${RD_FLOOR}`);
});

test('beating a much stronger, well-established opponent gains more than beating a peer', () => {
  const player: RatingState = { rating: 1200, rd: 60 };
  const beatPeer = updateRating(player, [{ rating: 1200, rd: 60, score: 1 }]);
  const beatStronger = updateRating(player, [{ rating: 1500, rd: 60, score: 1 }]);
  assert.ok(beatStronger.rating > beatPeer.rating,
    'an upset win should be worth more than beating an equally-rated peer');
});

test('losing to a much weaker opponent costs more than losing to a peer', () => {
  const player: RatingState = { rating: 1200, rd: 60 };
  const lostToPeer = updateRating(player, [{ rating: 1200, rd: 60, score: 0 }]);
  const lostToWeaker = updateRating(player, [{ rating: 900, rd: 60, score: 0 }]);
  assert.ok(lostToWeaker.rating < lostToPeer.rating,
    'an upset loss should cost more than losing to an equally-rated peer');
});

test('multiple games against the same opponent this period are independent evidence', () => {
  // Glickman's own spec: "multiple games against the same opponent are
  // treated as games against multiple opponents with the same rating and RD."
  const player: RatingState = { rating: 1200, rd: 100 };
  const opp: Opponent = { rating: 1200, rd: 100, score: 1 };
  const twice = updateRating(player, [opp, opp]);
  const once = updateRating(player, [opp]);
  assert.ok(twice.rating > once.rating, 'two wins should move the rating further than one');
  assert.ok(twice.rd < once.rd, 'two results should narrow RD more than one');
});
