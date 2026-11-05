// Where each lead stopped (#383). Run through lib.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseStatus, setStatus, refreshDue, refreshLine, workStep, IDLE_MS,sortLeads, leadState, leadTask, leadDot } from './status.js';

test('leadDot: orange only while the lead waits on the owner, from its own pane (#1756)', () => {
  assert.deepEqual(leadDot({ prompt: 'Do you want to proceed?' }), { state: 'needs', tip: 'Waits on you: Do you want to proceed?' });
  assert.deepEqual(leadDot({ asked: 'Which colours?' }), { state: 'needs', tip: 'Waits on your answer: Which colours?' });
  assert.equal(leadDot({ asked: 'Which colours?', active: true }).state, 'working', 'answered and working again');
  assert.deepEqual(leadDot({}), { state: 'idle', tip: 'Idle' }, 'nothing waits: hollow, whatever its board holds');
  assert.deepEqual(leadDot({ active: true }), { state: 'working', tip: 'Working' });
  assert.equal(leadDot({ exited: true, prompt: 'x' }).state, 'ended');
});

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

test('status: an active owner gets no refresh; one comes after the picked idle time while a lead is busy or changed (#1699)', () => {
  const M = 60000, now = 1000 * M;
  // Active: a key or click a minute, ten or 29 minutes ago holds every ask, however busy the leads.
  for (const ago of [0, M, 10 * M, 29 * M]) assert.equal(refreshDue({ now, ownerAgo: ago, leadLast: now - 1000, busy: true }), false, `active ${ago / M} min ago`);
  assert.equal(refreshDue({ now, ownerAgo: 30 * M, leadLast: now - 1000 }), true, 'idle 30 min, a lead changed');
  assert.equal(refreshDue({ now, ownerAgo: 30 * M, busy: true }), true, 'idle 30 min, a lead busy');
  assert.equal(refreshDue({ now, ownerAgo: 30 * M, leadLast: now - 60 * M, askedAt: now - 50 * M }), false, 'nothing changed since the last ask, nobody busy');
  assert.equal(refreshDue({ now, ownerAgo: 6 * M, busy: true, idle: 5 * M }), true, '5 min chosen');
  assert.equal(refreshDue({ now, ownerAgo: 90 * M, busy: true, idle: 120 * M }), false, '2 h chosen');
  assert.equal(refreshDue({ now, ownerAgo: 40 * M, busy: true, draft: true }), false, 'a draft sits in the prompt');
  assert.equal(refreshLine(['lead-A', 'lead-B']), 'STATUS REFRESH: lead-A, lead-B');
});

test('status: two refreshes per idle stretch, at the idle time and twice it, then none until the owner is back (#1699)', () => {
  const M = 60000, t0 = 1000 * M; // the owner's last key or click
  const at = (idleMin, askedAt) => refreshDue({ now: t0 + idleMin * M, ownerAgo: idleMin * M, askedAt, busy: true });
  assert.equal(at(30, 0), true, 'first ask at 30 min');
  assert.equal(at(45, t0 + 30 * M), false, 'asked at 30, not again at 45');
  assert.equal(at(60, t0 + 30 * M), true, 'second ask at 60 min');
  for (const m of [61, 90, 180, 600]) assert.equal(at(m, t0 + 60 * M), false, `none at ${m} min`);
  // Back at the keys after that, away again: the new stretch gets its own two.
  const t1 = t0 + 200 * M;
  assert.equal(refreshDue({ now: t1 + 30 * M, ownerAgo: 30 * M, askedAt: t0 + 60 * M, busy: true }), true, 'a new idle stretch');
  // Nothing new and nobody busy at the 60-minute mark: no second ask.
  assert.equal(refreshDue({ now: t0 + 60 * M, ownerAgo: 60 * M, askedAt: t0 + 30 * M, leadLast: t0 + 10 * M }), false);
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
  assert.equal(refreshDue({ now, askedAt: 0, leadLast: w.changedAt, idle: IDLE_MS }), true);
  assert.equal(refreshDue({ now: now + IDLE_MS, askedAt: now, leadLast: w.changedAt, idle: IDLE_MS }), false);
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
