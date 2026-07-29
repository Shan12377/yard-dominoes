import test from 'node:test';
import assert from 'node:assert/strict';
import { NAME_TTL_MS, staleUserIds } from './name-cache.ts';

test('a never-seen seated user is due for a fetch', () => {
  assert.deepEqual(staleUserIds(['a'], new Map(), 1000), ['a']);
});

test('a freshly-fetched name is not due again', () => {
  const names = new Map([['a', { fetchedAt: 1000 }]]);
  assert.deepEqual(staleUserIds(['a'], names, 1000 + NAME_TTL_MS - 1), []);
});

test('a name past the TTL is due again — this is what lets a mid-game '
  + 'profile edit ever reach a screen that opened before it happened', () => {
  const names = new Map([['a', { fetchedAt: 1000 }]]);
  assert.deepEqual(staleUserIds(['a'], names, 1000 + NAME_TTL_MS + 1), ['a']);
});

test('empty seats never ask the database for a null user', () => {
  assert.deepEqual(staleUserIds([null, null], new Map(), 1000), []);
});

test('the same user in two seats is asked for once, not twice', () => {
  assert.deepEqual(staleUserIds(['a', 'a'], new Map(), 1000), ['a']);
});

test('a mixed table only refetches the ones that actually need it', () => {
  const now = 1000 + NAME_TTL_MS + 1;
  const names = new Map([
    ['fresh', { fetchedAt: now - 1000 }],       // just fetched
    ['stale', { fetchedAt: now - NAME_TTL_MS - 1 }], // past the TTL
  ]);
  const due = staleUserIds(['fresh', 'stale', 'new', null], names, now);
  assert.deepEqual(new Set(due), new Set(['stale', 'new']));
});
