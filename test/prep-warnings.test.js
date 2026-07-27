import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { packedPrepWarnings } from '../js/kch-model.js';

function loadJSON(relUrl) {
  return JSON.parse(fs.readFileSync(new URL(relUrl, import.meta.url), 'utf8'));
}

const catalog = loadJSON('../data/secondary-loot.json').items;

// Reminder-only check (not gating): the four glass-cutter items are
// 0-A, 2-B, 2-C, 2-K.
test('flags only the glass-cutter items that are actually in chosenIds, not the whole catalog', () => {
  const chosenIds = new Set(['0-A', '1-A', '2-K']); // one non-gated item mixed in
  const flagged = packedPrepWarnings(catalog, chosenIds);
  assert.deepEqual(flagged.map(cat => cat.itemId).sort(), ['0-A', '2-K']);
  assert.ok(flagged.every(cat => cat.requiresPreps.includes('glass-cutter')));
});

test('returns an empty list when no packed item requires a prep', () => {
  const chosenIds = new Set(['1-A', '1-B', 'BAY']);
  const flagged = packedPrepWarnings(catalog, chosenIds);
  assert.deepEqual(flagged, []);
});

test('returns an empty list when a gated item exists but was not chosen', () => {
  const chosenIds = new Set(['1-A']);
  const flagged = packedPrepWarnings(catalog, chosenIds);
  assert.deepEqual(flagged, []);
});

test('all four documented glass-cutter items carry the metadata', () => {
  for (const id of ['0-A', '2-B', '2-C', '2-K']) {
    const cat = catalog.find(c => c.itemId === id);
    assert.ok(cat, `${id} should exist in the catalog`);
    assert.deepEqual(cat.requiresPreps, ['glass-cutter']);
  }
});
