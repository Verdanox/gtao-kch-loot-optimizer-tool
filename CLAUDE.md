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
  payout/bonus figures — no combined "Total Take" headline, see below;
  each player's own card below it does show a per-player "Career
  Progress" figure, distinct from "Payout").
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
    `fixedValue: 110000` on its catalog entry (data-driven, not a
    hardcoded `itemId === 'BAY'` check in the JS). Checked locks its value
    to `fixedValue`; unchecked excludes it entirely, even if it's also
    marked Buyer's Choice. This is the one deliberate exception to "every
    item starts blank" — its true value can't be known until it's
    actually taken during the heist. `fixedValue` was $122,500 (the
    $105k-140k community range, averaged) until 2026-08-03, when the user
    reported the truck's real value running lower than that average in
    practice — it's now a deliberately pessimistic $110,000 for optimizer
    math, and unlike the averaged figure before it, this number is
    **never shown to the user on `index.html`**: the checkbox's own label
    just reads "Scoped", not a dollar amount, since it's a planning
    assumption rather than a confirmed real value worth anchoring on.
    (`guide.html`'s results/manifest screen is unaffected by this and
    still shows the item's actual dollar contribution like any other
    packed item.)
  - **`scopeNote`** (currently only on `BAY`) — reminder-only metadata
    rendered inline under an item's name on `index.html` whenever
    present, generic to any catalog item (not a hardcoded `itemId`
    check). `BAY`'s note warns the crate isn't guaranteed to exist at
    all (the truck doesn't always spawn) — distinct from `requiresPreps`
    below, which is about needing a prep mission for an item that IS
    always there.
  - **`variants` + `variantLabel` (currently only on `2-H`, Gemstone)** —
    an optional per-run sub-type picker. When a catalog entry carries a
    non-empty `variants` array, `index.html` renders a dropdown of those
    values in the item's controls (after the value input, so the
    documented "click row, Tab once → value input" order is unchanged),
    and the pick is saved on the loot entry as `variant`. It is purely
    descriptive: never an eligibility, weight, value, or packing input,
    and `runOptimizer()` never reads it. `guide.html` shows it in the
    "Who Grabs What" manifest **in place of** the item's `description` —
    a chosen variant is the run-specific version of the same field
    (`2-H`'s generic tag is literally "gem, color varies"). Data-driven,
    not a hardcoded `itemId === '2-H'` check: any item can grow a
    `variants` list and get the same control. `mergeLootByItemId()` drops
    a saved `variant` that the catalog no longer offers, the same way it
    drops stale `itemId`s.
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
`runOptimizer()`, `computeGuidePayout()`, `computeCareerProgress()`,
`packedPrepWarnings()`, `money()`, and the
`serializeState`/`deserializeState`/`mergeLootByItemId`
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
selection no longer calls them. `knapsack()` was originally kept as the
building block a future "Greedy" model would need for its "stack the
host's bag first" step — that model is now deprioritized (2026-08-02):
the even-split payout confirmation (see below) means stacking value into
one bag has zero effect on anyone's career progress, so Greedy no longer
has a rationale (see `internal/model-notes.md`'s "Greedy" section for the
full history). Both primitives stay only as tested building blocks now —
`knapsack()` for single-bag allocation, `assignItemsToBags()`'s
host-routing tie-break behavior covered directly by
`test/bin-packing.test.js` — not because Greedy is still on the roadmap.

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
- **Bag assignment follows a four-tier, value-preserving preference**
  (rewritten 2026-08-02, extended 2026-08-03, widened 2026-08-04):
  `packBins()`'s reconstruction step chooses *which bin* an item lands in —
  never which items get chosen or the total secondary value — by, in
  order: (1) `Second` and `Crisp Gallery` items prefer the host's bag
  specifically (`HOST_PRIORITY_FLOORS`, shared with
  `assignItemsToBags()`'s own separate mechanism below). `Crisp Gallery`'s
  piece of this is the original, narrower exception — the host is the more
  reliable player to verify in-room presence when using an EMP, given
  known desync behavior in that specific room. `Second` joined it
  2026-08-04, confirmed against real heist mechanics: the host must
  physically enter the Vault for the primary target at *every* crew size
  (2-4 players), and Loading Bay is mutually exclusive with that Vault
  visit by game mechanics (can be sequenced before or after, but not
  combined into one pass) — so the host's route naturally continues on to
  the building's 2nd floor (`Second` + `Crisp Gallery`) afterward. `Vault`
  and `Loading Bay` were deliberately **not** added to this tier: the whole
  crew is physically present for the Vault sequence, not just the host, so
  there's no logistics/adjacency reason to bias Vault loot toward any one
  player — it's already the lowest-value-per-weight floor in the KCH, so
  it's naturally deprioritized by the value-maximizing search on its own,
  no tier needed; Loading Bay is isolated with no clustering upside either
  way, and can still land in the host's bag when capacity/ordering happens
  to put it there — that's fine, since the host just sequences it before
  or after the Vault trip rather than combining them; (2) otherwise, prefer
  a bin that already contains an item on the same floor (general
  floor-clustering, so a crew spends less time running between floors);
  (3) otherwise, prefer a bin that already contains an item on an
  *adjacent* floor per the real Kortz Center map (`Alarm Floor`↔`First`,
  `First`↔`Second`, `First`↔`Crisp Gallery`, `Second`↔`Crisp Gallery`;
  `Vault` and `Loading Bay` are isolated, adjacent to nothing including
  each other) — a softer nudge than exact-floor clustering, added after
  live testing showed a player routed straight from `Alarm Floor` to
  `Second`, skipping past `First`; (4) otherwise, prefer whichever bin
  has the most remaining capacity (spreads items across players by
  default). All four tiers only ever choose among bins already confirmed
  to preserve the optimizer's optimal total value — none of this can
  cost secondary value, and each tier falls through to the next when no
  value-preserving bin satisfies it, exactly like tier 1's host-bag
  fallback. Tier 1 traces to an earlier version that tried bin 0 first
  for literally *every* item (mandatory and optional alike), which is
  why Buyer's Choice loot used to land entirely in the host's bag — a
  real bug, not a rule.
  There's no fixed job-to-player-slot convention in real play (confirmed
  with the user 2026-08-04), so no per-player-index (P2/P3/P4) rules were
  added beyond the host/non-host split above — tiers 2-4 already produce
  reasonable, jobs-agnostic clustering for every non-host player once the
  host's items are placed first.
  `assignItemsToBags()` (the separate, unused-in-production
  First-Fit-Decreasing primitive — originally kept for a possible future
  "Greedy" model, since deprioritized, see `internal/model-notes.md`)
  still has its own, untouched `HOST_PRIORITY_FLOORS`/
  `HOST_PRIORITY_BOOST` logic bundling `Second`+`Crisp Gallery` — see
  `internal/model-notes.md`'s "Clarified model definitions" for the
  original "EMP" rationale that logic still reflects. `packBins()` now
  reads this same `HOST_PRIORITY_FLOORS` constant directly for tier 1
  above, rather than a separate `Crisp Gallery`-only constant, since the
  two happened to converge on the identical floor set.
- **`packBins()`'s bag assignment for a given selected item set is
  independent of Buyer's Choice/Elite status** (fixed 2026-08-04, real bug
  report: the same scope-out, resubmitted with Elite toggled on vs off,
  produced two different bag splits despite an identical secondary total
  and item selection). Root cause: `packBins()` built its working list as
  `[...mandatory, ...optional]`, so marking items Buyer's-Choice-mandatory
  pulled them to the front of the list, changing the order the four-tier
  reconstruction above walks items in — and when multiple bag partitions
  tie for the optimal value (as they did in the bug report), which one
  surfaces depended on this ordering accident, not on which was more
  sensible. Fix: every item passed to `packBins()` may carry an optional
  `order` field (mirrors the optional `floor` field — never touches
  value/weight/eligibility); the reconstruction stable-sorts by it before
  walking items, so callers that never set it (every pre-existing caller
  except `runOptimizer()`) see zero behavior change. `runOptimizer()`
  populates `order` from each item's position in the catalog-ordered
  `eligible` list, so reconstruction now always walks items in true
  catalog order regardless of which end up `mandatory` vs `optional`.
