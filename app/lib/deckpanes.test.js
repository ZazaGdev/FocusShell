// The CTO's pane requests as deck verbs (#2562): the same request files the .ps1 scripts write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPane, paneArgs, leadOf, projectNames } from './deckpanes.js';

function deck() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'panes-')), projects = path.join(root, 'projects'), data = path.join(root, 'deck');
  fs.mkdirSync(path.join(projects, 'Habitly'), { recursive: true });
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify({ scanRoots: [projects], projects: [{ name: 'Elsewhere', path: 'D:\\x', test: '' }] }));
  return data;
}
// Plays the app: takes the first request that shows up, remembers it, answers it.
function app(data, reply) {
  const req = path.join(data, 'state', 'requests'), got = [];
  const t = setInterval(() => {
    let files = [];
    try { files = fs.readdirSync(req).filter(f => f.endsWith('.req')); } catch { return; }
    for (const f of files) {
      const body = fs.readFileSync(path.join(req, f), 'utf8');
      fs.unlinkSync(path.join(req, f));
      got.push({ f, body });
      const a = reply(f, body);
      if (a !== null) fs.writeFileSync(path.join(req, f.replace(/\.req$/, '.out')), a);
    }
  }, 20);
  return { got, stop: () => clearInterval(t) };
}
const on = () => true;

test('pane options read as the scripts\' parameters', () => {
  assert.deepEqual(paneArgs(['Habitly', '--lead', '3', '--worktree', '--model', 'Haiku']), { pos: ['Habitly'], opt: { lead: '3', worktree: true, model: 'Haiku' } });
  assert.throws(() => paneArgs(['x', '--lead']), /needs a value/);
  assert.throws(() => paneArgs(['x', '--nope']), /unknown option/);
  assert.equal(leadOf({}), 0); assert.equal(leadOf({ lead: '1' }), 0); assert.equal(leadOf({ second: true }), 2);
  assert.equal(leadOf({ lead: '5' }), 5); assert.equal(leadOf({ lead: '6' }), null);
  assert.deepEqual(projectNames(deck()), ['Elsewhere', 'Habitly']);
});

test('open-pane files the request the app reads, with the project as it is named on disk', async () => {
  const data = deck(), a = app(data, () => 'Started lead-Habitly on haiku.');
  try {
    const r = await runPane('open-pane', ['habitly', '--model', 'haiku'], { data, running: on });
    assert.equal(r.code, 0);
    assert.equal(r.out, 'Started lead-Habitly on haiku. It shows in ListAgents within about 20 seconds.');
    assert.deepEqual(a.got, [{ f: 'open-Habitly.req', body: 'Habitly\nmodel=haiku\n' }]);
  } finally { a.stop(); }
});

test('an extra lead in its own worktree, and the refusals', async () => {
  const data = deck(), a = app(data, () => 'Started lead-Habitly-3.');
  try {
    const r = await runPane('open-pane', ['Habitly', '--lead', '3', '--worktree'], { data, running: on });
    assert.equal(r.code, 0);
    assert.match(r.out, /^Started lead-Habitly-3\. It works in its own worktree \(state.worktrees.Habitly-3, branch lead-3\)\./);
    assert.deepEqual(a.got, [{ f: 'open3-Habitly.req', body: 'worktree\n' }]);
  } finally { a.stop(); }
  assert.match((await runPane('open-pane', ['Habitly', '--lead', '6'], { data, running: on })).out, /^Refused: a project runs at most five leads/);
  assert.match((await runPane('open-pane', ['Habitly', '--worktree'], { data, running: on })).out, /^Refused: --worktree is for an extra lead only/);
  assert.match((await runPane('open-pane', ['Nope'], { data, running: on })).out, /^Unknown project 'Nope'\. Known: Elsewhere, Habitly\./);
  assert.match((await runPane('open-pane', ['Habitly', '--model', 'gpt'], { data, running: on })).out, /^Refused: --model takes/);
  const off = await runPane('open-pane', ['Habitly'], { data, running: () => false });
  assert.deepEqual(off, { out: 'The FocusShell app is not running. Start it, then ask again.', code: 1 });
});

test('the smoke run\'s own requests folder and project names stand in for the data folder\'s', async () => {
  const data = deck(), req = path.join(data, 'other-requests');
  const t = setInterval(() => { try { for (const f of fs.readdirSync(req).filter(f => f.endsWith('.req'))) { fs.unlinkSync(path.join(req, f)); fs.writeFileSync(path.join(req, f.replace(/\.req$/, '.out')), 'Started lead-Fake.'); } } catch { /* not yet */ } }, 20);
  try {
    const r = await runPane('open-pane', ['fake'], { data, requests: req, names: ['Fake'], running: on });
    assert.equal(r.code, 0);
    assert.ok(!fs.existsSync(path.join(data, 'state', 'requests')), 'the data folder\'s requests folder was not used');
  } finally { clearInterval(t); }
});

