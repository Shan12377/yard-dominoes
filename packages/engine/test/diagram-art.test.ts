import assert from 'node:assert/strict';
import test from 'node:test';
import { validateConnectedLine } from '../art/render.ts';

test('Academy art accepts a legal connected line regardless of tile naming order', () => {
  assert.doesNotThrow(() => validateConnectedLine([
    { id: '0-1', x: 0, y: 0, rotate: -90 },
    { id: '1-3', x: 100, y: 0, rotate: -90 },
    { id: '3-5', x: 200, y: 0, rotate: -90 },
    { id: '5-6', x: 300, y: 0, rotate: -90 },
  ]));
});

test('Academy art rejects a broken domino join before an SVG is generated', () => {
  assert.throws(() => validateConnectedLine([
    { id: '0-1', x: 0, y: 0, rotate: -90 },
    { id: '2-3', x: 100, y: 0, rotate: -90 },
  ]), /0-1 does not join 2-3/);
});
