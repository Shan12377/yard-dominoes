import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankTier, trustLevel, movePace } from './ranktier.ts';

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

test('move pace reads as character, not a score', () => {
  // Real figures from production: the QA account averages 3.8s, the owner 11s.
  assert.equal(movePace(3853), '3.9s · quick hand');
  assert.equal(movePace(11068), '11s · steady');
  assert.equal(movePace(14850), '15s · takes their time');
  // The boundaries themselves, so a tidy-up cannot move them unnoticed.
  assert.equal(movePace(4999), '5.0s · quick hand');
  assert.equal(movePace(5000), '5.0s · steady');
  assert.equal(movePace(11999), '12s · steady');
  assert.equal(movePace(12000), '12s · takes their time');
});
