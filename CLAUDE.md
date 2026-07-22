# Kortz Center Loot Ledger

A static, dependency-free web app that recommends the optimal secondary-loot
loadout for the GTA Online Kortz Center Heist, given crew size, difficulty,
weekly status, and Buyer's Choice picks.

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

## Core logic
- Bag capacity = `players * 100`.
- Optimizer is a 0/1 knapsack: Buyer's Choice items are locked in first
  (mandatory), then remaining capacity is filled to maximize value from the
  rest of the scoped items.
- If Buyer's Choice items don't all fit, the best-fitting subset is packed
  and the Buyer's Request + Elite Challenge bonuses are marked as forfeited.
- **Buyer's Choice is conditional on Elite Challenge.** Marking up to three
  (fewer is fine) items as Buyer's Choice only affects packing when Elite
  Challenge is toggled on. With Elite off, Buyer's Choice tags are purely
  informational (still shown in the manifest) and the optimizer runs a
  single unconstrained knapsack over all scoped items to maximize bag value
  — no forced inclusion, no Buyer's Request/Elite bonus, no overflow state.
- **Buyer's Request and Elite Challenge bonuses double on Hard mode**: $50k
  Buyer's Request / $50k-per-player Elite on Normal, $100k / $100k-per-player
  on Hard.
- **Payout is split per player, not shown as one crew total.** The pooled
  knapsack above still decides *which* secondary items get packed; a
  First-Fit-Decreasing bin-pack then assigns that chosen set across
  individual player bags (capacity 100 each) for display — index 0 is
  always "the host." Host = Primary Target + their bag − the repeat-run fee
  (host-only cost); players 2–4 = their bag only. If Buyer's Request/Elite
  are earned, **every player gets the full bonus amount each**, not a split
  pool. The "Total Take (Career Progress)" headline is Primary + Secondary
  only — no bonuses, no fee — since it represents the in-game progress stat,
  not any individual player's actual cash take.

## Known open questions (confirm before shipping)
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
