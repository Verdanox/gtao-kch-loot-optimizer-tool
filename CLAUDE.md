# Kortz Center Loot Ledger

A static, dependency-free web app that recommends the optimal secondary-loot
loadout for the GTA Online Kortz Center Heist, given crew size, difficulty,
weekly status, and Buyer's Choice picks.

## Pages
Three static pages, real navigation via `location.href`, state handed off
entirely through `localStorage` (no view-swap, no SPA framework):
- `index.html` — Page 1, Scope & Setup. Pure input collection: primary
  target, difficulty, weekly status, crew size, the full loot chart,
  Buyer's Choice picks, Elite Challenge toggle, optional per-player names.
  No live results panel — a single Submit button is the only way to reach
  Page 2. A "Copy as CSV" button (2026-08-10, next to "Clear Board" in the
  header actions bar) copies the current run's scoped item values to the
  clipboard, since the user tracks values across runs over time in their
  own external spreadsheet and had no way to preserve a scope-out before
  clearing the board. One row per **catalog** item, full stop, in catalog
  order, three columns: Item, Floor, Value — unscoped items still get a
  row, just with a blank Value field (changed 2026-08-13, user feedback:
  pasting straight into a spreadsheet is easier when every item's row is
  already present, rather than needing blank rows hand-inserted afterward
  to keep alignment with other runs' pastes; originally shipped
  2026-08-10 skipping unscoped items entirely). Floor is a real,
  load-bearing column, not decorative — two catalog
  items share a name ("Oeuf de Coquard" on both Alarm Floor and Second;
  "Fertility Statue" on both First and Crisp Gallery), so Item alone
  can't disambiguate them if both are scoped in the same run; the user
  chose a Floor column over renaming/suffixing the items themselves.
  Value is a plain number (no `$`, no thousands separator) so a
  spreadsheet treats it as numeric on paste, not text. The CSV-building
  logic itself (`buildScopeCsv()`) lives in `js/kch-model.js`, not here —
  same reason every other piece of shared logic does: it's pure
  (filtering/ordering/escaping, no `document`/clipboard), so it gets real
  `node --test` coverage against `fixtures/sample-run.json`
  (`test/build-scope-csv.test.js`) instead of only being checkable by eye
  in a browser. `index.html` only owns the actual
  `navigator.clipboard.writeText()` call and the button's brief
  "Copied!"/`var(--teal)` confirmation state (mirrors `guide.html`'s
  `.lock-btn.locked` pattern), reverting after ~1.5s. Deliberately not
  offered inside the "Clear the board?" confirm dialog too — header bar
  only, the user's call, on the reasoning that Copy is a general-purpose
  action rather than specifically a clear-time safety net. JSON export
  (for a future clean re-import feature) was considered and explicitly
  deferred — not a need right now.
  **Step order was reshuffled 2026-08-13** (Crew Size moved from Step 2
  to Step 4, now right after Elite Challenge, ahead of Crew Names):
  crew size might not actually be decided until after the loot's already
  been scoped, so asking for it second forced a premature choice. This
  is a pure DOM/markup reorder — every step's inner control still autosaves
  to the same `state` fields via the same element IDs, and `renderAll()`
  reads `state.players` on every change regardless of where its step
  physically sits, so nothing downstream needed touching (verified: the
  loot chart's per-floor "Needs N+ players" note already reads
  `state.players` live, not step position). The Scoped Secondary Loot
  hint text was tightened the same day (fewer clauses per sentence) and
  its "Elite Challenge (Step 4)" cross-reference was changed to "(below)"
  — a hardcoded step number would have gone stale the moment step order
  changed again, and "below" stays true regardless (Elite Challenge has
  always immediately followed the loot chart, before or after this
  reorder). The hint also now explicitly says Buyer's Choice is marked
  "by clicking the item" (user-requested addition) — the click target is
  the whole row/label, not a small checkbox, and that wasn't obvious from
  the text before.
  **"Keep Primary?" toggle (2026-08-15, user request), Step 1.** Some
  hosts keep the primary painting for display (arcade/property) instead
  of selling it. A third toggle-group in Step 1 (`state.keepPrimary`,
  `'no'`/`'yes'` — string-valued like every other toggle field here, not
  a raw boolean), same visual pattern as the Elite Challenge toggle. Purely
  a payout exclusion: nothing else in the tool changes (secondary loot,
  bonuses, bag packing all untouched) — confirmed with the user this
  doesn't map to any other mechanic. **Disabled for the mandatory story
  target** (`la-derniere-debauche`) — `renderPrimaryInfo()` already told
  the user "Mandatory story target — must be sold every run" before this
  toggle existed, and letting "Keep Primary? Yes" coexist with that line
  would contradict it, so selecting the mandatory target dims the "Yes"
  option (`.toggle-btn.disabled` — a CSS/JS click-guard, not a native
  `disabled` attribute, since these are `<div>`s) and force-resets
  `keepPrimary` back to `'no'` if it was set while a different, optional
  target was previously selected. See `guide.html` below for how `kept`
  propagates to the actual totals.
  Also **sorted by value, most → least valuable** (2026-08-15, user
  request, replacing alphabetical) — see the `primary-targets.json` entry
  under "Data model" below.
