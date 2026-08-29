import test from 'node:test';
import assert from 'node:assert/strict';
import { WALKTHROUGH_MUSIC_SECONDS, WALKTHROUGH_SKANK_BEATS } from './walkthrough-music.ts';

test('walkthrough music is brief and puts every chord on the offbeat', () => {
  assert.ok(WALKTHROUGH_MUSIC_SECONDS >= 5 && WALKTHROUGH_MUSIC_SECONDS <= 8);
  assert.ok(WALKTHROUGH_SKANK_BEATS.length >= 8);
  for (const beat of WALKTHROUGH_SKANK_BEATS) assert.equal(beat % 1, 0.5);
});
