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
  // Filler must itself genuinely fill bin 0 before G is ever considered.
  // 2026-08-09: priority-floor items are walked ahead of every other
  // floor, so a 'First'-floor filler no longer gets a head start (G would
  // just claim bin 0 first, defeating the point of this test). 2026-08-10:
  // Crisp Gallery now also outranks Second *within* the priority bucket,
  // so a 'Second' filler no longer gets a head start on G either — only
  // an earlier-order Crisp Gallery item can genuinely fill bin 0 ahead of
  // this one. Filler is also NOT 'Vault' — a Vault filler would get
  // routed away from bin 0 by tier 0 (2026-08-07), which would leave the
  // host bin free and defeat the point of this test.
  const mandatory = [{ id: 'A', value: 1000, weightUnits: 100, floor: 'Crisp Gallery', order: 0 }]; // fills bin 0 completely
  const optional = [{ id: 'G', value: 50, weightUnits: 10, floor: 'Crisp Gallery', order: 1 }];
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
  // 'Loading Bay' (not 'First' or 'Alarm Floor') for F: First is adjacent
  // to Second, which would let F legitimately tier-3-cluster into whatever
  // bin S landed in; Alarm Floor is a tier-0 host-avoid floor as of
  // 2026-08-14, which would route F away from bin 0 on its own and no
  // longer isolate this test to the priority-reordering behavior it's
  // meant to cover. Loading Bay is neutral (neither avoid nor priority)
  // and isolated (no adjacency to anything), so it isolates this test to
  // the priority-reordering behavior alone.
  const optional = [
    { id: 'F', value: 50, weightUnits: 30, floor: 'Loading Bay', order: 0 }, // earlier catalog position, non-priority
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

// Regression coverage for a real 2026-08-10 bug report: when combined
// Second + Crisp Gallery weight overflows one host bag, a Second item
// (earlier in catalog order, so walked first under the old plain-order
// tiebreak within the priority bucket) claimed the host bag first,
// leaving no room for a Crisp Gallery item that arrived later — backwards
// from Crisp Gallery's stronger (EMP-desync) host-preference rationale
// vs. Second's softer one. S(60) + G(50) = 110 can't both fit in one
// 100-capacity bag, so exactly one of them must fall through — it must
// be S, regardless of S having the earlier catalog `order`.
test('Crisp Gallery outranks Second when both compete for the host bin', () => {
  const optional = [
    { id: 'S', value: 100, weightUnits: 60, floor: 'Second', order: 0 },
    { id: 'G', value: 100, weightUnits: 50, floor: 'Crisp Gallery', order: 1 },
  ];
  const result = packBins([], optional, 2, 100);
  assert.ok(result);
  assert.equal(result.value, 200, 'both items still fit somewhere across the two bags — this is purely a routing preference');
  const bagOf = (id) => result.bags.findIndex(b => b.items.some(i => i.id === id));
  assert.equal(bagOf('G'), 0, 'Crisp Gallery should claim the host bag despite its later catalog order');
  assert.notEqual(bagOf('S'), 0, 'Second should fall through to the non-host bag once Crisp Gallery has claimed the host\'s only available room');
});

// Regression coverage for a real 2026-08-15 bug report: four *optional*
// Crisp Gallery items were walked (largest-first, per the 2026-08-13 fix)
// and greedily claimed 80 of the host's 100 capacity before a *mandatory*
// Second item (weight 30) ever got a turn — only 20 capacity remained, not
// enough for it, so the mandatory item was forced into the non-host bag
// purely because of processing order. Fixed by walking mandatory
// priority-floor items ahead of optional ones in the same pool (see
// packBins()'s `mandatoryRank`). M(30, Second, mandatory) plus four
// optional Crisp Gallery items (30, 20, 20, 10 = 80) sum to exactly 110 —
// can't all fit in one 100-capacity host bag, so something must fall
// through. It must be one of the optional items, not the mandatory one.
test('a mandatory priority-floor item claims host capacity ahead of optional priority-floor items on the OTHER priority floor', () => {
  const mandatory = [
    { id: 'M', value: 500, weightUnits: 30, floor: 'Second', order: 10 },
  ];
  const optional = [
    { id: 'G1', value: 100, weightUnits: 30, floor: 'Crisp Gallery', order: 0 },
    { id: 'G2', value: 100, weightUnits: 20, floor: 'Crisp Gallery', order: 1 },
    { id: 'G3', value: 100, weightUnits: 20, floor: 'Crisp Gallery', order: 2 },
    { id: 'G4', value: 100, weightUnits: 10, floor: 'Crisp Gallery', order: 3 },
  ];
  const result = packBins(mandatory, optional, 2, 100);
  assert.ok(result);
  const bagOf = (id) => result.bags.findIndex(b => b.items.some(i => i.id === id));
  assert.equal(bagOf('M'), 0, 'the mandatory Second item must land in the host bag, not be crowded out by optional Crisp Gallery items processed first');
});

// Guards the "reject full pooling" decision documented in packBins():
// mandatoryRank must stay a no-op when neither competing item is
// mandatory, so Crisp Gallery's stronger EMP-desync preference still wins
// optional-vs-optional ties — this is the same scenario as 'Crisp Gallery
// outranks Second when both compete for the host bin' above, asserted
// again explicitly here so a future change to mandatoryRank's placement in
// the sort can't silently re-break it without failing a test right next to
// the fix that could cause it.
test('mandatoryRank is a no-op between two optional priority-floor items — Crisp Gallery still outranks Second', () => {
  const optional = [
    { id: 'S', value: 100, weightUnits: 60, floor: 'Second', order: 0 },
    { id: 'G', value: 100, weightUnits: 50, floor: 'Crisp Gallery', order: 1 },
  ];
  const result = packBins([], optional, 2, 100);
  assert.ok(result);
  const bagOf = (id) => result.bags.findIndex(b => b.items.some(i => i.id === id));
  assert.equal(bagOf('G'), 0, 'Crisp Gallery should still claim the host bag over Second when neither item is mandatory');
});

// Full-catalog regression test replaying the real 2026-08-15 bug report
// scope-out (2 players, Elite on, Buyer's Choice: Antique Rings (1-B),
// Coquard Bracelets (2-D), Horse Statue (2-C)). Before this fix, the host
// bag ended up with a First-floor stray (Antique Rings) mixed into an
// otherwise Second/Crisp-Gallery bag, while Horse Statue (mandatory,
// Second) fell through to the non-host player alongside Loading Bay, Alarm
// Floor, and First — a 4-floor mishmash. After this fix, the host bag is
// exactly Second + Crisp Gallery, with Horse Statue included.
test('real 2026-08-15 scope-out: host bag is entirely Second/Crisp Gallery, no First-floor stray', () => {
  const values = {
    'B-A': 77500, 'B-B': 82500, 'B-D': 90000,
    'BAY': 105000,
    '0-A': 90000, '0-B': 50000,
    '1-A': 56000, '1-B': 30000, '1-E': 112500, '1-F': 105000, '1-G': 115000,
    '1-H': 107500, '1-I': 122500, '1-J': 122500, '1-K': 34000,
    '2-C': 97500, '2-D': 34000,
    '2-E': 152500, '2-F': 150000, '2-G': 76000, '2-H': 112500, '2-I': 90000, '2-J': 43000,
    '2-L': 112500, '2-M': 112500,
  };
  const bcIds = new Set(['1-B', '2-C', '2-D']); // Antique Rings, Horse Statue, Coquard Bracelets
  const loot = catalog.map(cat => ({
    itemId: cat.itemId,
    value: Object.prototype.hasOwnProperty.call(values, cat.itemId) ? values[cat.itemId] : '',
    buyersChoice: bcIds.has(cat.itemId)
  }));
  const state = { primaryId: 'x', difficulty: 'normal', weekly: 'no', players: 2, elite: 'yes', loot };
  const result = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);

  assert.equal(result.secondaryBagValue, 712000, 'total secondary value is unaffected by routing');
  const hostFloors = new Set(result.bags[0].items.map(i => i.floor));
  assert.deepEqual(hostFloors, new Set(['Second', 'Crisp Gallery']), 'host bag should be entirely Second/Crisp Gallery — no First-floor detour needed');
  const hostIds = result.bags[0].items.map(i => i.itemId);
  assert.ok(hostIds.includes('2-C'), 'the mandatory Horse Statue should land in the host bag, not be crowded out by optional Crisp Gallery items');
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

// Regression coverage for the 2026-08-14 extension of HOST_AVOID_FLOORS to
// Alarm Floor (user request, live-execution pathing complaint): the host's
// real route is Vault -> building 2nd floor (Second/Crisp Gallery, tier 1)
// and never passes through Alarm Floor (FLOOR_ADJACENCY: Alarm Floor only
// touches First), so a host bag that also picked up Alarm Floor loot forced
// a real backtrack. Mirrors the existing Vault-avoidance test block above —
// same tier-0 mechanism, now covering a second floor.
test('Alarm Floor items exclude the host bag but still floor-cluster together via tier 2', () => {
  const mandatory = [{ id: 'A', value: 500, weightUnits: 60, floor: 'Alarm Floor' }];
  const optional = [
    { id: 'V', value: 50, weightUnits: 30, floor: 'Alarm Floor' },
    { id: 'L', value: 50, weightUnits: 30, floor: 'Loading Bay' },
  ];
  const result = packBins(mandatory, optional, 2, 100);
  assert.ok(result);
  const bagOf = (id) => result.bags.findIndex(b => b.items.some(i => i.id === id));
  assert.notEqual(bagOf('A'), 0, 'Alarm Floor items should never land in the host bag when a non-host bag is available');
  assert.equal(bagOf('V'), bagOf('A'), 'V shares A\'s floor and should still cluster via tier 2 among non-host bags');
  assert.equal(bagOf('L'), 0, 'Loading Bay is unaffected by Alarm Floor host-avoidance and falls back to the emptier (host) bag via tier 4');
});

test('a lone Alarm Floor item is routed away from the host bag when a non-host bag is available', () => {
  const mandatory = [{ id: 'A', value: 100, weightUnits: 50, floor: 'Alarm Floor' }];
  const result = packBins(mandatory, [], 2, 100);
  assert.ok(result);
  assert.equal(result.bags[0].items.length, 0, 'host bag should stay empty when a non-host bag can take the Alarm Floor item instead');
  assert.ok(result.bags[1].items.some(i => i.id === 'A'), 'Alarm Floor item should land in the non-host bag');
});

test('an Alarm Floor item still packs into the host bag when it is the only bag (solo run)', () => {
  const mandatory = [{ id: 'A', value: 100, weightUnits: 50, floor: 'Alarm Floor' }];
  const result = packBins(mandatory, [], 1, 100);
  assert.ok(result);
  assert.ok(result.bags[0].items.some(i => i.id === 'A'), 'with only one bag, the Alarm Floor item must still be packed into it');
});

test('an Alarm Floor item falls back to the host bag when the non-host bag no longer has room', () => {
  const mandatory = [
    { id: 'A', value: 100, weightUnits: 90, floor: 'Alarm Floor' },
    { id: 'B', value: 100, weightUnits: 50, floor: 'Alarm Floor' },
  ];
  const result = packBins(mandatory, [], 2, 100);
  assert.ok(result);
  const bagOf = (id) => result.bags.findIndex(b => b.items.some(i => i.id === id));
  assert.equal(bagOf('A'), 1, 'first Alarm Floor item routes to the non-host bag');
  assert.equal(bagOf('B'), 0, 'second Alarm Floor item falls back to the host bag once the non-host bag lacks room');
});

test('Alarm Floor avoidance (tier 0) and Second-floor host priority (tier 1) coexist without fighting each other', () => {
  // A mixed scope-out: Alarm Floor loot should route away from the host
  // while Second-floor loot still routes toward the host, on the very same
  // reconstruction pass, at a real 2-player crew size.
  const mandatory = [
    { id: 'A', value: 100, weightUnits: 40, floor: 'Alarm Floor' },
    { id: 'S', value: 100, weightUnits: 40, floor: 'Second' },
  ];
  const result = packBins(mandatory, [], 2, 100);
  assert.ok(result);
  const bagOf = (id) => result.bags.findIndex(b => b.items.some(i => i.id === id));
  assert.notEqual(bagOf('A'), 0, 'Alarm Floor item should still be routed away from the host bag');
  assert.equal(bagOf('S'), 0, 'Second-floor item should still be routed toward the host bag');
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
  // 'First' (not 'Alarm Floor') for A: Alarm Floor is a tier-0 host-avoid
  // floor as of 2026-08-14, same as Vault — with only 2 bins, two
  // independently host-avoided items would both get pushed into the same
  // non-host bin regardless of adjacency, defeating the point of this
  // test. 'First' is neither avoid nor priority, so A lands in the host
  // bin via the normal tier-4 tie-break, isolating this to Vault's actual
  // adjacency (rather than tier-0) behavior.
  const mandatory = [{ id: 'A', value: 100, weightUnits: 50, floor: 'First' }];
  const optional = [{ id: 'B', value: 50, weightUnits: 20, floor: 'Vault' }];
  const result = packBins(mandatory, optional, 2, 100);
  assert.ok(result);
  const bagOf = (id) => result.bags.findIndex(b => b.items.some(i => i.id === id));
  assert.notEqual(bagOf('B'), bagOf('A'), 'Vault is isolated and should not adjacency-cluster with First');
});

test('adjacent-floor preference falls through gracefully when the only adjacent bin has no room', () => {
  // Filler ('Alarm Floor') and the incoming item ('First') are both
  // deliberately NOT HOST_PRIORITY_FLOORS (2026-08-09: those are now
  // walked ahead of every other floor, so using 'Second' here — as this
  // test originally did — would let B claim bin 0 via tier 1 before A
  // ever gets a chance to fill it, defeating the point of this test,
  // which is specifically about tier 3's adjacency fallback). Alarm Floor
  // is ALSO a tier-0 host-avoid floor as of 2026-08-14, so with two
  // symmetric empty bins, A lands in bin 1 (the only remaining valid bin
  // once tier 0 filters bin 0 out) rather than bin 0 — the test still
  // demonstrates the same principle (B prefers to cluster with A's
  // adjacent floor, but falls through to the OTHER bin once A's bin has
  // no room left), just with the bin indices swapped from before.
  const mandatory = [{ id: 'A', value: 1000, weightUnits: 100, floor: 'Alarm Floor' }]; // fills bin 1 completely (tier 0 routes it away from bin 0)
  const optional = [{ id: 'B', value: 50, weightUnits: 10, floor: 'First' }];
  const result = packBins(mandatory, optional, 2, 100);
  assert.ok(result);
  assert.equal(result.value, 1050, 'the adjacency preference should still pack B, just not with the full bin');
  assert.ok(result.bags[0].items.some(i => i.id === 'B'), 'adjacent-floor item should fall through to the non-full bin, not be dropped');
});

// Regression test for the real 2026-08-13 bug report: a 2-player run where
// five selected Crisp Gallery items (weights 20, 30(BC), 20(BC), 10, 30 —
// combined weight exactly 100, one full host bag) got split across BOTH
// bags because catalog order walked the four smaller items into the host
// bag first, leaving only 20 capacity free — not enough for the fifth,
// larger item (Venus d'Algernon, weight 30), which fell through to the
// teammate's bag while two unrelated First-floor items backfilled the
// host's leftover capacity, forcing an avoidable extra floor stop. Fixed
// by walking priority-floor items largest-weight-first (see packBins()'s
// 2026-08-13 sort comment) so the host bag fills with same-floor items in
// an order that actually finds the all-one-floor partition when one
// exists at the same total value.
test('largest priority-floor item is walked first, so a same-floor host bag is found instead of starving a late-order item into a cross-floor fallback', () => {
  const values = {
    'B-A':90000,'B-B':85000,'B-C':75000,'B-D':75000,
    'BAY':105000,
    '0-A':87500,'0-B':52000,
    '1-A':58000,'1-C':33000,'1-D':34000,'1-E':112500,'1-F':117500,'1-G':110000,'1-H':117500,'1-I':110000,'1-K':29000,'1-L':34000,
    '2-A':56000,'2-B':97500,'2-C':95000,'2-D':32000,
    '2-E':157500,'2-F':155000,'2-G':92000,'2-H':115000,'2-I':94000,'2-J':43000,'2-K':115000,
    '2-L':120000,'2-M':112500
  };
  const bcIds = new Set(['2-H', '2-I']); // Gemstone, Meteorite Fragment
  const loot = catalog.map(cat => ({
    itemId: cat.itemId,
    value: Object.prototype.hasOwnProperty.call(values, cat.itemId) ? values[cat.itemId] : '',
    buyersChoice: bcIds.has(cat.itemId)
  }));
  const state = { primaryId: 'x', difficulty: 'normal', weekly: 'first', players: 2, elite: 'yes', loot };
  const result = runOptimizer(state, catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);

  assert.equal(result.secondaryBagValue, 762500, 'total secondary value is unaffected by routing');
  const hostFloors = new Set(result.bags[0].items.map(i => i.floor));
  assert.deepEqual(hostFloors, new Set(['Crisp Gallery']), 'host bag should be entirely Crisp Gallery — no First-floor detour needed');
  const hostIds = result.bags[0].items.map(i => i.itemId).sort();
  assert.deepEqual(hostIds, ['2-G', '2-H', '2-I', '2-K'], 'host should carry all four selected Crisp Gallery items, including the larger, later-catalog-order Venus d\'Algernon');
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
