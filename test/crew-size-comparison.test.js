import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compareCrewSizes, runOptimizer, DEFAULT_BONUS_CONSTANTS } from '../js/kch-model.js';

function loadJSON(relUrl) {
  return JSON.parse(fs.readFileSync(new URL(relUrl, import.meta.url), 'utf8'));
}

const catalog = loadJSON('../data/secondary-loot.json').items;
const fixture = loadJSON('../fixtures/sample-run.json');
const BAG_CAPACITY_PER_PLAYER = 100;

// This fixture has eliteChallengeAttempted: true with a valid 3-item
// Buyer's Choice set (including 2-H, a Crisp Gallery item) — exactly the
// case compareCrewSizes() needs to ignore, not just default around.
function fixtureState(players) {
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

test('compareCrewSizes returns exactly 4 entries, players 1 through 4 in order', () => {
  const results = compareCrewSizes(fixtureState(2), catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
  assert.equal(results.length, 4);
  assert.deepEqual(results.map(r => r.players), [1, 2, 3, 4]);
  for (const r of results) {
    assert.ok('secondaryBagValue' in r);
    assert.ok('secondaryShareEach' in r);
    assert.ok('secondaryBagValueWithElite' in r);
    assert.ok('secondaryShareEachWithElite' in r);
  }
});

test('each entry matches calling runOptimizer directly with that player count and elite forced off', () => {
  // Feed in the fixture's real players value (2) — compareCrewSizes should
  // ignore it entirely and produce its own 1-4 sweep regardless.
  const results = compareCrewSizes(fixtureState(2), catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
  for (const r of results) {
    const direct = runOptimizer({ ...fixtureState(2), players: r.players, elite: 'no' }, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
    assert.equal(r.secondaryBagValue, direct.secondaryBagValue, `players=${r.players}`);
    assert.equal(r.secondaryShareEach, direct.secondaryShareEach, `players=${r.players}`);
  }
});

test('ignores the caller\'s actual Elite Challenge/Buyer\'s Choice status, not just a default', () => {
  // The fixture has elite: 'yes' with a valid, fully-reachable 3-item
  // Buyer's Choice set at 3 players — a real "attempted" run, not an edge
  // case. If compareCrewSizes actually respected state.elite instead of
  // overriding it, this would run the BC-constrained pack instead of the
  // pure value-max one.
  const withEliteYes = compareCrewSizes(fixtureState(3), catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
  const constrained = runOptimizer(fixtureState(3), catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
  const unconstrained = runOptimizer({ ...fixtureState(3), elite: 'no' }, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);

  const at3 = withEliteYes.find(r => r.players === 3);
  assert.equal(at3.secondaryBagValue, unconstrained.secondaryBagValue, 'compareCrewSizes must match the unconstrained (Elite-off) pack');
  // Sanity check the fixture actually exercises a real "attempted" branch
  // (constrained and unconstrained agreeing here would make this test
  // vacuous — they don't have to differ in value, but attempted must be
  // true for the constrained call to prove anything).
  assert.equal(constrained.attempted, true, 'fixture must actually attempt Elite Challenge at 3 players for this test to mean anything');
});

test('crew-size eligibility difference is visible: 1 player loses access to Crisp Gallery items', () => {
  const results = compareCrewSizes(fixtureState(2), catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
  const at1 = results.find(r => r.players === 1);
  const at2 = results.find(r => r.players === 2);

  // The fixture scopes several high-value Crisp Gallery items (2-E through
  // 2-M), all minPlayers: 2 — none of them can appear in the 1-player
  // pack, so the achievable secondary share should be meaningfully lower
  // there, not just "the same total split one more way."
  assert.ok(at1.secondaryShareEach < at2.secondaryShareEach,
    `expected 1-player share (${at1.secondaryShareEach}) to be lower than 2-player share (${at2.secondaryShareEach}) due to lost Crisp Gallery eligibility`);
});

// Regression coverage for the 2026-08-07 two-column addition: a "With
// Elite" column alongside the existing "No Elite" one, forcing elite:
// 'yes' with the run's real Buyer's Choice marks at each crew size.

test('the With-Elite column matches a direct runOptimizer call with elite forced on, at every crew size', () => {
  const results = compareCrewSizes(fixtureState(2), catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
  for (const r of results) {
    const direct = runOptimizer({ ...fixtureState(2), players: r.players, elite: 'yes' }, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
    assert.equal(r.secondaryBagValueWithElite, direct.secondaryBagValue, `players=${r.players}`);
    assert.equal(r.secondaryShareEachWithElite, direct.secondaryShareEach, `players=${r.players}`);
  }
});

test('No-Elite and With-Elite columns can diverge sharply when Buyer\'s Choice genuinely constrains packing', () => {
  // Solo run, 100-capacity bag. B-A (unmarked, weight 50) is worth far
  // more than 0-A + 2-B combined (both marked, weight 30 each). Without
  // Elite, the value-max pack keeps B-A plus whichever marked item still
  // fits (weight 50+30=80). With Elite, both marked items are forced in
  // (weight 60), crowding out B-A entirely (60+50=110 > 100 capacity).
  const state = {
    primaryId: 'la-derniere-debauche', difficulty: 'normal', weekly: 'first',
    players: 1, elite: 'no',
    loot: catalog.map(cat => {
      if (cat.itemId === 'B-A') return { itemId: cat.itemId, value: 1000000, buyersChoice: false };
      if (cat.itemId === '0-A' || cat.itemId === '2-B') return { itemId: cat.itemId, value: 10000, buyersChoice: true };
      return { itemId: cat.itemId, value: '', buyersChoice: false };
    })
  };
  const results = compareCrewSizes(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
  const at1 = results.find(r => r.players === 1);

  assert.equal(at1.secondaryShareEach, 1010000, 'without Elite, the pack keeps B-A plus one marked item');
  assert.equal(at1.secondaryShareEachWithElite, 20000, 'with Elite, both marked items are forced in, crowding out B-A entirely');
});
