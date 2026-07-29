import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeLeak, EMPTY_LEAKS, MIN_HANDS_FOR_A_PATTERN, recordHand, standoutLeak, topLeaks,
} from '../src/index.ts';
import type { Grade, HandReview, MoveReview } from '../src/index.ts';

function move(grade: Grade, lesson: string | null, loss: number): MoveReview {
  return {
    ply: 0, seat: 0,
    move: { kind: 'pass', seat: 0 },
    best: { kind: 'pass', seat: 0 },
    valueActual: 0, valueBest: 0, loss, grade, note: '', lesson, exact: true,
  };
}

function review(...moves: MoveReview[]): HandReview {
  return {
    seat: 0, side: 0, reviews: moves, criticalPly: null, summary: '', exact: true,
    counts: { best: 0, fine: 0, loose: 0, blunder: 0 },
  };
}

test('only decisions that cost something count as a leak', () => {
  let store = EMPTY_LEAKS;
  store = recordHand(store, review(
    move('best', null, 0),
    move('fine', 'Belt 1 · Lesson 1', 0.4),
    move('loose', 'Belt 4 · Lesson 1', 1.2),
  ));
  assert.equal(store.hands, 1);
  assert.deepEqual(store.entries.map((e) => e.lesson), ['Belt 4 · Lesson 1']);
});

test('the same mistake accumulates instead of duplicating', () => {
  let store = EMPTY_LEAKS;
  for (let i = 0; i < 3; i++) {
    store = recordHand(store, review(move('loose', 'Belt 4 · Lesson 1', 1)));
  }
  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0].count, 3);
  assert.equal(store.entries[0].cost, 3);
  assert.equal(store.entries[0].lastSeen, 3);
});

test('recording never mutates the store it was given', () => {
  const store = recordHand(EMPTY_LEAKS, review(move('loose', 'Belt 2 · Lesson 2', 1)));
  const snapshot = JSON.stringify(store);
  recordHand(store, review(move('blunder', 'Belt 2 · Lesson 2', 2)));
  assert.equal(JSON.stringify(store), snapshot);
  assert.deepEqual(EMPTY_LEAKS.entries, []);
});

test('a costly rare mistake outranks a cheap frequent one', () => {
  let store = EMPTY_LEAKS;
  for (let i = 0; i < 5; i++) {
    store = recordHand(store, review(move('loose', 'cheap', 1)));
  }
  store = recordHand(store, review(move('blunder', 'expensive', 2)));
  store = recordHand(store, review(move('blunder', 'expensive', 2)));
  store = recordHand(store, review(move('blunder', 'expensive', 2)));
  assert.equal(topLeaks(store, 1)[0].lesson, 'expensive');
});

test('one mistake is never called a habit', () => {
  let store = EMPTY_LEAKS;
  // Enough hands, but the mistake happened only once.
  for (let i = 0; i < MIN_HANDS_FOR_A_PATTERN; i++) {
    store = recordHand(store, review(i === 0 ? move('blunder', 'Belt 3 · Lesson 1', 2) : move('best', null, 0)));
  }
  assert.equal(standoutLeak(store), null);
});

test('a beginner is not diagnosed before there is evidence', () => {
  let store = EMPTY_LEAKS;
  // Repeated mistake, but far too few hands to call it a pattern.
  store = recordHand(store, review(move('blunder', 'Belt 3 · Lesson 1', 2)));
  store = recordHand(store, review(move('blunder', 'Belt 3 · Lesson 1', 2)));
  assert.ok(store.hands < MIN_HANDS_FOR_A_PATTERN);
  assert.equal(standoutLeak(store), null);
});

test('a real pattern is named once there is enough to go on', () => {
  let store = EMPTY_LEAKS;
  for (let i = 0; i < 6; i++) {
    store = recordHand(store, review(move('blunder', 'Belt 4 · Lesson 1', 2)));
  }
  const leak = standoutLeak(store);
  assert.ok(leak);
  assert.equal(leak!.lesson, 'Belt 4 · Lesson 1');
  assert.match(describeLeak(leak!, store), /6 times in 6 hands/);
});

test('a clean player is told nothing at all', () => {
  let store = EMPTY_LEAKS;
  for (let i = 0; i < 20; i++) store = recordHand(store, review(move('best', null, 0)));
  assert.equal(standoutLeak(store), null);
  assert.deepEqual(topLeaks(store), []);
});
