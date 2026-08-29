import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WALKTHROUGH_STEPS } from './walkthrough.ts';
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('walkthrough covers practice setup and every public destination', () => {
  assert.deepEqual(
    [...new Set(WALKTHROUGH_STEPS.map((step) => step.view))],
    ['play', 'lounges', 'rankings', 'academy', 'membership', 'profile', 'fair'],
  );
  assert.equal(WALKTHROUGH_STEPS.length, 11);
});

test('walkthrough targets and captions are complete and unambiguous', () => {
  assert.equal(new Set(WALKTHROUGH_STEPS.map((step) => step.target)).size, WALKTHROUGH_STEPS.length);
  for (const step of WALKTHROUGH_STEPS) {
    assert.match(step.target, /^\[data-tour="[a-z-]+"\]$/);
    assert.ok(step.title.length > 8);
    assert.ok(step.caption.length > 40);
  }
});

test('the Fair Deal stop says the completed-hand check shows every starting hand', () => {
  const fair = WALKTHROUGH_STEPS.find((step) => step.view === 'fair');
  assert.ok(fair);
  assert.match(fair.caption, /shows every original starting hand/);
  assert.match(fair.caption, /After a hand ends/);
});

test('the welcome domino stays inside the card instead of clipping its top border', () => {
  assert.match(styles, /\.walkthrough-bone \{[\s\S]*?margin: -8px 2px 10px 18px;/);
  assert.doesNotMatch(styles, /\.walkthrough-bone \{[\s\S]*?margin: -38px/);
});
