import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DUPPY_PACE_NAMES, duppyThinkSeconds } from '@yard/engine';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const start = read('supabase/functions/start-hand/index.ts');
const play = read('supabase/functions/play-move/index.ts');
const expire = read('supabase/functions/expire-turns/index.ts');
const advance = read('supabase/functions/advance-duppy/index.ts');
const create = read('supabase/functions/create-table/index.ts');
const client = read('apps/web/src/onlinetable.ts');
const view = read('apps/web/src/onlinetableview.ts');
const clock = read('packages/engine/src/clock.ts');

test('online Duppies take one visible, server-authoritative turn at a time', () => {
  // What matters here is that every pace is a real, visible beat — not the
  // specific durations, which are tuning and live under test in the engine's
  // own clock.test.ts. Pinning the literal numbers in this file's source
  // text only meant a tuning change broke an unrelated wiring test.
  for (const pace of DUPPY_PACE_NAMES) {
    const seconds = duppyThinkSeconds(pace);
    assert.ok(seconds > 0, `${pace} must give the table a visible beat, not move instantly`);
    assert.ok(seconds <= 60, `${pace} must not let a Duppy hold the table hostage`);
  }
  assert.match(clock, /DUPPY_PACE_SECONDS: Record<DuppyPace, number>/);
  assert.match(create, /duppy_pace: duppyPaceByName\(body\.duppyPace\)/);
  assert.match(start, /duppyThinkSeconds\(table\.duppy_pace\)/);
  assert.match(play, /duppyThinkSeconds\(table!\.duppy_pace\)/);
  assert.match(advance, /duppyThinkSeconds\(table!\.duppy_pace\)/);
  assert.doesNotMatch(start, /while \(state\.status === 'active' && seats!\[state\.turn\]\.duppy_level/);
  assert.doesNotMatch(play, /while \(state\.status === 'active' && seats!\[state\.turn\]\.duppy_level/);
  assert.match(advance, /requireUser\(req\)/);
  assert.match(advance, /const \{ handId \} = await req\.json\(\)/);
  assert.match(advance, /duppyMove\(state, actor\.duppy_level\)/);
  assert.doesNotMatch(advance, /const\s*\{[^}]*\b(tile|end|move)\b[^}]*\}\s*=\s*await req\.json/i);
  assert.match(client, /apiAdvanceDuppy\(handId\)/);
  assert.match(client, /DuppyTurnConflictError/);
  assert.match(client, /duppyPace: duppyPaceByName\(t\.duppy_pace\)/);
  assert.match(view, /DUPPY_PACE_NAMES/);
  assert.match(view, /duppyPace: duppyPace\.value as DuppyPace/);
  assert.match(view, /duppyThinkSeconds\(game\.table\.duppyPace\)/);
});

test('cron preserves Duppy difficulty and skips normal client races', () => {
  assert.match(expire, /duppyMove\(state, seats!\[timedOut\]\.duppy_level \?\? 'yard'\)/);
  assert.match(expire, /if \(err instanceof Conflict\) continue/);
});