- `guide.html` — Page 2, Heist Guide. The results/manifest screen, meant to
  be screenshotted or printed during the run. Top-to-bottom: a glass-cutter
  prep reminder banner (if applicable), the security-door-combination field
  with a reversible lock control, the promoted "who grabs what" info
  (optimized bag value + per-player item lists, color-coded by floor), a
  "Map View →" button (see `map-view.html` below), then the demoted
  "Finale Result" (Primary/Secondary totals + per-player payout/bonus
  figures — no combined "Total Take" headline, see below; each player's
  own card below it does show a per-player "Career Progress" figure,
  distinct from "Payout"). These are genuinely separate render passes/DOM
  zones, not just reordered markup — the item ledger and the payout figures
  used to be welded into the same per-player card. Has a "back to edit"
  link back to `index.html`; every page hydrates from the same
  `localStorage` blob, so navigation in any direction needs no extra
  state-passing.
- `map-view.html` — Page 3, Map View, added 2026-08-06. A lean,
  host-facing, screenshot/share-friendly live-reference for the *actual
  run*, reached via the "Map View →" button on `guide.html` (sitting
  between "Who Grabs What" and "Finale Result" — the seam between
  operational and planning content) and a "← Back to Guide" link back.
  **`guide.html` gates that button behind a `MAP_VIEW_ENABLED` constant**
  (added 2026-08-10, near the top of its module script) — a deploy-time
  kill switch: flip to `false` and redeploy to instantly hide the
  gateway button/section without a git revert, in case the feature ships
  with an issue post-launch. Deliberately only hides discoverability from
  `guide.html` — it doesn't gate `map-view.html` itself, so a direct URL
  still works while the flag is off; adding that would mean duplicating
  the flag onto `map-view.html` too, which already deliberately duplicates
  rather than shares render helpers with `guide.html` (see below), and
  wasn't asked for. Chosen over a full git revert because the map feature
  and any unrelated in-flight fix (e.g. to `js/kch-model.js`) live in
  different files, so this flag can be flipped independently of whatever
  else has landed since.
  Exists because `guide.html` conflates two audiences that have nothing to
  do with each other mid-heist: planning/bookkeeping (Finale Result,
  Payout by Player, Career Progress, Crew Size Comparison — relevant
  before a crew size is locked in, or after to settle up) and operational
  reference (prep warnings, security combo, who-grabs-what, floor maps —
  the only part that matters *during* the run). The host is the one who
  fills out this tool and relays results to teammates (confirmed
  2026-08-06), not each player individually — so this page is what a host
  keeps pinned on a second screen or screenshots piece-by-piece into a
  group chat, without financial math ever sharing the frame. Deliberately
  contains, top to bottom: the prep warning banner, Security Door
  Combination (identical markup/IDs to `guide.html` — editing/locking it
  here updates the same `page2State` fields `guide.html` reads, via the
  shared `localStorage` blob), Who Grabs What (shown exactly as on
  `guide.html`, dollar values and Buyer's Choice flags included — not a
  stripped-down variant), and Floor Maps (see below) — deliberately last,
  since floors with no tagged coordinates yet contribute nothing there and
  the list above is already the complete fallback, and crews who don't
  need the spatial view (the user's phrase: "sweaty folks") just stop
  scrolling once they have their list — no toggle/collapse mechanism
  needed to make maps skippable. Deliberately excludes the Optimized Bags
  $ stamp and its overflow/Buyer's-Choice-ineligible warning — the host
  already sees that on `guide.html` itself before ever clicking through,
  and it's planning-relevant, not moment-to-moment operational info.
  **Duplicates rather than shares** `guide.html`'s `PREP_LABELS`/
  `prepLabel`, `FLOOR_SLUGS`/`floorSlug`, `playerLabel()`, `variantFor()`,
  `loadPersisted()`/`saveState()`, `renderPrepWarning()`,
  `renderItemsList()`, and `wireSecurityCombo()` — checked the existing
  precedent first: `index.html` and `guide.html` already each
  independently duplicate their own persistence/hydration boilerplate,
  and the only thing actually shared between pages today is
  `js/kch-model.js` (pure logic). Introducing a shared render module for
  one page would be a new pattern the rest of the app doesn't use, so this
  stays consistent with how the app already works rather than DRY-ing it
  up. Also skips fetching `data/primary-targets.json` entirely — nothing
  on this page needs a primary-target value, so unlike the other two
  pages it only fetches `data/secondary-loot.json`.

Floor Maps itself (an image-based extension of "Who Grabs What," not a
replacement) lives only on `map-view.html`: one card per floor-map asset,
with a pin for every *packed* item that has real `xPct`/`yPct` data,
colored by which player's bag it landed in (reusing the `p-color-0..3`
player palette, same convention as the player cards above it). Cards are
grouped by resolved map asset rather than `floor` name, since `floorMaps`
is many-to-one — `Second` and `Crisp Gallery` share one image
(`assets/floors/second.png`), and that shared image has a dashed-rectangle
callout drawn directly in the art marking the Crisp Gallery room's
boundary, in the app's own `--floor-crisp-gallery` blue. Every mappable
floor is tagged as of 2026-08-06 (Alarm Floor, First, Vault, Second/Crisp
Gallery). Pure presentation, same as `floorSlug()` — no `kch-model.js`
logic involved. (This section briefly lived inline on `guide.html`
itself — a real density test at First Floor's item count measured it at
~2x the height of the entire existing "Who Grabs What" list, which is
what prompted splitting `map-view.html` out in the first place.)

