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
// Buyer's Request and Elite Challenge bonuses double on Hard mode.
export function bonusAmounts(difficulty, bonusConstants) {
  const hard = difficulty === 'hard';
  return {
    buyerRequest: hard ? bonusConstants.buyerRequestHard : bonusConstants.buyerRequestNormal,
    elitePerPlayer: hard ? bonusConstants.elitePerPlayerHard : bonusConstants.elitePerPlayerNormal
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
// `opts.boostFloors`, if given, lets certain floors' items get first
// crack at placement among the optional pool — mirrors the Normal
// model's best-effort host-routing preference (bin 0 is always tried
// first for every item on a tie, same as assignItemsToBags; putting
// boosted-floor items earlier in processing order just means they get
// that first-crack tie-break before bin 0 fills up with other stuff).
//
// Returns null if `mandatory` alone can't be packed into the bins at
// all (the caller's cue to forfeit and fall back to an unconstrained
// pack). Otherwise returns { value, bags }: bags is a `bins`-length
// array of { items, value, weightUsed }, items shaped like the input
// objects ({ id, value, weightUnits, floor }).
export function packBins(mandatory, optional, bins, capacityPerBin, opts = {}) {
  const boostFloors = opts.boostFloors || new Set();

  const allWeights = [...mandatory, ...optional].map(i => i.weightUnits).filter(w => w > 0);
  const unit = allWeights.reduce((g, w) => gcd(g, w), capacityPerBin);
  const cap = Math.round(capacityPerBin / unit);

  const optionalOrdered = [
    ...optional.filter(it => boostFloors.has(it.floor)),
    ...optional.filter(it => !boostFloors.has(it.floor))
  ];
  const items = [
    ...mandatory.map(it => ({ ...it, w: it.weightUnits / unit, mandatory: true })),
    ...optionalOrdered.map(it => ({ ...it, w: it.weightUnits / unit, mandatory: false }))
  ];

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
  // preferring bin 0 (the host) on ties, same as the old FFD's
  // `bags.find` (checks bag 0 first) always did.
  const bagsOut = Array.from({ length: bins }, () => ({ items: [], value: 0, weightUsed: 0 }));
  let caps = initCaps.slice();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const target = solve(i, caps);
    if (!it.mandatory && solve(i + 1, caps) === target) continue; // optimal path leaves this item out

    for (let b = 0; b < bins; b++) {
      if (caps[b] < it.w) continue;
      const next = caps.slice();
      next[b] -= it.w;
      if (it.value + solve(i + 1, next) === target) {
        bagsOut[b].items.push({ id: it.id, value: it.value, weightUnits: it.weightUnits, floor: it.floor });
        bagsOut[b].value += it.value;
        bagsOut[b].weightUsed += it.weightUnits;
        caps = next;
        break;
      }
    }
  }

  return { value: totalValue, bags: bagsOut };
}

// ---------- optimizer ----------
// Buyer's Choice items are locked in first (mandatory) only when Elite
// Challenge is attempted; with Elite off, Buyer's Choice tags are purely
// informational and the optimizer runs a single unconstrained knapsack.
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
  const toItem = (l) => {
    const cat = itemById(catalog, l.itemId);
    return { id: l.itemId, value: Number(l.value), weightUnits: cat.weight, floor: cat.floor };
  };

  const bcValid = valid.filter(l => l.buyersChoice);
  const bcIdsSet = new Set(bcValid.map(l => l.itemId));
  const bcIneligibleIds = bcValid
    .filter(l => itemById(catalog, l.itemId).minPlayers > state.players)
    .map(l => l.itemId);

  const attempted = state.elite === 'yes' && bcIdsSet.size > 0;
  const canLockMandatory = attempted && bcIneligibleIds.length === 0;
  const packOpts = { boostFloors: HOST_PRIORITY_FLOORS };

  let secondaryBagValue, allBuyerItemsFit, mandatoryWeightSum, packedBags;

  if (canLockMandatory) {
    const mandatory = eligible.filter(l => l.buyersChoice).map(toItem);
    const optional = eligible.filter(l => !l.buyersChoice).map(toItem);
    mandatoryWeightSum = mandatory.reduce((s, i) => s + i.weightUnits, 0);

    const packed = packBins(mandatory, optional, state.players, bagCapacityPerPlayer, packOpts);
    if (packed) {
      allBuyerItemsFit = true;
      secondaryBagValue = packed.value;
      packedBags = packed.bags;
    } else {
      // Mandatory items alone can't be bin-packed into this crew's bags —
      // forfeit the bonuses and fall back to the exact same unconstrained
      // value-max pack used when Elite isn't attempted at all.
      allBuyerItemsFit = false;
      const fallback = packBins([], eligible.map(toItem), state.players, bagCapacityPerPlayer, packOpts);
      secondaryBagValue = fallback.value;
      packedBags = fallback.bags;
    }
  } else {
    // Either never attempted, or attempted with a structurally-unreachable
    // marked item — either way, no Buyer's Choice weighting applied to
    // packing. Pure value-max pack over everything eligible.
    mandatoryWeightSum = 0;
    const packed = packBins([], eligible.map(toItem), state.players, bagCapacityPerPlayer, packOpts);
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
    secondaryBagValue, buyerRequestBonusEach, eliteBonusEach, planningFee,
    overflow, attempted, allBuyerItemsFit, mandatoryWeightSum, bcIneligibleIds,
    chosenIds, bcIdsSet, bags,
    ineligibleCount: valid.length - eligible.length
  };
}

// Page 2's per-player "Take" figure = bag value + Buyer's Request bonus
// ONLY. The Elite Challenge toggle still correctly makes Buyer's Choice
// mandatory for packing (see runOptimizer above) — but its bonus dollar
// amount must never be folded into this total, since Elite success
// depends on live-execution conditions (the clock, etc.) the tool can't
// model or guarantee. Host adds the primary target value and subtracts
// the repeat-run fee; non-hosts don't.
export function computeGuideTake({ bagValue, isHost, primaryValue, planningFee, buyerRequestBonusEach }) {
  let take = bagValue + buyerRequestBonusEach;
  if (isHost) take += primaryValue - planningFee;
  return take;
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
    loot: catalog.map(cat => ({ itemId: cat.itemId, value: '', buyersChoice: false }))
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
      loot: (page1.loot || []).map(l => ({ itemId: l.itemId, value: l.value, buyersChoice: !!l.buyersChoice }))
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
export function mergeLootByItemId(catalog, savedLoot) {
  const savedById = new Map((savedLoot || []).map(l => [l.itemId, l]));
  return catalog.map(cat => {
    const saved = savedById.get(cat.itemId);
    return {
      itemId: cat.itemId,
      value: saved && saved.value !== undefined ? saved.value : '',
      buyersChoice: saved ? !!saved.buyersChoice : false
    };
  });
}
