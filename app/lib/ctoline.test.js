// Lines typed into a pane and checked in the CTO's log (#1029). Run through lib.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunksOf, arrived } from './ctoline.js';

test('ctoline: a long line goes in pieces that add back up to it', () => {
  const line = 'RECORDING: ' + 'x'.repeat(2083);
  const parts = chunksOf(line);
  assert.equal(parts.length, 11);
  assert.ok(parts.every(p => p.length <= 200));
  assert.equal(parts.join(''), line);
  assert.deepEqual(chunksOf('short'), ['short']);
  assert.deepEqual(chunksOf(''), []);
});

const T = Date.parse('2026-10-18T01:13:15Z');
const user = (t, content) => JSON.stringify({ type: 'user', timestamp: new Date(t).toISOString(), message: { role: 'user', content } });
const queued = (t, content) => JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: new Date(t).toISOString(), content });
const LINE = 'RECORDING: D:\\rec\\transcript.md | FocusShell #1020: Remove it';

test('ctoline: the line is found when sent, when queued mid-turn, and not when cut', () => {
  assert.ok(arrived([user(T, LINE)].join('\n'), LINE, T));
  assert.ok(arrived(['{bad', queued(T + 500, LINE)].join('\n'), LINE, T));
  assert.ok(arrived(user(T, [{ type: 'text', text: LINE }]), LINE, T));
  // what 2026-10-18-0504 actually delivered: only the tail
  assert.equal(arrived(user(T, 'Version 2: chat view as an alternative to terminal view'), LINE, T), false);
  // an older copy of the same line does not count
  assert.equal(arrived(user(T - 60e3, LINE), LINE, T), false);
  assert.equal(arrived('', LINE, T), false);
});
