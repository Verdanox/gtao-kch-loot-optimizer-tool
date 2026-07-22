# Kortz Center Loot Ledger

A static, dependency-free web app that recommends the optimal secondary-loot
loadout for the GTA Online Kortz Center Heist, given crew size, difficulty,
weekly status, and Buyer's Choice picks.

## Data model
- `data/primary-targets.json` — primary painting payouts. Only a base value is
  stored per painting; hard mode, first-week, and alarm-triggered are all
  clean multipliers applied on top (see `_notes` in the file for the derived
  formula and verification).
- `data/secondary-loot.json` — every scoutable secondary item, its floor
  location, and its bag-weight (0–100 scale, one bag = 100). Dollar values are
  NOT stored here — they're randomized per scope-out and entered by the user
  at runtime, keyed by `itemId`.

## Core logic
- Bag capacity = `players * 100`.
- Optimizer is a 0/1 knapsack: Buyer's Choice items are locked in first
  (mandatory), then remaining capacity is filled to maximize value from the
  rest of the scoped items.
- If Buyer's Choice items don't all fit, the best-fitting subset is packed
  and the Buyer's Request + Elite Challenge bonuses are marked as forfeited.

## Known open questions (confirm before shipping)
- `minPlayers: 2` on "Second Exhibit" floor items in secondary-loot.json is an
  assumption (mapped to the two-player Crisp Gallery room from research, not
  explicitly labeled in the source spreadsheet). Verify against your own notes.
- The source payout table also included values for runs where witnesses/CCTV
  were left behind (0.75x). That's an execution outcome, not a planning
  input, so it's been cut from primary-targets.json entirely — no field for
  it, nothing to wire up.
- Consumato's first-time-this-week value: confirmed in this data pull, unlike
  the earlier estimate — use the table value, not the old 4x-guess.

## Stack
Plain HTML/CSS/JS, no build step. Deploys as-is to GitHub Pages.

## Commands
- No build/test commands yet — flag this file for updates once a
  package.json or test runner is added.
