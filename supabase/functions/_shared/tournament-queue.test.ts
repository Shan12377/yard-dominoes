import test from 'node:test';
import assert from 'node:assert/strict';
import { drawCutLine, drawForTheme, queueOrder, queueRank } from './tournament-queue.ts';

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

// ---------------------------------------------------------------- themes --
//
// A theme decides who sits with whom. It must never quietly cost somebody the
// place in line they paid for, so every case below also checks the leftovers
// are still in queue order.

const entry = (userId: string, gender: string | null, signedUpAt = '2026-01-01T09:00:00Z') => ({
  userId, gender, tier: 'guest', tierExpiresAt: null, signedUpAt,
});

test('an open event ignores gender entirely and just cuts the queue', () => {
  const ordered = [entry('a', null), entry('b', null), entry('c', 'f'), entry('d', 'm')];
  const draw = drawForTheme(ordered, 4, 'open');
  assert.deepEqual(draw.tables, [['a', 'b', 'c', 'd']]);
  assert.deepEqual(draw.substitutes, []);
});

test('battle of the sexes seats women against men, never alongside', () => {
  const ordered = [
    entry('w1', 'f'), entry('m1', 'm'), entry('w2', 'f'), entry('m2', 'm'),
  ];
  const draw = drawForTheme(ordered, 4, 'battle_of_the_sexes');
  assert.equal(draw.tables.length, 1);
  const [table] = draw.tables;
  // Partner sides are 0&2 against 1&3, so this seating IS the two sides.
  assert.deepEqual([table[0], table[2]], ['w1', 'w2'], 'women hold seats 0 and 2');
  assert.deepEqual([table[1], table[3]], ['m1', 'm2'], 'men hold seats 1 and 3');
});

test('the shorter side caps the tables, and the surplus waits in queue order', () => {
  // Six women, two men: one table only, and the four unseated women keep
  // their places in line rather than being shuffled.
  const ordered = [
    entry('w1', 'f'), entry('w2', 'f'), entry('w3', 'f'),
    entry('m1', 'm'), entry('w4', 'f'), entry('w5', 'f'),
    entry('m2', 'm'), entry('w6', 'f'),
  ];
  const draw = drawForTheme(ordered, 4, 'battle_of_the_sexes');
  assert.equal(draw.tables.length, 1);
  assert.deepEqual(draw.tables[0], ['w1', 'm1', 'w2', 'm2']);
  assert.deepEqual(draw.substitutes, ['w3', 'w4', 'w5', 'w6'],
    'the surplus stays in queue order — the VIP promise survives the theme');
});

test('a VIP still outranks a guest of the same side after the theme draws', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  const ordered = queueOrder([
    { userId: 'guestW', gender: 'f', tier: 'guest', tierExpiresAt: null, signedUpAt: '2026-01-01T09:00:00Z' },
    { userId: 'vipW', gender: 'f', tier: 'vip', tierExpiresAt: '2027-01-01T00:00:00Z', signedUpAt: '2026-01-01T11:00:00Z' },
    { userId: 'm1', gender: 'm', tier: 'guest', tierExpiresAt: null, signedUpAt: '2026-01-01T09:00:00Z' },
    { userId: 'm2', gender: 'm', tier: 'guest', tierExpiresAt: null, signedUpAt: '2026-01-01T09:05:00Z' },
    { userId: 'm3', gender: 'm', tier: 'guest', tierExpiresAt: null, signedUpAt: '2026-01-01T09:10:00Z' },
  ], now);
  const draw = drawForTheme(ordered, 4, 'battle_of_the_sexes');
  // Only two women, so one table; the late-signing VIP woman takes seat 0
  // ahead of the guest who signed up at 9am.
  assert.equal(draw.tables[0][0], 'vipW');
  assert.equal(draw.tables[0][2], 'guestW');
});

test('nobody without a recorded gender is seated into a side', () => {
  const ordered = [
    entry('w1', 'f'), entry('w2', 'f'), entry('m1', 'm'), entry('unknown', null), entry('m2', 'm'),
  ];
  const draw = drawForTheme(ordered, 4, 'battle_of_the_sexes');
  assert.deepEqual(draw.tables, [['w1', 'm1', 'w2', 'm2']]);
  assert.deepEqual(draw.substitutes, ['unknown']);
});

test('battle of the sexes seats nobody at a table that is not four-handed', () => {
  // It IS two against two. Three seats would be a 2-vs-1, which is not the
  // event — better to seat nobody than to invent a lopsided side.
  const ordered = [entry('w1', 'f'), entry('m1', 'm'), entry('w2', 'f')];
  const draw = drawForTheme(ordered, 3, 'battle_of_the_sexes');
  assert.deepEqual(draw.tables, []);
  assert.deepEqual(draw.substitutes, ['w1', 'm1', 'w2']);
});

