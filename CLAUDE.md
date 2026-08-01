# Kortz Center Loot Ledger

A static, dependency-free web app that recommends the optimal secondary-loot
loadout for the GTA Online Kortz Center Heist, given crew size, difficulty,
weekly status, and Buyer's Choice picks.

## Pages
Two static pages, real navigation via `location.href`, state handed off
entirely through `localStorage` (no view-swap, no SPA framework):
- `index.html` — Page 1, Scope & Setup. Pure input collection: primary
  target, difficulty, weekly status, crew size, the full loot chart,
  Buyer's Choice picks, Elite Challenge toggle, optional per-player names.
  No live results panel — a single Submit button is the only way to reach
  Page 2.
- `guide.html` — Page 2, Heist Guide. The results/manifest screen, meant to
  be screenshotted or printed during the run. Top-to-bottom: a glass-cutter
  prep reminder banner (if applicable), the security-door-combination field
  with a reversible lock control, the promoted "who grabs what" info
  (optimized bag value + per-player item lists, color-coded by floor), then
  the demoted "Finale Result" (Primary/Secondary totals + per-player
  payout/bonus figures — no combined "Total Take" headline, see below).
  These are genuinely separate render passes/DOM
  zones, not just reordered markup — the item ledger and the payout figures
  used to be welded into the same per-player card. Has a "back to edit"
  link back to `index.html`; both pages hydrate from the same
  `localStorage` blob, so navigation either direction needs no extra
  state-passing.

Both pages are `type="module"` and `import` directly from `js/kch-model.js`
(no separate `<script src>` tag for it). Shared visual styling lives in
`css/kch-styles.css`, linked from both pages.

## Data model
- `data/primary-targets.json` — primary painting payouts. Only a base value is
  stored per painting; hard mode and first-week are the only two clean
  multipliers applied on top (see `_notes` in the file for the derived
  formula and verification).
