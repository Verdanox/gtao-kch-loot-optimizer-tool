// kch-model.js
//
// Pure model/logic layer for the Kortz Center Loot Ledger.
//
// HARD CONSTRAINT: this file must stay 100% free of `document`, `fetch`,
// and `localStorage` — every function here takes plain objects/strings as
// parameters and returns plain objects/strings. That's what lets both
// index.html and guide.html `import` it directly as an ES module, AND
// lets the Node test suite (test/*.test.js) `import` it with zero DOM
// polyfills or fakes. The actual localStorage.getItem/setItem calls, the
// fetch() calls for data/*.json, and any DOM rendering belong in each
// page's own <script type="module"> — never here.

export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'kch-loot-ledger:v1';

export const DEFAULT_BONUS_CONSTANTS = {
  buyerRequestNormal: 50000,
  buyerRequestHard: 100000,
  elitePerPlayerNormal: 50000,
  elitePerPlayerHard: 100000,
  helperNormal: 100000,
  helperHard: 200000,
  repeatRunFee: 100000
};

// ---------- formatting ----------
export function money(n) {
  const neg = n < 0;
  n = Math.round(Math.abs(n));
  return (neg ? '-' : '') + '$' + n.toLocaleString('en-US');
}

// ---------- catalog lookups ----------
export function itemById(catalog, itemId) {
  return catalog.find(i => i.itemId === itemId);
}

// ---------- bonus math ----------
// Buyer's Request, Elite Challenge, and the Helper bonus all double on
// Hard mode.
export function bonusAmounts(difficulty, bonusConstants) {
  const hard = difficulty === 'hard';
  return {
    buyerRequest: hard ? bonusConstants.buyerRequestHard : bonusConstants.buyerRequestNormal,
    elitePerPlayer: hard ? bonusConstants.elitePerPlayerHard : bonusConstants.elitePerPlayerNormal,
    helper: hard ? bonusConstants.helperHard : bonusConstants.helperNormal
  };
}

// ---------- primary target ----------
// Hard mode and first-week are the only two multipliers applied on top of
// a painting's base value. This affects primaryTarget.value only — never
// secondary loot, which is always the actual randomized amount observed
// in-game, regardless of difficulty.
export function calcPrimary(state, primaryTargets, primaryMultipliers) {
  const p = primaryTargets.find(t => t.id === state.primaryId);
  let base = p.baseValue;
  if (state.weekly === 'first') base *= primaryMultipliers.firstWeek;
  if (state.difficulty === 'hard') base *= primaryMultipliers.hard;
  // In-game payouts are whole dollars; round off float drift from the
  // multiplier math (e.g. 365000 * 1.10 === 401500.00000000006 in JS).
  return { value: Math.round(base), meta: p };
}

