// Old recordings deleted, and items' screenshots moved out first (#1030). Run through lib.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expired, keptPath, KEEP_CHOICES } from './cleanup.js';
import { relinkShots } from '../../../lib/shots.js';
import { run } from '../../../lib/deckcli.js';
import manifest from '../manifest.js';

const H = 3600e3, NOW = Date.parse('2026-10-18T12:00:00Z');
const rec = (id, hoursAgo, open) => ({ id, startedAt: NOW - hoursAgo * H - 60e3, stoppedAt: open ? null : NOW - hoursAgo * H });

test('cleanup: only recordings older than the choice go, never the open one, never with never', () => {
  const all = [rec('a', 2), rec('b', 30), rec('c', 24 * 8), rec('d', 24 * 40), rec('e', 50, true)];
  assert.deepEqual(expired(all, 'never', NOW), []);
  assert.deepEqual(expired(all, undefined, NOW), []);
  assert.deepEqual(expired(all, '24 hours', NOW), ['b', 'c', 'd', 'e']);
  assert.deepEqual(expired(all, '24 hours', NOW, 'b'), ['c', 'd', 'e']);
  assert.deepEqual(expired(all, 'a week', NOW), ['c', 'd']);
  assert.deepEqual(expired(all, 'a month', NOW), ['d']);
  // the setting's choices are exactly the ones cleanup knows, default never
  const s = manifest.settings.find(x => x.key === 'deleteAfter');
  assert.deepEqual(s.choices, KEEP_CHOICES);
  assert.equal(s.default, 'never');
});

test('cleanup: a kept screenshot goes in its recording\'s folder under the keep folder', () => {
  assert.equal(keptPath('D:\\Deck\\screenshots\\', '2026-10-18-0504', 'D:\\Deck\\state\\plugins\\recorder\\2026-10-18-0504\\shots\\0024.png'), 'D:\\Deck\\screenshots\\2026-10-18-0504\\0024.png');
});

const REC = 'D:\\Deck\\state\\plugins\\recorder\\2026-10-18-0504\\shots';
const KEEP = 'D:\\Deck\\screenshots\\2026-10-18-0504';
const MD = `# FocusShell tasks

- [ ] #1020 Remove the strip (2026-10-18, user)
  > Screenshot: ${REC}\\0009.png
  > Screenshot: d:/deck/state/plugins/recorder/2026-10-18-0504/shots/0024.png
  > Screenshot: D:\\Deck\\state\\plugins\\recorder\\2026-10-18-0503\\shots\\0004.png
  > Transcript: ${REC}\\..\\transcript.md at 00:00
`;

test('cleanup: Screenshot lines under the recording follow it, others stay', () => {
  const r = relinkShots(MD, REC, KEEP);
  assert.equal(r.moved.length, 2);
  assert.ok(r.md.includes(`> Screenshot: ${KEEP}\\0009.png`));
  assert.ok(r.md.includes(`> Screenshot: ${KEEP}\\0024.png`));
  assert.ok(r.md.includes('2026-10-18-0503\\shots\\0004.png'));
  assert.ok(r.md.includes('> Transcript:'));
  assert.deepEqual(relinkShots(r.md, REC, KEEP).moved, []);
});

test('cleanup: deck relink moves the lines on every board, and --dry changes nothing', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-relink-'));
  fs.mkdirSync(path.join(data, 'tasks'));
  fs.writeFileSync(path.join(data, 'tasks', 'FocusShell.md'), MD);
  const ctx = { data, lock: path.join(data, '.lock') };
  const dry = run(['relink', REC, KEEP, '--dry'], ctx);
  assert.equal(dry.split('\n').length, 2);
  assert.equal(fs.readFileSync(path.join(data, 'tasks', 'FocusShell.md'), 'utf8'), MD);
  run(['relink', REC, KEEP], ctx);
  assert.ok(fs.readFileSync(path.join(data, 'tasks', 'FocusShell.md'), 'utf8').includes(`${KEEP}\\0024.png`));
  assert.equal(run(['relink', REC, KEEP], ctx), 'nothing to relink');
  fs.rmSync(data, { recursive: true, force: true });
});
