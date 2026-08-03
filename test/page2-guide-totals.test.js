import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runOptimizer, calcPrimary, computeGuidePayout, computeCareerProgress, DEFAULT_BONUS_CONSTANTS } from '../js/kch-model.js';

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
// "Payout" must equal secondaryShareEach (+ primary for the host, + the
// Helper bonus for non-hosts) + the Buyer's Request bonus ONLY. It must NOT
// also fold in the Elite Challenge bonus, even though runOptimizer()
// legitimately earns one at the model level (the Elite toggle still forces
// Buyer's Choice packing) — this asserts on the numeric total, not a
// rendered string.
test('guide Payout excludes the Elite Challenge bonus even when one was earned', () => {
  const players = 3;
  const state = stateForPlayers(players);
  const primary = calcPrimary(state, primaryData.targets, primaryData.multipliers);
  const r = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);

  // Sanity: the fixture at 3 players does earn both bonuses at model level.
  assert.ok(r.buyerRequestBonusEach > 0);
  assert.ok(r.eliteBonusEach > 0);

  for (let i = 0; i < players; i++) {
    const isHost = i === 0;
    const payout = computeGuidePayout({
      secondaryShareEach: r.secondaryShareEach,
      isHost,
      primaryValue: primary.value,
      buyerRequestBonusEach: r.buyerRequestBonusEach,
      helperBonusEach: r.helperBonusEach
    });

    const correctTotal = r.secondaryShareEach + r.buyerRequestBonusEach
      + (isHost ? primary.value : r.helperBonusEach);
    const wrongTotalWithElite = correctTotal + r.eliteBonusEach;

    assert.equal(payout, correctTotal, `player ${i} Payout should equal secondary share + Buyer's Request (+ primary or helper) only`);
    assert.notEqual(payout, wrongTotalWithElite, `player ${i} Payout must not include the Elite bonus`);
    assert.equal(wrongTotalWithElite - payout, r.eliteBonusEach, 'the excluded amount must be exactly the elite bonus');
  }
});

test('guide Payout with no bonuses earned is just the secondary share (host adds primary, no fee subtracted)', () => {
  // Force overflow by dropping to 1 player against the same fixture — both
  // bonuses are forfeited, so Payout should just be the share/primary math.
  const state = stateForPlayers(1);
  const primary = calcPrimary(state, primaryData.targets, primaryData.multipliers);
  const r = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
  assert.equal(r.buyerRequestBonusEach, 0);
  assert.equal(r.eliteBonusEach, 0);
  assert.ok(r.planningFee > 0, 'sanity: this fixture is a repeat run, so a planning fee is in play');

  const payout = computeGuidePayout({
    secondaryShareEach: r.secondaryShareEach,
    isHost: true,
    primaryValue: primary.value,
    buyerRequestBonusEach: r.buyerRequestBonusEach,
    helperBonusEach: r.helperBonusEach
  });
  assert.equal(payout, r.secondaryShareEach + primary.value);
});

// Regression test for the 2026-08-02 payout-model fix: every player's
// secondary-loot cut is the pooled total split evenly, never an
// individual bag's value — confirmed against two real GTA payout
// screenshots this session.
test('secondaryShareEach is the pooled secondary value split evenly across players', () => {
  for (const players of [2, 3, 4]) {
    const state = stateForPlayers(players);
    const r = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
    assert.equal(r.secondaryShareEach, r.secondaryBagValue / players);
  }
});

// Regression test: the repeat-run planning fee must never be netted
// against Payout (2026-08-02 user call — it's paid up front, a sunk cost
// by the time this screen matters). It's still surfaced separately via
// runOptimizer()'s planningFee field for guide.html's own informational
// line item, just never subtracted here.
test('the repeat-run planning fee is never subtracted from computeGuidePayout', () => {
  const state = stateForPlayers(1);
  const primary = calcPrimary(state, primaryData.targets, primaryData.multipliers);
  const r = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
  assert.ok(r.planningFee > 0);

  const payout = computeGuidePayout({
    secondaryShareEach: r.secondaryShareEach,
    isHost: true,
    primaryValue: primary.value,
    buyerRequestBonusEach: r.buyerRequestBonusEach,
    helperBonusEach: r.helperBonusEach
  });
  const payoutIfFeeWereSubtracted = payout - r.planningFee;
  assert.notEqual(payout, payoutIfFeeWereSubtracted, 'sanity: the fee is actually nonzero here');
  assert.equal(payout, r.secondaryShareEach + primary.value, 'planning fee must not appear in the Payout total at all');
});

