import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { DUPPY_LEVELS } from '@yard/engine';
import { DUPPY_PERSONAS, duppyPersona, duppyPersonaUrl } from './duppy-persona.ts';

test('every Duppy seat gets a distinct stable portrait at the same table', () => {
  for (const level of DUPPY_LEVELS) {
    assert.ok(DUPPY_PERSONAS[level].length >= 4);
    assert.equal(duppyPersona(level, 0), duppyPersona(level, 0));
    const wholeTable = [0, 1, 2, 3].map((seat) => duppyPersona(level, seat));
    assert.equal(new Set(wholeTable).size, 4);
    assert.match(duppyPersonaUrl(duppyPersona(level, 0)), /^\/duppies\//);
    assert.doesNotMatch(duppyPersonaUrl(duppyPersona(level, 0)), /^\/avatars\//);
  }
});

test('the expanded Duppy cast has ten dedicated local portraits', () => {
  const cast = new Set(Object.values(DUPPY_PERSONAS).flat());
  assert.equal(cast.size, 10);
  for (const persona of cast) {
    assert.equal(existsSync(new URL(`../public${duppyPersonaUrl(persona)}`, import.meta.url)), true);
  }
});
