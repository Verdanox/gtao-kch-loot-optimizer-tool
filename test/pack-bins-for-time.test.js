import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  runOptimizer, packBinsForTime, timeWeightFor, exhibitTravelCost,
  isItemReachable, itemById, DEFAULT_BONUS_CONSTANTS
} from '../js/kch-model.js';

function loadJSON(relUrl) {
  return JSON.parse(fs.readFileSync(new URL(relUrl, import.meta.url), 'utf8'));
}

const catalog = loadJSON('../data/secondary-loot.json').items;
const BAG_CAPACITY_PER_PLAYER = 100;

function stateFor(loot, overrides = {}) {
  return {
    primaryId: 'la-derniere-debauche',
    difficulty: 'normal',
    weekly: 'first',
    players: 2,
    elite: 'no',
    skipPreps: [],
    experimentalPacking: false,
    loot,
    ...overrides
  };
}

// Builds a full-catalog `loot` array with only the given itemId->value
// overrides scoped, mirroring the fixture-construction convention already
// used in test/pack-bins.test.js and test/optimizer.test.js.
function lootFor(values, bcIds = new Set()) {
  return catalog.map(cat => ({
    itemId: cat.itemId,
    value: Object.prototype.hasOwnProperty.call(values, cat.itemId) ? values[cat.itemId] : '',
    buyersChoice: bcIds.has(cat.itemId)
  }));
}

const EXHIBIT_FLOOR_NAMES = new Set(['Alarm Floor', 'First', 'Second', 'Crisp Gallery']);

// The per-bin time-cost this session's model is designed to minimize:
// summed item time-weight plus real inter-floor travel cost over the
// floors that bag's items actually touch. Used here only to independently
// verify packBinsForTime()'s own output — not itself the code under test.
// Non-exhibit items (Vault/Loading Bay) contribute nothing, same as the
// real model — must filter to exhibit items BEFORE summing timeWeight,
// not just when computing the floor set, or a non-exhibit item's
// otherwise-meaningless timeWeight tier leaks into the sum.
function binTimeCost(bag) {
  const exhibitItems = bag.items.filter(i => EXHIBIT_FLOOR_NAMES.has(i.floor));
  const floors = new Set(exhibitItems.map(i => i.floor));
  const sum = exhibitItems.reduce((s, i) => s + (i.timeWeight ?? 0), 0);
  return sum + exhibitTravelCost(floors);
}

// Real regression fixture (2026-08-22 session): the same 8-item, 2-player
// scope-out compared against an independent calculator's output — both
// tools agreed on item selection and total value ($577,500) but split
// bags differently. Hand-verified minimum bottleneck for this exact item
// set, under this session's time-weight tiers and exhibitTravelCost, is 8
// (achieved by several tied partitions, including the one the other
// calculator produced: host = {The Chief, Fertility Statue, Meteorite
// Fragment, Art Deco Circlets}, cost 8; other player = {Het Gouden Hondje,
// Byzantine Hoops, Antique Rings, Gemstone}, cost 7). This tool's own
// DEFAULT (value-model) split for the same items scores 12 on this same
// metric — confirming the real divergence this feature was built to close.
test('real regression fixture: packBinsForTime achieves the hand-verified minimum bottleneck (8), strictly better than the default split', () => {
  const values = {
    'B-D': 75000,   // Het Gouden Hondje (Vault)
    '1-F': 122500,  // The Chief (First)
    '0-C': 35000,   // Byzantine Hoops (Alarm Floor)
    '1-B': 32000,   // Antique Rings (First)
    '2-H': 110000,  // Gemstone (Crisp Gallery)
    '2-G': 76000,   // Fertility Statue (Crisp Gallery)
    '2-I': 78000,   // Meteorite Fragment (Crisp Gallery)
    '2-J': 49000    // Art Deco Circlets (Crisp Gallery)
  };
  const state = stateFor(lootFor(values), { players: 2 });

  const defaultResult = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
  assert.equal(defaultResult.secondaryBagValue, 577500);

  const experimentalState = { ...state, experimentalPacking: true };
  const experimentalResult = runOptimizer(experimentalState, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);

  // Same item selection and total value either way — this feature only
  // ever changes bag assignment.
  assert.equal(experimentalResult.secondaryBagValue, 577500);
  assert.deepEqual(
    [...experimentalResult.chosenIds].sort(),
    [...defaultResult.chosenIds].sort()
  );

  // No overflow either way.
  for (const bag of [...defaultResult.bags, ...experimentalResult.bags]) {
    assert.ok(bag.weightUsed <= BAG_CAPACITY_PER_PLAYER);
  }

  // Independently compute each bag's time-cost from runOptimizer()'s own
  // output shape ({ itemId, value, weight, floor }), attaching timeWeight
  // via the real catalog the same way runOptimizer() itself does.
  const costOf = (bags) => Math.max(...bags.map(b => binTimeCost({
    items: b.items.map(i => ({ floor: i.floor, timeWeight: timeWeightFor(itemById(catalog, i.itemId)) }))
  })));

  const defaultBottleneck = costOf(defaultResult.bags);
  const experimentalBottleneck = costOf(experimentalResult.bags);

  assert.equal(experimentalBottleneck, 8, 'expected the hand-verified true minimum bottleneck');
  assert.equal(defaultBottleneck, 12, 'expected the default value-model split\'s bottleneck, for contrast');
  assert.ok(experimentalBottleneck < defaultBottleneck);
});

