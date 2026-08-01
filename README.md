# Kortz Center Heist Loot Optimizer

Developed by dejarjar013, Mazemel, EtcherTM, and CMajor with help from Claude Code and Gemini

## Helps players determine what loot to grab during the Kortz Center Heist

### Instructions

1. Open **Scope & Setup** (`index.html`): pick your primary target, difficulty, and weekly status, set your crew size, fill in the value of whatever secondary loot you scoped (mark up to three items as Buyer's Choice), and toggle Elite Challenge if you're going for it.
2. Click **Continue to Heist Guide**. Everything autosaves as you go, so you can close the tab or come back later without losing your inputs.
3. The **Heist Guide** page (`guide.html`) shows who grabs what — floor by floor, color-coded per player — plus bag capacity, bonuses, and per-player payout. It's meant to be screenshotted or kept open on a second screen during the run. Save your security door combo there too.
4. Starting a new heist? **Clear Board** on the Scope & Setup page wipes everything (with a confirm step) — including the saved security combo on the Heist Guide page.

### Model Details

* **Normal** — pools all players' bags together and maximizes total secondary loot value for the crew, subject to each player's bag capacity. Buyer's Choice items are locked in first whenever Elite Challenge is on. Includes a slight built-in preference for routing Second Floor/Crisp Gallery items into the host's bag specifically, since the host typically pops the EMP after grabbing the primary target and being in the gallery makes that easy to verify — always on by default, not a separate toggle. This only actually matters with 2+ players: Crisp Gallery needs two players to access at all, and with a solo crew there's only one bag in play, so there's no "host's bag" to prefer over anyone else's.

### Roadmap

**Shipped**
* Two-page "scope, then calculate" flow with full input persistence (survives refresh, closing the browser, and navigating between pages)
* Heist Guide: per-player item assignments and floor locations, bag capacity gauges, a savable/lockable security door combo, color-coded players
* Buyer's Choice / Elite Challenge conditional packing, with the Buyer's Request bonus shown per player
* Glass cutter reminder banner when a gated item ends up in your loot pool
* Clear Board control to reset everything for a new scope-out
* In-line item descriptions in the loot list and Heist Guide, to help players unfamiliar with the heist recognize what they're grabbing
* Embedded feedback form (bug/feedback/feature request) on both pages, no navigating away

**Up next**
* Greedy model — stacks the most valuable loot into the host's bag first, then splits the remainder among the rest of the crew to maximize career-progress pace rather than total crew value
* "Speedy" — a distinct fourth model, not yet defined
* A correct per-player Career Progress total (the old crew-wide total was removed for being misleading — see `CLAUDE.md`)
* Reminder for when to pop your EMP mid-run
* Optional preps/approach inputs (entry point, weapon loadout, getaway vehicle, guard missions, power drills, etc.) feeding into the optimizer, beyond today's glass-cutter reminder
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