test('open-pane asks twice when the app does not answer, then gives up', async () => {
  const data = deck(), a = app(data, () => null);
  try {
    const r = await runPane('open-pane', ['Habitly'], { data, running: on, tries: 3 });
    assert.equal(r.code, 1);
    assert.match(r.out, /did not answer within 30 seconds; asking again\.\nFailed: the FocusShell app did not answer the request to open lead-Habitly, twice/);
    assert.equal(a.got.length, 2);
  } finally { a.stop(); }
});

test('close-pane sends force only when asked, and passes the app\'s refusal on', async () => {
  const data = deck(), a = app(data, (f, body) => (body.trim() === 'force' ? 'Closed lead-Habitly.' : 'Refused: lead-Habitly is busy.'));
  try {
    assert.deepEqual(await runPane('close-pane', ['Habitly'], { data, running: on }), { out: 'Refused: lead-Habitly is busy.', code: 1 });
    assert.deepEqual(await runPane('close-pane', ['Habitly', '--force'], { data, running: on }), { out: 'Closed lead-Habitly.', code: 0 });
    assert.deepEqual(a.got.map(g => g.f), ['close-Habitly.req', 'close-Habitly.req']);
  } finally { a.stop(); }
  assert.match((await runPane('close-pane', ['Habitly', '--lead', '2'], { data, running: () => false })).out, /no lead-Habitly-2 tab to close/);
});

test('ask-owner writes the words request whole and can wait for the click', async () => {
  const data = deck(), a = app(data, () => 'typed');
  try {
    const r = await runPane('ask-owner', ['Habitly', 'yes, push it', '--task', '12', '--why', 'Push?', '--lead', '2', '--wait', '5'], { data, running: on });
    assert.equal(r.code, 0);
    assert.match(r.out, /^Asked: a card for lead-Habitly-2 shows the words; nothing is typed until the owner clicks\. Request [0-9a-f]{12}\.\nAnswer: typed$/);
    const body = JSON.parse(a.got[0].body);
    assert.deepEqual({ ...body, created: 0 }, { project: 'Habitly', task: 12, words: 'yes, push it', why: 'Push?', n: 2, created: 0 });
    assert.match(a.got[0].f, /^words-[0-9a-f]{12}\.req$/);
  } finally { a.stop(); }
  assert.match((await runPane('ask-owner', ['Habitly', 'a\nb'], { data, running: on })).out, /one line/);
  assert.match((await runPane('ask-owner', ['Habitly', 'x'], { data, running: () => false })).out, /^Failed: the FocusShell app is not running/);
});

test('open-file asks the app to open a file the owner asked for, and passes its answer on (#2768)', async () => {
  const data = deck(), file = path.join(data, 'projects.json');
  const a = app(data, (f, body) => `Opened ${JSON.parse(body).file} in the Code pane of Habitly, beside lead-Habitly.`);
  try {
    const r = await runPane('open-file', [file], { data, running: on });
    assert.deepEqual(r, { out: `Opened ${file} in the Code pane of Habitly, beside lead-Habitly.`, code: 0 });
    assert.match(a.got[0].f, /^file-[0-9a-f]{12}\.req$/);
    assert.deepEqual(JSON.parse(a.got[0].body), { file });
    assert.deepEqual(fs.readdirSync(path.join(data, 'state', 'requests')), [], 'no request or answer is left behind');
  } finally { a.stop(); }
  const failed = app(data, () => 'Failed: could not open it.');
  try { assert.equal((await runPane('open-file', [file], { data, running: on })).code, 1); } finally { failed.stop(); }
  assert.match((await runPane('open-file', ['docs\\plan.md'], { data, running: on })).out, /^Refused: 'docs\\plan\.md' is not a full path/);
  assert.match((await runPane('open-file', [path.join(data, 'nope.md')], { data, running: on })).out, /^Failed: there is no file or folder at /);
  const off = await runPane('open-file', [file], { data, running: () => false });
  assert.equal(off.code, 1);
  assert.match(off.out, /not running.*Give the owner the path instead: /);
  const quiet = await runPane('open-file', [file], { data, running: on, tries: 2 });
  assert.match(quiet.out, /did not answer within 0\.4 seconds\. Give the owner the path instead\.$/);
  await assert.rejects(runPane('open-file', [], { data, running: on }), /needs one full path/);
  await assert.rejects(runPane('open-file', [file, file], { data, running: on }), /needs one full path/);
});