**Cards render in catalog floor order** (fixed 2026-08-06), not the
incidental order floors happened to get walked in while assigning bags
(which is why "Level 2" could appear before Alarm Floor/First before this
fix). Reuses the exact `[...new Set(LOOT_CATALOG.map(it => it.floor))]`
technique `renderItemsList()` already uses for its per-player floor
sub-headings — the catalog's own item order already encodes the intended
building sequence (Vault → Loading Bay → Alarm Floor → First → Second →
Crisp Gallery). A merged group (Second/Crisp Gallery) sorts by whichever
of its floors appears first in that sequence.

**Each map card carries its own player-color legend** (added 2026-08-06),
dynamically generated and sized to the actual crew for that run — never
baked into the base map art, the same "pins are data" principle the pins
themselves already follow (a static legend can't adapt to crew size and
would show unusable swatches for players not even in this run). Repeated
on every card rather than shown once for the whole section, deliberately:
the host screenshots individual floor cards to share with teammates, and
each screenshot needs to read correctly on its own without the rest of
the page for context. The legend's visible label uses `playerShortLabel()`
(`"P1"`/`"P2"`/etc., 2026-08-07 UX-review fix), not `playerLabel()`'s
fuller `"Host (P1)"`/`"Player N"` form used everywhere else — a real,
genuinely long player name still overflowed the legend's ellipsis/
max-width handling because "Player 2" alone ate 8 of the label's limited
characters; dropping to a uniform `"PN"` (host included) buys back that
room without losing any information the legend's color-to-name job
actually needs. `label.title` still holds the full `playerLabel()` form,
so hovering a legend entry reveals "Host"/"Player N" same as before —
only the always-visible text is abbreviated.

**Loading Bay gets a text-only callout card, not a map — and it sits
first, ahead of every real map (moved there 2026-08-06).** It's the one
floor deliberately excluded from `floorMaps` entirely (a single item, `BAY`,
nothing to visually distinguish — see `data/secondary-loot.json`'s
`_notes`). Once every *other* floor had a real map, leaving Loading Bay
silently absent from the section (or buried at the bottom, past
everything else) started reading as a gap rather than a choice, so
`renderFloorMaps()` checks (by `floor === 'Loading Bay'`, not a hardcoded
`itemId === 'BAY'` check) whether it was packed this run and, if so,
renders it before any real map card — same `.floor-map-card`
heading+content rhythm, just without an `<img>`. Carries the same two
color signals a real card's pins would: a `--floor-loading-bay`
left-border accent (matching how every other floor-colored element in the
app already works — a border, not full-color text) and a player-color dot
next to the text for whichever player actually has `BAY` this run,
standing in for a pin — and (fixed 2026-08-06) names that player inline
in the text itself, the same way a real card's legend names each of its
dots, rather than pointing back to "Who Grabs What" to decode the color;
this card should read correctly on its own, same screenshot-sharing
reasoning as everything else in this section. Deliberately **not** baked
onto the Vault map, despite the two floors
sitting adjacent in the catalog — `Vault` and `Loading Bay` are documented
as isolated from every other floor including each other (see the
bag-assignment adjacency notes under "Core logic" below), so pinning a
Loading Bay note onto Vault's art would misrepresent the routing.

