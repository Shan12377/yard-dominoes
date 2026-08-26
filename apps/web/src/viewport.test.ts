import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { needsLayoutRenderForResize } from './viewport.ts';

const mainSource = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

test('mobile address-bar movement does not request a full app redraw', () => {
  assert.equal(needsLayoutRenderForResize(390, 390), false);
  assert.equal(needsLayoutRenderForResize(390, 391), false);
});

test('a real width change still refits the domino board', () => {
  assert.equal(needsLayoutRenderForResize(390, 844), true);
  assert.equal(needsLayoutRenderForResize(844, 390), true);
});

test('the app shell applies the mobile resize guard and never clears before swapping', () => {
  assert.match(mainSource,
    /if \(!needsLayoutRenderForResize\(lastLayoutWidth, nextWidth\)\) return;/);
  assert.match(mainSource, /window\.setTimeout\(scheduleRender, 150\)/);
  assert.match(mainSource, /app\.replaceChildren\(next\);/);
  assert.doesNotMatch(mainSource, /app\.innerHTML\s*=/);
});
