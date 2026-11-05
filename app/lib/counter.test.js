// The shared task counter (#411). Run through lib.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sharedNext, SHARED_START, parseTasks } from './tasks.js';
import { nextShared, boardOf } from './counter.js';
import { run } from './deckcli.js';

test('shared counter: from 1000, one more than the highest on any board', () => {
  assert.equal(SHARED_START, 1000);
  assert.equal(sharedNext(['- [ ] #415 a (2026-10-01, user)', '- [ ] #305 b (2026-10-01, user)']), 1000);
  assert.equal(sharedNext(['- [ ] #415 a (2026-10-01, user)', '- [ ] #1003 b (2026-10-01, user)']), 1004);
  assert.equal(sharedNext(['']), 1000);
});

test('shared counter: deck numbers every task board from one count, finds an item by number alone, keeps ideas apart', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-counter-'));
  fs.mkdirSync(path.join(data, 'tasks'));
  fs.writeFileSync(path.join(data, 'tasks', 'FocusShell.md'), '# FocusShell tasks\n- [ ] #41 Old one (2026-10-01, user)\n');
  fs.writeFileSync(path.join(data, 'tasks', 'Brewlog.md'), '# Brewlog tasks\n- [ ] #41 Old too (2026-10-01, user)\n');
  const ctx = { data, lock: path.join(data, 'state', 'board.lock'), now: new Date(2026, 9, 18, 9, 0) };
  assert.equal(run(['add', 'FocusShell', 'First'], ctx), 'FocusShell #1000 added');
  assert.equal(run(['add', 'Brewlog', 'Second'], ctx), 'Brewlog #1001 added');
  assert.equal(run(['add', 'Me', 'Third'], ctx), 'Me #1002 added');
  assert.equal(run(['add', 'Ideas', 'An idea'], ctx), 'Ideas #1 added', 'ideas keep their own count');
  assert.equal(boardOf(path.join(data, 'tasks'), 1001), 'Brewlog');
  assert.equal(boardOf(path.join(data, 'tasks'), 41), null, 'an old number does not name one board');
  assert.equal(run(['mark', '1001', 'done'], ctx), 'Brewlog #1001 marked x');
  assert.throws(() => run(['mark', '41', 'done'], ctx), /old number .* give the board/);
  assert.throws(() => run(['mark', '1999', 'done'], ctx), /no board has #1999/);
  assert.equal(run(['mark', 'FocusShell', '41', 'done'], ctx), 'FocusShell #41 marked x', 'an old number with its board still works');
  assert.equal(run(['move', '1000', 'Me'], ctx), 'FocusShell #1000 moved to Me #1003');
  const f = path.join(data, 'tasks', 'Me.md');
  assert.equal(nextShared(path.join(data, 'tasks'), f, fs.readFileSync(f, 'utf8')), 1004);
  assert.ok(parseTasks(fs.readFileSync(f, 'utf8')).find(t => t.n === 1003).details.includes('From: FocusShell #1000'));
  fs.rmSync(data, { recursive: true, force: true });
});
