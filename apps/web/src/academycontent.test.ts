import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readFile } from 'node:fs/promises';
import { BELTS } from '@yard/engine';
import { ACADEMY_VISUALS, FRENCH_GUIDE_CROSS, GAME_GUIDES, scenarioFor } from './academycontent.ts';

test('every Academy lesson has teaching copy and a generated diagram', async () => {
  for (const lesson of BELTS.flatMap((belt) => belt.lessons)) {
    const visual = ACADEMY_VISUALS[lesson.id];
    assert.ok(visual, `${lesson.id} is missing visual teaching copy`);
    assert.ok(visual.alt.length > 20, `${lesson.id} needs meaningful alt text`);
    await access(new URL(`../public/art/boards/${lesson.id}.svg`, import.meta.url));
  }
});

test('every declared drill is answerable and has exactly one correct choice', () => {
  for (const drill of BELTS.flatMap((belt) => belt.drills)) {
    const scenario = scenarioFor(drill);
    assert.ok(scenario.setup.length > 0, `${drill.id} needs a table position`);
    assert.ok(scenario.choices.length >= 2, `${drill.id} needs a real decision`);
    assert.equal(
      scenario.choices.filter((choice) => choice.correct).length,
      1,
      `${drill.id} must have one unambiguous answer`,
    );
  }
});

test('the Academy explains the two modes that change board or seat control', () => {
  assert.deepEqual(GAME_GUIDES.map((guide) => guide.id), ['french', 'across']);
  for (const guide of GAME_GUIDES) {
    assert.ok(guide.body.length > 100, `${guide.id} guide is too thin to teach the mode`);
    assert.ok(guide.takeaway.length > 30, `${guide.id} guide needs a usable takeaway`);
  }
});

test('the French guide is a legal four-arm cross with every inner half matching the centre', () => {
  const [centerA, centerB] = FRENCH_GUIDE_CROSS.center.split('-').map(Number);
  assert.equal(centerA, centerB, 'the centre must be a double');
  assert.equal(FRENCH_GUIDE_CROSS.arms.length, 4);
  assert.deepEqual(FRENCH_GUIDE_CROSS.arms.map((arm) => arm.place).sort(),
    ['east', 'north', 'south', 'west']);

  const inwardHalf = { north: 1, east: 0, south: 0, west: 1 } as const;
  for (const arm of FRENCH_GUIDE_CROSS.arms) {
    const halves = arm.tile.split('-').map(Number);
    assert.equal(arm.horizontal, arm.place === 'east' || arm.place === 'west',
      `${arm.place} arm must lie along its direction from the centre`);
    assert.equal(halves[inwardHalf[arm.place]], centerA,
      `${arm.place} arm must point its matching half toward the centre`);
  }
});

test('the first pip-counting diagram labels the three and five halves correctly', async () => {
  const svg = await readFile(new URL('../public/art/boards/B1L1.svg', import.meta.url), 'utf8');
  const upperCallout = svg.match(/<g transform="translate\(260 145\)">([\s\S]*?)<\/g>/)?.[1] ?? '';
  const lowerCallout = svg.match(/<g transform="translate\(500 245\)">([\s\S]*?)<\/g>/)?.[1] ?? '';
  assert.match(upperCallout, />3 pips<\/text>/,
    'the callout beside the upper three must say 3 pips');
  assert.match(lowerCallout, />5 pips<\/text>/,
    'the callout beside the lower five must say 5 pips');
});
