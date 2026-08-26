import assert from 'node:assert/strict';
import test from 'node:test';
import { DUPPY_LEVELS } from '@yard/engine';
import { DUPPY_PERSONAS, duppyPersona, duppyPersonaUrl } from './duppy-persona.ts';

test('each duppy level has two stable illustrated personas', () => {
  for (const level of DUPPY_LEVELS) {
    assert.equal(DUPPY_PERSONAS[level].length, 2);
    assert.equal(duppyPersona(level, 0), duppyPersona(level, 0));
    assert.notEqual(duppyPersona(level, 0), duppyPersona(level, 1));
    assert.match(duppyPersonaUrl(duppyPersona(level, 0)), /^\/duppies\//);
    assert.doesNotMatch(duppyPersonaUrl(duppyPersona(level, 0)), /^\/avatars\//);
  }
});
