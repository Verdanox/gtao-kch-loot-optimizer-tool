import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runOptimizer, knapsack, itemById, DEFAULT_BONUS_CONSTANTS } from '../js/kch-model.js';

function loadJSON(relUrl) {
  return JSON.parse(fs.readFileSync(new URL(relUrl, import.meta.url), 'utf8'));
}

const catalog = loadJSON('../data/secondary-loot.json').items;
const fixture = loadJSON('../fixtures/sample-run.json');
const BAG_CAPACITY_PER_PLAYER = 100;

// Builds a Page-1-shaped state from fixtures/sample-run.json for a given
// player count, matching the real app's { itemId, value, buyersChoice }
// loot-row shape.
function stateForPlayers(players) {
  return {
    primaryId: fixture.primaryTarget.id,
    difficulty: fixture.primaryTarget.hardMode ? 'hard' : 'normal',
    weekly: fixture.primaryTarget.firstTimeThisWeek ? 'first' : 'repeat',
    players,
    elite: fixture.eliteChallengeAttempted ? 'yes' : 'no',
    loot: catalog.map(cat => ({
      itemId: cat.itemId,
      value: Object.prototype.hasOwnProperty.call(fixture.secondaryLoot, cat.itemId)
        ? fixture.secondaryLoot[cat.itemId]
        : '',
      buyersChoice: fixture.buyersChoice.includes(cat.itemId)
    }))
  };
}

for (const players of fixture.testPlayerCounts) {
  test(`sample-run fixture at ${players} players: Buyer's Choice fully packed, no overflow, both bonuses present`, () => {
    const state = stateForPlayers(players);
    const r = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);

    assert.equal(r.overflow, false, `expected no overflow at ${players} players`);
    assert.equal(r.allBuyerItemsFit, true);
    assert.deepEqual(r.bcIneligibleIds, []);
    assert.ok(r.buyerRequestBonusEach > 0, 'buyer request bonus should be earned');
    assert.ok(r.eliteBonusEach > 0, 'elite bonus should be earned at the model level');
    // All three Buyer's Choice items must actually be in the chosen set.
    for (const id of fixture.buyersChoice) {
      assert.ok(r.chosenIds.has(id), `expected ${id} to be packed at ${players} players`);
    }
  });
}

test('sample-run fixture at 1 player: illegal combo is flagged, not crashed or silently valid', () => {
  const state = stateForPlayers(1);
  const r = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);

  // 2-H (Gemstone, Crisp Gallery) requires minPlayers: 2 and is marked
  // Buyer's Choice — unreachable solo, so this exact scope is illegal.
  assert.equal(r.attempted, true);
  assert.equal(r.allBuyerItemsFit, false);
  assert.equal(r.overflow, true);
  assert.deepEqual(r.bcIneligibleIds, ['2-H']);
  assert.equal(r.buyerRequestBonusEach, 0);
  assert.equal(r.eliteBonusEach, 0);
  // Still produces a coherent (not NaN/undefined) packed result rather than crashing.
  assert.equal(typeof r.secondaryBagValue, 'number');
  assert.ok(!Number.isNaN(r.secondaryBagValue));
  assert.equal(r.bags.length, 1);
});

for (const players of fixture.testPlayerCounts) {
  test(`sample-run fixture at ${players} players: secondaryShareEach and helperBonusEach are correct`, () => {
    const state = stateForPlayers(players);
    const r = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
    assert.equal(r.secondaryShareEach, r.secondaryBagValue / players);
    const expectedHelper = state.difficulty === 'hard' ? DEFAULT_BONUS_CONSTANTS.helperHard : DEFAULT_BONUS_CONSTANTS.helperNormal;
    assert.equal(r.helperBonusEach, expectedHelper);
  });
}

test('sample-run fixture at 1 player: reachable Buyer\'s Choice items are NOT force-locked once the pick is already illegal', () => {
  // Regression test for the "drop Buyer's Choice weighting entirely" fix:
  // 2-H is unreachable solo, which already guarantees forfeiture — 1-D and
  // 1-E (the other two marked items, both minPlayers: 1) must no longer be
  // force-included in the mandatory knapsack, since that could only cost
  // bag value for a bonus that can never pay out. Packing should fall back
  // to the exact same unconstrained value-max knapsack used when Elite
  // isn't attempted at all.
  const state = stateForPlayers(1);
  const r = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);

  const totalUnits = 1 * BAG_CAPACITY_PER_PLAYER;
  const eligible = Object.keys(fixture.secondaryLoot)
    .map(itemId => ({ itemId, value: fixture.secondaryLoot[itemId] }))
    .filter(l => itemById(catalog, l.itemId).minPlayers <= 1)
    .map(l => ({ id: l.itemId, value: Number(l.value), weightUnits: itemById(catalog, l.itemId).weight }));
  const expected = knapsack(eligible, totalUnits);

  assert.equal(r.secondaryBagValue, expected.value);
  assert.deepEqual([...r.chosenIds].sort(), [...expected.chosenIds].sort());
});