// Direct test of exhibitTravelCost()'s shortest-path behavior: Alarm Floor
// and Crisp Gallery only connect through First (a real 2-hop detour), so
// a bin touching both must cost strictly more than a bin touching two
// floors that are directly adjacent.
test('exhibitTravelCost: a non-adjacent floor pair costs strictly more than an adjacent one', () => {
  const adjacent = exhibitTravelCost(new Set(['Alarm Floor', 'First']));
  const nonAdjacent = exhibitTravelCost(new Set(['Alarm Floor', 'Crisp Gallery']));
  assert.equal(adjacent, 1);
  assert.equal(nonAdjacent, 2);
  assert.ok(nonAdjacent > adjacent);
});

test('exhibitTravelCost: a single floor or empty set costs zero', () => {
  assert.equal(exhibitTravelCost(new Set()), 0);
  assert.equal(exhibitTravelCost(new Set(['First'])), 0);
});

test('exhibitTravelCost: all four exhibit floors together cost exactly 3 (a star through First)', () => {
  assert.equal(exhibitTravelCost(new Set(['Alarm Floor', 'First', 'Second', 'Crisp Gallery'])), 3);
});

// Direct packBinsForTime() test (bypassing runOptimizer): Vault/Loading Bay
// items always land via the pre-existing host-avoid rule, contributing
// zero to any bin's time-cost regardless of which bin they end up in.
test('packBinsForTime places Vault/Loading Bay items via the existing host-avoid rule and never overflows', () => {
  const items = [
    { id: 'vault-item', value: 100000, weightUnits: 50, floor: 'Vault', timeWeight: 0, order: 0 },
    { id: 'exhibit-item', value: 50000, weightUnits: 20, floor: 'First', timeWeight: 2, order: 1 }
  ];
  const result = packBinsForTime(items, 2, 100);
  assert.ok(result);
  for (const bag of result.bags) assert.ok(bag.weightUsed <= 100);
  const vaultBagIndex = result.bags.findIndex(b => b.items.some(i => i.id === 'vault-item'));
  assert.equal(vaultBagIndex, 1, 'Vault item should be routed away from bin 0 (host) when a non-host bin is available');
});

// isItemReachable / skipPreps: the new gating predicate must reproduce
// today's exact behavior at the default (skipPreps: []), and correctly
// exclude glass-cutter items only when explicitly skipped.
const GLASS_CUTTER_ITEM_IDS = ['0-A', '2-B', '2-C', '2-H', '2-K'];

test('isItemReachable: default skipPreps ([]) reproduces pre-2026-08-23 behavior exactly (only crew size gates)', () => {
  for (const itemId of GLASS_CUTTER_ITEM_IDS) {
    const cat = itemById(catalog, itemId);
    assert.ok(isItemReachable(cat, { players: 4, skipPreps: [] }), `${itemId} should be reachable by default`);
  }
});

test('isItemReachable: skipPreps excludes glass-cutter items, and only those', () => {
  const state = { players: 4, skipPreps: ['glass-cutter'] };
  for (const itemId of GLASS_CUTTER_ITEM_IDS) {
    assert.equal(isItemReachable(itemById(catalog, itemId), state), false, `${itemId} should be excluded`);
  }
  const nonGatedItem = catalog.find(c => !(c.requiresPreps || []).length && c.minPlayers <= 4);
  assert.ok(isItemReachable(nonGatedItem, state), 'a non-gated item must remain reachable');
});

test('runOptimizer: skipPreps excludes the 5 glass-cutter items from selection entirely', () => {
  const values = {};
  for (const it of catalog) values[it.itemId] = 40000; // scope everything
  const baseline = runOptimizer(stateFor(lootFor(values), { players: 4 }), catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
  const skipped = runOptimizer(stateFor(lootFor(values), { players: 4, skipPreps: ['glass-cutter'] }), catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);

  for (const itemId of GLASS_CUTTER_ITEM_IDS) {
    assert.ok(!skipped.chosenIds.has(itemId), `${itemId} must never be chosen when its prep is skipped`);
  }
  // Sanity: at least plausible that the baseline run (preps assumed done)
  // could include some of them — not asserted strictly equal since the
  // knapsack may or may not select every gated item depending on value
  // density, but the excluded set must never include anything selected.
  assert.ok(baseline.secondaryBagValue >= skipped.secondaryBagValue, 'excluding items can only reduce or match achievable value');
});

// Fuzz: across random scope-outs, experimentalPacking must never overflow
// a bag and must never change total secondary value or item selection —
// mirrors the existing fuzz test in test/pack-bins.test.js.
test('fuzz: experimentalPacking never overflows a bag and never changes value/selection vs the default split', () => {
  let checked = 0;
  for (let trial = 0; trial < 300; trial++) {
    const players = 1 + Math.floor(Math.random() * 4); // 1..4
    const elite = Math.random() < 0.5 ? 'yes' : 'no';
    const eligibleForBC = catalog.filter(c => c.minPlayers <= players && c.valueType !== 'checkbox' && c.buyersChoiceEligible !== false);
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
    const baseState = { primaryId: 'x', difficulty: Math.random() < 0.5 ? 'hard' : 'normal', weekly: 'first', players, elite, skipPreps: [], loot };

    const defaultResult = runOptimizer(baseState, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
    const experimentalResult = runOptimizer({ ...baseState, experimentalPacking: true }, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
    checked++;

    experimentalResult.bags.forEach((bag, i) => {
      assert.ok(
        bag.weightUsed <= BAG_CAPACITY_PER_PLAYER,
        `trial ${trial}, players ${players}: experimental bag ${i} overflowed at ${bag.weightUsed}/${BAG_CAPACITY_PER_PLAYER}`
      );
    });
    assert.equal(experimentalResult.secondaryBagValue, defaultResult.secondaryBagValue, `trial ${trial}: value must be unchanged`);
    assert.deepEqual(
      [...experimentalResult.chosenIds].sort(),
      [...defaultResult.chosenIds].sort(),
      `trial ${trial}: item selection must be unchanged`
    );
  }
  assert.ok(checked > 0);
});
