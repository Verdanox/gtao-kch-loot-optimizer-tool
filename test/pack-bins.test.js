import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { packBins, runOptimizer, DEFAULT_BONUS_CONSTANTS } from '../js/kch-model.js';

function loadJSON(relUrl) {
  return JSON.parse(fs.readFileSync(new URL(relUrl, import.meta.url), 'utf8'));
}

const catalog = loadJSON('../data/secondary-loot.json').items;
const BAG_CAPACITY_PER_PLAYER = 100;

// Regression coverage for the real bug report (2026-08-01): a player's bag
// showing 110% full. Root cause was architectural — a pooled-capacity
// knapsack (players * 100) doesn't guarantee the chosen items can actually
// be split into fixed-size per-player bags. Bin packing into fixed bins can
// be infeasible even when the pooled total fits; see the write-up on
// packBins() in kch-model.js.

test('packBins never lets a bin exceed capacity, even when including every optional item would overflow', () => {
  // Hand-verified true infeasibility: weights 50,30,30,30,30,30 sum to 200
  // (exactly 2 bins of 100 pooled), but no subset of {50,30,30,30,30,30}
  // sums to exactly 100 — so there is NO way to split all six into two
  // bins of 100 each. The old pooled-knapsack-then-FFD-split pipeline
  // would have accepted all six (200 <= 200 pooled) and then overflowed
  // one bag at the assignment step. The correct behavior is to drop the
  // least-valuable item (F, value 50) and pack the rest (value 1500),
  // which IS feasible (80/90 split).
  const optional = [
    { id: 'A', value: 500, weightUnits: 50, floor: 'Vault' },
    { id: 'B', value: 400, weightUnits: 30, floor: 'Vault' },
    { id: 'C', value: 300, weightUnits: 30, floor: 'Vault' },
    { id: 'D', value: 200, weightUnits: 30, floor: 'Vault' },
    { id: 'E', value: 100, weightUnits: 30, floor: 'Vault' },
    { id: 'F', value: 50, weightUnits: 30, floor: 'Vault' },
  ];
  const result = packBins([], optional, 2, 100);

  assert.ok(result, 'expected a feasible pack to be found');
  for (const bag of result.bags) {
    assert.ok(bag.weightUsed <= 100, `bag overflowed: ${bag.weightUsed}/100`);
  }
  assert.equal(result.value, 1500, 'expected the optimal value achievable under real bin constraints');
  const chosenIds = result.bags.flatMap(b => b.items.map(i => i.id)).sort();
  assert.deepEqual(chosenIds, ['A', 'B', 'C', 'D', 'E'], 'F (lowest value) should be the one dropped');
});

test('packBins returns null when mandatory items alone cannot be bin-packed', () => {
  // Same infeasible weight multiset, but this time all six are mandatory
  // (e.g. all marked Buyer's Choice) — there is no valid way to include
  // them all, full stop, regardless of what else is or isn't optional.
  const mandatory = [
    { id: 'A', value: 500, weightUnits: 50, floor: 'Vault' },
    { id: 'B', value: 400, weightUnits: 30, floor: 'Vault' },
    { id: 'C', value: 300, weightUnits: 30, floor: 'Vault' },
    { id: 'D', value: 200, weightUnits: 30, floor: 'Vault' },
    { id: 'E', value: 100, weightUnits: 30, floor: 'Vault' },
    { id: 'F', value: 50, weightUnits: 30, floor: 'Vault' },
  ];
  const result = packBins(mandatory, [], 2, 100);
  assert.equal(result, null);
});

test('packBins: mandatory items that DO fit are all included, plus a value-max optional fill', () => {
  const mandatory = [{ id: 'M', value: 1000, weightUnits: 50, floor: 'Vault' }];
  const optional = [
    { id: 'O1', value: 300, weightUnits: 50, floor: 'Vault' },
    { id: 'O2', value: 100, weightUnits: 50, floor: 'Vault' },
  ];
  const result = packBins(mandatory, optional, 2, 100);
  assert.ok(result);
  const chosenIds = new Set(result.bags.flatMap(b => b.items.map(i => i.id)));
  assert.ok(chosenIds.has('M'), 'mandatory item must always be included');
  // Capacity is 200 total across 2 bins of 100. M(50) + O1(50) fit together
  // in one bin, leaving the other bin free for O2(50) too — all three fit.
  assert.ok(chosenIds.has('O1'));
  assert.ok(chosenIds.has('O2'));
  for (const bag of result.bags) assert.ok(bag.weightUsed <= 100);
});

test('the real 3-player catalog combo that originally overflowed a bag now packs without overflow', () => {
  // The exact repro found against the live catalog: 10 items summing to
  // 300 (players * 100 pooled) that cannot be split 100/100/100.
  const overflowIds = ['0-A', '0-B', '1-A', '1-G', '1-H', '2-B', '2-C', '2-G', '2-H', '2-I'];
  const optional = overflowIds.map(id => {
    const cat = catalog.find(c => c.itemId === id);
    return { id, value: 1000, weightUnits: cat.weight, floor: cat.floor };
  });
  const result = packBins([], optional, 3, 100);
  assert.ok(result);
  for (const bag of result.bags) {
    assert.ok(bag.weightUsed <= 100, `bag overflowed: ${bag.weightUsed}/100`);
  }
});