// Regression coverage for the 2026-08-03 fix: Elite Challenge needs at
// least 2 Buyer's Choice picks to ever be a real contract — 0 and 1 must
// resolve identically ("not attempted"), and 2/3 must work as before.
function stateWithBcCount(count) {
  const bcIds = catalog.filter(c => c.minPlayers <= 3 && c.valueType !== 'checkbox').slice(0, count).map(c => c.itemId);
  return {
    primaryId: 'la-derniere-debauche', difficulty: 'normal', weekly: 'first',
    players: 3, elite: 'yes',
    loot: catalog.map(cat => ({
      itemId: cat.itemId,
      value: cat.minPlayers <= 3 ? 50000 : '',
      buyersChoice: bcIds.includes(cat.itemId)
    }))
  };
}

for (const count of [0, 1]) {
  test(`Elite Challenge with ${count} Buyer's Choice pick(s): not attempted, no bonus`, () => {
    const state = stateWithBcCount(count);
    const r = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
    assert.equal(r.attempted, false);
    assert.equal(r.overflow, false);
    assert.equal(r.buyerRequestBonusEach, 0);
    assert.equal(r.eliteBonusEach, 0);
  });
}

for (const count of [2, 3]) {
  test(`Elite Challenge with ${count} Buyer's Choice picks: attempted normally`, () => {
    const state = stateWithBcCount(count);
    const r = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
    assert.equal(r.attempted, true);
  });
}

// Regression coverage for the 2026-08-07 fix: Buyer's Request bonus is
// decoupled from the Elite Challenge toggle — it's earned whenever the
// chosen bag selection happens to include every marked-and-scoped item,
// even with Elite off. Real bug report: a 3-player run whose value-max
// unconstrained pack naturally contained all the marked items, but the
// bonus still showed as unearned solely because Elite wasn't toggled on.
function stateWithElite(elite, overrides) {
  return {
    primaryId: 'la-derniere-debauche', difficulty: 'normal', weekly: 'first',
    players: 1, elite,
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

test("Buyer's Request bonus is earned with Elite off when the unconstrained pack happens to include every marked item", () => {
  // B-A and B-B are both Vault, weight 50, minPlayers 1 — with nothing
  // else scoped, both trivially fit together in one 100-capacity bag, so
  // the value-max unconstrained pack (Elite off) includes both anyway.
  const state = stateWithElite('no', {
    'B-A': { value: 100000, buyersChoice: true },
    'B-B': { value: 90000, buyersChoice: true }
  });
  const r = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
  assert.equal(r.attempted, false, 'Elite was never toggled on');
  assert.ok(r.chosenIds.has('B-A') && r.chosenIds.has('B-B'), 'both marked items should be packed');
  assert.ok(r.buyerRequestBonusEach > 0, 'Buyer\'s Request should be earned even though Elite was never attempted');
  assert.equal(r.eliteBonusEach, 0, 'Elite bonus stays gated behind the toggle, unaffected by this decoupling');
});

test("Buyer's Request bonus is NOT earned with Elite off when the unconstrained pack excludes one marked item", () => {
  // B-A, B-B, B-C are all Vault, weight 50 each, minPlayers 1 — three of
  // them (150 weight) can't all fit in a single 1-player 100-capacity
  // bag. The value-max pack keeps the two highest-value items (A, B) and
  // drops C, so not every marked item is packed.
  const state = stateWithElite('no', {
    'B-A': { value: 100000, buyersChoice: true },
    'B-B': { value: 90000, buyersChoice: true },
    'B-C': { value: 80000, buyersChoice: true }
  });
  const r = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
  assert.ok(r.chosenIds.has('B-A') && r.chosenIds.has('B-B'), 'the two highest-value marked items should still be packed');
  assert.ok(!r.chosenIds.has('B-C'), 'the lowest-value marked item should be left out by the value-max pack');
  assert.equal(r.buyerRequestBonusEach, 0, 'not every marked item was packed, so the bonus is not earned');
});

test("a single incidentally-packed marked item still does not earn Buyer's Request with Elite off (>=2-picks minimum applies either way)", () => {
  const state = stateWithElite('no', {
    'B-A': { value: 100000, buyersChoice: true }
  });
  const r = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
  assert.ok(r.chosenIds.has('B-A'), 'the only scoped item is trivially packed');
  assert.equal(r.buyerRequestBonusEach, 0, 'a single marked item never satisfies the Buyer\'s Choice contract, Elite or not');
});
