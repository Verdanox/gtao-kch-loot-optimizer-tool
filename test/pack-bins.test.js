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
// CHOICE now follows a four-tier preference (host-priority-floor, then
// general floor-clustering, then adjacent-floor, then least-loaded-bin)
// instead of always trying bin 0 first — the old behavior was why Buyer's
// Choice loot always ended up entirely in the host's bag.

test('floor-clustering: same-floor items land together, and spread to a fresh bin only when there is no floor match', () => {
  // C's floor is deliberately NOT one of the host-priority floors
  // (Second/Crisp Gallery) so this test isolates tier 2 (floor-clustering)
  // from tier 1 (host-priority) — otherwise C would land with the host
  // regardless of A/B's floor, which is a different tier's job to prove.
  const mandatory = [{ id: 'A', value: 100, weightUnits: 20, floor: 'Vault' }];
  const optional = [
    { id: 'B', value: 50, weightUnits: 20, floor: 'Vault' },
    { id: 'C', value: 50, weightUnits: 20, floor: 'First' },
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
  // Filler must itself be a HOST_PRIORITY_FLOORS item and processed first
  // to genuinely fill bin 0 before G is ever considered (2026-08-09: since
  // priority-floor items are now always walked ahead of every other floor,
  // a 'First'-floor filler would no longer get a head start on claiming
  // bin 0 first — G would just claim it instead, defeating the point of
  // this test). Using 'Second' here fills the host bin via the same tier 1
  // rule G itself relies on, so this is still a fair "host bin truly full"
  // setup. Filler is also NOT 'Vault' — a Vault filler would get routed
  // away from bin 0 by tier 0 (2026-08-07), which would leave the host bin
  // free and defeat the point of this test.
  const mandatory = [{ id: 'A', value: 1000, weightUnits: 100, floor: 'Second' }]; // fills bin 0 completely
  const optional = [{ id: 'G', value: 50, weightUnits: 10, floor: 'Crisp Gallery' }];
  const result = packBins(mandatory, optional, 2, 100);
  assert.ok(result);
  assert.equal(result.value, 1050, 'the Crisp Gallery item should still be packed, just not with the host');
  assert.ok(result.bags[1].items.some(i => i.id === 'G'), 'Crisp Gallery item should fall through to a non-host bin, not be dropped');
});

// Regression coverage for the real 2026-08-09 bug report: a host bag full
// of a cross-floor mishmash (Alarm Floor + First + partial Second) instead
// of the documented Second/Crisp Gallery concentration. Root cause: tier 1
// only fired when a priority-floor item happened to be walked in catalog
// order (Vault -> Loading Bay -> Alarm Floor -> First -> Second -> Crisp
// Gallery); an earlier, non-priority item could claim bin 0 first via the
// tier 4/5 symmetric-tie default, then floor/adjacency clustering (tiers
// 2/3) snowballed more of that same low-priority floor into the host bag
// before any Second/Crisp Gallery item was ever reached. Fixed by walking
// HOST_PRIORITY_FLOORS items ahead of every other floor regardless of
// catalog `order`.
test('a later-catalog-order priority-floor item still claims the host bag ahead of an earlier-catalog-order non-priority item', () => {
  // 'Alarm Floor' (not 'First') for F: First is adjacent to Second, which
  // would let F legitimately tier-3-cluster into whatever bin S landed in
  // — using a floor with no adjacency to Second isolates this test to the
  // priority-reordering behavior alone.
  const optional = [
    { id: 'F', value: 50, weightUnits: 30, floor: 'Alarm Floor', order: 0 }, // earlier catalog position, non-priority
    { id: 'S', value: 50, weightUnits: 30, floor: 'Second', order: 1 },      // later catalog position, priority floor
  ];
  const result = packBins([], optional, 2, 100);
  assert.ok(result);
  const bagOf = (id) => result.bags.findIndex(b => b.items.some(i => i.id === id));
  assert.equal(bagOf('S'), 0, 'the Second-floor item should claim the host bag despite its later catalog order');
  assert.notEqual(bagOf('F'), 0, 'the earlier-catalog Alarm Floor item should not have squatted in the host bag first');
});

// Regression coverage for the 2026-08-04 widening: the host must physically
// enter the Vault for the primary target at every crew size, and Loading
// Bay is mutually exclusive with that visit — so the host's route
// naturally continues on to the building's 2nd floor afterward. Second
// joins Crisp Gallery as a host-priority floor; Vault and Loading Bay
// deliberately do not (see packBins()'s tier-1 comment for why).
test('Second-floor items now also prefer the host bin, same as Crisp Gallery', () => {
  const mandatory = [{ id: 'A', value: 500, weightUnits: 80, floor: 'Vault' }];
  const optional = [{ id: 'S', value: 50, weightUnits: 10, floor: 'Second' }];
  const result = packBins(mandatory, optional, 2, 100);
  assert.ok(result);
  assert.equal(result.value, 550, 'the Second-floor preference must not cost any value');
  assert.ok(result.bags[0].items.some(i => i.id === 'S'), 'Second-floor item should land with the host despite bin 0 having far less room than bin 1');
});

test('Vault items exclude the host bag but still floor-cluster together via tier 2', () => {
  // A is mandatory Vault — tier 0 forces it away from bin 0 (host) into
  // bin 1, since bin 1 is a value-preserving alternative. V shares A's
  // floor and should still join it there via tier 2 clustering (not
  // scatter to tier 4's least-loaded fallback). L (Loading Bay) is
  // unrelated to Vault's host-avoidance or floor-clustering, so it's free
  // to land wherever tier 4 sends it — the now-emptier host bag.
  const mandatory = [{ id: 'A', value: 500, weightUnits: 60, floor: 'Vault' }];
  const optional = [
    { id: 'V', value: 50, weightUnits: 30, floor: 'Vault' },
    { id: 'L', value: 50, weightUnits: 30, floor: 'Loading Bay' },
  ];
  const result = packBins(mandatory, optional, 2, 100);
  assert.ok(result);
  const bagOf = (id) => result.bags.findIndex(b => b.items.some(i => i.id === id));
  assert.notEqual(bagOf('A'), 0, 'Vault items should never land in the host bag when a non-host bag is available');
  assert.equal(bagOf('V'), bagOf('A'), 'V shares A\'s floor and should still cluster via tier 2 among non-host bags');
  assert.equal(bagOf('L'), 0, 'Loading Bay is unaffected by Vault host-avoidance and falls back to the emptier (host) bag via tier 4');
});

test('a lone Vault item is routed away from the host bag when a non-host bag is available', () => {
  // With two empty, symmetric bins, the old tier-4 ascending-index
  // tiebreak would have landed this in bin 0 (host). Tier 0 must now
  // force it to bin 1 instead.
  const mandatory = [{ id: 'A', value: 100, weightUnits: 50, floor: 'Vault' }];
  const result = packBins(mandatory, [], 2, 100);
  assert.ok(result);
  assert.equal(result.bags[0].items.length, 0, 'host bag should stay empty when a non-host bag can take the Vault item instead');
  assert.ok(result.bags[1].items.some(i => i.id === 'A'), 'Vault item should land in the non-host bag');
});

test('a Vault item still packs into the host bag when it is the only bag (solo run)', () => {
  const mandatory = [{ id: 'A', value: 100, weightUnits: 50, floor: 'Vault' }];
  const result = packBins(mandatory, [], 1, 100);
  assert.ok(result);
  assert.ok(result.bags[0].items.some(i => i.id === 'A'), 'with only one bag, the Vault item must still be packed into it');
});

test('a Vault item falls back to the host bag when the non-host bag no longer has room', () => {
  // A (weight 90) fills most of bin 1 via tier 0. B (weight 50) no longer
  // fits in bin 1 (only 10 remaining), so it must fall back to bin 0
  // despite tier 0's usual host-avoidance.
  const mandatory = [
    { id: 'A', value: 100, weightUnits: 90, floor: 'Vault' },
    { id: 'B', value: 100, weightUnits: 50, floor: 'Vault' },
  ];
  const result = packBins(mandatory, [], 2, 100);
  assert.ok(result);
  const bagOf = (id) => result.bags.findIndex(b => b.items.some(i => i.id === id));
  assert.equal(bagOf('A'), 1, 'first Vault item routes to the non-host bag');
  assert.equal(bagOf('B'), 0, 'second Vault item falls back to the host bag once the non-host bag lacks room');
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
  // Filler ('Alarm Floor') and the incoming item ('First') are both
  // deliberately NOT HOST_PRIORITY_FLOORS (2026-08-09: those are now
  // walked ahead of every other floor, so using 'Second' here — as this
  // test originally did — would let B claim bin 0 via tier 1 before A
  // ever gets a chance to fill it, defeating the point of this test,
  // which is specifically about tier 3's adjacency fallback).
  const mandatory = [{ id: 'A', value: 1000, weightUnits: 100, floor: 'Alarm Floor' }]; // fills bin 0 completely
  const optional = [{ id: 'B', value: 50, weightUnits: 10, floor: 'First' }];
  const result = packBins(mandatory, optional, 2, 100);
  assert.ok(result);
  assert.equal(result.value, 1050, 'the adjacency preference should still pack B, just not with the full bin');
  assert.ok(result.bags[1].items.some(i => i.id === 'B'), 'adjacent-floor item should fall through to a non-adjacent bin, not be dropped');
});

// Regression test for the real 2026-08-04 bug report: the same scope-out,
// resubmitted with Elite Challenge toggled on vs off, produced two
// DIFFERENT bag splits despite an identical $740,000 secondary total and
// an identical 10-item selection. Root cause: packBins() concatenated
// `[...mandatory, ...optional]`, so marking items Buyer's-Choice-mandatory
// pulled them to the front of the processing order, changing which of
// several equally-optimal-value partitions the reconstruction landed on.
// The `order` field (threaded through from runOptimizer's catalog-ordered
// `eligible` list) fixes this by making packBins always walk items in true
// catalog order regardless of Buyer's Choice/Elite status.
test('bag assignment for a given selected item set no longer depends on Elite Challenge status', () => {
  const values = {
    'BAY': 110000, '1-B': 33000, '1-C': 33000, '1-D': 33000,
    '2-C': 97500, '2-G': 82000, '2-H': 117500, '2-I': 78000,
    '2-J': 46000, '2-K': 110000
  };
  const bcIds = new Set(['1-B', '2-I', '2-K']);
  const baseLoot = catalog.map(cat => ({
    itemId: cat.itemId,
    value: Object.prototype.hasOwnProperty.call(values, cat.itemId) ? values[cat.itemId] : '',
    buyersChoice: bcIds.has(cat.itemId)
  }));

  const stateFor = (elite) => ({
    primaryId: 'la-derniere-debauche', difficulty: 'normal', weekly: 'first',
    players: 2, elite, loot: baseLoot
  });

  const eliteOn = runOptimizer(stateFor('yes'), catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
  const eliteOff = runOptimizer(stateFor('no'), catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);

  assert.equal(eliteOn.secondaryBagValue, 740000);
  assert.equal(eliteOn.secondaryBagValue, eliteOff.secondaryBagValue, 'total value must match regardless of Elite status (already true before this fix)');

  const bagShapeOf = (result) => result.bags.map(b => b.items.map(i => i.itemId).sort().join(','));
  assert.deepEqual(bagShapeOf(eliteOn), bagShapeOf(eliteOff), 'per-bag item assignment must now be identical whether Elite is on or off');
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
