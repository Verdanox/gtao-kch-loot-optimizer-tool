import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runOptimizer, itemById, DEFAULT_BONUS_CONSTANTS } from '../js/kch-model.js';

function loadJSON(relUrl) {
  return JSON.parse(fs.readFileSync(new URL(relUrl, import.meta.url), 'utf8'));
}

const catalog = loadJSON('../data/secondary-loot.json').items;
const BAG_CAPACITY_PER_PLAYER = 100;

test('catalog declares BAY as a data-driven checkbox item, not a hardcoded special case', () => {
  const bay = itemById(catalog, 'BAY');
  assert.ok(bay, 'BAY must exist in the catalog');
  assert.equal(bay.valueType, 'checkbox');
  assert.equal(bay.fixedValue, 122500);
});

function stateWithLootOverrides(overrides, players = 1) {
  return {
    primaryId: 'la-derniere-debauche',
    difficulty: 'normal',
    weekly: 'first',
    players,
    elite: 'no',
    loot: catalog.map(cat => {
      const o = overrides[cat.itemId];
      return {
        itemId: cat.itemId,
        value: o && o.value !== undefined ? o.value : '',
        buyersChoice: o ? !!o.buyersChoice : false
      };
    })
  };
}

test('unchecked BAY (blank value) is excluded entirely, even when marked Buyer\'s Choice', () => {
  const state = stateWithLootOverrides({
    'BAY': { value: '', buyersChoice: true } // unchecked in the UI => blank value
  });
  const r = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
  assert.ok(!r.chosenIds.has('BAY'));
  assert.equal(r.secondaryBagValue, 0);
});

test('checked BAY participates at exactly $122,500 — no other value path reachable', () => {
  const bay = itemById(catalog, 'BAY');
  const state = stateWithLootOverrides({
    'BAY': { value: bay.fixedValue, buyersChoice: false }
  }, 1);
  const r = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
  assert.ok(r.chosenIds.has('BAY'));
  assert.equal(r.secondaryBagValue, 122500);

  // Confirm it landed in a bag at exactly the fixed value — no drift, no
  // arbitrary user-typed value ever reaches the model for this item.
  const bag = r.bags[0];
  const bayInBag = bag.items.find(it => it.itemId === 'BAY');
  assert.ok(bayInBag);
  assert.equal(bayInBag.value, 122500);
});

test('checked BAY as Buyer\'s Choice is treated identically to any other mandatory item', () => {
  const bay = itemById(catalog, 'BAY');
  const state = stateWithLootOverrides({
    'BAY': { value: bay.fixedValue, buyersChoice: true }
  }, 1);
  state.elite = 'yes';
  const r = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
  assert.ok(r.chosenIds.has('BAY'));
  assert.equal(r.allBuyerItemsFit, true);
  assert.ok(r.buyerRequestBonusEach > 0);
});
