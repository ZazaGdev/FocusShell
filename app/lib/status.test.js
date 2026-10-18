// Where each lead stopped (#383). Run through lib.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseStatus, setStatus, refreshDue, refreshLine, workStep, IDLE_MS, sortLeads, leadState, leadTask } from './status.js';

test('status: rows A to Z with a lead and its second together, and a state per lead (#413)', () => {
  const names = ['lead-Cliptools', 'lead-Brewlog', 'lead-Atlas', 'lead-Brewlog-2', 'lead-Roadmapper', 'lead-Atlas-2'];
  assert.deepEqual(sortLeads(names.map(name => ({ name }))).map(l => l.name),
    ['lead-Atlas', 'lead-Atlas-2', 'lead-Brewlog', 'lead-Brewlog-2', 'lead-Cliptools', 'lead-Roadmapper']);
  assert.equal(leadState({ busy: true }), 'working');
  assert.equal(leadState({ busy: false }), 'idle');
  assert.equal(leadState({ busy: true, prompt: true }), 'needs');
  assert.equal(leadState({ busy: false, task: { mark: '?' } }), 'needs');
  assert.equal(leadState({ busy: true, task: { mark: '!' } }), 'blocked');
  // The task is the one naming that lead, never another lead's of the same project.
  const tasks = [{ n: 394, mark: '~', who: 'lead-Atlas' }, { n: 396, mark: '~', who: 'lead-Atlas-2' }, { n: 397, mark: '?', who: 'lead-Atlas-2' }, { n: 400, mark: ' ', who: 'lead-Atlas' }];
  assert.equal(leadTask(tasks, 'lead-Atlas').n, 394);
  assert.equal(leadTask(tasks, 'lead-Atlas-2').n, 396);
  assert.equal(leadTask(tasks.slice(2), 'lead-Atlas-2').n, 397);
  assert.equal(leadTask(tasks, 'lead-Brewlog'), null);
  assert.equal(leadTask([{ n: 1, mark: '~', who: 'user' }], 'lead-Atlas'), null);
});
import { statusFile, readStatus } from './statusfile.js';
import { run } from './deckcli.js';

test('status: a lead line is set, kept to one line, and a bad name or empty line is refused', () => {
  let st = parseStatus('not json');
  assert.deepEqual(st, { leads: {} });
  st = setStatus(st, 'lead-Atlas', ' on #383,\n waiting on the owner ', 5);
  assert.deepEqual(st.leads['lead-Atlas'], { line: 'on #383, waiting on the owner', at: 5 });
  st = setStatus(st, 'lead-Blogger', 'idle', 6);
  assert.equal(Object.keys(st.leads).length, 2);
  assert.throws(() => setStatus(st, 'cto', 'x', 1), /not a lead name/);
  assert.throws(() => setStatus(st, 'lead-X', '  ', 1), /empty/);
  assert.equal(setStatus(st, 'lead-X', 'y'.repeat(300), 1).leads['lead-X'].line.length, 200);
});

test('status: a refresh is due once the picked interval has passed and a lead changed or is busy, busy CTO or not (#1034)', () => {
  const M = 60000, now = 1000 * M;
  assert.equal(refreshDue({ now, askedAt: 0, leadLast: now - 1000 }), true);
  assert.equal(refreshDue({ now, askedAt: now - 29 * M, leadLast: now - 1000 }), false, 'asked 29 min ago, default 30');
  assert.equal(refreshDue({ now, askedAt: now - 30 * M, leadLast: now - 1000 }), true, '30 min passed');
  assert.equal(refreshDue({ now, askedAt: now - 6 * M, leadLast: now - 1000, every: 5 * M }), true, '5 min chosen');
  assert.equal(refreshDue({ now, askedAt: now - 90 * M, leadLast: now - 1000, every: 120 * M }), false, '2 h chosen');
  assert.equal(refreshDue({ now, askedAt: now - 31 * M, leadLast: now - 40 * M }), false, 'nothing changed, nobody busy');
  assert.equal(refreshDue({ now, askedAt: now - 31 * M, leadLast: now - 40 * M, busy: true }), true, 'a lead busy all along');
  assert.equal(refreshLine(['lead-A', 'lead-B']), 'STATUS REFRESH: lead-A, lead-B');
});

test('status: an idle lead\'s recaps and redraws are not work; starting and finishing are, once each (#392)', () => {
  const run = (w, pattern, t0) => { let t = t0; for (const a of pattern) { w = workStep(w, a, t); t += 2000; } return [w, t]; };
  // A recap burst every few minutes: 2 to 4 seconds of output, then quiet.
  let w, t = 0;
  for (let i = 0; i < 10; i++) [w, t] = run(w, [true, true, false, false, false], t);
  assert.equal(w.changedAt, 0, 'bursts never count');
  // Real work: 30 s of spinner, then idle.
  [w, t] = run(w, Array(16).fill(true), t);
  const started = w.changedAt;
  assert.ok(started > 0 && w.working, 'started');
  [w, t] = run(w, [true, true], t);
  assert.equal(w.changedAt, started, 'still working: no new change');
  [w, t] = run(w, [false], t);
  const finished = w.changedAt;
  assert.ok(finished > started && !w.working, 'finished');
  [w, t] = run(w, [false, false, true, false], t);
  assert.equal(w.changedAt, finished, 'idle again: nothing new');
  // Asked after the finish: no second ask for the same state.
  const now = finished + IDLE_MS;
  assert.equal(refreshDue({ now, askedAt: 0, leadLast: w.changedAt, every: IDLE_MS }), true);
  assert.equal(refreshDue({ now: now + IDLE_MS, askedAt: now, leadLast: w.changedAt, every: IDLE_MS }), false);
});

test('status: deck status writes a line and prints them all', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-status-'));
  const ctx = { data, lock: path.join(data, 'state', 'board.lock'), now: new Date(2026, 9, 16, 19, 30) };
  assert.equal(run(['status'], ctx), 'no status lines yet');
  assert.equal(run(['status', 'lead-Atlas', 'idle after #383'], ctx), 'lead-Atlas: idle after #383');
  assert.equal(readStatus(statusFile(data)).leads['lead-Atlas'].line, 'idle after #383');
  assert.equal(run(['status'], ctx), 'lead-Atlas: idle after #383 (2026-10-16 19:30)');
  assert.throws(() => run(['status', 'lead-Atlas'], ctx), /missing the line/);
  fs.rmSync(data, { recursive: true, force: true });
});