All three pages are `type="module"` and `import` directly from
`js/kch-model.js` (no separate `<script src>` tag for it). Shared visual
styling lives in `css/kch-styles.css`, linked from all three.

## Data model
- `data/primary-targets.json` — primary painting payouts. Only a base value is
  stored per painting; hard mode and first-week are the only two clean
  multipliers applied on top (see `_notes` in the file for the derived
  formula and verification). `index.html`'s Target dropdown (and
  `guide.html`'s identical, duplicated data-loading code) sorts this list
  by `baseValue` descending — most valuable first — rather than
  alphabetically (2026-08-15, user request, easier to scan/compare at a
  glance). Sorting by raw `baseValue` stays correct regardless of the
  run's difficulty/weekly selection, since `calcPrimary()`'s multipliers
  apply uniformly to every target.
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
    `fixedValue: 105000` on its catalog entry (data-driven, not a
    hardcoded `itemId === 'BAY'` check in the JS). Checked locks its value
    to `fixedValue`; unchecked excludes it entirely, even if it's also
    marked Buyer's Choice. This is the one deliberate exception to "every
    item starts blank" — its true value can't be known until it's
    actually taken during the heist. `fixedValue` was $122,500 (the
    $105k-140k community range, averaged) until 2026-08-03, when the user
    reported the truck's real value running lower than that average in
    practice, dropping it to a deliberately pessimistic $110,000; on
    2026-08-09 the user asked to go further and pin it to the floor of
    that same $105k-140k range ($105,000) rather than just a
    below-average estimate. This number is
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
    values in the item's controls, built and appended **before** the value
    input so the dropdown is first in real DOM order — visual order, DOM
    order, and Tab order all agree: entering the row lands on the
    dropdown first ("what is it, then what's it worth"), then the value
    input, then Tab moves on to the next row. This is a real fix
    (2026-08-06) for a genuine bug: an earlier version kept the dropdown
    *second* in DOM order and used CSS (`order:-1`, then a `grid-column`
    attempt) to make it appear first only visually, on the theory that
    Tab would keep following DOM order regardless. Confirmed empirically
    in-browser that neither theory held — Tab followed plain DOM order
    both times, so a value-input-then-dropdown DOM order always put the
    dropdown *after* the value input in Tab sequence too, sending Tab
    backward into the dropdown before it would advance to the next row.
    Reordering the actual DOM (not any CSS trick) was the only fix that
    worked. The pick is saved on the loot entry as `variant`. It is purely
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
    Once 3 items are marked, every other row's BC checkbox is disabled
    (blocking a 4th pick) but the row itself is **not** dimmed
    (2026-08-15, dropped `.bc-locked`'s `opacity:.55` — user feedback: it
    faded the still-editable value input on unrelated rows too, hurting
    legibility for items you're actively typing values into). The 3
    picked rows' existing `.bc-active` gold highlight is the only visual
    signal now; no counter-signal on the rest.
  - **`floorMaps` (top-level, not per-item) + per-item `xPct`/`yPct`** —
    data backing `map-view.html`'s "Floor Maps" section (see "Pages"
    above — this section lives on `map-view.html`, not `guide.html`).
    `floorMaps` is a `floor` name → map image path lookup, many-to-one
    (`Second` and `Crisp Gallery` share one physical-level image, so the
    map asset can't be derived from `floor` by naive slug). A floor with
    no `floorMaps` entry (`Loading Bay` — one item, no visual value in a
    map) has no map at all; render code treats that as "skip," not an
    error. Per-item `xPct`/`yPct` are percentage-based, top-left origin
    (`x` right, `y` down — matches CSS `left`/`top` directly, zero
    conversion), giving that item's pin position on whichever image its
    floor resolves to. Alarm Floor (`0-A`/`0-B`/`0-C`) was the pilot floor
    (smallest, 3 items) used to validate pin rendering first — as of
    2026-08-06, every mappable floor (Vault, Alarm Floor, First,
    Second/Crisp Gallery) is fully tagged; only `Loading Bay` has no
    coordinates, and that's permanent (no `floorMaps` entry at all, not
    "not tagged yet" — see its text-only callout under "Pages" above).

