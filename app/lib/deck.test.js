// The deck command (#225): verbs, Windows paths as process arguments, concurrent writers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run } from './deckcli.js';
import { parseTasks, doneOf, itemTags } from './tasks.js';
import { dueOf, repeatOf, isSomeday } from './me.js';
import { update } from './boardio.js';

const DECK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'deck.mjs');
const fresh = () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-'));
  fs.mkdirSync(path.join(data, 'tasks'));
  fs.writeFileSync(path.join(data, 'tasks', 'Demo.md'), '# Demo tasks\n- [~] #1 Research hosting (2026-10-02, lead-Demo)\n  > Compare GitHub Pages and Netlify\n');
  return { data, lock: path.join(data, 'state', 'board.lock'), now: new Date(2026, 9, 7, 16, 5) };
};
const board = (c, name = 'Demo') => fs.readFileSync(path.join(c.data, 'tasks', `${name}.md`), 'utf8');
const item = (c, n, name) => parseTasks(board(c, name)).find(t => t.n === n);
// Every escape a shell, JSON or Python string would turn into something else.
const NASTY = String.raw`D:\new\back\test\raw\a\b\x41\u0041\\share\report.md`;

test('deck add, mark done with a result, detail, answer and title keep what was there', () => {
  const c = fresh();
  assert.match(run(['add', 'Demo', 'Read the report', '--who', 'lead-Demo', '--owner', '--detail', NASTY, '--tags', 'Research'], c), /^Demo #1000 added; it lacks a What: or To do: line/);
  // New items take the shared counter from 1000 (#411); #1 is an old number on its board.
  const t2 = item(c, 1000);
  assert.equal(t2.who, 'lead-Demo'); assert.equal(t2.forOwner, true);
  assert.deepEqual(t2.details, [NASTY, 'Tags: Research']);
  run(['mark', 'Demo', '1', 'done', '--result', 'GitHub Pages wins'], c);
  run(['detail', 'Demo', '1', `Full report: ${NASTY}`], c);
  const t1 = item(c, 1);
  assert.equal(t1.mark, 'x'); assert.equal(t1.result, 'GitHub Pages wins'); assert.equal(doneOf(t1), '2026-10-07 16:05');
  assert.deepEqual(t1.details, ['Compare GitHub Pages and Netlify', 'Done: 2026-10-07 16:05', `Full report: ${NASTY}`], 'the old detail stays');
  run(['add', 'Demo', 'Pick a font'], c);
  run(['mark', 'Demo', '1001', 'needs'], c);
  run(['answer', 'Demo', '1001', 'b: the serif one'], c);
  run(['title', 'Demo', '1001', 'Pick the heading font'], c);
  const t3 = item(c, 1001);
  assert.equal(t3.mark, '~'); assert.equal(t3.text, 'Pick the heading font'); assert.deepEqual(t3.details, ['Answer: b: the serif one']);
  assert.match(run(['show', 'Demo', '1'], c), /^- \[x\] #1 Research hosting/);
  run(['mark', 'Demo', '1000', 'working', '--who', 'lead-Other'], c);
  assert.equal(item(c, 1000).who, 'lead-Other'); assert.equal(item(c, 1000).forOwner, true, 'for owner stays');
});

test('deck tags, keys, versions and refusals', () => {
  const c = fresh();
  run(['tag', 'Demo', '1', 'Research'], c); run(['tag', 'Demo', '1', 'Video'], c); run(['tag', 'Demo', '1', 'research', '--off'], c);
  assert.deepEqual(itemTags(item(c, 1)), ['Video']);
  run(['set', 'Demo', '1', 'priority', '2'], c); run(['set', 'Demo', '1', 'Version', '0.5'], c);
  run(['version', 'Demo', '0.5', 'current'], c);
  assert.match(board(c), /^# Demo tasks\n> Version 0\.5: current\n/);
  assert.ok(item(c, 1).details.includes('Priority: 2'));
  assert.throws(() => run(['mark', 'Demo', '9', 'done'], c), /no #9/);
  assert.throws(() => run(['mark', 'Demo', '1', 'finished'], c), /not a mark/);
  assert.throws(() => run(['detail', 'Demo', '1', 'bad\u0008path'], c), /control character/);
  assert.throws(() => run(['add', '../x', 'y'], c), /not a board name/);
  assert.throws(() => run(['frob'], c), /unknown verb/);
});

test('deck Me items: due, repeat, someday, and a repeating one rolls instead of closing', () => {
  const c = fresh();
  run(['add', 'Me', 'Back up the phone', '--due', '2026-10-08 09:00', '--repeat', 'every 1 week'], c);
  let t = item(c, 1000, 'Me');
  assert.equal(dueOf(t).day, '2026-10-08'); assert.equal(repeatOf(t).unit, 'week');
  assert.equal(run(['mark', 'Me', '1000', 'done'], c), 'Me #1000 repeats: moved to its next date');
  t = item(c, 1000, 'Me');
  assert.equal(t.mark, ' '); assert.equal(dueOf(t).day, '2026-10-15');
  run(['add', 'Me', 'Learn Godot'], c); run(['someday', 'Me', '1001', 'on'], c);
  assert.equal(isSomeday(item(c, 1001, 'Me')), true);
  run(['due', 'Me', '1001', '2026-10-20'], c); run(['due', 'Me', '1001', '-'], c);
  assert.equal(dueOf(item(c, 1001, 'Me')), null);
});

test('a for-owner item made from a report reads on its own: What and To do lines (#236)', () => {
  const c = fresh();
  const said = run(['add', 'Demo', 'Check the form success messages', '--who', 'lead-Demo', '--owner',
    '--detail', 'What: the contact and quote forms on the rebuilt site show the plugin\'s default thank-you text',
    '--detail', 'To do: send each form once on staging and say whether the text is fine', '--detail', NASTY], c);
  assert.equal(said, 'Demo #1000 added');
  assert.deepEqual(item(c, 1000).details.map(d => d.split(':')[0]), ['What', 'To do', 'D']);
  assert.equal(run(['add', 'Demo', 'A plain task'], c), 'Demo #1001 added', 'only for-owner items get the reminder');
});

test('deck move copies an item to another board and closes it where it was', () => {
  const c = fresh();
  run(['add', 'Demo', 'Read the hosting report', '--owner', '--detail', NASTY], c);
  assert.equal(run(['move', 'Demo', '1000', 'Me'], c), 'Demo #1000 moved to Me #1001');
  const me = item(c, 1001, 'Me'), old = item(c, 1000);
  assert.equal(me.who, 'user'); assert.deepEqual(me.details, [NASTY, 'From: Demo #1000']);
  assert.equal(old.mark, 'x'); assert.equal(old.result, 'moved to Me #1001');
  assert.throws(() => run(['move', 'Demo', '1000', 'Me'], c), /closed already/);
});

test('deck notes go to the project card notes or to Me notes', () => {
  const c = fresh();
  run(['note', 'Demo', '#1 CTO: passed to lead-Demo as ANSWER #1'], c);
  run(['note', 'Me', 'Call the bank'], c);
  assert.match(fs.readFileSync(path.join(c.data, 'notes', 'Demo.md'), 'utf8'), /^# Demo notes\n- 2026-10-07 16:05 #1 CTO: passed to lead-Demo as ANSWER #1\n$/);
  assert.match(fs.readFileSync(path.join(c.data, 'notes.md'), 'utf8'), /- 2026-10-07 16:05 Call the bank/);
});

test('a board keeps its CRLF line endings and byte-order mark', () => {
  const c = fresh(), f = path.join(c.data, 'tasks', 'Win.md');
  fs.writeFileSync(f, '\uFEFF# Win tasks\r\n- [ ] #1 One (2026-10-01, user)\r\n');
  run(['detail', 'Win', '1', NASTY], c);
  assert.equal(fs.readFileSync(f, 'utf8'), `\uFEFF# Win tasks\r\n- [ ] #1 One (2026-10-01, user)\r\n  > ${NASTY}\r\n`);
});

test('a Windows path goes through the real command as a process argument byte for byte', () => {
  const c = fresh();
  execFileSync(process.execPath, [DECK, '--data', c.data, 'detail', 'Demo', '1', NASTY]);
  assert.equal(item(c, 1).details.at(-1), NASTY);
  assert.throws(() => execFileSync(process.execPath, [DECK, '--data', c.data, 'mark', 'Demo', '7', 'done'], { stdio: 'pipe' }), /no #7/);
});

test('eight writers adding at once lose nothing and repeat no number', async () => {
  const c = fresh(), procs = 8, each = 15;
  await Promise.all(Array.from({ length: procs }, (_, p) => new Promise((resolve, reject) => {
    const script = `import { run } from ${JSON.stringify(new URL('./deckcli.js', import.meta.url).href)};
      for (let i = 0; i < ${each}; i++) run(['add', 'Demo', 'writer ${p} item ' + i, '--detail', ${JSON.stringify(NASTY)}], { data: ${JSON.stringify(c.data)}, lock: ${JSON.stringify(c.lock)} });`;
    execFile(process.execPath, ['--input-type=module', '-e', script], err => (err ? reject(err) : resolve()));
  })));
  const ts = parseTasks(board(c));
  assert.equal(ts.length, 1 + procs * each);
  assert.deepEqual(ts.map(t => t.n), [1, ...Array.from({ length: procs * each }, (_, i) => 1000 + i)]);
  assert.ok(ts.slice(1).every(t => t.details[0] === NASTY));
  assert.equal(fs.existsSync(c.lock), false, 'the lock is released');
});

test('deck backup commits only the board files, once per change', () => {
  const c = fresh();
  const git = args => execFileSync('git', ['-C', c.data, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '-q']); git(['config', 'user.email', 't@example.com']); git(['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(c.data, 'code.js'), 'x');
  git(['add', 'code.js']);
  run(['note', 'Me', 'first'], c);
  assert.equal(run(['backup'], { ...c, git }), 'backup: 2 files committed, not pushed: pushing is off');
  assert.equal(git(['show', '--name-only', '--format=%s', 'HEAD']).trim().split('\n').filter(Boolean).sort().join('|'), 'chore: board backup 2026-10-07 16:05|notes.md|tasks/Demo.md');
  assert.match(git(['status', '--short']), /^A {2}code\.js/m, 'a staged code file stays staged, not committed');
  assert.equal(run(['backup'], { ...c, git }), 'backup: no board changes');
  run(['note', 'Me', 'second'], c);
  assert.equal(run(['backup', '--push'], { ...c, git }), 'backup: 1 files committed, not pushed: no remote', 'with --push it pushes when there is a remote');
  assert.match(run(['backup'], { data: fs.mkdtempSync(path.join(os.tmpdir(), 'nogit-')), git }), /not a git repository/);
});

test('a stale lock from a writer that died is taken over', () => {
  const c = fresh();
  fs.mkdirSync(path.dirname(c.lock), { recursive: true });
  fs.writeFileSync(c.lock, `999999 ${Date.now()}`);
  assert.equal(run(['add', 'Demo', 'After a crash'], c), 'Demo #1000 added');
  fs.writeFileSync(c.lock, `${process.pid} ${Date.now() - 60000}`);
  update(c.lock, path.join(c.data, 'tasks', 'Demo.md'), md => md + '- [ ] #3 Three (2026-10-07, user)\n');
  assert.equal(parseTasks(board(c)).length, 3);
});

// ---------- the owner's words (#228) ----------
import { parseRequest, sessionOfLead, ctoLine } from './ownerwords.js';
test('a words request is checked before it can become a card (#228)', () => {
  const now = Date.UTC(2026, 9, 7, 12);
  const ok = parseRequest('a1', JSON.stringify({ project: 'Cliptools', task: 18, words: String.raw`yes, edit C:\Users\me\.claude\skills\iterate\SKILL.md`, why: 'Edit outside its folder?', created: now }), now);
  assert.deepEqual(ok, { id: 'a1', project: 'Cliptools', lead: 'lead-Cliptools', task: 18, words: String.raw`yes, edit C:\Users\me\.claude\skills\iterate\SKILL.md`, why: 'Edit outside its folder?', created: now });
  assert.equal(parseRequest('a', JSON.stringify({ project: 'P', words: 'x', second: true }), now).lead, 'lead-P-2');
  assert.match(parseRequest('a', JSON.stringify({ project: 'P', words: 'one\ntwo' }), now).error, /line break/);
  assert.match(parseRequest('a', JSON.stringify({ project: 'P', words: 'esc\u001b[2J' }), now).error, /control/);
  assert.match(parseRequest('a', JSON.stringify({ project: 'P', words: 'x'.repeat(501) }), now).error, /longer than 500/);
  assert.equal(parseRequest('a', JSON.stringify({ project: 'P', words: 'x'.repeat(500) }), now).words.length, 500);
  assert.match(parseRequest('a', JSON.stringify({ project: 'P', words: 'x', created: now - 25 * 3600000 }), now).error, /24 hours/);
  assert.match(parseRequest('a', JSON.stringify({ project: '../P', words: 'x' }), now).error, /no project/);
  assert.match(parseRequest('a', 'not json', now).error, /not JSON/);
  assert.equal(parseRequest('a', '\uFEFF' + JSON.stringify({ project: 'P', words: 'x' }), now).words, 'x', 'PowerShell writes a byte-order mark');
  assert.equal(sessionOfLead('P', 'lead-P'), 'P'); assert.equal(sessionOfLead('P', 'lead-P-2'), 'P:2');
  assert.equal(ctoLine(ok, 'typed'), String.raw`WORDS Cliptools #18: the owner approved; typed into lead-Cliptools: "yes, edit C:\Users\me\.claude\skills\iterate\SKILL.md"`);
  assert.equal(ctoLine(ok, 'declined'), 'WORDS Cliptools #18: the owner declined; nothing typed into lead-Cliptools');
});
