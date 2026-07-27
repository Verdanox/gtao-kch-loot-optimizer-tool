import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runOptimizer, calcPrimary, computeGuideTake, DEFAULT_BONUS_CONSTANTS } from '../js/kch-model.js';

function loadJSON(relUrl) {
  return JSON.parse(fs.readFileSync(new URL(relUrl, import.meta.url), 'utf8'));
}

const catalog = loadJSON('../data/secondary-loot.json').items;
const primaryData = loadJSON('../data/primary-targets.json');
const fixture = loadJSON('../fixtures/sample-run.json');
const BAG_CAPACITY_PER_PLAYER = 100;

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

// Regression test for the Elite-bonus-exclusion gotcha: Page 2's per-player
// "Take" must equal bag.value (+ primary/-fee for the host) + the Buyer's
// Request bonus ONLY. It must NOT also fold in the Elite Challenge bonus,
// even though runOptimizer() legitimately earns one at the model level
// (the Elite toggle still forces Buyer's Choice packing) — this asserts on
// the numeric total, not a rendered string.
test('guide Take excludes the Elite Challenge bonus even when one was earned', () => {
  const players = 3;
  const state = stateForPlayers(players);
  const primary = calcPrimary(state, primaryData.targets, primaryData.multipliers);
  const r = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);

  // Sanity: the fixture at 3 players does earn both bonuses at model level.
  assert.ok(r.buyerRequestBonusEach > 0);
  assert.ok(r.eliteBonusEach > 0);

  for (let i = 0; i < players; i++) {
    const isHost = i === 0;
    const bag = r.bags[i];
    const take = computeGuideTake({
      bagValue: bag.value,
      isHost,
      primaryValue: primary.value,
      planningFee: r.planningFee,
      buyerRequestBonusEach: r.buyerRequestBonusEach
    });

    const correctTotal = bag.value + r.buyerRequestBonusEach + (isHost ? (primary.value - r.planningFee) : 0);
    const wrongTotalWithElite = correctTotal + r.eliteBonusEach;

    assert.equal(take, correctTotal, `player ${i} Take should equal bag + Buyer's Request only`);
    assert.notEqual(take, wrongTotalWithElite, `player ${i} Take must not include the Elite bonus`);
    assert.equal(wrongTotalWithElite - take, r.eliteBonusEach, 'the excluded amount must be exactly the elite bonus');
  }
});

test('guide Take with no bonuses earned equals plain bag value (host adds primary, subtracts fee)', () => {
  // Force overflow by dropping to 1 player against the same fixture — both
  // bonuses are forfeited, so Take should just be the bag/primary math.
  const state = stateForPlayers(1);
  const primary = calcPrimary(state, primaryData.targets, primaryData.multipliers);
  const r = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
  assert.equal(r.buyerRequestBonusEach, 0);
  assert.equal(r.eliteBonusEach, 0);

  const bag = r.bags[0];
  const take = computeGuideTake({
    bagValue: bag.value,
    isHost: true,
    primaryValue: primary.value,
    planningFee: r.planningFee,
    buyerRequestBonusEach: r.buyerRequestBonusEach
  });
  assert.equal(take, bag.value + primary.value - r.planningFee);
});
