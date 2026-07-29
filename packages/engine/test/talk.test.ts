import test from 'node:test';
import assert from 'node:assert/strict';
import { DUPPY_LEVELS, duppyLine, TALK_CHANCE } from '../src/index.ts';
import type { TalkTrigger } from '../src/index.ts';

const TRIGGERS: TalkTrigger[] = [
  'pose', 'slam', 'theyPass', 'iPass', 'lastTile',
  'win', 'winCount', 'lose', 'sixLove', 'sixLoveAgainst', 'bruk',
];

test('every duppy has something to say at every trigger', () => {
  for (const level of DUPPY_LEVELS) {
    for (const trigger of TRIGGERS) {
      const line = duppyLine(level, trigger, 0);
      assert.ok(line, `${level} has no line for ${trigger}`);
      assert.notEqual(line!.trim(), '', `${level}/${trigger} is blank`);
    }
  }
});

test('a roll anywhere in range picks a real line, never off the end', () => {
  // Math.floor(roll * length) lands on `length` itself at roll = 1, which
  // would return undefined and render "undefined" at the table.
  for (const level of DUPPY_LEVELS) {
    for (const trigger of TRIGGERS) {
      for (const roll of [0, 0.25, 0.5, 0.75, 0.999999, 1]) {
        const line = duppyLine(level, trigger, roll);
        assert.ok(typeof line === 'string' && line.length > 0,
          `${level}/${trigger} at roll ${roll} gave ${line}`);
      }
    }
  }
});

test('chance keeps duppies quiet without ever emitting an empty line', () => {
  for (const level of DUPPY_LEVELS) {
    const chance = TALK_CHANCE[level];
    let spoke = 0;
    for (let i = 0; i < 1000; i++) {
      const line = duppyLine(level, 'theyPass', i / 1000, chance);
      if (line !== null) {
        spoke++;
        assert.notEqual(line.trim(), '');
      }
    }
    const rate = spoke / 1000;
    assert.ok(Math.abs(rate - chance) < 0.05,
      `${level} spoke ${rate} of the time, expected about ${chance}`);
  }
});

test('a quieter duppy really does say less', () => {
  assert.ok(TALK_CHANCE.don < TALK_CHANCE.pickney);
});
