import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('every selectable portrait and wearable has a local asset and accessible label', () => {
  // `lounges.ts` depends on Vite's import.meta.env, so this source contract
  // stays executable in the dependency-free Node test runner too.
  const source = readFileSync(resolve(import.meta.dirname, 'lounges.ts'), 'utf8');
  const portraits = [
    'hoops', 'plain', 'granny', 'tam', 'wrap', 'straw', 'phones', 'afro',
    'braids', 'cap', 'twists', 'goldtooth', 'marigold', 'cedar', 'sonia',
    'devon', 'otis', 'nadia', 'kyro', 'levi', 'harold', 'mei', 'imani', 'tariq',
    'gideon', 'anika', 'kai',
    'malcolm', 'renee', 'nia',
  ];
  const wearables = [
    'shades', 'crown', 'flower', 'headphones', 'flagpin', 'canadapin', 'ukpin',
    'bandana', 'beanie', 'necklace',
    'poinsettia', 'emancipendence', 'goldbone',
  ];
  const backgrounds = [
    'midday', 'evening', 'rain', 'beach', 'shop', 'grandmarket', 'emancipendence',
  ];

  assert.equal(portraits.length, 30);
  assert.equal(wearables.length, 13);
  assert.equal(backgrounds.length, 7);

  for (const avatar of portraits) {
    assert.match(source, new RegExp(`${avatar}: '\\w`));
    assert.ok(existsSync(resolve(import.meta.dirname, '../public/avatars', `${avatar}.webp`)));
  }

  for (const accessory of wearables) {
    assert.match(source, new RegExp(`${accessory}: '\\w`));
    assert.ok(existsSync(resolve(import.meta.dirname, '../public/accessories', `${accessory}.svg`)));
  }

  for (const background of backgrounds) {
    assert.match(source, new RegExp(`${background}: '\\w`));
    assert.ok(existsSync(resolve(import.meta.dirname, '../public/backgrounds', `${background}.webp`)));
  }
});
