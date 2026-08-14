import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildScopeCsv, itemById } from '../js/kch-model.js';

function loadJSON(relUrl) {
  return JSON.parse(fs.readFileSync(new URL(relUrl, import.meta.url), 'utf8'));
}

const catalog = loadJSON('../data/secondary-loot.json').items;
const sampleRun = loadJSON('../fixtures/sample-run.json');

// Converts fixtures/sample-run.json's { itemId: dollarValue } map into the
// { itemId, value, buyersChoice, variant } loot shape buildScopeCsv() (and
// the rest of the app) expects — every catalog item gets an entry, blank
// for anything not present in the fixture's scoped map, matching how
// index.html's real state.loot is always shaped.
function lootFromSampleRun() {
  return catalog.map(cat => ({
    itemId: cat.itemId,
    value: sampleRun.secondaryLoot[cat.itemId] !== undefined ? sampleRun.secondaryLoot[cat.itemId] : '',
    buyersChoice: sampleRun.buyersChoice.includes(cat.itemId),
    variant: ''
  }));
}

test('header row is always Item,Floor,Value', () => {
  const csv = buildScopeCsv([], catalog);
  assert.equal(csv.split('\r\n')[0], 'Item,Floor,Value');
});

test('unscoped/blank items still get a row, with a blank Value field', () => {
  const loot = catalog.map(cat => ({ itemId: cat.itemId, value: '', buyersChoice: false, variant: '' }));
  const csv = buildScopeCsv(loot, catalog);
  const lines = csv.split('\r\n');
  // 2026-08-13, user feedback: every catalog item gets a row so pasting
  // straight into a spreadsheet needs no hand-inserted blank rows to stay
  // aligned with other runs. Header + one row per catalog item.
  assert.equal(lines.length - 1, catalog.length);
  const firstItem = catalog[0];
  assert.equal(lines[1], `${firstItem.name},${firstItem.floor},`);
});

test('one row per catalog item (blank Value if unscoped), in catalog order, against the real sample-run fixture', () => {
  const loot = lootFromSampleRun();
  const csv = buildScopeCsv(loot, catalog);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'Item,Floor,Value');

  // Every catalog item gets a row now, scoped or not.
  assert.equal(lines.length - 1, catalog.length, 'one data row per catalog item, nothing more or less');

  // Catalog order preserved: B-A is the first catalog item. Its Value is
  // blank if it wasn't scoped in the fixture, filled in if it was.
  const ba = itemById(catalog, 'B-A');
  const baValue = sampleRun.secondaryLoot['B-A'] !== undefined ? String(sampleRun.secondaryLoot['B-A']) : '';
  assert.equal(lines[1], `${ba.name},${ba.floor},${baValue}`);

  // BAY's fixedValue reaches the CSV as a plain number like any other item.
  const bay = itemById(catalog, 'BAY');
  assert.ok(lines.includes(`${bay.name},${bay.floor},${sampleRun.secondaryLoot['BAY']}`));

  // Scoped items' Value is a plain number — no "$" or thousands separator.
  // Unscoped items' Value is simply blank.
  const scopedIds = new Set(catalog.filter(cat => sampleRun.secondaryLoot[cat.itemId] !== undefined).map(cat => cat.itemId));
  lines.slice(1).forEach(line => {
    const [name, floor, value] = line.split(',');
    const cat = catalog.find(c => c.name === name && c.floor === floor);
    if (cat && scopedIds.has(cat.itemId)) {
      assert.ok(/^\d+$/.test(value), `value field "${value}" should be a bare integer`);
    } else {
      assert.equal(value, '', `unscoped item "${name}" should have a blank value field`);
    }
  });
});

test('name collisions are disambiguated by the Floor column', () => {
  // Oeuf de Coquard exists on both Alarm Floor (0-B) and Second (2-A).
  const loot = catalog.map(cat => {
    if (cat.itemId === '0-B') return { itemId: cat.itemId, value: 20000, buyersChoice: false, variant: '' };
    if (cat.itemId === '2-A') return { itemId: cat.itemId, value: 54000, buyersChoice: false, variant: '' };
    return { itemId: cat.itemId, value: '', buyersChoice: false, variant: '' };
  });
  const csv = buildScopeCsv(loot, catalog);
  const lines = csv.split('\r\n').slice(1);
  assert.ok(lines.includes('Oeuf de Coquard,Alarm Floor,20000'));
  assert.ok(lines.includes('Oeuf de Coquard,Second,54000'));
});

test('fields containing a comma or quote are RFC4180-escaped', () => {
  const syntheticCatalog = [
    { itemId: 'X-1', name: 'Weird, "Named" Item', floor: 'First' },
  ];
  const loot = [{ itemId: 'X-1', value: 1000, buyersChoice: false, variant: '' }];
  const csv = buildScopeCsv(loot, syntheticCatalog);
  const lines = csv.split('\r\n');
  assert.equal(lines[1], '"Weird, ""Named"" Item",First,1000');
});
