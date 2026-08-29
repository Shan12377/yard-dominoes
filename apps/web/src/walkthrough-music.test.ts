import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WALKTHROUGH_MUSIC_REPEATS,
  WALKTHROUGH_MUSIC_SECONDS,
  WALKTHROUGH_SKANK_BEATS,
} from './walkthrough-music.ts';
const source = readFileSync(new URL('./walkthrough-music.ts', import.meta.url), 'utf8');

test('walkthrough music repeats a brief phrase with every chord on the offbeat', () => {
  assert.equal(WALKTHROUGH_MUSIC_REPEATS, true);
  assert.ok(WALKTHROUGH_MUSIC_SECONDS >= 5 && WALKTHROUGH_MUSIC_SECONDS <= 8);
  assert.ok(WALKTHROUGH_SKANK_BEATS.length >= 8);
  for (const beat of WALKTHROUGH_SKANK_BEATS) assert.equal(beat % 1, 0.5);
  assert.match(source,
    /setTimeout\([\s\S]*?scheduleLoop\(ctx, master, start \+ WALKTHROUGH_MUSIC_SECONDS\)/);
});
