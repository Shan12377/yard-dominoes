import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choiceFrom, soundAnswered, storedFor } from './sound.ts';

test('a browser that has never answered is silent', () => {
  // The whole point: an absent key used to mean "make noise", which is how a
  // first visit announced itself in somebody's quiet office.
  assert.equal(choiceFrom(null, null), 'off');
  assert.equal(soundAnswered(null, null), false);
});

test('only an explicit allow makes a sound', () => {
  assert.equal(choiceFrom('0', '0'), 'all');
  assert.equal(choiceFrom('0', '1'), 'table');
  assert.equal(choiceFrom('1', '1'), 'off');
  assert.equal(choiceFrom('1', '0'), 'off', 'voices without table sound is not a state we offer');
});

test('a choice survives the round trip', () => {
  for (const choice of ['off', 'table', 'all'] as const) {
    const [table, voices] = storedFor(choice);
    assert.equal(choiceFrom(table, voices), choice);
  }
});

test('somebody who already chose is not asked again', () => {
  assert.equal(soundAnswered('1', null), true);
  assert.equal(soundAnswered(null, '0'), true);
});
