import test from 'node:test';
import assert from 'node:assert/strict';
import { canSpeak, diffRoster, isPolite, MAX_VOICE_PEERS, newestPresence } from './voice.ts';

test('exactly one peer in every pair is polite', () => {
  const ids = ['a', 'b', 'zz', '0', 'f47ac10b', 'f47ac10c'];
  for (const me of ids) {
    for (const them of ids) {
      if (me === them) continue;
      assert.notEqual(isPolite(me, them), isPolite(them, me),
        `${me} and ${them} must disagree about who yields`);
    }
  }
});

test('guests listen, members talk', () => {
  assert.equal(canSpeak('guest'), false);
  assert.equal(canSpeak('yardie'), true);
  assert.equal(canSpeak('vip'), true);
});

test('diffRoster opens and closes each peer exactly once', () => {
  const me = 'me';
  const known = new Set<string>();

  let d = diffRoster(known, ['me', 'a', 'b'], me);
  assert.deepEqual(d.added.sort(), ['a', 'b']);
  assert.deepEqual(d.removed, []);
  for (const id of d.added) known.add(id);

  // A presence sync that repeats the same roster must do nothing.
  d = diffRoster(known, ['me', 'a', 'b'], me);
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.removed, []);

  d = diffRoster(known, ['me', 'b', 'c'], me);
  assert.deepEqual(d.added, ['c']);
  assert.deepEqual(d.removed, ['a']);
});

test('diffRoster never connects a peer to itself', () => {
  const d = diffRoster([], ['me'], 'me');
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.removed, []);
});

test('an empty roster drops everyone', () => {
  const d = diffRoster(['a', 'b'], [], 'me');
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.removed.sort(), ['a', 'b']);
});

test('the mesh is capped, and every client picks the same peers', () => {
  const room = Array.from({ length: MAX_VOICE_PEERS + 4 }, (_, i) => `p${i}`);

  const mine = diffRoster([], room, 'me');
  assert.equal(mine.added.length, MAX_VOICE_PEERS);
  assert.equal(mine.full, true);

  // Two clients seeing the same room in a different order must choose the
  // same peers, or each half-connects to a different subset.
  const shuffled = [...room].reverse();
  const theirs = diffRoster([], shuffled, 'me');
  assert.deepEqual(theirs.added.sort(), mine.added.sort());
});

test('a room within the cap is not reported full', () => {
  const room = Array.from({ length: MAX_VOICE_PEERS }, (_, i) => `p${i}`);
  const d = diffRoster([], room, 'me');
  assert.equal(d.full, false);
  assert.equal(d.added.length, MAX_VOICE_PEERS);
});

test('someone who leaves voice is dropped even while still in the lounge', () => {
  // The roster passed in is voice participants only; a reader simply is not
  // in it, so the mesh must hang up rather than hold a dead connection.
  const d = diffRoster(['a', 'b'], ['a'], 'me');
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.removed, ['b']);
});

test('presence reads the newest meta, not the one from before the mic went on', () => {
  // Realtime appends a meta per track() rather than replacing, so a person who
  // joined the room and THEN joined voice has two entries. Reading the first
  // reports voice:false forever, which silently disables the whole mesh —
  // every peer shows "Listening" and nobody is ever dialled. This exact bug
  // shipped, and only two real clients surfaced it.
  const state = {
    ada: [
      { user_id: 'ada', voice: false },
      { user_id: 'ada', voice: true },
    ],
    ken: [{ user_id: 'ken', voice: false }],
  };

  const roster = newestPresence(state);
  assert.deepEqual(roster, [
    { user_id: 'ada', voice: true },
    { user_id: 'ken', voice: false },
  ]);

  // The payoff: the person who picked up the mic is dialled.
  assert.deepEqual(
    diffRoster([], roster.filter((p) => p.voice).map((p) => p.user_id), 'me'),
    { added: ['ada'], removed: [], full: false });
});

test('presence tolerates a key with no metas', () => {
  // A person mid-disconnect can leave an empty array behind; mapping it blind
  // puts `undefined` in the roster and every read of it throws inside render.
  assert.deepEqual(newestPresence({ gone: [], here: [{ user_id: 'here' }] }),
    [{ user_id: 'here' }]);
});
