import assert from 'node:assert/strict';
import test from 'node:test';
import { access } from 'node:fs/promises';
import { BELTS } from '@yard/engine';
import { ACADEMY_VISUALS, GAME_GUIDES, scenarioFor } from './academycontent.ts';

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
