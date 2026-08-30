import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  WALKTHROUGH_MUSIC_REPEATS,
  WALKTHROUGH_MUSIC_URL,
  WALKTHROUGH_MUSIC_VOLUME,
} from './walkthrough-music.ts';

const source = readFileSync(new URL('./walkthrough-music.ts', import.meta.url), 'utf8');
const publicTrack = new URL(`../public${WALKTHROUGH_MUSIC_URL}`, import.meta.url);

test('the tour uses the selected reggae track as a quiet, repeating background bed', () => {
  assert.equal(WALKTHROUGH_MUSIC_URL, '/audio/tour-riddim.m4a');
  assert.equal(WALKTHROUGH_MUSIC_REPEATS, true);
  assert.ok(WALKTHROUGH_MUSIC_VOLUME > 0 && WALKTHROUGH_MUSIC_VOLUME <= 0.2);
  assert.equal(existsSync(publicTrack), true);
  assert.match(source, /new Audio\(WALKTHROUGH_MUSIC_URL\)/);
  assert.match(source, /audio\.loop = WALKTHROUGH_MUSIC_REPEATS/);
  assert.match(source, /audio\.play\(\)/);
});

test('stopping the tour pauses and rewinds its music', () => {
  assert.match(source, /active\.pause\(\)/);
  assert.match(source, /active\.currentTime = 0/);
});
