import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leadGrid, toggleLead, slotCount, LAYOUTS } from './layouts.js';

test('leadGrid: the multi-project grids without the CTO pane (#1554)', () => {
  assert.equal(leadGrid(1), null);
  assert.equal(leadGrid(0), null);
  assert.deepEqual(leadGrid(2), LAYOUTS['m-2r'].tree[1][1][0]);
  assert.deepEqual(leadGrid(4), LAYOUTS['m-2x2'].tree[1][1][0]);
  for (const n of [2, 3, 4, 5]) assert.equal(slotCount(leadGrid(n)), n);
  assert.equal(leadGrid(5)[1][1][0][1].length, 2); // three above two
});

test('toggleLead: Ctrl+click adds a lead to the split and takes it out again (#1554)', () => {
  assert.deepEqual(toggleLead(null, 1, 2), { split: [1, 2], show: 1 });
  assert.deepEqual(toggleLead([1, 2], 1, 3), { split: [1, 2, 3], show: 1 });
  assert.deepEqual(toggleLead([1, 2, 3], 1, 1), { split: [2, 3], show: 3 });
  assert.deepEqual(toggleLead([1, 2], 2, 1), { split: null, show: 2 });
  assert.deepEqual(toggleLead(null, 1, 1), { split: null, show: 1 });
  assert.deepEqual(toggleLead([], 3, 4), { split: [3, 4], show: 3 });
});
