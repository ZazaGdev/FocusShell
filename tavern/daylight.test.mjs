// The room's light by the local clock (#283).
import test from 'node:test';
import assert from 'node:assert/strict';
import { lightAt } from './demos/room/daylight.js';

test('daylight: day 7-18, dusk 5-7 and 18-21, night the rest', () => {
  const at = (h, m = 0) => lightAt(new Date(2026, 9, 9, h, m));
  assert.deepEqual([at(0), at(4, 59), at(5), at(6, 59), at(7), at(12), at(17, 59), at(18), at(20, 59), at(21), at(23, 59)],
    ['night', 'night', 'dusk', 'dusk', 'day', 'day', 'day', 'dusk', 'dusk', 'night', 'night']);
});