- **`compareCrewSizes()` (added 2026-08-04) answers "would a different
  crew size pay more per player?"** for the loot values already entered —
  a supplementary panel on `guide.html`, never affecting the actual run's
  result above it. It sweeps player counts 1-4, calling `runOptimizer()`
  once per size with `elite` forced to `'no'` regardless of the real run's
  setting — Elite Challenge completion is never guaranteed, so it
  shouldn't skew which crew size looks best, and forcing Elite off also
  means Buyer's Choice never constrains packing here, just the plain
  value-max pack. It reports `secondaryShareEach` only (not the host's
  full payout with primary/bonuses) — precedented by
  `internal/kch_calculator_8.2.26.py`'s own solo/duo/trio/quad payout
  comparison, which computes the analogous "best secondary take"
  config. Crew size still changes item *eligibility*, not just how a
  fixed total splits — Crisp Gallery items require `minPlayers: 2`, so a
  smaller crew's lower share can genuinely mean fewer reachable items, not
  just a bigger total split more ways; `guide.html`'s panel says this
  explicitly rather than leaving it to be inferred from the numbers alone.
- **Buyer's Choice is conditional on Elite Challenge, and needs at least
  2 picks.** Marking up to three items as Buyer's Choice only affects
  packing when Elite Challenge is toggled on. With Elite off, Buyer's
  Choice tags are purely informational (still shown in the manifest) and
  the optimizer runs a single unconstrained pack over all scoped items to
  maximize bag value — no forced inclusion, no Buyer's Request/Elite
  bonus, no overflow state. **A single marked item can never satisfy
  Elite Challenge** (confirmed 2026-08-03, direct game knowledge) — 0 and
  1 marked-and-scoped picks resolve identically to "not attempted" (same
  unconstrained pack, no bonus), only 2 or 3 actually lock packing and
  put the bonuses in play. `guide.html` shows an explicit warning for
  both the 0- and 1-pick case (one shared message, parameterized only by
  the count) rather than leaving it inferable only from the Finale
  Result's "not attempted" label.