// Regression coverage for the 2026-08-02 reconstruction rewrite: bin
// CHOICE now follows a three-tier preference (Crisp-Gallery-to-host, then
// general floor-clustering, then least-loaded-bin) instead of always
// trying bin 0 first — the old behavior was why Buyer's Choice loot
// always ended up entirely in the host's bag.

test('floor-clustering: same-floor items land together, and spread to a fresh bin only when there is no floor match', () => {
  const mandatory = [{ id: 'A', value: 100, weightUnits: 20, floor: 'Vault' }];
  const optional = [
    { id: 'B', value: 50, weightUnits: 20, floor: 'Vault' },
    { id: 'C', value: 50, weightUnits: 20, floor: 'Second' },
  ];
  const result = packBins(mandatory, optional, 3, 100);
  assert.ok(result);
  assert.equal(result.value, 200);

  const bagOf = (id) => result.bags.findIndex(b => b.items.some(i => i.id === id));
  assert.equal(bagOf('A'), bagOf('B'), 'A and B share a floor and should land in the same bag');
  assert.notEqual(bagOf('C'), bagOf('A'), 'C is on a different floor and should not pile into the same bag');
});

test('items with no floor field never spuriously cluster via undefined === undefined', () => {
  const optional = [
    { id: 'X', value: 100, weightUnits: 50 },
    { id: 'Y', value: 100, weightUnits: 50 },
  ];
  const result = packBins([], optional, 2, 100);
  assert.ok(result);
  assert.equal(result.value, 200);
  const bagOf = (id) => result.bags.findIndex(b => b.items.some(i => i.id === id));
  assert.notEqual(bagOf('X'), bagOf('Y'), 'floorless items should spread via least-loaded, not cluster on undefined');
});

test('anti-host-bias regression: mandatory items on different floors spread across bins instead of piling into bin 0', () => {
  // Floors must be mutually non-adjacent for this test to isolate the
  // least-loaded fallback (tier 4) from the newer adjacent-floor tier
  // (tier 3, added 2026-08-03) — First and Alarm Floor are now
  // intentionally adjacent, so they'd legitimately cluster together on
  // purpose and this assertion would no longer hold for that pair.
  const mandatory = [
    { id: 'A', value: 100, weightUnits: 20, floor: 'Vault' },
    { id: 'B', value: 100, weightUnits: 20, floor: 'Loading Bay' },
    { id: 'C', value: 100, weightUnits: 20, floor: 'Alarm Floor' },
  ];
  const result = packBins(mandatory, [], 3, 100);
  assert.ok(result);
  const bagOf = (id) => result.bags.findIndex(b => b.items.some(i => i.id === id));
  const bins = [bagOf('A'), bagOf('B'), bagOf('C')];
  assert.equal(new Set(bins).size, 3, `expected 3 mandatory items on 3 mutually non-adjacent floors to spread across 3 different bins, got ${bins}`);
});

test('floor-clustering outranks the least-loaded fallback', () => {
  // Bin 0 is left with only 50 remaining after A; bin 1 is still empty
  // (100 remaining) and would win on pure least-loaded grounds — but B
  // shares A's floor, so it should still join bin 0 anyway.
  const mandatory = [{ id: 'A', value: 100, weightUnits: 50, floor: 'Vault' }];
  const optional = [{ id: 'B', value: 50, weightUnits: 20, floor: 'Vault' }];
  const result = packBins(mandatory, optional, 2, 100);
  assert.ok(result);
  const bagOf = (id) => result.bags.findIndex(b => b.items.some(i => i.id === id));
  assert.equal(bagOf('B'), bagOf('A'), 'same-floor item should cluster with A despite bin 1 being emptier');
});

test('Crisp Gallery items prefer the host bin even when least-loaded would pick elsewhere', () => {
  const mandatory = [{ id: 'A', value: 500, weightUnits: 80, floor: 'Vault' }];
  const optional = [{ id: 'G', value: 50, weightUnits: 10, floor: 'Crisp Gallery' }];
  const result = packBins(mandatory, optional, 2, 100);
  assert.ok(result);
  assert.equal(result.value, 550, 'the Crisp Gallery preference must not cost any value');
  assert.ok(result.bags[0].items.some(i => i.id === 'G'), 'Crisp Gallery item should land with the host despite bin 0 having far less room than bin 1');
});

test('Crisp Gallery preference falls through gracefully when the host bin truly has no room', () => {
  const mandatory = [{ id: 'A', value: 1000, weightUnits: 100, floor: 'Vault' }]; // fills bin 0 completely
  const optional = [{ id: 'G', value: 50, weightUnits: 10, floor: 'Crisp Gallery' }];
  const result = packBins(mandatory, optional, 2, 100);
  assert.ok(result);
  assert.equal(result.value, 1050, 'the Crisp Gallery item should still be packed, just not with the host');
  assert.ok(result.bags[1].items.some(i => i.id === 'G'), 'Crisp Gallery item should fall through to a non-host bin, not be dropped');
});