## Model module
`js/kch-model.js` is a pure ES module — no `document`, `fetch`, or
`localStorage` anywhere in it — holding `packBins()`, `knapsack()`,
`assignItemsToBags()`, `calcPrimary()`, `bonusAmounts()`, `itemById()`,
`runOptimizer()`, `computeGuidePayout()`, `computeCareerProgress()`,
`packedPrepWarnings()`, `buildScopeCsv()`, `money()`, and the
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
Page 1 inputs (primary target, difficulty, weekly status, players, keep-
primary toggle, loot values/Buyer's Choice flags, Elite toggle, player
names) and Page 2's
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
- **Bag assignment follows a five-tier, value-preserving preference**
  (rewritten 2026-08-02, extended 2026-08-03, widened 2026-08-04, Vault
  tier added 2026-08-07, priority-floor processing order fixed 2026-08-09,
  refined 2026-08-10, refined again 2026-08-13, Alarm Floor added to tier
  0 2026-08-14, mandatory items given priority-pool precedence 2026-08-15):
  `packBins()`'s
  reconstruction step chooses *which bin* an item lands in — never which
  items get chosen or the total secondary value — by, in order: (0) `Vault`
  and `Alarm Floor` items exclude the
  host's bag specifically, whenever a non-host bag is also available
  (`HOST_AVOID_FLOORS`) — `Vault` confirmed with the user 2026-08-07: the host
  alone must physically enter the Vault for the Primary Target, so
  routing Vault secondary loot to a teammate instead lets it be grabbed
  in parallel rather than requiring the host to double back for it after
  the primary grab, which matters for the Elite Challenge's 17-minute
  clock. This reverses the floor's previous "deliberately neutral"
  status — falls back to including the host only when they're the sole
  remaining valid bag (a solo run, or every other bag already full).
  `Alarm Floor` joined the same set 2026-08-14, user request, for a
  different reason: the host's real route is Vault → building 2nd floor
  (tier 1 below) and never passes through Alarm Floor
  (`FLOOR_ADJACENCY`: `Alarm Floor` only touches `First`, not `Second`/
  `Crisp Gallery`), so a host bag that also picked up Alarm Floor loot —
  via tier 2/3/4, since it sat in neither `HOST_PRIORITY_FLOORS` nor
  `HOST_AVOID_FLOORS` before this — forced a genuine backtrack during the
  timed run; this is exactly the cross-floor mishmash the 2026-08-09 bug
  report showed. `First` Floor was considered and deliberately excluded
  from this tier (confirmed with the user): it neighbors `Second`/`Crisp
  Gallery` directly, so a host stop there isn't the same off-route
  detour;
  (1) `Second` and `Crisp Gallery` items prefer the host's bag
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
  the building's 2nd floor (`Second` + `Crisp Gallery`) afterward.
  `Loading Bay` was deliberately **not** added to this tier: it's isolated
  with no clustering upside either way, and can still land in the host's
  bag when capacity/ordering happens to put it there — that's fine, since
  the host just sequences it before or after the Vault trip rather than
  combining them. (`Vault` is excluded from *this* tier for a different
  reason than Loading Bay — see tier 0 above, which now actively routes it
  away from the host instead of leaving it neutral.)
  **Real bug fix, 2026-08-09:** `packBins()` used to walk items strictly in
  catalog order (`Vault → Loading Bay → Alarm Floor → First → Second →
  Crisp Gallery`), so tier 1 only ever got a chance to fire once a
  Second/Crisp Gallery item's turn came up — it had no way to reserve host
  capacity ahead of time. A real 3-player run reported the host ending up
  with a cross-floor mishmash (Alarm Floor + First + only two of four
  scoped Second items) while a teammate got the Second/Crisp-Gallery-heavy
  bag that was supposed to be the host's: an early, low-priority item
  (Alarm Floor, processed first purely because tier 4/5's fallback still
  defaults perfectly-tied bins to bin 0) claimed the host bag, and tiers
  2/3's floor/adjacency clustering then snowballed more of that same floor
  into it before any Second/Crisp Gallery item was ever reached. Fixed by
  having `packBins()` walk every `HOST_PRIORITY_FLOORS` item ahead of every
  other floor, regardless of catalog position or mandatory/optional status
  — catalog order (the `order` field) remains the tiebreak *within* each
  priority bucket, so this is exactly as Elite-toggle-independent as
  before. Reordering only changes which of several equally-optimal bin
  partitions gets realized (the DP's optimal total value is provably
  invariant to processing order for a fixed set of symmetric bins) — it
  never changes total secondary value or which items get selected.
  **Real bug fix, 2026-08-10:** the 2026-08-09 fix above walked
  `HOST_PRIORITY_FLOORS` items ahead of every other floor, but *within*
  that priority bucket itself the two floors still fell back to plain
  catalog order — `Second`'s items (`2-A`..`2-D`) come before `Crisp
  Gallery`'s (`2-E`/`2-F`) in the catalog. A real report: when combined
  `Second` + `Crisp Gallery` weight exceeds one host bag, the smaller
  `Second` items greedily claimed most of the host's capacity first,
  leaving no room for a larger `Crisp Gallery` item that arrived later —
  it fell through to a teammate instead, and an unrelated `First`-floor
  item got adjacency-clustered in to round out the leftover capacity,
  forcing an avoidable extra floor stop. This was backwards: `Crisp
  Gallery`'s host-preference is the *stronger* of the two rationales (the
  EMP-desync room-verification requirement above), while `Second`'s is
  the *softer* one (the host's route just happens to pass through).
  Fixed by giving the priority bucket its own floor sub-rank — `Crisp
  Gallery` items are walked ahead of `Second` items whenever both are
  present, so `Crisp Gallery` always wins that capacity race regardless
  of catalog `order`. `order` still breaks ties within a single floor.
  Same invariance argument as the 2026-08-09 fix: this only changes which
  equally-optimal partition gets realized, never the total value or item
  selection.
  **Real bug fix, 2026-08-13:** even with floor-level ordering fixed, a
  same-floor problem remained *within* a single priority floor. A real
  2-player report: four smaller selected `Crisp Gallery` items (weights
  20, 30, 20, 10 — two of them Buyer's Choice-mandatory) walked in plain
  catalog order and claimed 80 of the host's 100 capacity, leaving only
  20 free — not enough for a fifth, larger selected `Crisp Gallery` item
  (Venus d'Algernon, weight 30, later in catalog order), which fell
  through to the teammate's bag while two unrelated `First`-floor items
  backfilled the host's leftover capacity instead, forcing an avoidable
  detour to First Floor. All five items summed to exactly 100 — a
  same-value, all-Crisp-Gallery host bag existed, catalog order just
  never found it. Fixed by walking priority-floor items
  largest-weight-first (a third sort key, between the floor sub-rank
  above and `order`) — the standard bin-packing fix for this shape of
  problem (place the least-flexible item first, while the most capacity
  is still open), the same rationale `assignItemsToBags()`'s own
  First-Fit-Decreasing already uses elsewhere in this file. Scoped to
  apply only *within* a priority floor (a no-op whenever either item
  being compared is non-priority), so no other tier or non-priority
  floor's processing order changes. `order` remains the final tiebreak
  among same-floor items of equal weight. Same invariance argument as the
  2026-08-09/2026-08-10 fixes: this only changes which equally-optimal
  partition gets realized, never the total value or item selection.
  **Real bug fix, 2026-08-15:** even with same-floor ordering fixed, a
  problem remained *across* the two priority floors specifically for
  mandatory items. A real 2-player report (Elite on, Buyer's Choice:
  Antique Rings, Coquard Bracelets, Horse Statue): four *optional* `Crisp
  Gallery` items were walked largest-first (per the 2026-08-13 fix) and
  greedily claimed 80 of the host's 100 capacity before the *mandatory*
  `Second` item (Horse Statue, weight 30) ever got a turn — only 20
  capacity remained, not enough for it, so it fell through to the
  non-host player purely because of processing order, while the host's
  leftover 10 capacity got backfilled by an unrelated `First`-floor item
  (Antique Rings) on what turned out to be a capacity tie between the two
  bags. Net result: the host bag carried a First-floor stray, and the
  non-host player ended up spanning Loading Bay + Alarm Floor + Second +
  First — a real cross-floor mishmash for both players. The user proposed
  pooling `Second` and `Crisp Gallery` for host-bag capacity instead of
  always ranking `Crisp Gallery` ahead of `Second`; a fully-flattened pool
  (dropping the floor sub-rank entirely) was tested and rejected — it
  broke the 2026-08-10 fix's own guarantee, letting a heavier optional
  `Second` item beat a lighter optional `Crisp Gallery` item for the
  host's last slot on a tie, reversing the EMP-desync rationale. Fixed
  instead by layering in `mandatoryRank` *above* the floor sub-rank (still
  gated to the priority pool, so it's a no-op elsewhere): a mandatory item
  now claims host capacity ahead of any optional priority-floor item on
  *either* floor. This only changes behavior when a mandatory and an
  optional item are competing in the pool — optional-vs-optional ties
  still fall through to the existing `Crisp Gallery`-over-`Second`
  sub-rank unchanged. Same invariance argument as every fix above: only
  changes which equally-optimal partition gets realized, never the total
  value or item selection.
  (2) otherwise, prefer a bin that already contains an item on the same floor (general
  floor-clustering, so a crew spends less time running between floors);
  (3) otherwise, prefer a bin that already contains an item on an
  *adjacent* floor per the real Kortz Center map (`Alarm Floor`↔`First`,
  `First`↔`Second`, `First`↔`Crisp Gallery`, `Second`↔`Crisp Gallery`;
  `Vault` and `Loading Bay` are isolated, adjacent to nothing including
  each other) — a softer nudge than exact-floor clustering, added after
  live testing showed a player routed straight from `Alarm Floor` to
  `Second`, skipping past `First`; (4) otherwise, prefer whichever bin
  has the most remaining capacity (spreads items across players by
  default). All five tiers only ever choose among bins already confirmed
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
  **Reopened 2026-08-15, same day as the `mandatoryRank` fix below, and
  fixed again the same day:** `mandatoryRank` keyed its sort purely off
  `it.mandatory` — but `packBins()` only ever sets `mandatory: true` when
  Elite forces Buyer's Choice picks into the mandatory branch, so with
  Elite off `mandatoryRank` silently went back to a no-op and the
  pre-`mandatoryRank` crowding bug reappeared, even for an identical item
  selection (real report: same $712,000 scope-out, clean Second/Crisp-
  Gallery host bag with Elite on, a First-floor stray back in the host bag
  with Elite off). Fixed by threading `buyersChoice` through `toItem()` in
  `runOptimizer()` and widening the key to `(it.mandatory ||
  it.buyersChoice)` — a strict generalization, since every item
  `packBins()` ever marks `mandatory: true` is already `buyersChoice: true`
  by construction, so the Elite-on path is provably unaffected and Elite-
  off gains the missing protection. **Important scoping, discussed with the
  user before implementing:** this invariant only claims "same selected
  item set implies same bag split" — it does NOT claim Elite on/off always
  select the same items. Forcing a low value-density Buyer's Choice pick
  (e.g. a painting — every painting in this catalog is weight 50, the
  heaviest class, vs 10/20/30 for everything else) can cost enough value
  that the unconstrained Elite-off pack rationally drops it for something
  better, in which case the two states select different items and their
  splits are expected to differ too — not a regression, just two different
  knapsack problems. `test/pack-bins.test.js` has one test for each regime:
  a same-selection regression test (guarded by first asserting the
  item-id sets are actually equal) and a diverging-selection sanity test
  (guarded by asserting they're actually *not* equal, plus no overflow and
  Elite-off's value never falling below Elite-on's).
- **`compareCrewSizes()` (added 2026-08-04, two-column 2026-08-07) answers
  "would a different crew size pay more per player?"** for the loot values
  already entered — a supplementary panel on `guide.html`, never affecting
  the actual run's result above it. It sweeps player counts 1-4, calling
  `runOptimizer()` **twice** per size: once with `elite` forced to `'no'`
  (the original "No Elite" column, unchanged since 2026-08-04 —
  regardless of the real run's setting, since Elite Challenge completion
  is never guaranteed and shouldn't by itself skew which crew size looks
  best, so Buyer's Choice never constrains this column's packing, just the
  plain value-max pack), and once with `elite` forced to `'yes'` (the new
  "With Elite" column — user request: some crews still go for the Elite
  Challenge's bonus even though it's deliberately excluded from Career
  Progress, so whether the crew's actual Buyer's Choice marks still all
  fit at a given crew size matters to them too). Both columns report
  `secondaryShareEach` only (not the host's full payout with
  primary/bonuses) — precedented by `internal/kch_calculator_8.2.26.py`'s
  own solo/duo/trio/quad payout comparison, which computes the analogous
  "best secondary take" config. The With-Elite column is deliberately the
  *same* raw metric, not a fuller number with bonus dollars folded in —
  forcing Buyer's Choice items into packing can only match or reduce the
  raw share (never increase it), so the two columns stay directly
  comparable at a glance, and the bonus itself is presented as the
  separate reward for that trade-off rather than baked into this number
  (same reasoning `computeGuidePayout()` already applies to the Elite
  bonus). Each column highlights its own "best" crew size independently,
  since forcing Buyer's Choice in at one size can shift which size wins
  for that column without moving the other. Crew size still changes item
  *eligibility*, not just how a fixed total splits — Crisp Gallery items
  require `minPlayers: 2`, so a smaller crew's lower share can genuinely
  mean fewer reachable items, not just a bigger total split more ways;
  `guide.html`'s panel says this explicitly rather than leaving it to be
  inferred from the numbers alone.
- **Buyer's Choice *packing* is conditional on Elite Challenge, and needs
  at least 2 picks — but the Buyer's Request *bonus* is not conditional on
  Elite (decoupled 2026-08-07, see below).** Marking up to three items as
  Buyer's Choice only forces them into packing when Elite Challenge is
  toggled on. With Elite off, Buyer's Choice tags are purely informational
  in the manifest and the optimizer runs a single unconstrained pack over
  all scoped items to maximize bag value — no forced inclusion, no
  overflow state. **A single marked item can never satisfy Elite
  Challenge** (confirmed 2026-08-03, direct game knowledge) — 0 and 1
  marked-and-scoped picks resolve identically to "not attempted" for
  packing purposes (same unconstrained pack), only 2 or 3 actually lock
  packing. `guide.html` shows an explicit warning for both the 0- and
  1-pick case (one shared message, parameterized only by the count)
  rather than leaving it inferable only from the Finale Result's "not
  attempted" label.
- **Buyer's Request bonus is earned whenever the chosen bag selection
  happens to include every marked-and-scoped Buyer's Choice item, whether
  or not Elite Challenge was ever toggled on** (fixed 2026-08-07, real bug
  report: a 3-player run whose value-max *unconstrained* pack naturally
  contained all the marked items, but the tool still reported the bonus
  as unearned solely because Elite was off). Buyer's Request was always
  meant to reward *having* the marked items — Elite Challenge is a
  separate, harder contract (the sub-17-minute clock) layered on top, not
  a prerequisite for this bonus. The same >=2-marked-picks minimum still
  applies regardless of Elite status (confirmed with the user 2026-08-07:
  it's a Buyer's-Choice-contract minimum, not an Elite-specific one), so a
  single incidentally-packed marked item still never earns it. The Elite
  Challenge bonus itself is **not** decoupled — it still requires the
  toggle, since completing it depends on live-execution conditions (the
  clock) this tool can't verify from bag contents alone, unlike simply
  having grabbed the marked items. `runOptimizer()`'s `buyerRequestBonusEach`
  reflects this; `eliteBonusEach` is untouched.
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
  *framed as career progress*; the correct shape for that figure is
  per-player.
- **A different, plainly-labeled "Total Take" line was added 2026-08-04 —
  this is NOT a revival of the removed line above.** It shows the exact
  same arithmetic (`primary.value + secondaryBagValue`), in the Finale
  Result ledger right after the Primary Target/Secondary Targets lines it
  sums, but with a deliberately different framing: a purely comparative,
  crew-wide reference number ("how much did this heist generate in total,
  before any bonuses, fees, or splitting"), explicitly not presented as
  anyone's personal take or career progress. `guide.html` pairs it with an
  inline note saying exactly that, so the distinction from the
  still-removed career-progress framing stays unmistakable. The takeaway:
  the *number* was never the problem, the *framing* was — don't drop the
  disclaiming note if this line is ever touched again.
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
- **"Keep Primary?" (`state.keepPrimary`, 2026-08-15) zeroes
  `primary.value` at the single source, `calcPrimary()`, not at each
  display/total site.** When `state.keepPrimary === 'yes'`, `calcPrimary()`
  short-circuits past the multiplier math entirely and returns `{ value:
  0, meta: p, kept: true }`. Every consumer of `primary.value` — the
  Finale Result ledger's Primary Target and Total Take rows, the host's
  player-card Primary Target row, `computeGuidePayout()`, and
  `computeCareerProgress()` — already just reads that field, so zeroing it
  once here is sufficient; **neither `computeGuidePayout()` nor
  `computeCareerProgress()` needed any changes at all.** `guide.html`
  reads the returned `kept` flag only for display, swapping the two
  Primary Target rows (ledger + host card) to "Kept — not sold" instead of
  a dollar figure, plus one small hint line under the ledger row
  reiterating that it's excluded from Total Take/Payout below — see
  `index.html`'s Step 1 entry above for the toggle itself and why it's
  disabled for the mandatory story target.

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