// ---------- knapsack ----------
// 0/1 knapsack: items = [{id, value, weightUnits}], capacityUnits -> {value, chosenIds}
export function knapsack(items, capacityUnits) {
  const n = items.length;
  if (n === 0 || capacityUnits <= 0) return { value: 0, chosenIds: [] };
  const dp = Array.from({ length: n + 1 }, () => new Array(capacityUnits + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    const it = items[i - 1];
    for (let c = 0; c <= capacityUnits; c++) {
      dp[i][c] = dp[i - 1][c];
      if (it.weightUnits <= c) {
        const cand = dp[i - 1][c - it.weightUnits] + it.value;
        if (cand > dp[i][c]) dp[i][c] = cand;
      }
    }
  }
  // backtrack
  let c = capacityUnits;
  const chosen = [];
  for (let i = n; i >= 1; i--) {
    if (dp[i][c] !== dp[i - 1][c]) {
      chosen.push(items[i - 1].id);
      c -= items[i - 1].weightUnits;
    }
  }
  return { value: dp[n][capacityUnits], chosenIds: chosen };
}

// Normal model's slight, best-effort host-routing preference (2026-07-26,
// direct from the notebook author via the user): the host tends to prefer
// Second/Crisp Gallery items specifically. `assignItemsToBags()` already
// gives the host first crack at every item (`bags.find` always checks bag
// 0 first) — the only gap is processing *order*: plain weight-descending
// sort means small Second/Crisp Gallery items get processed last and can
// find the host's bag already full of unrelated heavier items. Nudging
// their effective sort weight up (without ever exceeding a full-size
// item's real weight advantage) lets them win that race more often,
// without ever overriding capacity — if the host's bag is genuinely full
// when an item's turn comes up, it still falls through exactly as before.
//
// Shared with `packBins()` below (2026-08-04): confirmed via the host's
// real in-heist routing (mandatory Vault trip for the primary target
// naturally continues on to the building's 2nd floor — Second and Crisp
// Gallery) that the *same* two floors are the right host-priority set for
// packBins()'s own, unrelated tier-1 bin-choice mechanism. Vault and
// Loading Bay were deliberately considered and excluded — see packBins()'s
// tier-1 comment for why. assignItemsToBags()'s own sort-weight-boost
// mechanism below is otherwise untouched.
const HOST_PRIORITY_FLOORS = new Set(['Second', 'Crisp Gallery']);
const HOST_PRIORITY_BOOST = 8;

// First-Fit-Decreasing bin pack: distributes chosen items across `players`
// individual bags of `capacityPerPlayer` each. Index 0 is always the host.
// `items` may optionally carry a `floor` field (see HOST_PRIORITY_FLOORS
// above) — it only ever affects processing order, never which bag an item
// is capacity-checked against or its counted weight/value.
export function assignItemsToBags(items, players, capacityPerPlayer) {
  const bags = Array.from({ length: players }, () => ({ items: [], value: 0, weightUsed: 0 }));
  const sortKey = (it) => it.weight + (HOST_PRIORITY_FLOORS.has(it.floor) ? HOST_PRIORITY_BOOST : 0);
  const sorted = items.slice().sort((a, b) => sortKey(b) - sortKey(a));
  sorted.forEach(it => {
    let target = bags.find(b => b.weightUsed + it.weight <= capacityPerPlayer);
    if (!target) {
      target = bags.reduce((best, b) =>
        (capacityPerPlayer - b.weightUsed) > (capacityPerPlayer - best.weightUsed) ? b : best, bags[0]);
    }
    target.items.push(it);
    target.value += it.value;
    target.weightUsed += it.weight;
  });
  return bags;
}

// ---------- exact multi-bin (per-player) knapsack ----------
function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

// Exact bin-constrained knapsack: `mandatory` items must ALL be included;
// `optional` items are chosen to maximize total value, subject to the
// combined set being packable into `bins` bins of `capacityPerBin` each.
//
// This treats per-player bag capacity as a real constraint from the
// start. The old approach (pooled knapsack against players*capacity,
// then a separate First-Fit-Decreasing split into individual bags) could
// report a value the crew couldn't actually carry — fitting a pooled
// total doesn't guarantee the chosen items can be partitioned into
// fixed-size bins (real bug report, 2026-08-01: a bag showing 110%
// full). Bin packing is NP-hard in general, but tractable here because
// every catalog weight — and capacityPerBin — share a common factor
// (10, today). `unit` is computed as a GCD rather than hardcoded /10, so
// this stays correct (just a bigger, still-small search) if a future
// item ever broke that pattern; see the "power drill loot" note in
// secondary-loot.json's _notes for why that's not expected.
//
// Bin CHOICE during reconstruction (below) follows a four-tier
// preference, applied uniformly to mandatory and optional items alike —
// this replaced an earlier version (2026-08-02) that tried bin 0 first
// for literally every item, which is why Buyer's Choice loot always used
// to land entirely in the host's bag (a real bug, not a rule: mandatory
// items are processed first, while bins are still symmetric, so bin 0
// won that tie almost every time). All four tiers only ever choose
// AMONG bins already confirmed (via `solve()`) to preserve the DP's
// optimal total value — none of this can ever cost secondary value,
// which matters because every player's career progress is driven by
// that same total (see computeCareerProgress below), split evenly:
//   1. Second and Crisp Gallery items prefer bin 0 (the host) —
//      HOST_PRIORITY_FLOORS, shared with assignItemsToBags() above.
//      Crisp Gallery's own rationale (confirmed with the user
//      2026-08-02): the host is the more reliable player to verify
//      in-room presence when using an EMP, given known desync behavior
//      in that specific room. Second joined it 2026-08-04, confirmed via
//      real heist mechanics: the host must physically enter the Vault
//      for the primary target at every crew size, and Loading Bay is
//      mutually exclusive with that Vault visit — so the host's route
//      naturally continues on to the building's 2nd floor (Second +
//      Crisp Gallery) afterward. Vault and Loading Bay were deliberately
//      NOT added: the whole crew is physically present for the Vault
//      sequence (not just the host), so there's no logistics reason to
//      bias Vault loot toward any one player — it's low-value filler
//      already handled correctly by the value-maximizing search above.
//      Loading Bay is isolated with no adjacency upside either way.
//   2. Otherwise, prefer a bin that already contains an item sharing the
//      same `.floor` — general floor-clustering, so a crew spends less
//      time running between floors to collect their assigned loot.
//      Items with `floor === undefined` never match each other here.
//   3. Otherwise, prefer a bin that already contains an item on an
//      ADJACENT floor per FLOOR_ADJACENCY below (e.g. Alarm Floor next
//      to First, or First next to Second/Crisp Gallery) — a softer nudge
//      than tier 2, confirmed with the user 2026-08-03 after live
//      testing showed a player jumping straight from Alarm Floor to
//      Second, skipping past First. This is a soft preference, not a
//      guarantee: if no value-preserving adjacent-floor bin exists at
//      this point in the reconstruction, it falls through to tier 4
//      exactly like the Crisp Gallery tier falls through when the
//      host's bag is full. Vault and Loading Bay are isolated — never
//      adjacent to anything, including each other.
//   4. Otherwise, prefer whichever candidate bin has the most remaining
//      capacity — spreads items across players by default instead of
//      piling into bin 0, which is what actually fixes the reported bug
//      in the common case (a plain ascending-index fallback would not
//      have, since it's indistinguishable from the old bug there).
//   5. Exact remaining-capacity ties: ascending bin index, purely for
//      determinism — no longer a host-favoring rule, just a tiebreaker.
//
// Returns null if `mandatory` alone can't be packed into the bins at
// all (the caller's cue to forfeit and fall back to an unconstrained
// pack). Otherwise returns { value, bags }: bags is a `bins`-length
// array of { items, value, weightUsed }, items shaped like the input
// objects ({ id, value, weightUnits, floor }).
//
// Note: `assignItemsToBags()` above has its own, separate
// HOST_PRIORITY_FLOORS/HOST_PRIORITY_BOOST logic — that function is
// untouched by this change, kept only as a tested primitive for a
// possible future "Greedy" model. `packBins()`'s tier 1 below now reads
// the very same HOST_PRIORITY_FLOORS constant directly (2026-08-04) —
// no separate CRISP_GALLERY constant needed anymore.

// Real Kortz Center map adjacency (confirmed with the user 2026-08-03):
// which floors are a single transition apart. Used only as tier 3 above —
// a soft logistics nudge, never a hard constraint or an economic one.
// Vault and Loading Bay are isolated (no adjacency to anything, including
// each other) since neither borders the Alarm Floor/First/Second/Crisp
// Gallery run of the building.
const FLOOR_ADJACENCY = {
  'Alarm Floor': new Set(['First']),
  'First': new Set(['Alarm Floor', 'Second', 'Crisp Gallery']),
  'Second': new Set(['First', 'Crisp Gallery']),
  'Crisp Gallery': new Set(['First', 'Second']),
  'Vault': new Set(),
  'Loading Bay': new Set()
};
function floorsAdjacent(a, b) {
  return a !== undefined && b !== undefined && !!FLOOR_ADJACENCY[a] && FLOOR_ADJACENCY[a].has(b);
}

export function packBins(mandatory, optional, bins, capacityPerBin) {
  const allWeights = [...mandatory, ...optional].map(i => i.weightUnits).filter(w => w > 0);
  const unit = allWeights.reduce((g, w) => gcd(g, w), capacityPerBin);
  const cap = Math.round(capacityPerBin / unit);

  const items = [
    ...mandatory.map(it => ({ ...it, w: it.weightUnits / unit, mandatory: true })),
    ...optional.map(it => ({ ...it, w: it.weightUnits / unit, mandatory: false }))
  ];
  // Stable-sort by the caller's optional `order` field (mirrors the
  // optional `floor` field — never touches value/weight/eligibility) so
  // the reconstruction below always walks items in one canonical sequence,
  // regardless of how many of them were passed in as `mandatory` vs
  // `optional`. Without this, concatenating mandatory-first changes the
  // processing order the four-tier bag-choice below sees, which can select
  // a *different* (but equally optimal-value) partition purely because
  // Buyer's Choice/Elite status happened to reorder the list — confirmed
  // 2026-08-04 against a real bug report (same scope-out, same $740,000
  // total, two different bag splits depending on Elite on/off).
  // `runOptimizer()` populates `order` from true catalog position; callers
  // that never set it (every pre-existing test) get `0 - 0 = 0` throughout,
  // making this a no-op — current mandatory-first behavior is preserved
  // exactly when no caller opts in.
  items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const NEG = -Infinity;
  const memo = new Map();

  // Best additional value achievable from item index i onward, given
  // `caps` = remaining capacity (in `unit`s) per bin.
  function solve(i, caps) {
    if (i === items.length) return 0;
    const key = i + '|' + caps.join(',');
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    const it = items[i];
    let best = it.mandatory ? NEG : solve(i + 1, caps);
    const tried = new Set();
    for (let b = 0; b < bins; b++) {
      if (caps[b] < it.w || tried.has(caps[b])) continue;
      tried.add(caps[b]); // symmetric bins: identical remaining capacity gives an identical result
      const next = caps.slice();
      next[b] -= it.w;
      const sub = solve(i + 1, next);
      if (sub !== NEG) best = Math.max(best, it.value + sub);
    }
    memo.set(key, best);
    return best;
  }

  const initCaps = new Array(bins).fill(cap);
  const totalValue = solve(0, initCaps);
  if (totalValue === NEG) return null;

  // Reconstruct one concrete assignment matching that optimal value,
  // choosing among value-preserving bins via the four-tier preference
  // documented above (host-priority-floor, then floor-clustering, then
  // adjacent-floor-clustering, then least-loaded, then ascending index).
  const bagsOut = Array.from({ length: bins }, () => ({ items: [], value: 0, weightUsed: 0 }));
  let caps = initCaps.slice();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const target = solve(i, caps);
    if (!it.mandatory && solve(i + 1, caps) === target) continue; // optimal path leaves this item out

    const candidates = [];
    for (let b = 0; b < bins; b++) {
      if (caps[b] < it.w) continue;
      const next = caps.slice();
      next[b] -= it.w;
      if (it.value + solve(i + 1, next) === target) candidates.push({ b, next });
    }

    // Tier 1 (2026-08-04, widened from Crisp-Gallery-only): the host must
    // physically enter the Vault for the primary target at every crew size,
    // and Loading Bay is mutually exclusive with that Vault visit by game
    // mechanics — so the host's route naturally continues on to the
    // building's 2nd floor (Second + Crisp Gallery) instead. Crisp Gallery
    // additionally keeps its original EMP-desync rationale (the host is the
    // more reliable player to verify in-room presence there) — that fact
    // doesn't extend to Second, but the routing argument above does.
    // Vault and Loading Bay were deliberately NOT added here: the whole
    // crew is physically present for the Vault sequence (not just the
    // host), so there's no logistics/adjacency reason to bias Vault loot
    // toward any one player — it's low-value filler already handled
    // correctly by the value-maximizing search above, no tier needed.
    // Loading Bay is isolated with no adjacency upside either way.
    let chosen;
    if (HOST_PRIORITY_FLOORS.has(it.floor)) {
      chosen = candidates.find(c => c.b === 0);
    }
    if (!chosen && it.floor !== undefined) {
      const floorMatches = candidates.filter(c => bagsOut[c.b].items.some(x => x.floor === it.floor));
      chosen = floorMatches.reduce((best, c) => (!best || caps[c.b] > caps[best.b]) ? c : best, null);
    }
    if (!chosen && it.floor !== undefined) {
      const adjMatches = candidates.filter(c => bagsOut[c.b].items.some(x => floorsAdjacent(it.floor, x.floor)));
      chosen = adjMatches.reduce((best, c) => (!best || caps[c.b] > caps[best.b]) ? c : best, null);
    }
    if (!chosen) {
      chosen = candidates.reduce((best, c) => (!best || caps[c.b] > caps[best.b]) ? c : best, null);
    }

    bagsOut[chosen.b].items.push({ id: it.id, value: it.value, weightUnits: it.weightUnits, floor: it.floor });
    bagsOut[chosen.b].value += it.value;
    bagsOut[chosen.b].weightUsed += it.weightUnits;
    caps = chosen.next;
  }

  return { value: totalValue, bags: bagsOut };
}

