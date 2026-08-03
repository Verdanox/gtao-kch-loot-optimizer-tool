# Kortz Center Heist Loot Optimizer

Developed by dejarjar013, Mazemel, EtcherTM, and CMajor with help from Claude Code and Gemini

## Helps players determine what loot to grab during the Kortz Center Heist

### Instructions

1. Open **Scope & Setup** (`index.html`): pick your primary target, difficulty, and weekly status, set your crew size, fill in the value of whatever secondary loot you scoped (mark up to three items as Buyer's Choice — at least 2 are required for the Elite Challenge bonus to actually be in play), and toggle Elite Challenge if you're going for it.
2. Click **Continue to Heist Guide**. Everything autosaves as you go, so you can close the tab or come back later without losing your inputs.
3. The **Heist Guide** page (`guide.html`) shows who grabs what — floor by floor, color-coded per player — plus bag capacity, bonuses, and per-player payout. It's meant to be screenshotted or kept open on a second screen during the run. Save your security door combo there too.
4. Starting a new heist? **Clear Board** on the Scope & Setup page wipes everything (with a confirm step) — including the saved security combo on the Heist Guide page.

### Model Details

* **Normal** — packs each player's individual bag (not just a pooled crew total) to maximize total secondary loot value for the crew, subject to each player's real bag capacity. Buyer's Choice items are locked in first whenever Elite Challenge is on **and at least 2 items are marked** — a single marked item can never satisfy Elite Challenge, so it's treated the same as marking none (an explicit heads-up appears on the Heist Guide if you toggle Elite on without enough marked). Which bag an item lands in is chosen to minimize floor-to-floor travel: items on the same floor cluster together, items on floors one real transition apart (e.g. Alarm Floor↔First, First↔Second/Crisp Gallery) get a softer version of the same preference, and Crisp Gallery items specifically prefer the host's bag on top of that — the host typically pops the EMP after grabbing the primary target, and being in the gallery makes that easy to verify. None of this ever costs secondary value; it only decides which of several equally-optimal bags an item goes in.
* **Payout** — every player's secondary-loot cut is the crew's total secondary value split evenly, regardless of whose bag anything physically landed in; every non-host player additionally earns a flat Helper bonus. A separate **Career Progress** figure (excludes every bonus — Buyer's Request, Elite, and Helper alike) is shown per player alongside Payout, since they track differently in-game.

### Roadmap

**Shipped**
* Two-page "scope, then calculate" flow with full input persistence (survives refresh, closing the browser, and navigating between pages)
* Heist Guide: per-player item assignments and floor locations, bag capacity gauges, a savable/lockable security door combo, color-coded players
* Buyer's Choice / Elite Challenge conditional packing, with the Buyer's Request bonus shown per player
* Glass cutter reminder banner when a gated item ends up in your loot pool
* Clear Board control to reset everything for a new scope-out
* In-line item descriptions in the loot list and Heist Guide, to help players unfamiliar with the heist recognize what they're grabbing
* Embedded feedback form (bug/feedback/feature request) on both pages, no navigating away
* Corrected secondary-loot payout: split evenly across the whole crew regardless of bag contents, plus an unconditional Helper bonus for non-host players and a correct per-player Career Progress total (the old crew-wide total was removed for being misleading — see `CLAUDE.md`)
* Bag assignment now minimizes floor-to-floor travel (same-floor clustering, plus a softer preference for floors one real transition apart) on top of the existing Crisp-Gallery-to-host and Buyer's Choice logic
* Buyer's Choice now requires at least 2 marked picks for Elite Challenge to be in play (a single pick can never satisfy it), with a heads-up on the Heist Guide if you toggle Elite on without enough marked
* Colorblind-safe player and floor color palettes, checked against each other (not just within each set) so the two color systems don't collide when shown together on a player's card
* Delivery Truck Crate value updated to a more conservative estimate, kept off the Scope & Setup page (it's a planning assumption, not a confirmed number), plus a reminder that the truck doesn't always spawn

**Up next**
* Reminder for when to pop your EMP mid-run
* Optional preps/approach inputs (entry point, weapon loadout, getaway vehicle, guard missions, power drills, exit point, etc.) feeding into the optimizer, beyond today's glass-cutter reminder — including different optimization models based on the chosen entry, preps, and exit point
* Print/save-as-image friendly view
* Light mode toggle (last on the list — dark is the whole vibe, but an "unironic" light mode for daylight/print use)
* **Final form**: a floor-by-floor map of the Kortz Center with item locations pinned and color-coded by player
  * Capture each item's x/y position (percentage-based) on its floor map
  * Floor-to-map-image lookup (some floors share one map image, e.g. Second/Crisp Gallery; Loading Bay has none — just one crate)
  * Render the map image with item pins overlaid at their captured positions
  * Color-code pins by the player assigned to grab that item
  * Baked-in landmark labels on the map art (stairs, alarm box, etc.) for orientation
* Collecting input data to speed up filling out common values
* Spreadsheet input?
