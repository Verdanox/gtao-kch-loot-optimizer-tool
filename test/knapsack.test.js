import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { knapsack } from '../js/kch-model.js';

function loadJSON(relUrl) {
  return JSON.parse(fs.readFileSync(new URL(relUrl, import.meta.url), 'utf8'));
}

// Brute-force reference solver, used to cross-check knapsack() on small
// item sets without trusting knapsack()'s own backtracking logic.
function bruteForce(items, capacityUnits) {
  let best = { value: 0, chosenIds: [] };
  const n = items.length;
  for (let mask = 0; mask < (1 << n); mask++) {
    let weight = 0, value = 0, ids = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        weight += items[i].weightUnits;
        value += items[i].value;
        ids.push(items[i].id);
      }
    }
    if (weight <= capacityUnits && value > best.value) {
      best = { value, chosenIds: ids };
    }
  }
  return best;
}

test('empty item list returns zero value and no chosen ids', () => {
  const res = knapsack([], 100);
  assert.equal(res.value, 0);
  assert.deepEqual(res.chosenIds, []);
});

test('zero capacity returns zero value even with items available', () => {
  const items = [{ id: 'a', value: 500, weightUnits: 10 }];
  const res = knapsack(items, 0);
  assert.equal(res.value, 0);
  assert.deepEqual(res.chosenIds, []);
});

test('a single item heavier than capacity is excluded', () => {
  const items = [{ id: 'a', value: 500, weightUnits: 150 }];
  const res = knapsack(items, 100);
  assert.equal(res.value, 0);
  assert.deepEqual(res.chosenIds, []);
});

test('tie-breaking: picks an optimal-value subset when multiple subsets tie', () => {
  // Two items of equal value/weight ratio such that only one fits — the
  // optimizer must still land on the true optimum, not an arbitrary tie.
  const items = [
    { id: 'a', value: 100, weightUnits: 50 },
    { id: 'b', value: 100, weightUnits: 50 },
    { id: 'c', value: 40, weightUnits: 20 },
  ];
  const res = knapsack(items, 70);
  const expected = bruteForce(items, 70);
  assert.equal(res.value, expected.value);
  // sanity: whatever was chosen must actually fit
  const usedWeight = res.chosenIds.reduce((s, id) => s + items.find(i => i.id === id).weightUnits, 0);
  assert.ok(usedWeight <= 70);
});

test('hand-computed classic knapsack case', () => {
  // a+b=160/w30, a+c=180/w40, b+c=220/w50 (optimal), a+b+c=280/w60 (over capacity)
  const items = [
    { id: 'a', value: 60, weightUnits: 10 },
    { id: 'b', value: 100, weightUnits: 20 },
    { id: 'c', value: 120, weightUnits: 30 },
  ];
  const res = knapsack(items, 50);
  assert.equal(res.value, 220);
  assert.deepEqual([...res.chosenIds].sort(), ['b', 'c']);
});

test('matches brute force over a real subset of the sample-run fixture at a known capacity', () => {
  const catalog = loadJSON('../data/secondary-loot.json').items;
  const fixture = loadJSON('../fixtures/sample-run.json');

  // Use the first 6 scoped items (brute force is 2^6 = 64 combos — cheap).
  const scopedIds = Object.keys(fixture.secondaryLoot).slice(0, 6);
  const items = scopedIds.map(id => {
    const cat = catalog.find(c => c.itemId === id);
    return { id, value: fixture.secondaryLoot[id], weightUnits: cat.weight };
  });

  const capacityUnits = 100;
  const res = knapsack(items, capacityUnits);
  const expected = bruteForce(items, capacityUnits);

  assert.equal(res.value, expected.value);
  const usedWeight = res.chosenIds.reduce((s, id) => s + items.find(i => i.id === id).weightUnits, 0);
  assert.ok(usedWeight <= capacityUnits);
  const actualValueOfChosen = res.chosenIds.reduce((s, id) => s + items.find(i => i.id === id).value, 0);
  assert.equal(actualValueOfChosen, res.value);
});