// ---------- optimizer ----------
// Buyer's Choice items are locked in first (mandatory) only when Elite
// Challenge is attempted; with Elite off, Buyer's Choice tags are purely
// informational and the optimizer runs a single unconstrained knapsack.
// "Attempted" itself requires at least 2 marked-and-scoped Buyer's Choice
// items (2026-08-03) — Elite Challenge can never be satisfied by a single
// pick, so 0 or 1 marked both resolve identically to "not attempted."
//
// A marked-and-scoped Buyer's Choice item that this crew size can't even
// access (item.minPlayers > state.players) can never actually be picked
// up — that's an illegal combo, not just a packing shortfall, so it forces
// the same forfeiture (allBuyerItemsFit = false) as a weight overflow.
//
// When that happens, the *other*, reachable Buyer's Choice items are no
// longer force-locked into the mandatory knapsack either — bonuses are
// already guaranteed forfeited once one marked item is structurally
// unreachable, so force-including the rest could only cost bag value for
// a bonus that can never pay out. In that case packing falls back to the
// exact same unconstrained value-max knapsack used when Elite isn't
// attempted at all — Buyer's Choice weighting is dropped entirely, not
// partially honored.
export function runOptimizer(state, catalog, bagCapacityPerPlayer, bonusConstants) {
  const valid = state.loot.filter(l => l.value !== '' && l.value !== null && l.value !== undefined && !isNaN(l.value));
  const eligible = valid.filter(l => itemById(catalog, l.itemId).minPlayers <= state.players);
  // `order` = each item's position in `eligible` (already catalog-ordered)
  // — passed through to packBins() so its reconstruction always walks
  // items in true catalog order, regardless of which of them end up in
  // `mandatory` vs `optional` below. Without this, splitting eligible
  // items by Buyer's Choice status and concatenating mandatory-first would
  // change packBins()'s processing order purely based on Elite Challenge
  // status, which could select a different (though equally optimal-value)
  // bag partition for the same chosen items — see packBins()'s own comment
  // on the `order` field for the full writeup.
  const orderById = new Map(eligible.map((l, idx) => [l.itemId, idx]));
  const toItem = (l) => {
    const cat = itemById(catalog, l.itemId);
    return { id: l.itemId, value: Number(l.value), weightUnits: cat.weight, floor: cat.floor, order: orderById.get(l.itemId) };
  };

  const bcValid = valid.filter(l => l.buyersChoice);
  const bcIdsSet = new Set(bcValid.map(l => l.itemId));
  const bcIneligibleIds = bcValid
    .filter(l => itemById(catalog, l.itemId).minPlayers > state.players)
    .map(l => l.itemId);

  // Elite Challenge requires at least 2 Buyer's Choice picks to be a real
  // contract (confirmed 2026-08-03, direct game knowledge) — a single
  // marked item can never satisfy it. Below that threshold, treat it
  // identically to marking none: no forced packing, no bonus.
  const attempted = state.elite === 'yes' && bcIdsSet.size >= 2;
  const canLockMandatory = attempted && bcIneligibleIds.length === 0;

  let secondaryBagValue, allBuyerItemsFit, mandatoryWeightSum, packedBags;

  if (canLockMandatory) {
    const mandatory = eligible.filter(l => l.buyersChoice).map(toItem);
    const optional = eligible.filter(l => !l.buyersChoice).map(toItem);
    mandatoryWeightSum = mandatory.reduce((s, i) => s + i.weightUnits, 0);

    const packed = packBins(mandatory, optional, state.players, bagCapacityPerPlayer);
    if (packed) {
      allBuyerItemsFit = true;
      secondaryBagValue = packed.value;
      packedBags = packed.bags;
    } else {
      // Mandatory items alone can't be bin-packed into this crew's bags —
      // forfeit the bonuses and fall back to the exact same unconstrained
      // value-max pack used when Elite isn't attempted at all.
      allBuyerItemsFit = false;
      const fallback = packBins([], eligible.map(toItem), state.players, bagCapacityPerPlayer);
      secondaryBagValue = fallback.value;
      packedBags = fallback.bags;
    }
  } else {
    // Either never attempted, or attempted with a structurally-unreachable
    // marked item — either way, no Buyer's Choice weighting applied to
    // packing. Pure value-max pack over everything eligible.
    mandatoryWeightSum = 0;
    const packed = packBins([], eligible.map(toItem), state.players, bagCapacityPerPlayer);
    secondaryBagValue = packed.value;
    packedBags = packed.bags;

    // Not attempted at all -> nothing to forfeit. Attempted but unreachable
    // -> always forfeited, regardless of what the unconstrained pack
    // happened to pack.
    allBuyerItemsFit = !attempted;
  }

  const chosenIds = new Set(packedBags.flatMap(b => b.items.map(i => i.id)));

  const bonuses = bonusAmounts(state.difficulty, bonusConstants);
  const eliteEligible = attempted && allBuyerItemsFit;
  const buyerRequestBonusEach = eliteEligible ? bonuses.buyerRequest : 0;
  const eliteBonusEach = eliteEligible ? bonuses.elitePerPlayer : 0;
  const planningFee = state.weekly === 'repeat' ? bonusConstants.repeatRunFee : 0;
  // Every player's secondary-loot cut is the SAME number — the pooled
  // total split evenly across the whole crew — regardless of which bag
  // any specific item physically landed in (confirmed 2026-08-02 against
  // two real GTA payout screenshots). Bag/floor assignment above is pure
  // logistics with zero economic effect on this. Every non-host player
  // additionally, unconditionally earns the flat Helper bonus on top of
  // everything else — not a per-run choice, a fixed rule of the model.
  const secondaryShareEach = secondaryBagValue / state.players;
  const helperBonusEach = bonuses.helper;

  const overflow = attempted && !allBuyerItemsFit;

  // packBins' items are shaped { id, value, weightUnits, floor } to match
  // knapsack()'s convention; translate to the { itemId, value, weight,
  // floor } shape the rest of the app (guide.html, tests) expects.
  const bags = packedBags.map(b => ({
    value: b.value,
    weightUsed: b.weightUsed,
    items: b.items.map(i => ({ itemId: i.id, value: i.value, weight: i.weightUnits, floor: i.floor }))
  }));

  return {
    secondaryBagValue, secondaryShareEach, buyerRequestBonusEach, eliteBonusEach,
    helperBonusEach, planningFee,
    overflow, attempted, allBuyerItemsFit, mandatoryWeightSum, bcIneligibleIds,
    chosenIds, bcIdsSet, bags,
    ineligibleCount: valid.length - eligible.length
  };
}

