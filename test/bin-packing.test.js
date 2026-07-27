import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assignItemsToBags, runOptimizer, DEFAULT_BONUS_CONSTANTS } from '../js/kch-model.js';

function loadJSON(relUrl) {
  return JSON.parse(fs.readFileSync(new URL(relUrl, import.meta.url), 'utf8'));
}

const catalog = loadJSON('../data/secondary-loot.json').items;
const fixture = loadJSON('../fixtures/sample-run.json');
const BAG_CAPACITY_PER_PLAYER = 100;

// No dedicated bin-packing test file existed before this — test/optimizer.test.js
// only ever checked bag *count* and Buyer's Choice membership in chosenIds,
// never which specific bag an item lands in. These tests cover the Normal
// model's slight, best-effort host-routing preference for Second/Crisp
// Gallery items (see the "Clarified model definitions" section of
// internal/model-notes.md).

test('a Second/Crisp Gallery item wins a close-weight contention for the host\'s bag', () => {
  // Without any floor weighting, weight-descending + stable sort would
  // process w1, w2 (both Vault, weight 50) before s (Second, weight 45),
  // filling the host's bag (capacity 100) with w1+w2 before s ever gets a
  // look-in, pushing s into bag 1. The host-routing boost (~8) should flip
  // s's processing order ahead of w2, landing it in the host's bag instead.
  const items = [
    { itemId: 'w1', value: 100, weight: 50, floor: 'Vault' },
    { itemId: 'w2', value: 100, weight: 50, floor: 'Vault' },
    { itemId: 's', value: 80, weight: 45, floor: 'Second' },
  ];
  const bags = assignItemsToBags(items, 2, 100);

  const hostIds = bags[0].items.map(it => it.itemId);
  assert.ok(hostIds.includes('s'), `expected Second-floor item "s" to land in the host's bag, host has: ${hostIds}`);
});

test('a Crisp Gallery item wins the same contention', () => {
  const items = [
    { itemId: 'w1', value: 100, weight: 50, floor: 'Vault' },
    { itemId: 'w2', value: 100, weight: 50, floor: 'Vault' },
    { itemId: 'c', value: 80, weight: 45, floor: 'Crisp Gallery' },
  ];
  const bags = assignItemsToBags(items, 2, 100);

  const hostIds = bags[0].items.map(it => it.itemId);
  assert.ok(hostIds.includes('c'), `expected Crisp Gallery item "c" to land in the host's bag, host has: ${hostIds}`);
});

test('the boost never leapfrogs a full-size item past a small Second/Crisp Gallery item outright', () => {
  // A 50-weight Vault item's real weight beats a 10-weight Crisp Gallery
  // item's boosted weight (10 + 8 = 18 < 50) — the boost is calibrated to
  // flip only close-weight ties, not invert the whole ordering. With a
  // capacity too tight for both in one bag (55 < 50 + 10 = 60), the heavy
  // item still wins first claim on the host's bag, exactly as it would
  // with no boost at all.
  const items = [
    { itemId: 'heavy', value: 100, weight: 50, floor: 'Vault' },
    { itemId: 'tiny', value: 20, weight: 10, floor: 'Crisp Gallery' },
  ];
  const bags = assignItemsToBags(items, 2, 55);

  const hostIds = bags[0].items.map(it => it.itemId);
  assert.deepEqual(hostIds, ['heavy'], 'the heavy Vault item should still claim the host bag first');
  assert.deepEqual(bags[1].items.map(it => it.itemId), ['tiny']);
});

test('total value and weight are unaffected by the host-routing reorder — selection is untouched, only assignment', () => {
  const items = [
    { itemId: 'a', value: 100, weight: 50, floor: 'Vault' },
    { itemId: 'b', value: 90, weight: 50, floor: 'Second' },
    { itemId: 'c', value: 80, weight: 45, floor: 'Crisp Gallery' },
    { itemId: 'd', value: 70, weight: 30, floor: 'First' },
  ];
  const bags = assignItemsToBags(items, 3, 100);

  const totalValue = bags.reduce((s, b) => s + b.value, 0);
  const totalWeight = bags.reduce((s, b) => s + b.weightUsed, 0);
  const expectedValue = items.reduce((s, it) => s + it.value, 0);
  const expectedWeight = items.reduce((s, it) => s + it.weight, 0);

  assert.equal(totalValue, expectedValue);
  assert.equal(totalWeight, expectedWeight);

  // Every item lands in exactly one bag.
  const allPlacedIds = bags.flatMap(b => b.items.map(it => it.itemId)).sort();
  assert.deepEqual(allPlacedIds, items.map(it => it.itemId).sort());
});

test('1-player crew: host-routing preference is a structural no-op (only one bag exists)', () => {
  const items = [
    { itemId: 'a', value: 100, weight: 50, floor: 'Vault' },
    { itemId: 'b', value: 90, weight: 45, floor: 'Second' },
    { itemId: 'c', value: 80, weight: 5, floor: 'Crisp Gallery' },
  ];
  const bags = assignItemsToBags(items, 1, 100);
  assert.equal(bags.length, 1);
  const hostIds = bags[0].items.map(it => it.itemId).sort();
  assert.deepEqual(hostIds, ['a', 'b', 'c']);
});

test('end-to-end via runOptimizer: sample-run fixture floor field flows through to assignment without changing secondaryBagValue', () => {
  // Confirms runOptimizer's chosenItemList now carries `floor` (needed for
  // the host-routing preference) without perturbing the optimizer's own
  // value-maximizing selection.
  const state = {
    primaryId: fixture.primaryTarget.id,
    difficulty: fixture.primaryTarget.hardMode ? 'hard' : 'normal',
    weekly: fixture.primaryTarget.firstTimeThisWeek ? 'first' : 'repeat',
    players: 3,
    elite: fixture.eliteChallengeAttempted ? 'yes' : 'no',
    loot: catalog.map(cat => ({
      itemId: cat.itemId,
      value: Object.prototype.hasOwnProperty.call(fixture.secondaryLoot, cat.itemId)
        ? fixture.secondaryLoot[cat.itemId]
        : '',
      buyersChoice: fixture.buyersChoice.includes(cat.itemId)
    }))
  };
  const r = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);

  const sumOfBagValues = r.bags.reduce((s, b) => s + b.value, 0);
  assert.equal(sumOfBagValues, r.secondaryBagValue);

  // Every item placed in a bag actually carries a floor (sanity check that
  // the data-flow wiring didn't silently drop it).
  for (const bag of r.bags) {
    for (const it of bag.items) {
      assert.ok('floor' in it, `chosen item ${it.itemId} is missing its floor field`);
    }
  }
});
