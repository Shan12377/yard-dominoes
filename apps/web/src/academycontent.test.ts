import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readFile } from 'node:fs/promises';
import { BELTS, halves } from '@yard/engine';
import { ACADEMY_VISUALS, FRENCH_GUIDE_CROSS, GAME_GUIDES, scenarioFor } from './academycontent.ts';

test('every Academy lesson has teaching copy and a generated diagram', async () => {
  for (const lesson of BELTS.flatMap((belt) => belt.lessons)) {
    const visual = ACADEMY_VISUALS[lesson.id];
    assert.ok(visual, `${lesson.id} is missing visual teaching copy`);
    assert.ok(visual.alt.length > 20, `${lesson.id} needs meaningful alt text`);
    await access(new URL(`../public/art/boards/${lesson.id}.svg`, import.meta.url));
  }
});

test('every declared drill is visible, answerable and has exactly one correct choice', () => {
  for (const drill of BELTS.flatMap((belt) => belt.drills)) {
    const scenario = scenarioFor(drill);
    assert.ok(scenario.setup.length > 0, `${drill.id} needs a table position`);
    assert.ok(scenario.visual.label.length > 0, `${drill.id} needs a visual situation label`);
    assert.ok(scenario.visual.facts.length > 0, `${drill.id} needs visible public facts`);
    assert.ok(scenario.visual.line?.length || scenario.visual.hand?.length,
      `${drill.id} needs visible dominoes, not a text-only drill`);
    for (const tile of [...(scenario.visual.line ?? []), ...(scenario.visual.hand ?? [])]) {
      const [low, high] = halves(tile);
      assert.ok(low <= high, `${drill.id} must use canonical low-high tile ids: ${tile}`);
    }
    const line = scenario.visual.line ?? [];
    for (let index = 1; index < line.length; index++) {
      const previous = halves(line[index - 1]);
      const next = halves(line[index]);
      assert.ok(previous.some((pip) => next.includes(pip)),
        `${drill.id} visual line has a disconnected join at ${line[index - 1]} → ${line[index]}`);
    }
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

test('teaching lines are generated only after their domino joins are validated', async () => {
  for (const lessonId of ['B1L3', 'B2L5', 'B4L4', 'B4L5', 'B4L7', 'B5L2']) {
    const svg = await readFile(new URL(`../public/art/boards/${lessonId}.svg`, import.meta.url), 'utf8');
    assert.match(svg, /data-connected-line="true"/, `${lessonId} must be a validated legal line`);
  }
});

test('privacy diagram shows seven faces for you and seven backs for every opponent', async () => {
  const svg = await readFile(new URL('../public/art/boards/B1L4.svg', import.meta.url), 'utf8');
  assert.match(svg, /data-face-count="7"/);
  assert.equal((svg.match(/data-back-count="7"/g) ?? []).length, 3);
  assert.match(svg, /Your seven tile faces are visible/);
});

test('the five reported Table General visuals keep their dominoes aligned with the teaching facts', async () => {
  const elimination = await readFile(new URL('../public/art/boards/B5L1.svg', import.meta.url), 'utf8');
  assert.equal((elimination.match(/ opacity="[\d.]+"><g transform="rotate/g) ?? []).length, 3,
    'B5L1 must show exactly its three named candidates');
  for (const label of ['2-5 ✕', '3-5 ✓', '4-6 ✕']) assert.match(elimination, new RegExp(label));

  const playerRead = await readFile(new URL('../public/art/boards/B5L4.svg', import.meta.url), 'utf8');
  assert.match(playerRead, /HEAVY FIRST/);
  assert.match(playerRead, /CONTROL FIRST/);
  assert.equal((playerRead.match(/ opacity="[\d.]+"><g transform="rotate/g) ?? []).length, 6,
    'B5L4 must show the same three tiles in two separate histories');

  const tempo = await readFile(new URL('../public/art/boards/B5L5.svg', import.meta.url), 'utf8');
  assert.match(tempo, /data-connected-line="true"/);
  assert.match(tempo, /EVEN · 3.5  3.5  3.5/);
  assert.match(tempo, /TELL · 3.5  3.5  10.0/);

  const safePlay = scenarioFor(BELTS[4].drills.find((drill) => drill.id === 'B5D1')!);
  assert.deepEqual(safePlay.visual.hand, ['5-5', '0-5']);
  assert.deepEqual(safePlay.choices.map((choice) => choice.label), ['5-5', '0-5']);

  const narrowHand = scenarioFor(BELTS[4].drills.find((drill) => drill.id === 'B5D2')!);
  assert.deepEqual(narrowHand.visual.hand, ['2-5', '3-5', '4-6']);
  assert.equal(narrowHand.visual.handLabel, 'Unseen candidates');
});