// For a given scope-out (the loot values/floors already entered — nothing
// else about the run changes), computes per-player secondary loot share at
// every supported crew size (1-4), to answer "would a different crew size
// pay more per player?" (2026-08-04, user request — precedented by
// `internal/kch_calculator_8.2.26.py`'s own solo/duo/trio/quad payout
// comparison). Deliberately ignores Elite Challenge/Buyer's Choice
// entirely — every call forces `elite: 'no'`, regardless of what the
// actual run has it set to, since Elite completion is never guaranteed and
// shouldn't skew a "which crew size is best" comparison. This also means
// Buyer's Choice tags never constrain packing here; every crew size gets
// the same pure value-max pack `runOptimizer()` already does when Elite is
// off. Crew size still changes which items are even ELIGIBLE (Crisp
// Gallery items require `minPlayers: 2`) — `runOptimizer`'s own `eligible`
// filter already handles that per player count, so a smaller crew's lower
// share here can genuinely mean "fewer items were reachable," not just "a
// bigger total got split more ways." Reuses `runOptimizer()` as-is; no new
// packing logic.
export function compareCrewSizes(state, catalog, bagCapacityPerPlayer, bonusConstants) {
  const results = [];
  for (let players = 1; players <= 4; players++) {
    const r = runOptimizer({ ...state, players, elite: 'no' }, catalog, bagCapacityPerPlayer, bonusConstants);
    results.push({ players, secondaryBagValue: r.secondaryBagValue, secondaryShareEach: r.secondaryShareEach });
  }
  return results;
}

