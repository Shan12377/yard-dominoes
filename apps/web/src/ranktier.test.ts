import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankTier, trustLevel } from './ranktier.ts';

test('rank tiers follow the Yard Rating bands', () => {
  assert.equal(rankTier(1000).name, 'Benchwarmer');
  assert.equal(rankTier(1199).name, 'Benchwarmer');
  assert.equal(rankTier(1200).name, 'Corner Regular');
  assert.equal(rankTier(1399).badge, 'Silver');
  assert.equal(rankTier(1400).name, 'Table Boss');
  assert.equal(rankTier(1600).name, 'Domino Don');
  assert.equal(rankTier(1800).name, 'Yaad Legend');
  assert.equal(rankTier(2400).badge, 'Diamond');
});

test('Table Trust levels', () => {
  assert.equal(trustLevel(100).label, 'Respect Due');
  assert.equal(trustLevel(90).label, 'Respect Due');
  assert.equal(trustLevel(89).label, 'On Watch');
  assert.equal(trustLevel(75).label, 'On Watch');
  assert.equal(trustLevel(74).label, 'Rough Play');
});
