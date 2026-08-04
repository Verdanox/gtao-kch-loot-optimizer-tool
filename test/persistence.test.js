import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  serializeState, deserializeState, mergeLootByItemId,
  defaultPage1State, defaultPage2State, SCHEMA_VERSION
} from '../js/kch-model.js';

function loadJSON(relUrl) {
  return JSON.parse(fs.readFileSync(new URL(relUrl, import.meta.url), 'utf8'));
}

const catalog = loadJSON('../data/secondary-loot.json').items;

test('serialize/deserialize round-trips a full page1+page2 state', () => {
  const page1 = {
    primaryId: 'consumato',
    difficulty: 'hard',
    weekly: 'repeat',
    players: 3,
    elite: 'yes',
    playerNames: ['Franklin', 'Lamar', '', ''],
    loot: catalog.map((cat, i) => ({ itemId: cat.itemId, value: i < 2 ? 50000 : '', buyersChoice: i === 0 }))
  };
  const page2 = { securityCombo: '4-1-3-2', locked: true };

  const blob = serializeState(page1, page2);
  assert.equal(blob.schemaVersion, SCHEMA_VERSION);
  assert.ok(typeof blob.savedAt === 'string' && blob.savedAt.length > 0);

  const raw = JSON.stringify(blob);
  const defaults1 = defaultPage1State(catalog);
  const defaults2 = defaultPage2State();
  const { page1: outPage1, page2: outPage2 } = deserializeState(raw, defaults1, defaults2);

  assert.equal(outPage1.primaryId, 'consumato');
  assert.equal(outPage1.difficulty, 'hard');
  assert.equal(outPage1.weekly, 'repeat');
  assert.equal(outPage1.players, 3);
  assert.equal(outPage1.elite, 'yes');
  assert.deepEqual(outPage1.playerNames, ['Franklin', 'Lamar', '', '']);
  assert.equal(outPage1.loot.length, catalog.length);
  assert.equal(outPage1.loot[0].value, 50000);
  assert.equal(outPage1.loot[0].buyersChoice, true);
  assert.equal(outPage2.securityCombo, '4-1-3-2');
  assert.equal(outPage2.locked, true);
});

test('defaultPage2State starts unlocked, and locked survives a false round-trip too', () => {
  const defaults2 = defaultPage2State();
  assert.equal(defaults2.locked, false);

  const blob = serializeState(defaultPage1State(catalog), { securityCombo: 'x', locked: false });
  const { page2 } = deserializeState(JSON.stringify(blob), defaultPage1State(catalog), defaultPage2State());
  assert.equal(page2.locked, false);
});

test('mergeLootByItemId merges saved values onto the current catalog by itemId, not wholesale replace', () => {
  const savedLoot = [
    { itemId: catalog[0].itemId, value: 99000, buyersChoice: true },
    { itemId: 'this-item-no-longer-exists', value: 12345, buyersChoice: true }
    // note: every other current catalog item is intentionally absent from savedLoot
  ];
  const merged = mergeLootByItemId(catalog, savedLoot);

  // Same length/shape as the current catalog — stale saved id is dropped.
  assert.equal(merged.length, catalog.length);
  assert.ok(!merged.some(l => l.itemId === 'this-item-no-longer-exists'));

  // The one matching saved item carries its value/flag over.
  const first = merged.find(l => l.itemId === catalog[0].itemId);
  assert.equal(first.value, 99000);
  assert.equal(first.buyersChoice, true);

  // Every other catalog item comes back blank/unmarked, not missing.
  const others = merged.filter(l => l.itemId !== catalog[0].itemId);
  assert.equal(others.length, catalog.length - 1);
  for (const o of others) {
    assert.equal(o.value, '');
    assert.equal(o.buyersChoice, false);
  }
});

// Per-run variant picks (the Gemstone's type today — see `variants` in
// secondary-loot.json). Descriptive only: they persist and display, and
// never reach the optimizer.
const variantItem = catalog.find(c => Array.isArray(c.variants) && c.variants.length);

test('every catalog item defaults to a blank variant, and at least one offers variants', () => {
  const defaults1 = defaultPage1State(catalog);
  assert.ok(variantItem, 'expected at least one catalog item with a variants list');
  for (const l of defaults1.loot) assert.equal(l.variant, '');
});

test('a picked variant round-trips through serialize/deserialize/merge', () => {
  const pick = variantItem.variants[1];
  const page1 = {
    ...defaultPage1State(catalog),
    loot: defaultPage1State(catalog).loot.map(l =>
      l.itemId === variantItem.itemId ? { ...l, value: 40000, variant: pick } : l)
  };

  const raw = JSON.stringify(serializeState(page1, defaultPage2State()));
  const { page1: out } = deserializeState(raw, defaultPage1State(catalog), defaultPage2State());
  const merged = mergeLootByItemId(catalog, out.loot);

  const entry = merged.find(l => l.itemId === variantItem.itemId);
  assert.equal(entry.variant, pick);
  assert.equal(entry.value, 40000);
  // Nothing else picked one up.
  for (const l of merged.filter(l => l.itemId !== variantItem.itemId)) assert.equal(l.variant, '');
});

test('mergeLootByItemId drops a saved variant the catalog no longer offers', () => {
  const savedLoot = [
    { itemId: variantItem.itemId, value: 1000, buyersChoice: false, variant: 'Not A Real Gem' },
    // an item with no variants list at all can never carry one back
    { itemId: 'B-A', value: 2000, buyersChoice: false, variant: 'Emerald' }
  ];
  const merged = mergeLootByItemId(catalog, savedLoot);
  assert.equal(merged.find(l => l.itemId === variantItem.itemId).variant, '');
  assert.equal(merged.find(l => l.itemId === 'B-A').variant, '');
  // The rest of the entry still merges normally.
  assert.equal(merged.find(l => l.itemId === variantItem.itemId).value, 1000);
});

test('corrupted JSON falls back to defaults without throwing', () => {
  const defaults1 = defaultPage1State(catalog);
  const defaults2 = defaultPage2State();
  assert.doesNotThrow(() => {
    const { page1, page2 } = deserializeState('{not valid json!!', defaults1, defaults2);
    assert.deepEqual(page1, defaults1);
    assert.deepEqual(page2, defaults2);
  });
});

test('schemaVersion mismatch falls back to defaults without throwing', () => {
  const defaults1 = defaultPage1State(catalog);
  const defaults2 = defaultPage2State();
  const staleBlob = JSON.stringify({
    schemaVersion: SCHEMA_VERSION + 1,
    page1: { primaryId: 'juiced', difficulty: 'hard', weekly: 'repeat', players: 4, elite: 'yes', loot: [] },
    page2: { securityCombo: 'should-not-survive' }
  });
  const { page1, page2 } = deserializeState(staleBlob, defaults1, defaults2);
  assert.deepEqual(page1, defaults1);
  assert.deepEqual(page2, defaults2);
});

test('missing/empty localStorage value falls back to defaults without throwing', () => {
  const defaults1 = defaultPage1State(catalog);
  const defaults2 = defaultPage2State();
  const { page1, page2 } = deserializeState(null, defaults1, defaults2);
  assert.deepEqual(page1, defaults1);
  assert.deepEqual(page2, defaults2);
});