// Page 2's per-player "Payout" figure (renamed from "Take" 2026-08-02 —
// it's the amount that actually hits the wallet) = secondaryShareEach +
// Buyer's Request bonus, PLUS the Helper bonus for every non-host player,
// PLUS the Primary Target for the host. The Elite Challenge bonus is
// deliberately never folded in here — its dollar amount must never be
// projected, since Elite success depends on live-execution conditions
// (the clock, etc.) the tool can't model or guarantee. `secondaryShareEach`
// (not an individual bag's value) is the correct input for every player,
// host included — bag assignment has no economic effect on payout, see
// runOptimizer above.
//
// The repeat-run planning fee is deliberately NOT subtracted here
// (2026-08-02, user call): it's paid up front to set up a repeat run,
// before the heist itself — by the time this payout screen matters, it's
// already a sunk cost, a separate transaction from what the heist pays
// out. It's still shown as its own informational line in guide.html so
// the host isn't left wondering where it went, just never netted against
// Payout.
export function computeGuidePayout({ secondaryShareEach, isHost, primaryValue, buyerRequestBonusEach, helperBonusEach }) {
  let payout = secondaryShareEach + buyerRequestBonusEach;
  if (isHost) {
    payout += primaryValue;
  } else {
    payout += helperBonusEach;
  }
  return payout;
}

