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

// ---------- tap-the-pin hit testing (map-scope.html) ----------
// Given a tap position and a floor/asset's catalog items (each carrying
// xPct/yPct), returns every item within radiusPx of the tap, nearest
// first. Empty = no hit (caller no-ops); one entry = unambiguous, open
// that item directly; 2+ = ambiguous, caller should show a disambiguation
// chip list instead of guessing.
//
// Converts each item's percent position to real rendered pixels PER AXIS
// (x against imageWidthPx, y against imageHeightPx) before measuring
// Euclidean distance — never a blended average of width+height. That
// shortcut was a real, confirmed bug in the scratchpad prototype this
// graduates from: on a non-square rendered image (e.g. First Floor's
// 900x727), it silently shrank the effective hit-zone on whichever axis
// the image was shorter along, producing dead zones where the true
// per-axis math says a tap should register. `items` only needs
// `itemId`/`xPct`/`yPct` — pass the full catalog subset for one floor/
// asset; entries missing coordinates (e.g. BAY, which has none) are
// skipped rather than throwing.
export function findNearestPins(items, tapXPx, tapYPx, imageWidthPx, imageHeightPx, radiusPx) {
  const candidates = [];
  for (const it of items) {
    if (it.xPct == null || it.yPct == null) continue;
    const itemXPx = (it.xPct / 100) * imageWidthPx;
    const itemYPx = (it.yPct / 100) * imageHeightPx;
    const dx = tapXPx - itemXPx;
    const dy = tapYPx - itemYPx;
    const distancePx = Math.sqrt(dx * dx + dy * dy);
    if (distancePx <= radiusPx) candidates.push({ itemId: it.itemId, distancePx });
  }
  candidates.sort((a, b) => a.distancePx - b.distancePx);
  return candidates;
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
//
// 2026-08-15: `state.keepPrimary === 'yes'` (some hosts keep the painting
// for display — arcade/property — rather than selling it) short-circuits
// straight to `value: 0`, skipping the multiplier math entirely. This is
// the single source of truth for "kept" — every downstream consumer
// (guide.html's Finale Result ledger, the host's player card, Total Take,
// computeGuidePayout(), computeCareerProgress()) already just reads
// `primary.value`, so zeroing it here is sufficient on its own; those
// functions need no changes. The `kept` flag on the return value lets
// callers show "Kept — not sold" instead of a dollar figure without
// re-deriving the check from `state` themselves.
export function calcPrimary(state, primaryTargets, primaryMultipliers) {
  const p = primaryTargets.find(t => t.id === state.primaryId);
  if (state.keepPrimary === 'yes') return { value: 0, meta: p, kept: true };
  let base = p.baseValue;
  if (state.weekly === 'first') base *= primaryMultipliers.firstWeek;
  if (state.difficulty === 'hard') base *= primaryMultipliers.hard;
  // In-game payouts are whole dollars; round off float drift from the
  // multiplier math (e.g. 365000 * 1.10 === 401500.00000000006 in JS).
  return { value: Math.round(base), meta: p, kept: false };
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
// packBins()'s own, unrelated tier-1 bin-choice mechanism. Loading Bay was
// deliberately considered and excluded — see packBins()'s tier-1 comment
// for why. Vault was excluded from THIS set for a different reason
// (2026-08-07): it now gets its own, opposite-direction tier — see
// HOST_AVOID_FLOORS and packBins()'s tier-0 comment below.
// assignItemsToBags()'s own sort-weight-boost mechanism below is otherwise
// untouched.
const HOST_PRIORITY_FLOORS = new Set(['Second', 'Crisp Gallery']);
const HOST_PRIORITY_BOOST = 8;

// packBins()'s tier 0 (2026-08-07): floors the host should NOT carry
// whenever a non-host bag can take the item instead — the mirror image of
// HOST_PRIORITY_FLOORS above. See packBins()'s tier-0 comment for the full
// rationale (parallelizing the mandatory Vault trip with a teammate
// grabbing Vault secondary loot, for the Elite Challenge's 17-minute
// clock). Not read by assignItemsToBags() — that function keeps its own,
// separate, untouched host-priority-only mechanism.
//
// 2026-08-14: Alarm Floor joined this set (user request, live-execution
// pathing complaint) — the host's real route is Vault -> building 2nd
// floor (HOST_PRIORITY_FLOORS above), which never passes through Alarm
// Floor (FLOOR_ADJACENCY below: Alarm Floor only touches First, not
// Second/Crisp Gallery). A host bag that also picked up Alarm Floor loot
// via tier 2/3/4 forced a real backtrack during the timed run. First
// Floor was considered and deliberately excluded — it's adjacent to
// Second/Crisp Gallery directly, so a host stop there isn't the same
// off-route detour Alarm Floor is.
const HOST_AVOID_FLOORS = new Set(['Vault', 'Alarm Floor']);

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
// Bin CHOICE during reconstruction (below) follows a five-tier
// preference (tier 0 added 2026-08-07), applied uniformly to mandatory
// and optional items alike — this replaced an earlier version
// (2026-08-02) that tried bin 0 first for literally every item, which is
// why Buyer's Choice loot always used to land entirely in the host's bag
// (a real bug, not a rule: mandatory items are processed first, while
// bins are still symmetric, so bin 0 won that tie almost every time).
// Every tier only ever chooses AMONG bins already confirmed (via
// `solve()`) to preserve the DP's optimal total value — none of this can
// ever cost secondary value, which matters because every player's career
// progress is driven by that same total (see computeCareerProgress
// below), split evenly:
//   0. Vault items exclude bin 0 (the host) whenever a non-host,
//      value-preserving bin is also available — HOST_AVOID_FLOORS,
//      confirmed with the user 2026-08-07. The host alone must
//      physically enter the Vault for the Primary Target; routing Vault
//      secondary loot to a teammate instead lets it be grabbed in
//      parallel rather than requiring the host to double back for it
//      after the primary grab, which matters for the Elite Challenge's
//      17-minute clock. This is the mirror image of tier 1 below (which
//      pulls loot TOWARD the host) and falls back to including the host
//      when they're the only remaining valid bin (a solo run, or every
//      other bag already full).
//      Alarm Floor joined HOST_AVOID_FLOORS 2026-08-14 for a different
//      reason: the host's real route (Vault -> building 2nd floor, tier 1
//      below) never passes through Alarm Floor, so a host bag that also
//      picked up Alarm Floor loot forced a genuine backtrack during the
//      timed run — the same mechanism, applied for a pathing reason
//      rather than a parallelization one. First Floor was deliberately
//      excluded from this — it neighbors Second/Crisp Gallery directly,
//      so it isn't the same off-route detour.
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
//      Crisp Gallery) afterward. Loading Bay was deliberately NOT added
//      here: it's isolated with no adjacency upside either way, and can
//      still land in the host's bag when capacity/ordering happens to
//      put it there — that's fine, since the host just sequences it
//      before or after the Vault trip rather than combining them.
//      **Real bug fix, 2026-08-09:** this tier used to only fire at the
//      moment a Second/Crisp Gallery item happened to be walked in
//      catalog order (Vault → Loading Bay → Alarm Floor → First → Second
//      → Crisp Gallery) — it had no way to reserve host capacity ahead of
//      time. Since Alarm Floor/First are walked first, an early
//      non-priority item could claim bin 0 via tier 4/5's symmetric-tie
//      default (all bins tie on the very first item of a run, and that
//      still resolves to bin 0), then tiers 2/3 would snowball more
//      same-/adjacent-floor loot into that same bag before any
//      Second/Crisp Gallery item was ever reached — a real report, host
//      ended up with a cross-floor Alarm Floor+First+partial-Second
//      mishmash while a teammate got the Second/Crisp-Gallery-heavy bag
//      that was supposed to be the host's. Fixed by walking
//      HOST_PRIORITY_FLOORS items ahead of every other floor in the
//      items list itself (see the sort just below `items` is built),
//      so tier 1 gets first claim on bin 0's capacity regardless of
//      catalog position or mandatory/optional status — catalog `order`
//      remains the tiebreak *within* each priority bucket, so this stays
//      just as Elite-toggle-independent as before. Reordering can only
//      ever change which of several equally-optimal bin partitions gets
//      realized (solve()'s total value is provably invariant to
//      processing order for a fixed set of symmetric bins) — never the
//      total secondary value or which items get selected.
//      **Real bug fix, 2026-08-10:** the above fix walked Second and
//      Crisp Gallery items ahead of everything else, but *within* that
//      priority bucket they still fell back to plain catalog order
//      (Second's items 2-A..2-D come before Crisp Gallery's 2-E/2-F in
//      the catalog). A real report: when combined Second + Crisp Gallery
//      weight exceeds one host bag, the smaller Second items greedily
//      claimed most of bin 0 first, leaving no room for the larger Crisp
//      Gallery paintings by the time their turn came up — those fell
//      through to a teammate instead, and an unrelated First-floor item
//      got adjacency-clustered into bin 0's last few units of capacity to
//      round it out, forcing an avoidable extra floor stop. This is
//      backwards: Crisp Gallery's host-preference is the *stronger* of
//      the two rationales (the EMP-desync room-verification requirement
//      above), while Second's is the *softer* one (the host's route just
//      happens to pass through). Fixed by giving the priority bucket its
//      own floor sub-rank — Crisp Gallery items are walked ahead of
//      Second items whenever both are present — so Crisp Gallery always
//      wins ties for bin 0's capacity over Second, matching which
//      rationale is actually the harder requirement. `order` still
//      breaks ties within a single floor. Same invariance argument as
//      above: this only changes which equally-optimal partition gets
//      realized, never the total value or item selection.
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

// `extraHostAvoidFloors` (2026-08-23): an optional Set, unioned with
// HOST_AVOID_FLOORS for this call only — every existing caller omits it
// and sees zero behavior change. Added specifically for
// packBinsForTime()'s non-exhibit pre-pass (see its doc comment), which
// needs 'Loading Bay' routed away from the host even though the shared
// HOST_AVOID_FLOORS constant deliberately does NOT include it for the
// default value-model — the user confirmed 2026-08-23 that in real runs
// the value model's own tier-1 host-priority crowding already tends to
// push Loading Bay off the host's bag "by accident," so no fix was needed
// there; the time model's isolated single-item pre-pass has no such
// crowding and was defaulting Loading Bay onto the host via plain
// ascending-bin-index tie-break, which the user wants avoided (fine for a
// solo run, not otherwise).
export function packBins(mandatory, optional, bins, capacityPerBin, extraHostAvoidFloors) {
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
  //
  // 2026-08-09: HOST_PRIORITY_FLOORS items are additionally walked ahead
  // of every other floor (a primary sort key layered on top of the
  // `order` tiebreak above) — see tier 1's doc comment above for the real
  // bug this fixes. `order` still decides sequence *within* each priority
  // bucket, so this stays just as toggle-independent as the fix above.
  //
  // 2026-08-10: within that priority bucket itself, Crisp Gallery items
  // now sort ahead of Second items (a second sort key, between
  // `priorityRank` and `order`) — see tier 1's doc comment above for the
  // real bug this fixes.
  //
  // 2026-08-13: within a single priority floor (e.g. every selected Crisp
  // Gallery item), items now walk largest-weight-first, ahead of `order`
  // — a third sort key, between `floorSubRank` and `order`. Real bug
  // report: a 2-player run where the host's Crisp-Gallery-only capacity
  // (100) exactly matched four selected Crisp Gallery items' combined
  // weight, but plain catalog order walked four *smaller* items
  // (Fertility Statue 20, Gemstone 30, Meteorite Fragment 20, Art Deco
  // Circlets 10 = 80) into the host bag first, leaving only 20 capacity
  // free — not enough for the fifth, larger selected item (Venus
  // d'Algernon, 30), which fell through to the teammate's bag along with
  // a still-mostly-empty slice of host capacity backfilled by two
  // unrelated First-floor items. That forced the host to detour to First
  // Floor for no reason, when swapping Venus d'Algernon in for the two
  // First-floor items (and Art Deco Circlets) would have given the host
  // an entirely Crisp-Gallery bag at the exact same total value — a valid
  // equally-optimal partition the old ordering simply never reached.
  // Largest-first is the standard bin-packing fix for this shape of
  // problem (place the item with the least placement flexibility first,
  // while the most capacity is still open) — same rationale
  // `assignItemsToBags()`'s own First-Fit-Decreasing already uses
  // elsewhere in this file. Scoped to *within* a priority floor only
  // (`priorityRank(a) === 0` guards the term to 0, a no-op, whenever
  // either item is non-priority) so every other tier's behavior, and
  // every non-priority floor's processing order, is untouched. `order`
  // remains the final tiebreak within same-floor items of equal weight.
  // 2026-08-15: within the priority pool itself, mandatory items now walk
  // ahead of optional ones, regardless of which of the two priority floors
  // they're on. Real bug report: a 2-player run where four *optional*
  // Crisp Gallery items were walked (per the 2026-08-13 largest-first rule
  // above) and greedily claimed 80 of the host's 100 capacity before a
  // *mandatory* Second item (Horse Statue, weight 30) ever got a turn —
  // only 20 capacity remained, not enough for it, so it was forced into
  // the non-host bag purely because of processing order. The host's
  // leftover 10 capacity then got backfilled by an unrelated First-floor
  // item via tier 3's adjacency fallback, on what turned out to be a
  // capacity tie between the two bags — a real cross-floor mishmash for
  // both players, not a deliberate placement.
  //
  // The user proposed pooling Second and Crisp Gallery for host-bag
  // capacity instead of always ranking Crisp Gallery ahead of Second.
  // Tested (and rejected) fully flattening `floorSubRank` away: it broke
  // the existing 'Crisp Gallery outranks Second when both compete for the
  // host bin' test — a heavier optional Second item would beat a lighter
  // optional Crisp Gallery item for the host's last slot, reversing the
  // documented EMP-desync rationale (Crisp Gallery needs the host in-room
  // to verify presence; Second's host-preference is only the softer
  // "route happens to pass through" one). `floorSubRank` below is
  // untouched, so that preference still holds for optional-vs-optional
  // ties.
  //
  // Instead, `mandatoryRank` is layered in ABOVE `floorSubRank` (but still
  // gated to `priorityRank(a) === 0`, so it's a no-op outside the priority
  // pool): a mandatory item now claims host capacity before any optional
  // priority-floor item gets a chance to crowd it out, on either floor.
  // This only changes behavior when a mandatory and an optional item are
  // both competing in the pool — optional-vs-optional ties still fall
  // through to `floorSubRank` exactly as before. Verified against the
  // full existing suite (96/96 unchanged, including the Crisp-Gallery-
  // outranks-Second test and the 2026-08-13 largest-priority-floor-item
  // test) before landing this. Same invariance guarantee as every other
  // reordering fix in this file: only changes which equally-optimal
  // partition gets realized, never total value or item selection.
  //
  // 2026-08-15, same day, later: the `mandatoryRank` key above reopened
  // exactly the invariant the 2026-08-04 `order` fix was written to
  // guarantee — but only for the Elite-off case. `packBins()` only ever
  // sets `it.mandatory = true` when Elite forces Buyer's Choice picks into
  // the mandatory knapsack branch (`runOptimizer()`'s `mandatory =
  // eligible.filter(l => l.buyersChoice)`); with Elite off, `packBins()` is
  // always called with `mandatory: []`, so `mandatoryRank` silently became
  // a no-op and the pre-bug-#5 crowding bug reappeared — even when Elite on
  // vs off select the exact same items. Real report: a scope-out where
  // `elite:'yes'` gave a clean Second/Crisp-Gallery host bag, but the same
  // scope-out with `elite:'no'` put a First-floor stray back in the host
  // bag, same $712,000 total, same items selected either way.
  //
  // Fixed by widening the key to `(it.mandatory || it.buyersChoice)`. This
  // is a strict generalization, not a behavior change for Elite-on: every
  // item `packBins()` ever marks `mandatory: true` is already
  // `buyersChoice: true` by construction, so `it.mandatory` already implies
  // `it.buyersChoice` and that path is bit-for-bit unaffected. Elite-off
  // gains the missing case: a Buyer's-Choice-marked item that got selected
  // by pure value-max now gets the same priority-pool precedence a
  // forced-mandatory item would, closing the gap.
  //
  // Important scoping, discussed with the user before implementing: this
  // only guarantees "same selected item set -> same bag split." It does
  // NOT claim Elite on/off always produce identical splits, because they
  // don't always select the same items — forcing a low value-density
  // Buyer's Choice pick (e.g. a painting; every painting in this catalog is
  // weight 50, the heaviest class, vs 10/20/30 for everything else) can
  // cost enough value that the unconstrained Elite-off pack drops it for
  // something better. When selection genuinely diverges, the two runs are
  // packing different items and their splits are expected to differ too —
  // that's not a regression. See the "diverging-selection sanity test" in
  // test/pack-bins.test.js for the case where selection is NOT equal.
  const priorityRank = (it) => HOST_PRIORITY_FLOORS.has(it.floor) ? 0 : 1;
  const mandatoryRank = (it) => (it.mandatory || it.buyersChoice) ? 0 : 1;
  const floorSubRank = (it) => it.floor === 'Crisp Gallery' ? 0 : it.floor === 'Second' ? 1 : 2;
  items.sort((a, b) =>
    (priorityRank(a) - priorityRank(b)) ||
    (priorityRank(a) === 0 ? (mandatoryRank(a) - mandatoryRank(b)) : 0) ||
    (floorSubRank(a) - floorSubRank(b)) ||
    (priorityRank(a) === 0 ? (b.w - a.w) : 0) ||
    ((a.order ?? 0) - (b.order ?? 0))
  );

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
  // choosing among value-preserving bins via the five-tier preference
  // documented above (Vault-avoid-host, then host-priority-floor, then
  // floor-clustering, then adjacent-floor-clustering, then least-loaded,
  // then ascending index).
  const bagsOut = Array.from({ length: bins }, () => ({ items: [], value: 0, weightUsed: 0 }));
  let caps = initCaps.slice();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const target = solve(i, caps);
    if (!it.mandatory && solve(i + 1, caps) === target) continue; // optimal path leaves this item out

    let candidates = [];
    for (let b = 0; b < bins; b++) {
      if (caps[b] < it.w) continue;
      const next = caps.slice();
      next[b] -= it.w;
      if (it.value + solve(i + 1, next) === target) candidates.push({ b, next });
    }

    // Tier 0 (2026-08-07): Vault items exclude the host's bag (bin 0)
    // whenever a non-host, value-preserving bin is also available. The
    // host alone must enter the Vault for the Primary Target — routing
    // Vault secondary loot to a teammate instead lets it be grabbed in
    // parallel rather than requiring the host to double back for it,
    // which matters for the Elite Challenge's 17-minute clock. This is
    // the mirror image of tier 1 below (which pulls loot TOWARD the
    // host) but follows the identical value-preserving rule: it only
    // ever narrows among candidates already confirmed not to cost the
    // optimal total, and falls back to including the host when they're
    // the only remaining valid bag (solo runs, or every other bag full).
    if (HOST_AVOID_FLOORS.has(it.floor) || (extraHostAvoidFloors && extraHostAvoidFloors.has(it.floor))) {
      const nonHost = candidates.filter(c => c.b !== 0);
      if (nonHost.length > 0) candidates = nonHost;
    }

    // Tier 1 (2026-08-04, widened from Crisp-Gallery-only): the host must
    // physically enter the Vault for the primary target at every crew size,
    // and Loading Bay is mutually exclusive with that Vault visit by game
    // mechanics — so the host's route naturally continues on to the
    // building's 2nd floor (Second + Crisp Gallery) instead. Crisp Gallery
    // additionally keeps its original EMP-desync rationale (the host is the
    // more reliable player to verify in-room presence there) — that fact
    // doesn't extend to Second, but the routing argument above does.
    // Loading Bay was deliberately NOT added here: it's isolated with no
    // adjacency upside either way. Vault is excluded from THIS tier for a
    // different reason — see tier 0 above, which now actively routes it
    // AWAY from the host instead.
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

// ---------- experimental: time-optimized packing ----------
// Backing model for the "Experimental: time-optimized packing" Advanced
// Settings toggle on index.html (2026-08-23). Item SELECTION is never
// touched by any of this — packBins() above remains the single source of
// truth for which items get chosen and their total dollar value. This
// only offers an alternate BAG-ASSIGNMENT strategy for an already-
// selected item set, designed from a real observed divergence between
// this tool's default bag split and an independent calculator on an
// identical scope-out: the two agreed on item selection and total value
// exactly, but split bags differently — the other calculator kept the
// host to a tighter, fully-adjacent floor route by routing the crew's
// one Alarm Floor item to a teammate instead.
//
// Scope is deliberately narrow: only Alarm Floor/First/Second/Crisp
// Gallery ("exhibit floors") carry any time-cost at all. Vault and
// Loading Bay contribute zero — both are effectively fixed, mandatory
// stops regardless of loot (the host must enter the Vault for the
// Primary Target either way), so this model only measures the genuinely
// discretionary exhibit-floor routing choice. This is a distinct concept
// from HOST_AVOID_FLOORS above, which also contains 'Vault' (for an
// unrelated reason) and 'Alarm Floor' (which IS an exhibit floor here, on
// purpose — HOST_AVOID_FLOORS is about the default value-model's tier-0
// preference, not this one).
const EXHIBIT_FLOORS = new Set(['Alarm Floor', 'First', 'Second', 'Crisp Gallery']);
const EXHIBIT_FLOOR_LIST = [...EXHIBIT_FLOORS];
const EXHIBIT_FLOOR_INDEX = new Map(EXHIBIT_FLOOR_LIST.map((f, i) => [f, i]));

// Item time-weight, 2026-08-23: prefers the real per-item
// `lootTimeWeight` the user hand-tuned into secondary-loot.json (see its
// `_notes` entry for the 1-5 scale and how it was sourced) over the older
// 3-tier weight/requiresPreps-derived heuristic below, which now only
// serves as a fallback for any item that field is absent on (e.g. a
// future catalog addition that ships before its real value is known —
// never Vault/BAY today, since those are filtered out of the exhibit set
// before this function is ever called on them). Never read by the
// default packBins() path above.
export function timeWeightFor(catItem) {
  if (typeof catItem.lootTimeWeight === 'number') return catItem.lootTimeWeight;
  if ((catItem.requiresPreps || []).includes('glass-cutter')) return 3;
  return catItem.weight === 10 ? 1 : 2; // weight 20, or 50 (painting)
}

// A single floor transition costs about the same as a glass-cutter item's
// loot time (tier 5 on timeWeightFor()'s scale) — confirmed with the user
// 2026-08-23. Kept as one named constant rather than baked into the
// BFS/MST math directly, so the ratio stays visible and adjustable in one
// place if the relative scale above is ever retuned.
const FLOOR_TRANSITION_COST = 5;

// BFS shortest-path distance (in floor-transitions) between two floors,
// over the same FLOOR_ADJACENCY graph packBins()'s tier 3 already uses.
function shortestFloorDistance(a, b) {
  if (a === b) return 0;
  const seen = new Set([a]);
  let frontier = [a];
  let dist = 0;
  while (frontier.length) {
    dist++;
    const next = [];
    for (const f of frontier) {
      for (const n of FLOOR_ADJACENCY[f] || []) {
        if (n === b) return dist;
        if (!seen.has(n)) { seen.add(n); next.push(n); }
      }
    }
    frontier = next;
  }
  return Infinity; // never reached for two exhibit floors — the exhibit subgraph is fully connected through First
}

// True minimal cost to route through every floor in `floorSet` (a Set of
// exhibit-floor names) — the MST weight over the complete graph of
// pairwise shortest-path distances between them, NOT a flat "distinct
// floors - 1" count. A flat count would treat Alarm Floor + Crisp Gallery
// as a single 1-hop cost, when both only connect through First (a real
// 2-hop detour). With only 4 possible exhibit floors this is exact, not
// an approximation, and generalizes automatically if the floor graph ever
// changes. Each hop is scaled by FLOOR_TRANSITION_COST (a hop used to be
// worth flat `1`, the same unit as one weight-10 item's loot-time, until
// 2026-08-23 — the user confirmed a real transition costs much closer to
// a glass-cutter item's time, so it's scaled up to match rather than
// silently under-weighted against item time-costs).
export function exhibitTravelCost(floorSet) {
  const floors = [...floorSet];
  if (floors.length <= 1) return 0;
  const inTree = new Set([floors[0]]);
  let total = 0;
  while (inTree.size < floors.length) {
    let best = null;
    for (const a of inTree) {
      for (const b of floors) {
        if (inTree.has(b)) continue;
        const d = shortestFloorDistance(a, b) * FLOOR_TRANSITION_COST;
        if (!best || d < best.d) best = { floor: b, d };
      }
    }
    total += best.d;
    inTree.add(best.floor);
  }
  return total;
}

// Precomputed exhibitTravelCost() for every possible floor-touched bitmask
// (only 16, since there are only 4 exhibit floors) — keeps
// packBinsForTime()'s inner search loop from recomputing the same small
// MST repeatedly.
const TRAVEL_COST_BY_MASK = Array.from({ length: 1 << EXHIBIT_FLOOR_LIST.length }, (_, mask) => {
  const floors = EXHIBIT_FLOOR_LIST.filter((_, i) => mask & (1 << i));
  return exhibitTravelCost(new Set(floors));
});

// Given an ALREADY-SELECTED flat item list (each { id, value, weightUnits,
// floor, timeWeight, order? }) — never a fresh knapsack search — packs
// them into `bins` bags of `capacityPerBin` each to minimize the
// bottleneck (max) per-player time-cost, instead of packBins()'s value-
// maximizing objective. Item selection/total dollar value are whatever
// the caller already decided; this only changes which bag each item lands
// in. Returns { bags } in the same shape packBins() returns, or null if no
// feasible placement was found (see the limitation note below) — callers
// should fall back to whatever packing they already had, exactly like a
// null packBins() result.
//
// Two phases:
//  1. Vault/Loading Bay items are placed first via a plain call to
//     packBins() itself (as all-mandatory, no optional items) — reusing
//     its already-correct tier-0 host-avoid-Vault logic with zero
//     duplicated code. This is always feasible on its own (the full
//     combined item set was already proven bin-packable by the caller's
//     original packBins() run, and a feasible packing of a subset of
//     already-packed items trivially still fits).
//  2. Exhibit-floor items are placed into whatever capacity remains via
//     an EXACT minimax search over a candidate max-cost threshold T (not
//     a greedy heuristic) — a greedy assignment isn't guaranteed to find
//     a feasible packing even when one exists, the same class of bug
//     packBins() itself was rewritten to avoid on 2026-08-01.
//
// Known limitation, accepted for "experimental" status: phase 1's fresh
// Vault/Loading Bay placement isn't provably guaranteed to leave enough
// remaining capacity for phase 2 to succeed in every theoretically
// possible case (a single joint search across both phases would close
// this gap, at real added complexity). In practice this is a non-issue
// for this catalog — Vault/Loading Bay items are few and comparatively
// light against 100-capacity bags — but if phase 2 genuinely can't find a
// feasible split, this returns null rather than an invalid/overflowing
// bag, and the caller keeps its existing (value-preserving, default-
// heuristic) bag split for that run.
export function packBinsForTime(items, bins, capacityPerBin) {
  const nonExhibit = items.filter(it => !EXHIBIT_FLOORS.has(it.floor));
  const exhibit = items.filter(it => EXHIBIT_FLOORS.has(it.floor));

  // 'Loading Bay' is routed away from the host here specifically — see
  // packBins()'s `extraHostAvoidFloors` doc comment above for why this
  // isn't just added to the shared HOST_AVOID_FLOORS constant instead.
  const prePack = packBins(nonExhibit.map(it => ({ ...it })), [], bins, capacityPerBin, new Set(['Loading Bay']));
  if (!prePack) return null; // should not happen — see doc comment above
  const bagsOut = prePack.bags.map(b => ({ items: b.items.slice(), value: b.value, weightUsed: b.weightUsed }));

  if (exhibit.length === 0) return { bags: bagsOut };

  const remainingCapacity = bagsOut.map(b => capacityPerBin - b.weightUsed);

  // Largest-time-weight-first (mirrors packBins()'s own largest-weight-
  // first tiebreak within a priority floor), `order` as the final
  // tiebreak — same catalog-position convention packBins() uses.
  const exhibitSorted = exhibit.slice().sort((a, b) =>
    (b.timeWeight - a.timeWeight) || ((a.order ?? 0) - (b.order ?? 0))
  );

  function buildChecker(T) {
    const memo = new Map();
    function rec(i, caps, masks, sums) {
      if (i === exhibitSorted.length) return true;
      const key = i + '|' + caps.join(',') + '|' + masks.join(',') + '|' + sums.join(',');
      const cached = memo.get(key);
      if (cached !== undefined) return cached;
      const it = exhibitSorted[i];
      const bit = 1 << EXHIBIT_FLOOR_INDEX.get(it.floor);
      let ok = false;
      for (let b = 0; b < bins; b++) {
        if (caps[b] < it.weightUnits) continue;
        const newMask = masks[b] | bit;
        const newSum = sums[b] + it.timeWeight;
        if (newSum + TRAVEL_COST_BY_MASK[newMask] > T) continue;
        const nextCaps = caps.slice(); nextCaps[b] -= it.weightUnits;
        const nextMasks = masks.slice(); nextMasks[b] = newMask;
        const nextSums = sums.slice(); nextSums[b] = newSum;
        if (rec(i + 1, nextCaps, nextMasks, nextSums)) { ok = true; break; }
      }
      memo.set(key, ok);
      return ok;
    }
    return rec;
  }

  const zeros = new Array(bins).fill(0);
  // Safe upper bound for the minimal bottleneck: any single bin's cost is
  // at most the sum of every exhibit item's time-weight (if they all
  // landed in one bin) plus 3 (the max possible exhibitTravelCost across
  // all 4 exhibit floors — see its own doc comment).
  const tMax = exhibitSorted.reduce((s, it) => s + it.timeWeight, 0) + 3;
  let bestT = null;
  let bestRec = null;
  for (let T = 0; T <= tMax; T++) {
    const rec = buildChecker(T);
    if (rec(0, remainingCapacity, zeros, zeros)) { bestT = T; bestRec = rec; break; }
  }
  if (bestT === null) return null; // should not happen — see doc comment above

  // Reconstruct one concrete assignment achieving bestT, choosing among
  // cost-preserving candidates via the same tiers 2-4 packBins() already
  // uses above (same-floor clustering -> adjacent-floor -> most remaining
  // capacity -> ascending bin index) — confirmed with the user this
  // session. Tier 1 (host-priority for Crisp Gallery/Second) is
  // deliberately not reused here — it's about the value model's
  // EMP-verification rationale, unrelated to this objective.
  let caps = remainingCapacity.slice();
  let masks = zeros.slice();
  let sums = zeros.slice();
  for (let i = 0; i < exhibitSorted.length; i++) {
    const it = exhibitSorted[i];
    const bit = 1 << EXHIBIT_FLOOR_INDEX.get(it.floor);
    const candidates = [];
    for (let b = 0; b < bins; b++) {
      if (caps[b] < it.weightUnits) continue;
      const newMask = masks[b] | bit;
      const newSum = sums[b] + it.timeWeight;
      if (newSum + TRAVEL_COST_BY_MASK[newMask] > bestT) continue;
      const nextCaps = caps.slice(); nextCaps[b] -= it.weightUnits;
      const nextMasks = masks.slice(); nextMasks[b] = newMask;
      const nextSums = sums.slice(); nextSums[b] = newSum;
      if (bestRec(i + 1, nextCaps, nextMasks, nextSums)) {
        candidates.push({ b, nextCaps, nextMasks, nextSums });
      }
    }

    const floorMatches = candidates.filter(c => bagsOut[c.b].items.some(x => x.floor === it.floor));
    let chosen = floorMatches.reduce((best, c) => (!best || caps[c.b] > caps[best.b]) ? c : best, null);
    if (!chosen) {
      const adjMatches = candidates.filter(c => bagsOut[c.b].items.some(x => floorsAdjacent(it.floor, x.floor)));
      chosen = adjMatches.reduce((best, c) => (!best || caps[c.b] > caps[best.b]) ? c : best, null);
    }
    if (!chosen) {
      chosen = candidates.reduce((best, c) => (!best || caps[c.b] > caps[best.b]) ? c : best, null);
    }

    bagsOut[chosen.b].items.push({ id: it.id, value: it.value, weightUnits: it.weightUnits, floor: it.floor });
    bagsOut[chosen.b].value += it.value;
    bagsOut[chosen.b].weightUsed += it.weightUnits;
    caps = chosen.nextCaps;
    masks = chosen.nextMasks;
    sums = chosen.nextSums;
  }

  return { bags: bagsOut };
}

// Shared reachability predicate (2026-08-23) — consolidates the crew-size
// check with the new prep-skip check (state.skipPreps) so both call sites
// in runOptimizer() below can never silently disagree, the way two
// independent inline checks risked doing once a second gate existed.
// requiresPreps items (see secondary-loot.json) are unreachable only when
// the user has explicitly marked that prep as skipped this run —
// state.skipPreps defaults to [], exactly matching pre-2026-08-23
// behavior (every prep assumed done).
export function isItemReachable(catItem, state) {
  if (catItem.minPlayers > state.players) return false;
  const reqs = catItem.requiresPreps || [];
  return reqs.every(p => !(state.skipPreps || []).includes(p));
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
//
// The Buyer's Request bonus is decoupled from the Elite Challenge toggle
// (2026-08-07, real bug report: a 3-player run whose value-max optimal
// bag naturally included every marked item, but the bonus still showed
// as unearned purely because Elite wasn't toggled on). Buyer's Request
// only ever required *having* all the marked items, not attempting Elite
// — Elite is a separate, harder contract (the 17-minute clock) layered on
// top. So `buyerRequestBonusEach` below is now earned whenever the
// unconstrained pack happens to include every marked-and-scoped item too,
// even with Elite off — the >=2-picks minimum still applies either way
// (confirmed with the user 2026-08-07: it's a Buyer's-Choice-contract
// minimum, not an Elite-specific one). `eliteBonusEach` stays gated
// strictly behind the Elite toggle, unchanged — completing it depends on
// live-execution conditions this tool can't verify from bag contents
// alone, unlike simply having grabbed the marked items.
export function runOptimizer(state, catalog, bagCapacityPerPlayer, bonusConstants) {
  const valid = state.loot.filter(l => l.value !== '' && l.value !== null && l.value !== undefined && !isNaN(l.value));
  const eligible = valid.filter(l => isItemReachable(itemById(catalog, l.itemId), state));
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
  // 2026-08-15 (later fix): `buyersChoice` is threaded through here so
  // `packBins()`'s `mandatoryRank` can see it even when Elite is off (see
  // that function's doc comment for the full writeup) — without this, an
  // item's priority-pool placement silently depended on whether Elite
  // happened to be toggled on, not on the item's own identity.
  const toItem = (l) => {
    const cat = itemById(catalog, l.itemId);
    return { id: l.itemId, value: Number(l.value), weightUnits: cat.weight, floor: cat.floor, order: orderById.get(l.itemId), buyersChoice: !!l.buyersChoice };
  };

  const bcValid = valid.filter(l => l.buyersChoice);
  const bcIdsSet = new Set(bcValid.map(l => l.itemId));
  const bcIneligibleIds = bcValid
    .filter(l => !isItemReachable(itemById(catalog, l.itemId), state))
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

  // "Experimental: time-optimized packing" Advanced Settings toggle
  // (state.experimentalPacking, default false, 2026-08-23) — purely
  // additive, never touches packBins() above or which items got
  // selected/their value. Re-derives ONLY the bag assignment for the
  // exact same chosen item set, to balance exhibit-floor time-cost
  // between players instead of just maximizing bag value placement.
  // Falls back to keeping the default packedBags untouched if
  // packBinsForTime() can't find a feasible split (see its own doc
  // comment) — always safe, since that's the split this function would
  // have produced anyway.
  if (state.experimentalPacking) {
    const itemsForTime = packedBags.flatMap(b => b.items).map(i => ({
      ...i,
      order: orderById.get(i.id),
      timeWeight: timeWeightFor(itemById(catalog, i.id))
    }));
    const repacked = packBinsForTime(itemsForTime, state.players, bagCapacityPerPlayer);
    if (repacked) packedBags = repacked.bags;
  }

  const chosenIds = new Set(packedBags.flatMap(b => b.items.map(i => i.id)));

  const bonuses = bonusAmounts(state.difficulty, bonusConstants);
  const eliteEligible = attempted && allBuyerItemsFit;
  // Decoupled Buyer's Request check (see the doc comment above
  // runOptimizer): true when every marked-and-scoped Buyer's Choice item
  // ended up in the chosen bag selection ANYWAY, even without Elite
  // forcing them in. Still needs >=2 marked picks, same as the Elite path
  // — a single marked item was never enough to be a real Buyer's Choice
  // contract, Elite or not. Only ever consulted when Elite wasn't
  // attempted; when it was, `eliteEligible` already covers the earned
  // case, and the forced-mandatory-pack forfeiture path (attempted but
  // not allBuyerItemsFit) can never have packed every marked item anyway
  // — if it could, packBins() would have returned a non-null result for
  // the mandatory set in the first place.
  const allBuyerItemsPacked = bcIdsSet.size >= 2 && [...bcIdsSet].every(id => chosenIds.has(id));
  const buyerRequestEarned = eliteEligible || (!attempted && allBuyerItemsPacked);
  const buyerRequestBonusEach = buyerRequestEarned ? bonuses.buyerRequest : 0;
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
// comparison). The "without Elite" column (`secondaryShareEach`/
// `secondaryBagValue`, unchanged since 2026-08-04) forces `elite: 'no'`
// regardless of what the actual run has it set to, since Elite completion
// is never guaranteed and shouldn't by itself skew a "which crew size is
// best" comparison — every crew size gets the same pure value-max pack
// `runOptimizer()` already does when Elite is off, Buyer's Choice tags
// completely ignored.
//
// A second "with Elite" column (`secondaryShareEachWithElite`/
// `secondaryBagValueWithElite`, added 2026-08-07) forces `elite: 'yes'`
// instead, keeping the run's actual Buyer's Choice marks — user request:
// some crews still go for the Elite Challenge's Hard-mode bonus
// (+$100k/player) even though it's deliberately excluded from Career
// Progress, so which crew size still lets those marked items all fit
// matters to them too. This column deliberately reports the same *raw*
// secondary share metric as the other column, not a fuller payout with
// bonus dollars folded in — forcing Buyer's Choice items into packing can
// only match or reduce the raw share (never increase it), so the two
// columns are directly comparable at a glance; the bonus itself is the
// separate reward for accepting that trade-off, not something this panel
// projects (same reasoning `computeGuidePayout()` already applies to the
// Elite bonus). Reuses `runOptimizer()` as-is for both columns; no new
// packing logic — its existing >=2-picks and unreachable-item handling
// apply per crew size exactly as they would on a real run, including
// falling back to the unconstrained pack (matching the "without" column)
// whenever Elite can't actually be attempted or the marked items can't
// all be bin-packed at that size.
//
// Crew size still changes which items are even ELIGIBLE (Crisp Gallery
// items require `minPlayers: 2`) — `runOptimizer`'s own `eligible` filter
// already handles that per player count, so a smaller crew's lower share
// here can genuinely mean "fewer items were reachable," not just "a
// bigger total got split more ways." This applies to both columns.
export function compareCrewSizes(state, catalog, bagCapacityPerPlayer, bonusConstants) {
  const results = [];
  for (let players = 1; players <= 4; players++) {
    const withoutElite = runOptimizer({ ...state, players, elite: 'no' }, catalog, bagCapacityPerPlayer, bonusConstants);
    const withElite = runOptimizer({ ...state, players, elite: 'yes' }, catalog, bagCapacityPerPlayer, bonusConstants);
    results.push({
      players,
      secondaryBagValue: withoutElite.secondaryBagValue,
      secondaryShareEach: withoutElite.secondaryShareEach,
      secondaryBagValueWithElite: withElite.secondaryBagValue,
      secondaryShareEachWithElite: withElite.secondaryShareEach
    });
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

// Minimal RFC4180 escaping: wraps a field in double quotes (doubling any
// internal quotes) only when it actually contains a comma, quote, or
// newline — the common case (plain item names) stays unquoted and clean.
function csvEscapeField(field) {
  const s = String(field);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Builds a CSV string of this run's scoped secondary loot, for the user
// to copy/paste into their own external tracking spreadsheet before
// clearing the board (2026-08-10, user request — they track item values
// across runs over time outside this app). One row per **catalog** item,
// full stop — walked in `catalog` order so output is stable and matches
// every other per-item listing in the app. Unscoped items (no non-blank,
// numeric `value` — the same filter `runOptimizer()`'s `valid` list uses)
// still get a row, just with a blank Value field (2026-08-13, user
// feedback: pasting straight into a spreadsheet is easier when every
// item's row is already there, rather than needing blank rows
// hand-inserted afterward to keep alignment with other runs' pastes).
// Columns are Item, Floor, Value — Floor is a real, load-bearing column,
// not decorative: two catalog items share a name ("Oeuf de Coquard" on
// both Alarm Floor and Second; "Fertility Statue" on both First and Crisp
// Gallery), so Item alone can't disambiguate them if both are scoped in
// the same run. Value is written as a plain number (no `$`, no thousands
// separator) so a spreadsheet treats the column as numeric on paste
// rather than as text. `BAY` (the one checkbox item) needs no
// special-casing — it just gets a blank Value row like any other
// unchecked item. Pure/DOM-free like every other function here —
// index.html owns the actual `navigator.clipboard` call.
export function buildScopeCsv(loot, catalog) {
  const lootById = new Map(loot.map(l => [l.itemId, l]));
  const rows = [['Item', 'Floor', 'Value']];
  catalog.forEach(cat => {
    const entry = lootById.get(cat.itemId);
    const scoped = entry && entry.value !== '' && entry.value !== null && entry.value !== undefined && !isNaN(entry.value);
    rows.push([cat.name, cat.floor, scoped ? String(Number(entry.value)) : '']);
  });
  return rows.map(r => r.map(csvEscapeField).join(',')).join('\r\n');
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
    // 2026-08-15: 'no'/'yes', matching the string-valued convention every
    // other toggle field here uses (not a raw boolean) — see calcPrimary().
    keepPrimary: 'no',
    // Advanced Settings toggles (2026-08-23), both default to the exact
    // pre-existing behavior (every prep assumed done, default value-max
    // bag assignment) — see isItemReachable() and packBinsForTime() above.
    // skipPreps is an extensible array (not a one-off boolean) so a future
    // prep-gated toggle just adds another string.
    skipPreps: [],
    experimentalPacking: false,
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
      keepPrimary: page1.keepPrimary === 'yes' ? 'yes' : 'no',
      skipPreps: Array.isArray(page1.skipPreps) ? page1.skipPreps.filter(p => typeof p === 'string') : [],
      experimentalPacking: !!page1.experimentalPacking,
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
      keepPrimary: parsed.page1.keepPrimary === 'yes' ? 'yes' : 'no',
      skipPreps: Array.isArray(parsed.page1.skipPreps) ? parsed.page1.skipPreps.filter(p => typeof p === 'string') : [],
      experimentalPacking: !!parsed.page1.experimentalPacking,
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
//
// `buyersChoice` is force-reset to false for any item whose catalog entry
// carries `buyersChoiceEligible: false` (currently only BAY — the truck's
// contents can never actually be a Buyer's Choice target in-game),
// regardless of what's saved. Enforced here, the single place every page's
// loadPersisted() already funnels through, rather than only at the UI
// layer — so a value marked true before this flag existed (or written by
// a future bug) can never silently resurrect as a mandatory Elite pick.
export function mergeLootByItemId(catalog, savedLoot) {
  const savedById = new Map((savedLoot || []).map(l => [l.itemId, l]));
  return catalog.map(cat => {
    const saved = savedById.get(cat.itemId);
    const variants = Array.isArray(cat.variants) ? cat.variants : [];
    const savedVariant = saved && typeof saved.variant === 'string' ? saved.variant : '';
    return {
      itemId: cat.itemId,
      value: saved && saved.value !== undefined ? saved.value : '',
      buyersChoice: cat.buyersChoiceEligible === false ? false : (saved ? !!saved.buyersChoice : false),
      variant: variants.includes(savedVariant) ? savedVariant : ''
    };
  });
}