- **Buyer's Request, Elite Challenge, and Helper bonuses all double on
  Hard mode**: $50k Buyer's Request / $50k-per-player Elite / $100k
  Helper on Normal, $100k / $100k-per-player / $200k on Hard.
- **Every player's secondary-loot cut is identical, and bag contents are
  economically irrelevant.** Confirmed 2026-08-02 against two real GTA
  payout screenshots: each player's share is `secondaryBagValue /
  players`, split evenly regardless of which bag any specific item
  physically landed in — bag/floor assignment (see above) is pure
  logistics with zero effect on payout. Host additionally gets the
  Primary Target value. **Every non-host player (P2–P4) unconditionally
  earns the flat Helper bonus** on top of everything else — not a
  per-run toggle, a fixed rule of the model (the all-even-split scenario
  from one of the two reference screenshots is deliberately no longer
  representable). If Buyer's Request is earned, every player gets the
  full bonus amount each, not a split pool. The repeat-run planning fee
  is a host-only cost, but is **not** netted against any player's payout
  (see below) — it's disclosed separately in the "Finale Result" ledger.
- **A per-player "Career Progress" figure exists, fulfilling the
  "deferred to a later round" note below.** `computeCareerProgress()` in
  `kch-model.js`: host = Primary Target + secondary share; everyone else
  = secondary share only. It excludes **every** bonus — Buyer's Request,
  Elite, and Helper alike — for every player, host included. This is
  deliberately a *different* number from Payout (below), rendered as its
  own, visually distinct line in each player's card on `guide.html`.
- **No combined "Total Take (Career Progress)" headline.** One used to
  show `primary.value + secondaryBagValue` (the crew-wide combined bag
  total), but the PM confirmed (2026-07-26, direct game knowledge) that
  career progress is actually tracked per-player, not the crew's combined
  total. The old line was removed as actively misleading rather than left
  in place. The per-player replacement that note deferred is the Career
  Progress figure above — don't reintroduce a crew-wide combined-total
  headline; the correct shape for this number is per-player.
- **Page 2's per-player "Payout" figure (renamed from "Take" 2026-08-02 —
  it's the amount that actually hits the wallet) shows the Buyer's
  Request bonus but never projects the Elite Challenge bonus dollar
  amount**, even when one is earned at the model level. The Elite toggle
  still correctly makes Buyer's Choice mandatory for packing (an
  optimizer concern); omitting its bonus from Payout is display-only,
  because Elite success depends on live-execution conditions (the
  17-minute clock, etc.) this tool can't model or guarantee — `guide.html`
  instead shows a small note under Payout naming the exact dollar amount
  Elite would add on success. `computeGuidePayout()` in `kch-model.js` is
  the single source of truth for this total — it takes `secondaryShareEach`
  (never an individual bag's value), `buyerRequestBonusEach`, and
  `helperBonusEach` for non-hosts, but never `eliteBonusEach` and never
  the repeat-run planning fee.

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