// Career progress is tracked per-player in-game and excludes EVERY bonus
// (Buyer's Request, Elite, and the Helper bonus) — only the Primary
// Target and secondary loot share count toward it. Confirmed 2026-08-02
// via two real GTA payout screenshots. Kept as its own function rather
// than a mode flag on computeGuidePayout(): the two figures have
// entirely different bonus-inclusion rules, and a single function would
// need a confusing superset of params to serve both.
export function computeCareerProgress({ secondaryShareEach, isHost, primaryValue }) {
  return isHost ? primaryValue + secondaryShareEach : secondaryShareEach;
}

// Reminder-only check (2026-07-26): some catalog items carry a
// `requiresPreps` array (e.g. `["glass-cutter"]`) marking a prep mission
// needed to actually loot them in-game. This does NOT gate the optimizer —
// no eligibility exclusion, no state field — it's purely informational.
// Returns the catalog entries, among those actually chosen/packed this
// run, that carry a non-empty `requiresPreps`, so guide.html can name only
// the specific items actually present rather than warning generically.
export function packedPrepWarnings(catalog, chosenIds) {
  return catalog.filter(cat => chosenIds.has(cat.itemId) && Array.isArray(cat.requiresPreps) && cat.requiresPreps.length > 0);
}

// ---------- persistence (pure JSON <-> plain-object helpers) ----------
// Actual localStorage.getItem/setItem calls belong in each page's script,
// not here — these functions never touch localStorage themselves.