// Regression tests for the unconditional Helper bonus (2026-08-02): every
// non-host player earns it, the host never does, and it's additive on top
// of the secondary share and Buyer's Request bonus, not a replacement.
test('every non-host player earns the flat Helper bonus on top of everything else, at both difficulties', () => {
  for (const [difficulty, expectedHelper] of [['normal', DEFAULT_BONUS_CONSTANTS.helperNormal], ['hard', DEFAULT_BONUS_CONSTANTS.helperHard]]) {
    const state = { ...stateForPlayers(3), difficulty };
    const r = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
    assert.equal(r.helperBonusEach, expectedHelper);

    const payout = computeGuidePayout({
      secondaryShareEach: r.secondaryShareEach,
      isHost: false,
      primaryValue: 0,
      buyerRequestBonusEach: r.buyerRequestBonusEach,
      helperBonusEach: r.helperBonusEach
    });
    assert.equal(payout, r.secondaryShareEach + r.buyerRequestBonusEach + expectedHelper);
  }
});

test('the host never receives the Helper bonus', () => {
  const state = stateForPlayers(3);
  const primary = calcPrimary(state, primaryData.targets, primaryData.multipliers);
  const r = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
  assert.ok(r.helperBonusEach > 0, 'sanity: the helper bonus is nonzero this run');

  const hostPayout = computeGuidePayout({
    secondaryShareEach: r.secondaryShareEach,
    isHost: true,
    primaryValue: primary.value,
    buyerRequestBonusEach: r.buyerRequestBonusEach,
    helperBonusEach: r.helperBonusEach
  });
  assert.equal(hostPayout, r.secondaryShareEach + r.buyerRequestBonusEach + primary.value);
});

// Regression tests for computeCareerProgress (2026-08-02, new): excludes
// every bonus (Buyer's Request, Elite, Helper) for everyone, host
// included — only primary/secondary loot values count.
test('computeCareerProgress excludes Buyer\'s Request, Elite, and Helper bonuses for both host and non-host', () => {
  const players = 3;
  const state = stateForPlayers(players);
  const primary = calcPrimary(state, primaryData.targets, primaryData.multipliers);
  const r = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
  assert.ok(r.buyerRequestBonusEach > 0 && r.eliteBonusEach > 0 && r.helperBonusEach > 0, 'sanity: all three bonuses are earned this run');

  const hostCareer = computeCareerProgress({ secondaryShareEach: r.secondaryShareEach, isHost: true, primaryValue: primary.value });
  assert.equal(hostCareer, primary.value + r.secondaryShareEach);

  const nonHostCareer = computeCareerProgress({ secondaryShareEach: r.secondaryShareEach, isHost: false, primaryValue: primary.value });
  assert.equal(nonHostCareer, r.secondaryShareEach);
});

// Encodes "bag assignment has zero economic effect on payout" as a
// permanent regression guard: Payout and Career Progress only ever
// depend on secondaryShareEach (identical for every player), never on
// any individual bag's contents.
test('Payout and Career Progress are identical for every non-host player regardless of individual bag contents', () => {
  const players = 3;
  const state = stateForPlayers(players);
  const r = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);

  // Bag values differ per player (real packing output) — Payout/Career
  // Progress must not, since neither function ever looks at bag.value.
  const bagValues = r.bags.slice(1).map(b => b.value);
  assert.ok(new Set(bagValues).size > 1, 'sanity: this fixture actually produces different bag values across non-host players');

  const payouts = new Set();
  const careers = new Set();
  for (let i = 1; i < players; i++) {
    payouts.add(computeGuidePayout({
      secondaryShareEach: r.secondaryShareEach, isHost: false, primaryValue: 0,
      buyerRequestBonusEach: r.buyerRequestBonusEach, helperBonusEach: r.helperBonusEach
    }));
    careers.add(computeCareerProgress({ secondaryShareEach: r.secondaryShareEach, isHost: false, primaryValue: 0 }));
  }
  assert.equal(payouts.size, 1, 'every non-host player should have an identical Payout');
  assert.equal(careers.size, 1, 'every non-host player should have an identical Career Progress');
});
