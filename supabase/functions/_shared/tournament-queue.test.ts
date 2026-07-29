import test from 'node:test';
import assert from 'node:assert/strict';
import { drawCutLine, queueOrder, queueRank } from './tournament-queue.ts';

const NOW = Date.parse('2026-08-02T12:00:00Z');
const LATER = '2026-09-01T00:00:00Z';
const EARLIER = '2026-07-01T00:00:00Z';

const at = (userId: string, tier: string, signedUpAt: string, tierExpiresAt: string | null = LATER) =>
  ({ userId, tier, tierExpiresAt, signedUpAt });

const ids = (entries: { userId: string }[]) => entries.map((e) => e.userId);

// -------------------------------------------------------------- the pitch ---
test('a VIP who signed up at 4:30 is seated ahead of a guest who signed up at '
  + '9am — this is the whole VIP pitch, not a tiebreak', () => {
  const ordered = queueOrder([
    at('early-guest', 'guest', '2026-08-02T09:00:00Z', null),
    at('late-vip', 'vip', '2026-08-02T16:30:00Z'),
  ], NOW);
  assert.deepEqual(ids(ordered), ['late-vip', 'early-guest']);
});

test('yardie sits between vip and guest — it is a PAID tier and must not rank '
  + 'level with a free account', () => {
  const ordered = queueOrder([
    at('g', 'guest', '2026-08-02T09:00:00Z', null),
    at('v', 'vip', '2026-08-02T09:00:00Z'),
    at('y', 'yardie', '2026-08-02T09:00:00Z'),
  ], NOW);
  assert.deepEqual(ids(ordered), ['v', 'y', 'g']);
});

test('an expired VIP does not jump — this is the only place in the app that '
  + 'could let a lapsed membership still buy something', () => {
  const ordered = queueOrder([
    at('lapsed-vip', 'vip', '2026-08-02T16:00:00Z', EARLIER),
    at('guest', 'guest', '2026-08-02T09:00:00Z', null),
  ], NOW);
  assert.deepEqual(ids(ordered), ['guest', 'lapsed-vip']);
});

test('an expired yardie drops to guest too, not to some middle band', () => {
  assert.equal(queueRank('yardie', EARLIER, NOW), queueRank('guest', null, NOW));
});

test('a membership with no expiry is live forever', () => {
  assert.equal(queueRank('vip', null, NOW), 2);
});

test('tier is read now, not snapshotted at signup: a guest who upgrades before '
  + 'seating jumps, which is exactly when the upgrade sells itself', () => {
  const signup = at('upgrader', 'guest', '2026-08-02T09:00:00Z', null);
  const rival = at('vip-rival', 'guest', '2026-08-02T08:00:00Z', null);
  assert.deepEqual(ids(queueOrder([signup, rival], NOW)), ['vip-rival', 'upgrader']);

  // Same signup row, same timestamp. Only the profile changed.
  const upgraded = { ...signup, tier: 'vip', tierExpiresAt: LATER };
  assert.deepEqual(ids(queueOrder([upgraded, rival], NOW)), ['upgrader', 'vip-rival']);
});

// --------------------------------------------------------------- ordering ---
test('inside one band, first signed up is first seated', () => {
  const ordered = queueOrder([
    at('b', 'guest', '2026-08-02T10:00:00Z', null),
    at('a', 'guest', '2026-08-02T09:00:00Z', null),
  ], NOW);
  assert.deepEqual(ids(ordered), ['a', 'b']);
});

test('two VIPs on the same timestamp order the same way every run, so a '
  + 'retried seeding deals the same bracket instead of reshuffling it', () => {
  const same = '2026-08-02T09:00:00Z';
  const first = queueOrder([at('b', 'vip', same), at('a', 'vip', same)], NOW);
  const again = queueOrder([at('a', 'vip', same), at('b', 'vip', same)], NOW);
  assert.deepEqual(ids(first), ['a', 'b']);
  assert.deepEqual(ids(again), ['a', 'b']);
});

test('ordering does not mutate the caller\'s array', () => {
  const entries = [at('b', 'guest', '2026-08-02T10:00:00Z', null), at('a', 'vip', '2026-08-02T11:00:00Z')];
  queueOrder(entries, NOW);
  assert.deepEqual(ids(entries), ['b', 'a']);
});

test('an unknown tier string is treated as a guest rather than out-ranking a VIP', () => {
  assert.equal(queueRank('admin', LATER, NOW), queueRank('guest', null, NOW));
});

// -------------------------------------------------------------- the line ----
test('an exact multiple seats everyone and leaves no substitutes', () => {
  const draw = drawCutLine(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 4);
  assert.deepEqual(draw.tables, [['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h']]);
  assert.deepEqual(draw.substitutes, []);
});

test('the overflow becomes substitutes, not duppy seats — a tournament where a '
  + 'bot knocks out a human is not a tournament', () => {
  const draw = drawCutLine(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], 4);
  assert.deepEqual(draw.tables, [['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h']]);
  assert.deepEqual(draw.substitutes, ['i'], 'the ninth player waits, and is first in if someone drops');
});

test('#N+1 is a substitute, not a reject — the ordering that seats also runs '
  + 'the substitutes line, which is already sold as a VIP benefit', () => {
  const draw = drawCutLine(['a', 'b', 'c', 'd', 'e', 'f'], 4);
  assert.deepEqual(draw.tables, [['a', 'b', 'c', 'd']]);
  assert.deepEqual(draw.substitutes, ['e', 'f'], 'still in queue order');
});

test('fewer people than one full table is not a small tournament, it is no '
  + 'tournament — partner mode needs exactly four seats', () => {
  const draw = drawCutLine(['a', 'b', 'c'], 4);
  assert.deepEqual(draw.tables, []);
  assert.deepEqual(draw.substitutes, ['a', 'b', 'c']);
});

test('nobody signed up', () => {
  assert.deepEqual(drawCutLine([], 4), { tables: [], substitutes: [] });
});

test('a nonsense seat count seats nobody rather than looping forever', () => {
  assert.deepEqual(drawCutLine(['a', 'b'], 1), { tables: [], substitutes: ['a', 'b'] });
});

test('every table is full and nobody is lost, across every turnout up to 40', () => {
  for (let n = 0; n <= 40; n++) {
    const queue = Array.from({ length: n }, (_, i) => `p${i}`);
    const { tables, substitutes } = drawCutLine(queue, 4);
    assert.ok(tables.every((t) => t.length === 4), `n=${n} produced a table that was not full`);
    assert.ok(substitutes.length < 4, `n=${n} left a full table's worth of people sitting out`);
    assert.deepEqual([...tables.flat(), ...substitutes], queue, `n=${n} lost or reordered somebody`);
  }
});

test('the whole pipeline: VIPs take the last seats at the only table, and the '
  + 'guest who signed up first thing in the morning is the substitute', () => {
  const entries = [
    at('guest-dawn', 'guest', '2026-08-02T06:00:00Z', null),
    at('guest-noon', 'guest', '2026-08-02T12:00:00Z', null),
    at('yardie', 'yardie', '2026-08-02T15:00:00Z'),
    at('vip-late', 'vip', '2026-08-02T16:30:00Z'),
    at('vip-later', 'vip', '2026-08-02T16:45:00Z'),
  ];
  const draw = drawCutLine(ids(queueOrder(entries, NOW)), 4);
  assert.deepEqual(draw.tables, [['vip-late', 'vip-later', 'yardie', 'guest-dawn']]);
  assert.deepEqual(draw.substitutes, ['guest-noon']);
});