export function defaultPage1State(catalog) {
  return {
    primaryId: 'la-derniere-debauche',
    difficulty: 'normal',
    weekly: 'first',
    players: 1,
    elite: 'no',
    playerNames: ['', '', '', ''],
    // `variant` is the optional cosmetic sub-type pick (see `variants` in
    // secondary-loot.json — only Gemstone has one today). Carried on every
    // loot entry for a uniform shape; stays '' for items with no variants.
    loot: catalog.map(cat => ({ itemId: cat.itemId, value: '', buyersChoice: false, variant: '' }))
  };
}

export function defaultPage2State() {
  return { securityCombo: '', locked: false };
}

export function serializeState(page1, page2) {
  return {
    schemaVersion: SCHEMA_VERSION,
    page1: {
      primaryId: page1.primaryId,
      difficulty: page1.difficulty,
      weekly: page1.weekly,
      players: page1.players,
      elite: page1.elite,
      playerNames: Array.isArray(page1.playerNames) ? page1.playerNames.slice(0, 4) : ['', '', '', ''],
      loot: (page1.loot || []).map(l => ({ itemId: l.itemId, value: l.value, buyersChoice: !!l.buyersChoice, variant: l.variant || '' }))
    },
    page2: {
      securityCombo: (page2 && page2.securityCombo) || '',
      locked: !!(page2 && page2.locked)
    },
    savedAt: new Date().toISOString()
  };
}