test('one side short of a pair means no table at all', () => {
  const ordered = [entry('w1', 'f'), entry('w2', 'f'), entry('m1', 'm')];
  const draw = drawForTheme(ordered, 4, 'battle_of_the_sexes');
  assert.deepEqual(draw.tables, []);
  assert.deepEqual(draw.substitutes, ['w1', 'w2', 'm1']);
});

// --------------------------------------------------------------- couples --

const couple = (
  userId: string, partnerUserId: string | null, signedUpAt = '2026-01-01T09:00:00Z', tier = 'guest',
) => ({
  userId, partnerUserId, tier, tierExpiresAt: tier === 'guest' ? null : '2027-01-01T00:00:00Z',
  signedUpAt, gender: null,
});

test('two couples make a table, partners opposite each other', () => {
  const ordered = [
    couple('a1', 'a2'), couple('a2', 'a1'), couple('b1', 'b2'), couple('b2', 'b1'),
  ];
  const draw = drawForTheme(ordered, 4, 'couples');
  assert.equal(draw.tables.length, 1);
  const [t] = draw.tables;
  assert.deepEqual([t[0], t[2]], ['a1', 'a2'], 'the first couple holds seats 0 and 2');
  assert.deepEqual([t[1], t[3]], ['b1', 'b2'], 'the second holds 1 and 3');
  assert.deepEqual(draw.substitutes, []);
});

test('a claim nobody confirmed is not a couple', () => {
  // a1 names a2, but a2 named somebody else entirely. Seating on a one-sided
  // claim would put a stranger in a partner seat on the strength of a typed
  // username.
  const ordered = [
    couple('a1', 'a2'), couple('a2', 'zz'), couple('b1', 'b2'), couple('b2', 'b1'),
  ];
  const draw = drawForTheme(ordered, 4, 'couples');
  assert.deepEqual(draw.tables, [], 'one confirmed couple is not two, so no table');
  assert.deepEqual(draw.substitutes, ['a1', 'a2', 'b1', 'b2']);
});

test('naming somebody who never entered leaves you unpaired', () => {
  const ordered = [
    couple('a1', 'ghost'), couple('b1', 'b2'), couple('b2', 'b1'),
    couple('c1', 'c2'), couple('c2', 'c1'),
  ];
  const draw = drawForTheme(ordered, 4, 'couples');
  assert.equal(draw.tables.length, 1);
  assert.deepEqual(draw.tables[0], ['b1', 'c1', 'b2', 'c2']);
  assert.deepEqual(draw.substitutes, ['a1'], 'the unpaired entrant waits, in queue order');
});

test('entering alone in a couples event seats nobody', () => {
  const ordered = [couple('a', null), couple('b', null), couple('c', null), couple('d', null)];
  const draw = drawForTheme(ordered, 4, 'couples');
  assert.deepEqual(draw.tables, []);
  assert.deepEqual(draw.substitutes, ['a', 'b', 'c', 'd']);
});

test('an odd couple out waits as a pair, in queue order', () => {
  const ordered = [
    couple('a1', 'a2'), couple('a2', 'a1'),
    couple('b1', 'b2'), couple('b2', 'b1'),
    couple('c1', 'c2'), couple('c2', 'c1'),
  ];
  const draw = drawForTheme(ordered, 4, 'couples');
  assert.equal(draw.tables.length, 1);
  assert.deepEqual(draw.substitutes, ['c1', 'c2'], 'the third couple waits together');
});

test('a VIP brings their partner up the line, because a couple is one entry', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  const ordered = queueOrder([
    couple('g1', 'g2', '2026-01-01T09:00:00Z'),
    couple('g2', 'g1', '2026-01-01T09:00:00Z'),
    couple('h1', 'h2', '2026-01-01T09:01:00Z'),
    couple('h2', 'h1', '2026-01-01T09:01:00Z'),
    // Signed up last, but VIP — and their guest partner comes with them.
    couple('vip', 'spouse', '2026-01-01T11:00:00Z', 'vip'),
    couple('spouse', 'vip', '2026-01-01T11:00:00Z'),
  ], now);
  const draw = drawForTheme(ordered, 4, 'couples');
  assert.equal(draw.tables.length, 1);
  assert.ok(draw.tables[0].includes('vip'));
  assert.ok(draw.tables[0].includes('spouse'),
    'the VIP cannot be seated without the partner they entered with');
});
