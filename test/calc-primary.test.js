import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calcPrimary, runOptimizer, DEFAULT_BONUS_CONSTANTS } from '../js/kch-model.js';

function loadJSON(relUrl) {
  return JSON.parse(fs.readFileSync(new URL(relUrl, import.meta.url), 'utf8'));
}

const catalog = loadJSON('../data/secondary-loot.json').items;
const primaryData = loadJSON('../data/primary-targets.json');
const fixture = loadJSON('../fixtures/sample-run.json');
const BAG_CAPACITY_PER_PLAYER = 100;

function baseState(overrides) {
  return Object.assign({
    primaryId: fixture.primaryTarget.id,
    difficulty: fixture.primaryTarget.hardMode ? 'hard' : 'normal',
    weekly: fixture.primaryTarget.firstTimeThisWeek ? 'first' : 'repeat',
    players: 4,
    elite: 'no',
    loot: catalog.map(cat => ({
      itemId: cat.itemId,
      value: Object.prototype.hasOwnProperty.call(fixture.secondaryLoot, cat.itemId)
        ? fixture.secondaryLoot[cat.itemId]
        : '',
      buyersChoice: fixture.buyersChoice.includes(cat.itemId)
    }))
  }, overrides);
}

test('hard mode isolation: fixture primary target is exactly $401,500', () => {
  const state = baseState({});
  const { value } = calcPrimary(state, primaryData.targets, primaryData.multipliers);
  assert.equal(value, 401500);
});

test('normal-mode primary value differs from hard-mode (multiplier actually applies)', () => {
  const hardState = baseState({ difficulty: 'hard' });
  const normalState = baseState({ difficulty: 'normal' });
  const hard = calcPrimary(hardState, primaryData.targets, primaryData.multipliers);
  const normal = calcPrimary(normalState, primaryData.targets, primaryData.multipliers);
  assert.notEqual(hard.value, normal.value);
  assert.equal(normal.value, 365000); // baseValue, firstWeek false, no hard multiplier
  assert.equal(hard.value, 401500);
});

test('keepPrimary "yes" returns value 0 and kept: true, regardless of difficulty/weekly', () => {
  const hard = calcPrimary(baseState({ difficulty: 'hard', weekly: 'first', keepPrimary: 'yes' }), primaryData.targets, primaryData.multipliers);
  const normal = calcPrimary(baseState({ difficulty: 'normal', weekly: 'repeat', keepPrimary: 'yes' }), primaryData.targets, primaryData.multipliers);
  assert.equal(hard.value, 0);
  assert.equal(hard.kept, true);
  assert.equal(normal.value, 0);
  assert.equal(normal.kept, true);
  // meta (the target's own record) is still populated even when kept —
  // only .value is zeroed.
  assert.ok(hard.meta && hard.meta.id === baseState({}).primaryId);
});

test('keepPrimary "no" (or unset) still returns the real computed value with kept: false', () => {
  const explicit = calcPrimary(baseState({ keepPrimary: 'no' }), primaryData.targets, primaryData.multipliers);
  const unset = calcPrimary(baseState({}), primaryData.targets, primaryData.multipliers);
  assert.equal(explicit.value, 401500);
  assert.equal(explicit.kept, false);
  assert.equal(unset.value, 401500);
  assert.equal(unset.kept, false);
});

test('secondary loot values never change with difficulty', () => {
  const normalState = baseState({ difficulty: 'normal' });
  const hardState = baseState({ difficulty: 'hard' });

  const normalResult = runOptimizer(normalState, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
  const hardResult = runOptimizer(hardState, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);

  // Same scoped secondary values in, same optimal secondary bag value out —
  // difficulty must only ever touch primaryTarget.value and the bonuses.
  assert.equal(normalResult.secondaryBagValue, hardResult.secondaryBagValue);

  // And the raw per-item values themselves are untouched by difficulty.
  for (let i = 0; i < normalState.loot.length; i++) {
    assert.equal(normalState.loot[i].value, hardState.loot[i].value);
  }
});