// Parses a raw JSON string (as read from localStorage) and validates it
// against the current schema. Falls back to `fallbackPage1`/`fallbackPage2`
// wholesale on any parse error, missing/wrong schemaVersion, or malformed
// shape — never throws.
export function deserializeState(rawJsonString, fallbackPage1, fallbackPage2) {
  try {
    if (!rawJsonString) return { page1: fallbackPage1, page2: fallbackPage2 };
    const parsed = JSON.parse(rawJsonString);
    if (!parsed || typeof parsed !== 'object' || parsed.schemaVersion !== SCHEMA_VERSION) {
      return { page1: fallbackPage1, page2: fallbackPage2 };
    }
    if (!parsed.page1 || typeof parsed.page1 !== 'object') {
      return { page1: fallbackPage1, page2: fallbackPage2 };
    }
    const validPlayers = [1, 2, 3, 4];
    const page1 = {
      primaryId: typeof parsed.page1.primaryId === 'string' ? parsed.page1.primaryId : fallbackPage1.primaryId,
      difficulty: parsed.page1.difficulty === 'hard' ? 'hard' : 'normal',
      weekly: parsed.page1.weekly === 'repeat' ? 'repeat' : 'first',
      players: validPlayers.includes(parsed.page1.players) ? parsed.page1.players : fallbackPage1.players,
      elite: parsed.page1.elite === 'yes' ? 'yes' : 'no',
      playerNames: Array.isArray(parsed.page1.playerNames)
        ? [0, 1, 2, 3].map(i => typeof parsed.page1.playerNames[i] === 'string' ? parsed.page1.playerNames[i] : '')
        : fallbackPage1.playerNames,
      loot: Array.isArray(parsed.page1.loot) ? parsed.page1.loot : []
    };
    const page2 = {
      securityCombo: parsed.page2 && typeof parsed.page2.securityCombo === 'string' ? parsed.page2.securityCombo : '',
      locked: !!(parsed.page2 && parsed.page2.locked)
    };
    return { page1, page2 };
  } catch (err) {
    return { page1: fallbackPage1, page2: fallbackPage2 };
  }
}

// Merges saved per-item loot entries onto the freshly-fetched catalog BY
// itemId — never wholesale-replaces state.loot. Items present in the
// catalog but missing from the saved blob (new items, or the item just
// wasn't scoped) come back blank/unmarked; saved entries for items no
// longer in the catalog are silently dropped.
//
// A saved `variant` only survives if the catalog entry still offers it in
// its `variants` list — same spirit as dropping stale itemIds, so a
// renamed/removed variant can't come back as a label nothing in the game
// matches. Items with no `variants` always merge back as ''.
export function mergeLootByItemId(catalog, savedLoot) {
  const savedById = new Map((savedLoot || []).map(l => [l.itemId, l]));
  return catalog.map(cat => {
    const saved = savedById.get(cat.itemId);
    const variants = Array.isArray(cat.variants) ? cat.variants : [];
    const savedVariant = saved && typeof saved.variant === 'string' ? saved.variant : '';
    return {
      itemId: cat.itemId,
      value: saved && saved.value !== undefined ? saved.value : '',
      buyersChoice: saved ? !!saved.buyersChoice : false,
      variant: variants.includes(savedVariant) ? savedVariant : ''
    };
  });
}
