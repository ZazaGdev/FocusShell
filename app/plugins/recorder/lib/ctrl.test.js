import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ctrlHold, keysLine } from './ctrl.js';

// The pen's state after each reading of the keys, in order.
const run = steps => { let st = null; return steps.map(k => { const r = ctrlHold(st, k); st = r.state; return r.pen; }); };
const CTRL = { ctrl: true, other: false }, COMBO = { ctrl: true, other: true }, NONE = { ctrl: false, other: false };

test('Ctrl held on its own draws, let go it stops (#1908)', () => {
  assert.deepEqual(run([NONE, CTRL, CTRL, NONE]), [false, true, true, false]);
});

test('Ctrl with another key is a shortcut and never draws (#1908)', () => {
  // Ctrl+C: Ctrl first, then C with it, then C let go while Ctrl stays down.
  assert.deepEqual(run([CTRL, COMBO, CTRL, NONE]), [true, false, false, false]);
  // Pressed together: never on at all.
  assert.deepEqual(run([COMBO, CTRL, NONE]), [false, false, false]);
  // The next hold on its own draws again.
  assert.deepEqual(run([CTRL, COMBO, NONE, CTRL]), [true, false, false, true]);
});

test('the key watcher\'s lines are read, anything else ignored (#1908)', () => {
  assert.deepEqual(keysLine('10\r'), { ctrl: true, other: false });
  assert.deepEqual(keysLine('11'), { ctrl: true, other: true });
  assert.deepEqual(keysLine('00'), { ctrl: false, other: false });
  assert.equal(keysLine('Add-Type: error'), null);
  assert.equal(keysLine(''), null);
});
