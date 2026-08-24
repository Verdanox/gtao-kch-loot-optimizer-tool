#!/usr/bin/env node
// Dev-only CLI: compares the default (value-model) bag split against the
// "Experimental: time-optimized packing" split for a real scope-out, side
// by side. Never shipped — same category as the rest of test/ and
// package.json per CLAUDE.md's Stack section (GitHub Pages just serves
// index.html/guide.html/map-view.html/map-scope.html/js/css/data as
// static files; nothing on those pages ever references this file). Not
// picked up by `npm test` / `node --test` either, since it doesn't end in
// .test.js.
//
// Usage:
//   node test/compare-packing.mjs [path-to-scope.json]
//
// Defaults to fixtures/sample-run.json. Any file matching that same shape
// (primaryTarget, eliteChallengeAttempted, buyersChoice, secondaryLoot,
// and optionally a players count) works — drop in your own real scoped
// values to try this locally without touching the browser or the
// Advanced Settings checkbox on index.html.
//
// Prints, per player, that player's item list grouped by floor plus a $
// total (asserted equal across both runs — a mismatch is a bug, flagged
// loudly, not silently ignored) and the time-cost metric
// (timeWeightFor()/exhibitTravelCost()) for BOTH runs, so the
// improvement — or lack of one — is visible even for the default split.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runOptimizer, itemById, money, timeWeightFor, exhibitTravelCost,
  DEFAULT_BONUS_CONSTANTS
} from '../js/kch-model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const scopePath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(repoRoot, 'fixtures', 'sample-run.json');

const catalog = loadJSON(path.join(repoRoot, 'data', 'secondary-loot.json')).items;
const BAG_CAPACITY_PER_PLAYER = 100;
const scope = loadJSON(scopePath);

const players = Array.isArray(scope.testPlayerCounts) && scope.testPlayerCounts.length
  ? scope.testPlayerCounts[0]
  : (scope.players || 2);

const bcIds = new Set(Array.isArray(scope.buyersChoice) ? scope.buyersChoice : []);
const loot = catalog.map(cat => ({
  itemId: cat.itemId,
  value: Object.prototype.hasOwnProperty.call(scope.secondaryLoot || {}, cat.itemId)
    ? scope.secondaryLoot[cat.itemId]
    : '',
  buyersChoice: bcIds.has(cat.itemId)
}));

function buildState(experimentalPacking) {
  return {
    primaryId: scope.primaryTarget?.id || 'x',
    difficulty: scope.primaryTarget?.hardMode ? 'hard' : 'normal',
    weekly: scope.primaryTarget?.firstTimeThisWeek ? 'first' : 'repeat',
    players,
    elite: scope.eliteChallengeAttempted ? 'yes' : 'no',
    skipPreps: [],
    experimentalPacking,
    loot
  };
}

const EXHIBIT_FLOOR_NAMES = new Set(['Alarm Floor', 'First', 'Second', 'Crisp Gallery']);

// Independent time-cost reporter — same metric packBinsForTime() itself
// minimizes, computed here from runOptimizer()'s own output shape so it
// works identically for the default run too (which never optimizes for
// this, but the number is still informative for comparison).
function bagTimeCost(bag) {
  const exhibitItems = bag.items.filter(i => EXHIBIT_FLOOR_NAMES.has(i.floor));
  const floors = new Set(exhibitItems.map(i => i.floor));
  const sum = exhibitItems.reduce((s, i) => s + timeWeightFor(itemById(catalog, i.itemId)), 0);
  return sum + exhibitTravelCost(floors);
}

function printRun(label, r) {
  console.log(`\n=== ${label} ===`);
  console.log(`Secondary total: ${money(r.secondaryBagValue)}  (${money(r.secondaryShareEach)}/player)`);
  r.bags.forEach((bag, i) => {
    const byFloor = new Map();
    for (const it of bag.items) {
      if (!byFloor.has(it.floor)) byFloor.set(it.floor, []);
      byFloor.get(it.floor).push(it);
    }
    console.log(`  Player ${i + 1}${i === 0 ? ' (host)' : ''} — ${money(bag.value)}, ${bag.weightUsed}/${BAG_CAPACITY_PER_PLAYER} weight, time-cost ${bagTimeCost(bag)}`);
    for (const [floor, items] of byFloor) {
      console.log(`    ${floor}:`);
      for (const it of items) {
        const cat = itemById(catalog, it.itemId);
        console.log(`      ${cat.name} — ${money(it.value)}${r.bcIdsSet.has(it.itemId) ? " (Buyer's Choice)" : ''}`);
      }
    }
  });
}

const defaultResult = runOptimizer(buildState(false), catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);
const experimentalResult = runOptimizer(buildState(true), catalog, BAG_CAPACITY_PER_PLAYER, DEFAULT_BONUS_CONSTANTS);

console.log(`Scope-out: ${scopePath}`);
console.log(`Players: ${players}`);

printRun('Default (value-model) packing', defaultResult);
printRun('Experimental (time-optimized) packing', experimentalResult);

if (defaultResult.secondaryBagValue !== experimentalResult.secondaryBagValue) {
  console.error(`\n⚠ MISMATCH: default total ${money(defaultResult.secondaryBagValue)} !== experimental total ${money(experimentalResult.secondaryBagValue)} — this should never happen (experimentalPacking must never change item selection/value). This is a bug, not an expected variance.`);
  process.exitCode = 1;
} else {
  const defaultBottleneck = Math.max(...defaultResult.bags.map(bagTimeCost));
  const experimentalBottleneck = Math.max(...experimentalResult.bags.map(bagTimeCost));
  console.log(`\nSame total value either way, as expected. Bottleneck time-cost: default ${defaultBottleneck}, experimental ${experimentalBottleneck}${experimentalBottleneck < defaultBottleneck ? ' (improved)' : experimentalBottleneck === defaultBottleneck ? ' (no change for this scope-out)' : ' (unexpected — should never be worse)'}`);
}