- `data/secondary-loot.json` — every scoutable secondary item, its floor
  location, and its bag-weight (0–100 scale, one bag = 100). Dollar values are
  NOT stored here — they're randomized per scope-out and entered by the user
  at runtime, keyed by `itemId`. The UI shows the full catalog as an
  always-visible chart grouped by floor (not a picker you add rows to) —
  every item's value input starts blank until the user fills in what they
  actually scoped. Item weight is intentionally never shown to the user —
  bag-space math is the tool's job, not theirs.
  - **Exception: the Delivery Truck Crate (`BAY`)** renders as a checkbox,
    not a number input, driven by `valueType: "checkbox"` and
    `fixedValue: 122500` on its catalog entry (data-driven, not a
    hardcoded `itemId === 'BAY'` check in the JS). Checked locks its value
    to `fixedValue`; unchecked excludes it entirely, even if it's also
    marked Buyer's Choice. This is the one deliberate exception to "every
    item starts blank" — its true value can't be known until it's
    actually taken during the heist.
  - **`requiresPreps` (e.g. `["glass-cutter"]`)** — reminder-only metadata
    on four items (`0-A`, `2-B`, `2-C`, `2-K`) that need a prep mission to
    actually be lootable in-game. This does **not** gate the optimizer —
    no eligibility exclusion, no `state` field, no packing changes. `guide.html`
    just warns if any *packed* item carries it, naming only the ones
    actually present. Full gating (a toggle, excluding these from
    selection when the prep isn't marked done) is deferred to a future
    "specify your preps" system — see `internal/model-notes.md`.
  - On `index.html`, the entire loot row is the Buyer's Choice click
    target (a `<label>` wrapping a visually-hidden checkbox, per-item
    `aria-label`) — not just a small checkbox — while the value input (and
    BAY's own checkbox) remain independently clickable/typeable inside it.

## Model module
`js/kch-model.js` is a pure ES module — no `document`, `fetch`, or
`localStorage` anywhere in it — holding `packBins()`, `knapsack()`,
`assignItemsToBags()`, `calcPrimary()`, `bonusAmounts()`, `itemById()`,
`runOptimizer()`, `computeGuideTake()`, `packedPrepWarnings()`, `money()`,
and the `serializeState`/`deserializeState`/`mergeLootByItemId`
persistence helpers. Both pages and the Node test suite (`test/*.test.js`,
run via `node --test`) import this same file, so there is exactly one
implementation of the optimizer logic. A marked-and-scoped Buyer's Choice
item that the current crew size can't even reach (its `minPlayers`
exceeds `players`) forces the same forfeiture as a bag-weight overflow —
it's an illegal combo, not a silent drop — and drops Buyer's Choice
weighting from packing entirely (the *other*, reachable marked items are
no longer force-locked either, since the bonus is already guaranteed
forfeited).

`runOptimizer()` selects and assigns items via `packBins()` — see "Core
logic" below for why. `knapsack()` (plain single-bag 0/1 knapsack) and
`assignItemsToBags()` (First-Fit-Decreasing bin pack) are kept as
standalone, independently-tested primitives even though production
selection no longer calls them: `knapsack()` is still exactly the
building block the future Greedy model needs for its "stack the host's
bag first" step (see Roadmap), and `assignItemsToBags()`'s host-routing
tie-break behavior is covered directly by `test/bin-packing.test.js`.

## Persistence
Page 1 inputs (primary target, difficulty, weekly status, players, loot
values/Buyer's Choice flags, Elite toggle, player names) and Page 2's
`securityCombo` + `locked` fields all autosave to a single versioned
`localStorage` key (`kch-loot-ledger:v1`) on every input/change event, and
survive page refresh, closing/reopening the browser, and navigating
between pages. Parsing is defensive: a `schemaVersion` mismatch or
malformed/corrupted JSON falls back to defaults rather than throwing.
Hydration merges saved per-item loot values onto the freshly-fetched
catalog **by `itemId`**, never a wholesale replace of the loot list.
`page2.locked` toggles the security-combo input between editable and
`readonly` (never `disabled`, so it stays selectable/copyable/tabbable) —
a reversible fat-finger guard, not a security boundary, so there's no
confirmation dialog on unlock.

## Core logic
- Bag capacity = `players * 100`, but capacity is enforced **per player
  bag**, not as one pooled number — see `packBins()` below for why that
  distinction is load-bearing.
- **Optimizer is an exact multi-bin knapsack (`packBins()` in
  `kch-model.js`), not a pooled knapsack + separate bin-split.** Buyer's
  Choice items are passed in as mandatory (must all be included), the
  rest as optional (chosen to maximize value); `packBins()` searches
  directly over per-bag remaining capacity, so every value it reports is
  provably realizable as an actual per-player bag assignment. This
  replaced an earlier pooled-capacity design (2026-08-01 bug fix): fitting
  the pooled total (`players * 100`) does **not** guarantee the chosen
  items can be partitioned into fixed-size bags — bin packing can be
  infeasible even when the sum fits — and a real bug report (a bag
  showing 110% full) confirmed this happens with real catalog weights at
  every player count ≥2, not just larger crews. `packBins()` is only fast
  enough for an exact search because every catalog weight and the bag
  capacity share a common factor (10 today) — it computes that as a GCD
  rather than hardcoding /10, so it stays correct (just a bigger, still
  small, search) if a future item ever broke that pattern. (Power-drill
  loot, weight 5, was considered and deliberately excluded — its
  per-unit value is the lowest of anything in the KCH, not worth
  modeling — see the `_notes` in `secondary-loot.json`.)
- If Buyer's Choice items can't all be bin-packed into the crew's bags at
  all (`packBins()` returns null for the mandatory set), the Buyer's
  Request + Elite Challenge bonuses are marked as forfeited, and packing
  falls back to the same unconstrained value-max pack used when Elite
  isn't attempted. If a marked item is structurally unreachable for the
  crew size at all (`minPlayers` exceeds `players`), Buyer's Choice
  weighting is dropped from packing entirely the same way — the other,
  reachable marked items aren't force-included either, since forfeiture
  is already locked in and forcing them could only cost bag value for a
  bonus that can't pay out.
- **Normal model has a slight, best-effort host-routing preference**:
  `Second`/`Crisp Gallery` items get first crack at placement among the
  optional pool, and every item prefers bin 0 (the host) on a tie — not a
  hard override, if the host's bag is genuinely full the item still lands
  elsewhere normally. This only affects *who carries what*, never *which*
  items get chosen or the total secondary value. See
  `internal/model-notes.md`'s "Clarified model definitions" for why (this
  is what the notebook calls "EMP," baked into Normal as a standing
  default rather than a separate toggle).
- **Buyer's Choice is conditional on Elite Challenge.** Marking up to three
  (fewer is fine) items as Buyer's Choice only affects packing when Elite
  Challenge is toggled on. With Elite off, Buyer's Choice tags are purely
  informational (still shown in the manifest) and the optimizer runs a
  single unconstrained pack over all scoped items to maximize bag value
  — no forced inclusion, no Buyer's Request/Elite bonus, no overflow state.
- **Buyer's Request and Elite Challenge bonuses double on Hard mode**: $50k
  Buyer's Request / $50k-per-player Elite on Normal, $100k / $100k-per-player
  on Hard.
- **Payout is split per player, not shown as one crew total.** `packBins()`
  above decides both *which* secondary items get packed AND which
  individual player bag (capacity 100 each) each one lands in, in a single
  pass — index 0 is always "the host." Host = Primary Target + their bag − the repeat-run fee
  (host-only cost); players 2–4 = their bag only. If Buyer's Request/Elite
  are earned, **every player gets the full bonus amount each**, not a split
  pool.
- **No combined "Total Take (Career Progress)" headline.** One used to
  show `primary.value + secondaryBagValue` (the crew-wide combined bag
  total), but the PM confirmed (2026-07-26, direct game knowledge) that
  career progress is actually tracked per-player/per-bag — as host, it's
  your primary plus only *your own* bag, not the crew's combined total. The
  old line was removed as actively misleading rather than left in place;
  a correct per-player replacement is deferred to a later round. Don't
  reintroduce a combined-total headline without that per-player fix.
- **Page 2's per-player "Take" figure shows the Buyer's Request bonus but
  never projects the Elite Challenge bonus dollar amount**, even when one
  is earned at the model level. The Elite toggle still correctly makes
  Buyer's Choice mandatory for packing (an optimizer concern); omitting its
  bonus from the displayed Take is display-only, because Elite success
  depends on live-execution conditions (the 17-minute clock, etc.) this
  tool can't model or guarantee. `computeGuideTake()` in `kch-model.js` is
  the single source of truth for this total — it takes `buyerRequestBonusEach`
  only, never `eliteBonusEach`.

## Known open questions (confirm before shipping)
- The source payout table also included values for runs where witnesses/CCTV
  were left behind (0.75x). That's an execution outcome, not a planning
  input, so it's been cut from primary-targets.json entirely — no field for
  it, nothing to wire up.
- Consumato's first-time-this-week value: confirmed in this data pull, unlike
  the earlier estimate — use the table value, not the old 4x-guess.

## Stack
Plain HTML/CSS/JS, no build step. Deploys as-is to GitHub Pages. The only
non-static artifact is `package.json` + `test/`, dev-only tooling for the
Node test runner — it never ships; GitHub Pages still just serves
`index.html`/`guide.html`/`js/`/`css/`/`data/` as static files.

## Commands
- `npm test` (or `node --test`) — runs the suite in `test/*.test.js`
  against `js/kch-model.js`. No external dependencies, no bundler.
