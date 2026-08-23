import test from 'node:test';
import assert from 'node:assert/strict';
import { findNearestPins } from '../js/kch-model.js';

// A small synthetic floor: three pins on a 200x100 (non-square) rendered
// image, spread out enough that most taps only ever reach one of them.
const ITEMS = [
  { itemId: 'A', xPct: 50, yPct: 50 },  // (100px, 50px)
  { itemId: 'B', xPct: 90, yPct: 50 },  // (180px, 50px) — 80px from A
  { itemId: 'C', xPct: 10, yPct: 10 }   // (20px, 10px)
];
const W = 200, H = 100;

test('returns the single pin within radius, unambiguous', () => {
  const hits = findNearestPins(ITEMS, 100, 50, W, H, 20); // dead-on A
  assert.deepEqual(hits.map(h => h.itemId), ['A']);
});

test('returns an empty list when no pin is within radius', () => {
  const hits = findNearestPins(ITEMS, 100, 90, W, H, 5); // far below A, tiny radius
  assert.deepEqual(hits, []);
});

test('returns every pin within radius when 2+ overlap, nearest first', () => {
  // Two pins 40px apart (closer together than ITEMS' A/B, which are 80px
  // apart and can never both fit inside one realistic radius) — a tap 10px
  // right of the first reaches both at a 32px radius, closer to the first.
  const closePair = [
    { itemId: 'A', xPct: 50, yPct: 50 },  // (100px, 50px)
    { itemId: 'D', xPct: 70, yPct: 50 }   // (140px, 50px) — 40px from A
  ];
  const hits = findNearestPins(closePair, 110, 50, W, H, 32);
  assert.deepEqual(hits.map(h => h.itemId), ['A', 'D']);
  assert.ok(hits[0].distancePx < hits[1].distancePx);
});

test('boundary: a distance exactly equal to the radius is included', () => {
  const hits = findNearestPins(ITEMS, 100, 70, W, H, 20); // exactly 20px below A
  assert.deepEqual(hits.map(h => h.itemId), ['A']);
});

test('boundary: a distance one unit past the radius is excluded', () => {
  const hits = findNearestPins(ITEMS, 100, 70.001, W, H, 20);
  assert.deepEqual(hits, []);
});

test('items with no xPct/yPct (e.g. BAY) are skipped, not thrown on', () => {
  const withUnmapped = [...ITEMS, { itemId: 'BAY', xPct: null, yPct: null }];
  const hits = findNearestPins(withUnmapped, 100, 50, W, H, 20);
  assert.deepEqual(hits.map(h => h.itemId), ['A']);
});

// Real regression case (2026-08-22): the scratchpad prototype's first
// hit-testing pass compared tap-to-pin distance in a blended "average of
// (rendered width + height)/2" percent space — only correct for a square
// image and a perfectly diagonal offset. On a wide-but-short rendered
// image with a purely-vertical gap, that shortcut silently shrinks the
// effective hit-zone below the real pixel radius. Confirmed here with the
// exact numbers: image 200x100, tap 15px straight below a pin (well
// within a 20px radius under true per-axis math) — the blended approach
// would have converted the same 15%-in-percent-space gap using
// avgDim=(200+100)/2=150, giving 22.5px > 20px radius, a false miss.
// findNearestPins() must use true per-axis pixels and therefore register
// the hit.
test('non-square image: true per-axis math finds a hit a blended-percent shortcut would miss', () => {
  const items = [{ itemId: 'A', xPct: 50, yPct: 50 }]; // (100px, 50px) on a 200x100 image
  const hits = findNearestPins(items, 100, 65, 200, 100, 20); // 15px straight down
  assert.deepEqual(hits.map(h => h.itemId), ['A']);
  assert.ok(Math.abs(hits[0].distancePx - 15) < 1e-9);
});

// Real catalog case (First Floor's tightest cluster, ~47px apart on a
// 900x727 rendered image): Antique Bands (1-C, xPct 53.04/yPct 19.12) and
// Art Deco Rings (1-D, xPct 53.04/yPct 12.66) sit almost exactly on the
// Medium (24px) hit-zone's ambiguity boundary — a tap at their midpoint
// should register both as candidates.
test('real First Floor cluster (Antique Bands / Art Deco Rings) is ambiguous at Medium radius', () => {
  const firstFloorItems = [
    { itemId: '1-C', xPct: 53.04, yPct: 19.12 },
    { itemId: '1-D', xPct: 53.04, yPct: 12.66 }
  ];
  const W2 = 900, H2 = 727;
  const midYPct = (19.12 + 12.66) / 2;
  const tapXPx = (53.04 / 100) * W2;
  const tapYPx = (midYPct / 100) * H2;
  const hits = findNearestPins(firstFloorItems, tapXPx, tapYPx, W2, H2, 24);
  assert.deepEqual(hits.map(h => h.itemId).sort(), ['1-C', '1-D']);
});
