import assert from 'node:assert/strict';
import test from 'node:test';
import { validateConnectedLine, validateNoTileOverlap } from '../art/render.ts';

test('Academy art accepts a legal connected line regardless of tile naming order', () => {
  assert.doesNotThrow(() => validateConnectedLine([
    { id: '0-1', x: 0, y: 0, rotate: -90 },
    { id: '1-3', x: 110, y: 0, rotate: -90 },
    { id: '3-5', x: 220, y: 0, rotate: -90 },
    { id: '5-6', x: 330, y: 0, rotate: -90 },
  ]));
});

test('Academy art rejects a broken domino join before an SVG is generated', () => {
  assert.throws(() => validateConnectedLine([
    { id: '0-1', x: 0, y: 0, rotate: -90 },
    { id: '2-3', x: 110, y: 0, rotate: -90 },
  ]), /0-1 does not join 2-3/);
});

test('Academy art rejects a visually overlapped or floating teaching line', () => {
  assert.throws(() => validateConnectedLine([
    { id: '0-1', x: 0, y: 0, rotate: -90 },
    { id: '1-3', x: 95, y: 0, rotate: -90 },
  ]), /touch without overlap or gaps/);
});

test('Academy art rejects separate tiles that cover each other and hide pips', () => {
  assert.throws(() => validateNoTileOverlap([
    { id: '0-1', x: 0, y: 0, rotate: -90 },
    { id: '2-3', x: 95, y: 0, rotate: -90 },
  ]), /overlap and hide pips/);
  assert.doesNotThrow(() => validateNoTileOverlap([
    { id: '0-1', x: 0, y: 0, rotate: -90 },
    { id: '2-3', x: 125, y: 0, rotate: -90 },
  ]));
});