// Regression coverage for the 2026-08-03 adjacent-floor tie-break: a
// softer nudge, ranked below exact-floor-match and above least-loaded,
// for clustering items whose floors are one real-map transition apart
// (Alarm Floor<->First<->Second/Crisp Gallery) even when they don't
// share an identical floor string.

test('adjacent-floor items cluster together over an emptier, unrelated bin', () => {
  // Bin 0 (First) is left with 50 remaining after A; bin 1 is empty (100
  // remaining) and would win on pure least-loaded grounds — but B is on
  // Second, which is adjacent to First, so it should still join bin 0.
  const mandatory = [{ id: 'A', value: 100, weightUnits: 50, floor: 'First' }];
  const optional = [{ id: 'B', value: 50, weightUnits: 20, floor: 'Second' }];
  const result = packBins(mandatory, optional, 2, 100);
  assert.ok(result);
  const bagOf = (id) => result.bags.findIndex(b => b.items.some(i => i.id === id));
  assert.equal(bagOf('B'), bagOf('A'), 'adjacent-floor item should cluster with A despite bin 1 being emptier');
});

test('exact-floor match still outranks adjacent-floor match', () => {
  // Bin 0 holds a First item, bin 1 holds a Second item. C is on Second:
  // bin 1 is an exact match, bin 0 is only adjacent — exact match wins.
  const mandatory = [
    { id: 'A', value: 100, weightUnits: 20, floor: 'First' },
    { id: 'B', value: 100, weightUnits: 20, floor: 'Second' },
  ];
  const optional = [{ id: 'C', value: 50, weightUnits: 20, floor: 'Second' }];
  const result = packBins(mandatory, optional, 2, 100);
  assert.ok(result);
  const bagOf = (id) => result.bags.findIndex(b => b.items.some(i => i.id === id));
  assert.equal(bagOf('C'), bagOf('B'), 'exact-floor match (Second/Second) should win over merely-adjacent (First/Second)');
});

test('isolated floors (Vault, Loading Bay) never soft-cluster with anything', () => {
  const mandatory = [{ id: 'A', value: 100, weightUnits: 50, floor: 'Alarm Floor' }];
  const optional = [{ id: 'B', value: 50, weightUnits: 20, floor: 'Vault' }];
  const result = packBins(mandatory, optional, 2, 100);
  assert.ok(result);
  const bagOf = (id) => result.bags.findIndex(b => b.items.some(i => i.id === id));
  assert.notEqual(bagOf('B'), bagOf('A'), 'Vault is isolated and should not adjacency-cluster with Alarm Floor');
});

test('adjacent-floor preference falls through gracefully when the only adjacent bin has no room', () => {
  const mandatory = [{ id: 'A', value: 1000, weightUnits: 100, floor: 'First' }]; // fills bin 0 completely
  const optional = [{ id: 'B', value: 50, weightUnits: 10, floor: 'Second' }];
  const result = packBins(mandatory, optional, 2, 100);
  assert.ok(result);
  assert.equal(result.value, 1050, 'the adjacency preference should still pack B, just not with the full bin');
  assert.ok(result.bags[1].items.some(i => i.id === 'B'), 'adjacent-floor item should fall through to a non-adjacent bin, not be dropped');
});

// Fuzz test via the real runOptimizer entry point: across many random
// scope-outs against the real catalog, no player's bag should ever exceed
// bagCapacityPerPlayer. This is the same search that originally found the
// bug, kept permanently as a regression guard.
test('fuzz: runOptimizer never produces an overflowing bag across random scope-outs', () => {
  let checked = 0;
  for (let trial = 0; trial < 300; trial++) {
    const players = 1 + Math.floor(Math.random() * 4); // 1..4
    const elite = Math.random() < 0.5 ? 'yes' : 'no';
    const eligibleForBC = catalog.filter(c => c.minPlayers <= players && c.valueType !== 'checkbox');
    const bcPicks = new Set();
    if (elite === 'yes' && eligibleForBC.length > 0) {
      const pickCount = Math.min(3, 1 + Math.floor(Math.random() * 3));
      for (let k = 0; k < pickCount; k++) {
        bcPicks.add(eligibleForBC[Math.floor(Math.random() * eligibleForBC.length)].itemId);
      }
    }
    const loot = catalog.map(cat => ({
      itemId: cat.itemId,
      value: Math.random() < 0.5 ? '' : String(1000 + Math.floor(Math.random() * 200000)),
      buyersChoice: bcPicks.has(cat.itemId)
    }));
    const state = { primaryId: 'x', difficulty: Math.random() < 0.5 ? 'hard' : 'normal', weekly: 'first', players, elite, loot };
    const r = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
    checked++;
    r.bags.forEach((bag, i) => {
      assert.ok(
        bag.weightUsed <= BAG_CAPACITY_PER_PLAYER,
        `trial ${trial}, players ${players}: bag ${i} overflowed at ${bag.weightUsed}/${BAG_CAPACITY_PER_PLAYER}`
      );
    });
  }
  assert.ok(checked > 0);
});
