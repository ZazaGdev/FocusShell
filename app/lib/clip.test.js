import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryClipboard, keepClipboard, whenTaken, putBack } from './clip.js';

test('a smoke or try run copies into its own clipboard, never the owner\'s (#1902)', async () => {
  const c = memoryClipboard();
  assert.equal(await c.readText(), '');
  assert.equal(await c.has('image/png'), false);
  await c.writeText('ctrl-v-text');
  assert.equal(await c.readText(), 'ctrl-v-text');
  await c.writePng(new Uint8Array([137, 80, 78, 71]));
  assert.equal(await c.readText(), '', 'an image replaces the text');
  assert.equal(await c.has('image/png'), true);
  await c.clear();
  assert.equal(c.peek(), null);
});

// A clipboard with Electron's calls over items of { type: data }, counting writes.
function fakeClipboard(items) {
  let now = items, writes = 0;
  return {
    read: async () => now.map(r => ({ types: Object.keys(r), getType: async t => r[t] })),
    write: async list => { now = list; writes++; },
    clear: async () => { now = []; writes++; },
    get now() { return now; }, get writes() { return writes; },
  };
}

test('a Sketch Insert puts back what the owner had copied (#1902)', async () => {
  const owner = [{ 'text/plain': 'my copied text', 'text/html': '<b>my copied text</b>' }];
  const clip = fakeClipboard(owner);
  const kept = await keepClipboard(clip.read);
  await clip.write([{ 'image/png': 'sketch.png' }]); // the sketch goes on for Claude Code's Alt+V
  let taken = false;
  setTimeout(() => { taken = true; }, 30); // "[Image #1]" shows in the pane
  assert.equal(await whenTaken(() => taken, 2000, 10), true);
  assert.equal(await putBack(clip, kept, r => r), true);
  assert.deepEqual(clip.now, owner, 'every format of the owner\'s copy is back');
  // An empty clipboard is left empty; one that could not be read is left as the sketch.
  const empty = fakeClipboard([]), keptEmpty = await keepClipboard(empty.read);
  await empty.write([{ 'image/png': 'sketch.png' }]);
  await putBack(empty, keptEmpty, r => r);
  assert.deepEqual(empty.now, []);
  const unreadable = await keepClipboard(async () => { throw new Error('locked'); });
  assert.equal(unreadable, null);
  assert.equal(await putBack(clip, unreadable, r => r), false);
  // Claude Code never takes it: the owner's copy still comes back after the wait.
  assert.equal(await whenTaken(() => false, 50, 10), false);
});
