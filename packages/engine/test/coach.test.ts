import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accuracy, applyMove, deal, legalMoves, provablyFairShuffle, reviewHand,
} from '../src/index.ts';
import type { HandState } from '../src/index.ts';

/** Play a whole hand out, choosing among legal moves deterministically. */
async function playedHand(seed: number) {
  const order = await provablyFairShuffle({
    serverSeed: `s${seed}`, clientSeeds: [`c${seed}`], handId: `h${seed}`,
  });
  const initial = deal({
    order, seatCount: 4, mode: 'partner', useBoneyard: false, poseMustBeDoubleSix: false,
  });
  let s: HandState = initial;
  let pick = seed;
  let guard = 0;
  while (s.status === 'active' && guard++ < 60) {
    const moves = legalMoves(s);
    if (moves.length === 0) break;
    pick = (pick * 1103515245 + 12345) & 0x7fffffff;
    s = applyMove(s, moves[pick % moves.length]);
  }
  return { initial, final: s };
}

/**
 * The coach's headline number and its headline finding must agree. Showing
 * "100% accuracy" beside "here is where you threw the hand away" makes the
 * whole feature look broken, and the coach is the reason to play here.
 */
test('accuracy and the turning point never contradict each other', async () => {
  for (let seed = 0; seed < 40; seed++) {
    const { initial, final } = await playedHand(seed);
    const review = reviewHand(
      { ...initial, hands: initial.hands.map((h) => [...h]) },
      final.moveLog,
      0,
    );
    const acc = accuracy(review);

    if (review.criticalPly !== null) {
      const critical = review.reviews.find((r) => r.ply === review.criticalPly);
      assert.ok(critical, `seed ${seed}: criticalPly points at no reviewed move`);
      assert.ok(critical!.grade === 'loose' || critical!.grade === 'blunder',
        `seed ${seed}: turning point was graded ${critical!.grade}, which counts as accurate`);
      assert.ok(acc < 100,
        `seed ${seed}: accuracy ${acc}% while naming a move that cost the hand`);
    } else {
      assert.equal(acc, 100,
        `seed ${seed}: accuracy ${acc}% but no decision was ever named`);
    }
  }
});

test('a clean hand is never told it gave up a winnable hand', async () => {
  for (let seed = 0; seed < 40; seed++) {
    const { initial, final } = await playedHand(seed);
    const review = reviewHand(
      { ...initial, hands: initial.hands.map((h) => [...h]) },
      final.moveLog,
      0,
    );
    if (review.criticalPly === null) {
      assert.doesNotMatch(review.summary, /threw|gave up/,
        `seed ${seed}: "${review.summary}" blames a hand with nothing wrong in it`);
    }
  }
});

test('visual Coach positions retain only the reviewed seat hand', async () => {
  const { initial, final } = await playedHand(7);
  const review = reviewHand(
    { ...initial, hands: initial.hands.map((h) => [...h]) },
    final.moveLog,
    0,
  );
  for (const decision of review.reviews) {
    assert.ok(Array.isArray(decision.position.hand));
    assert.equal('hands' in decision.position, false,
      'a Coach snapshot must never contain every seat hand');
    assert.equal('boneyard' in decision.position, false,
      'a Coach snapshot must not smuggle hidden tiles through the boneyard');
    assert.ok(Array.isArray(decision.position.legal));
    assert.ok(decision.position.after, 'a new Coach review should show both safe after-move reads');
    assert.ok(Array.isArray(decision.position.after!.actual.ends));
    assert.ok(Array.isArray(decision.position.after!.actual.hand));
    assert.equal('hands' in decision.position.after!.actual, false,
      'the after-move snapshot must never contain every seat hand');
  }
});
