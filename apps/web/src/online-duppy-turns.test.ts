import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const start = read('supabase/functions/start-hand/index.ts');
const play = read('supabase/functions/play-move/index.ts');
const expire = read('supabase/functions/expire-turns/index.ts');
const advance = read('supabase/functions/advance-duppy/index.ts');
const client = read('apps/web/src/onlinetable.ts');

test('online Duppies take one visible, server-authoritative turn at a time', () => {
  assert.match(start, /DUPPY_THINK_SECONDS/);
  assert.match(play, /DUPPY_THINK_SECONDS/);
  assert.doesNotMatch(start, /while \(state\.status === 'active' && seats!\[state\.turn\]\.duppy_level/);
  assert.doesNotMatch(play, /while \(state\.status === 'active' && seats!\[state\.turn\]\.duppy_level/);
  assert.match(advance, /requireUser\(req\)/);
  assert.match(advance, /const \{ handId \} = await req\.json\(\)/);
  assert.match(advance, /duppyMove\(state, actor\.duppy_level\)/);
  assert.doesNotMatch(advance, /const\s*\{[^}]*\b(tile|end|move)\b[^}]*\}\s*=\s*await req\.json/i);
  assert.match(client, /apiAdvanceDuppy\(handId\)/);
  assert.match(client, /DuppyTurnConflictError/);
});

test('cron preserves Duppy difficulty and skips normal client races', () => {
  assert.match(expire, /duppyMove\(state, seats!\[timedOut\]\.duppy_level \?\? 'yard'\)/);
  assert.match(expire, /if \(err instanceof Conflict\) continue/);
});
