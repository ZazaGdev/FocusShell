import { test } from 'node:test';
import assert from 'node:assert/strict';
import './missed.test.js';
import './ctoline.test.js';
import './catchup.test.js';
import './talk.test.js';
import './cardlinks.test.js';
import './tldr.test.js';
import './plugins.test.js';
import './counter.test.js';
import '../plugins/recorder/lib/choices.test.js';
import '../plugins/recorder/lib/recorder.test.js';
import '../plugins/recorder/lib/review.test.js';
import '../plugins/recorder/lib/brainstorm.test.js';
import '../plugins/recorder/lib/cleanup.test.js';
import { parseTasks, nextNumber, addTaskLine, projectState, optionsOf, parseNotes, addNoteLine } from './tasks.js';
import { LAYOUTS, slotCount, autoLayout, splitWith } from './layouts.js';
import { parseProjects, trustedPaths, isTrusted, mergeProjects, projectForPath, paneColour, withProjectModel } from './projects.js';
import { findLinks, dropText, stretchCandidates, findBareNames, folderHints, continuesRow, joinRows, crossedCuts, joinReadings, spacedReadings, wrappedUrl, opensInExplorer, textParts } from './links.js';
import { serveWebArgs, servePort, codeUrl, isCodeUrl, orphanServers, withTrusted } from './codeweb.js';
import { uriPath, liveExtensions, extensionPlan, serverManifest, pageFiles, pageSyncScript, syncServer, machineSettings, themeBase } from './codesync.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { leadArgs, managerArgs, pmArgs, withModel, cleanEnv, renderLeadPrompt, renderGroupPrompt, secondId, secondOf, secondLeadNote, submits, working, owns, sessionName, requestModel, demoArgs, withoutRemote, ownSetupSettings, withSettings, DEMO_NOTE, keepShell, shellTitle, CLAUDE_ENDED, nameProblem, commandLine, spawnArgs } from './sessions.js';

const md = [
  '# Streaky tasks',
  '- [?] #7 Dark mode (2026-10-01, lead-Streaky) -> Follow system or toggle? | options: system, toggle | suggest: system',
  '- [ ] #8 Streak freeze purchase flow (2026-10-01, user)',
  '- [x] #6 Fix midnight rollover bug (2026-09-30, lead-Streaky) -> tests pass, 9be01d4',
  'stray text',
].join('\n');

test('parseTasks reads mark, number, text, date, who, result', () => {
  const t = parseTasks(md);
  assert.equal(t.length, 3);
  assert.deepEqual([t[0].mark, t[0].n, t[0].text, t[0].date, t[0].who], ['?', 7, 'Dark mode', '2026-10-01', 'lead-Streaky']);
  assert.match(t[0].result, /^Follow system/);
  assert.equal(t[1].mark, ' ');
  assert.equal(t[1].result, '');
});

test('parseTasks tolerates lines without date or result', () => {
  const t = parseTasks('- [~] #3 Run pain mining\n- [ ] #4 Re-test -> later');
  assert.deepEqual(t.map(x => [x.n, x.text, x.who, x.result]), [[3, 'Run pain mining', '', ''], [4, 'Re-test', '', 'later']]);
});

test('nextNumber is one more than the highest', () => {
  assert.equal(nextNumber(md), 9);
  assert.equal(nextNumber('# Empty tasks'), 1);
});

test('parseTasks reads ", for owner" in the who part as a task for the owner', () => {
  const [a, b] = parseTasks('- [ ] #5 Check the taskbar logo (2026-10-02, lead-FocusShell, for owner) -> after #12\n- [ ] #6 Plain (2026-10-02, user)');
  assert.equal(a.who, 'lead-FocusShell'); assert.equal(a.forOwner, true); assert.equal(a.result, 'after #12');
  assert.equal(b.who, 'user'); assert.equal(b.forOwner, false);
});

test('addTaskLine appends an open task with the next number', () => {
  const out = addTaskLine(md, 'Add widgets', 'user', '2026-10-02');
  assert.ok(out.endsWith('- [ ] #9 Add widgets (2026-10-02, user)\n'));
  assert.ok(addTaskLine('# X tasks', 'a', 'user', '2026-10-02').startsWith('# X tasks\n- [ ] #1 a'));
});

test('projectState ranks needs > blocked > working > idle', () => {
  assert.equal(projectState(parseTasks(md)), 'needs');
  assert.equal(projectState(parseTasks('- [!] #1 a\n- [~] #2 b')), 'blocked');
  assert.equal(projectState(parseTasks('- [~] #2 b\n- [x] #1 a')), 'working');
  assert.equal(projectState(parseTasks('- [x] #1 a')), 'idle');
});

test('optionsOf reads options and suggestion', () => {
  const t = parseTasks(md)[0];
  assert.deepEqual(optionsOf(t), { options: ['system', 'toggle'], suggest: 'system' });
  assert.deepEqual(optionsOf(parseTasks(md)[1]), { options: [], suggest: '' });
});

test('notes parse and append', () => {
  const n = parseNotes('# Notes\n- 2026-10-01 14:02 Check price\n- bad');
  assert.deepEqual(n, [{ when: '2026-10-01 14:02', text: 'Check price' }]);
  assert.ok(addNoteLine('', 'Hello', '2026-10-01 15:00').endsWith('- 2026-10-01 15:00 Hello\n'));
});

test('layouts: slot counts and auto choice', () => {
  assert.equal(slotCount(LAYOUTS['m-2x2'].tree), 4);
  assert.equal(slotCount(LAYOUTS['m-1'].tree), 1);
  assert.equal(autoLayout(3), 'm-3r');
  assert.equal(autoLayout(4), 'm-2x2');
  assert.equal(autoLayout(5), 'm-3x2');
  assert.equal(autoLayout(7), 'm-3x2');
  assert.equal(slotCount(LAYOUTS['m-3x2'].tree), 6);
  assert.equal(slotCount(LAYOUTS['3x2-m'].tree), 6);
  assert.equal(autoLayout(2), 'm-2r');
  assert.ok(Object.values(LAYOUTS).every(L => L.mgr), 'every layout has the CTO pane');
});

test('a project keeps its Claude model in its projects.json entry (#1115)', () => {
  const p = { name: 'Habitly', path: 'D:\\P\\Habitly' };
  const added = withProjectModel([{ name: 'X', path: 'D:\\P\\X', test: 'npm t' }], p, 'opus');
  assert.deepEqual(added[1], { name: 'Habitly', path: 'D:\\P\\Habitly', test: '', model: 'opus' }, 'a folder from a projects folder gets an entry');
  const changed = withProjectModel(added, { ...p, path: 'd:/p/habitly' }, 'haiku');
  assert.equal(changed[1].model, 'haiku');
  assert.equal('model' in withProjectModel(changed, p, '')[1], false, 'Default takes it off');
  assert.equal(withProjectModel(changed, p, 'gpt'), changed, 'an unknown model changes nothing');
  assert.deepEqual(withProjectModel([], p, ''), [], 'Default for a folder with no entry adds none');
  const merged = mergeProjects([{ name: 'Habitly', path: 'D:\\P\\Habitly', model: 'sonnet' }, { name: 'Odd', path: 'D:\\P\\Odd', model: 'gpt-9' }], [{ name: 'Habitly', path: 'D:\\P\\Habitly' }], 'D:\\deck');
  assert.deepEqual(merged.map(m => [m.name, m.model]), [['Habitly', 'sonnet'], ['Odd', '']]);
});

test('projects.json parses with a BOM', () => {
  const p = parseProjects('\uFEFF{"projects":[{"name":"A","path":"G:\\\\a","test":""}],"lastSelected":[]}');
  assert.equal(p.projects[0].name, 'A');
});

test('trusted paths survive keys that differ only by case', () => {
  const j = '{"projects":{"g:/SideProjects/A":{"hasTrustDialogAccepted":true},"G:/SideProjects/A":{"x":1},"G:/SideProjects/B":{}}}';
  const t = trustedPaths(j);
  assert.ok(isTrusted('G:\\SideProjects\\A', t));
  assert.ok(!isTrusted('G:\\SideProjects\\B', t));
  assert.ok(!isTrusted('G:\\SideProjects\\C', t));
});

test('session arguments match v1, plus Remote Control under the session name', () => {
  assert.deepEqual(leadArgs('Streaky', 'G:\\d\\p.md'),
    ['/c', 'claude', '-n', 'lead-Streaky', '--remote-control', 'lead-Streaky', '--permission-mode', 'auto', '--append-system-prompt-file', 'G:\\d\\p.md']);
  assert.deepEqual(managerArgs(), ['/c', 'claude', '-n', 'cto', '--remote-control', 'cto', '--permission-mode', 'auto']);
  assert.deepEqual(pmArgs(), ['/c', 'claude', '-n', 'pm', '--remote-control', 'pm', '--permission-mode', 'auto']);
  assert.deepEqual(managerArgs('cto-Mobile', 'p.md').slice(2), ['-n', 'cto-Mobile', '--remote-control', 'cto-Mobile', '--permission-mode', 'auto', '--append-system-prompt-file', 'p.md']);
});

test('withModel adds --model for a known alias only', () => {
  assert.deepEqual(withModel(pmArgs(), 'sonnet').slice(-2), ['--model', 'sonnet']);
  assert.deepEqual(withModel(pmArgs(), ''), pmArgs());
  assert.deepEqual(withModel(pmArgs(), 'x --dangerous'), pmArgs());
});

test('leadArgs can resume a past session, and ignores anything that is not a session id', () => {
  const id = 'c8a369b3-0786-4d15-8d67-fbae24b95693';
  assert.deepEqual(leadArgs('A', 'p.md', id).slice(-2), ['--resume', id]);
  assert.equal(leadArgs('A', 'p.md', '--dangerous').includes('--resume'), false);
});

test('a session counts as used once something is submitted to it or it starts working', () => {
  assert.equal(submits('fix the login\r'), true);
  assert.equal(submits('\x1b[I'), false, 'focus report from the terminal');
  assert.equal(submits('\x1b[200~"D:\\a b.txt"\x1b[201~'), false, 'dropped path, not sent');
  assert.equal(submits(' '), false, 'push-to-talk key');
  assert.equal(working('\x1b[2K\x1b[38;5;174m* Thinking\x1b[39m (12s \x1b[1m·\x1b[22m esc to interrupt)'), true);
  assert.equal(working('esc\x1b[1Cto\x1b[1Cinterrupt'), true, 'spaces drawn as cursor moves');
  assert.equal(working('> Try "fix lint errors"\r\n? for shortcuts'), false);
});

test('a closed session no longer speaks for a pane reopened under its id (#197)', () => {
  const sessions = new Map(), old = { alive: true }, fresh = { alive: true };
  sessions.set('Blogger', old);
  assert.equal(owns(sessions, 'Blogger', old), true);
  sessions.delete('Blogger'); // close-pane
  assert.equal(owns(sessions, 'Blogger', old), false, 'late exit of a closed pane');
  sessions.set('Blogger', fresh); // open-pane
  assert.equal(owns(sessions, 'Blogger', old), false, 'late exit after the reopen');
  assert.equal(owns(sessions, 'Blogger', fresh), true);
});

test('Restart resumes the conversation the pane last ran (#197)', () => {
  const id = 'fb5bcd84-76e6-4e35-8628-01a5e6addba4';
  assert.deepEqual(managerArgs('cto', undefined, id).slice(-2), ['--resume', id]);
  assert.deepEqual(managerArgs('cto-Mobile', 'p.md', id).slice(-4), ['--append-system-prompt-file', 'p.md', '--resume', id]);
  assert.deepEqual(pmArgs(id).slice(-2), ['--resume', id]);
  assert.ok(!managerArgs().includes('--resume'));
  assert.equal(sessionName('Blogger'), 'lead-Blogger');
  assert.equal(sessionName('Blogger:2'), 'lead-Blogger-2');
  assert.equal(sessionName('cto-Mobile'), 'cto-Mobile');
  assert.equal(sessionName('pm'), 'pm');
  const title = n => `{"type":"custom-title","customTitle":"${n}","sessionId":"x"}`;
  const files = [
    { id: 'old', mtime: 1, text: title('lead-Blogger') },
    { id: 'other', mtime: 3, text: title('lead-Blogger-2') },
    { id: 'mine', mtime: 2, text: title('lead-Blogger') },
  ];
  assert.equal(lastConversation(files, 'lead-Blogger'), 'mine');
  assert.equal(lastConversation(files, 'lead-Streaky'), null);
});

test('cleanEnv drops inherited Claude session variables', () => {
  const e = cleanEnv({ PATH: 'x', CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_PID: '3' });
  assert.deepEqual(e, { PATH: 'x' });
});

test('renderLeadPrompt fills tokens with a test fallback', () => {
  assert.equal(renderLeadPrompt('{{PROJECT}}|{{TASKFILE}}|{{TEST}}', 'A', 'f', 'npm test'), 'A|f|npm test');
  assert.match(renderLeadPrompt('{{TEST}}', 'A', 'f', ''), /usual test command/);
  assert.equal(renderLeadPrompt('{{MANAGER}}', 'A', 'f', ''), 'cto');
  assert.equal(renderLeadPrompt('node {{DECKCMD}} help', 'A', 'f', '', 'cto', 'D:\\Deck\\deck.mjs'), "node 'D:\\Deck\\deck.mjs' help", 'the deck command, quoted (#225)');
  assert.equal(renderLeadPrompt('{{MANAGER}} {{MANAGER}}', 'A', 'f', '', 'cto-Mobile'), 'cto-Mobile cto-Mobile');
  assert.equal(renderGroupPrompt('{{MANAGER}}|{{GROUP}}|{{GROUPSFILE}}', 'Mobile', 'g.json'), 'cto-Mobile|Mobile|g.json');
});

test('mergeProjects lists every folder, keeps settings by path, skips only the manager folder', () => {
  const explicit = [
    { name: 'Budgetly', path: 'G:/S/BudgetlyV2', test: 'npm test' },
    { name: 'Far', path: 'D:/elsewhere/Far', test: '' },
  ];
  const folders = [
    { name: 'Budgetly', path: 'G:/S/Budgetly' },
    { name: 'BudgetlyV2', path: 'G:/S/BudgetlyV2' },
    { name: 'Aardvark', path: 'G:/S/Aardvark' },
    { name: 'alpha', path: 'G:/S/alpha' },
  ];
  const m = mergeProjects(explicit, folders, 'G:/S/Aardvark/manager');
  assert.deepEqual(m.map(p => p.name), ['Aardvark', 'alpha', 'Budgetly', 'BudgetlyV2', 'Far']);
  assert.equal(m.find(p => p.name === 'BudgetlyV2').test, 'npm test');
  assert.equal(m.find(p => p.name === 'Budgetly').test, '');
  assert.equal(mergeProjects([], [{ name: 'manager', path: 'G:/S/FocusShell/manager' }], 'G:/S/FocusShell/manager').length, 0);
});

test('mergeProjects lists a folder once when two paths reach the same real folder', () => {
  const explicit = [{ name: 'Coins', path: 'G:\\S\\Coins', test: 'npm test' }];
  const folders = [{ name: 'Coins', path: 'D:\\S\\Coins' }, { name: 'Streaky', path: 'D:\\S\\Streaky' }];
  const real = p => p.replace(/^G:/i, 'D:');
  const m = mergeProjects(explicit, folders, 'D:\\S\\FocusShell\\manager', real);
  assert.deepEqual(m.map(p => p.name), ['Coins', 'Streaky']);
  assert.equal(m[0].test, 'npm test');
});

test('mergeProjects keeps a projects.json entry outside the scan root, once', () => {
  const explicit = [{ name: 'Cliptools', path: 'D:\\Claude Setup', test: '' }];
  const alone = mergeProjects(explicit, [{ name: 'Streaky', path: 'D:\\S\\Streaky' }], 'D:\\S\\FocusShell\\manager');
  assert.deepEqual(alone.map(p => [p.name, p.path]), [['Cliptools', 'D:\\Claude Setup'], ['Streaky', 'D:\\S\\Streaky']]);
  const real = p => p.replace('D:\\S\\Cliptools', 'D:\\Claude Setup');
  const linked = mergeProjects(explicit, [{ name: 'Cliptools', path: 'D:\\S\\Cliptools' }], 'D:\\S\\FocusShell\\manager', real);
  assert.equal(linked.length, 1);
});

test('splitWith adds opened projects after the shown ones and keeps the six most recent', () => {
  assert.deepEqual(splitWith(['A'], ['B', 'C']), ['A', 'B', 'C']);
  assert.deepEqual(splitWith(['A', 'B'], ['A', 'C', 'C']), ['B', 'A', 'C']);
  assert.deepEqual(splitWith(['A', 'B', 'C', 'D', 'E'], ['F', 'G']), ['B', 'C', 'D', 'E', 'F', 'G']);
});

test('dropText joins dropped paths with spaces and quotes paths that contain one', () => {
  assert.equal(dropText([String.raw`G:\S\a.txt`, String.raw`G:\My Files\b`, '']), String.raw`G:\S\a.txt "G:\My Files\b"`);
});

test('findLinks picks out Windows paths and web links, without trailing punctuation', () => {
  const s = String.raw`APK at G:\SideProjects\Workout\android\app\build\outputs\apk\release\app-release.apk. See https://example.com/x). Also G:/SideProjects/Streaky, done.`;
  assert.deepEqual(findLinks(s).map(l => l.text), [
    String.raw`G:\SideProjects\Workout\android\app\build\outputs\apk\release\app-release.apk`,
    'https://example.com/x',
    'G:/SideProjects/Streaky',
  ]);
  assert.equal(findLinks('no paths here: 1:2, a:b').length, 0);
});

test('continuesRow joins a row Claude Code broke mid-path, at the same text indent', () => {
  const a = String.raw`  G:\SideProjects\Workout\android\app\build\outputs\apk\releas   `;
  assert.ok(continuesRow(a, String.raw`  e\app-release.apk`));
  assert.ok(continuesRow(String.raw`● Built G:\Side\apk\releas`, String.raw`  e\app-release.apk`));
  assert.ok(!continuesRow(a, String.raw`    e\app-release.apk`), 'deeper indent');
  assert.ok(!continuesRow(a, ''), 'blank row');
  assert.ok(!continuesRow('  ends with a space ', ' x'));
});

test('joinRows maps every character back to its cell and marks the joins', () => {
  const { text, pos, cuts } = joinRows([
    { y: 3, rows: [String.raw`  G:\a\releas    `] },
    { y: 4, rows: [String.raw`  e\app.apk      `] },
  ]);
  assert.equal(text.trimEnd(), String.raw`  G:\a\release\app.apk`);
  assert.deepEqual(cuts, [13]);
  assert.deepEqual(pos[2], { x: 3, y: 3 });
  assert.deepEqual(pos[13], { x: 3, y: 4 });
  const l = findLinks(text)[0];
  assert.equal(l.text, String.raw`G:\a\release\app.apk`);
  assert.deepEqual(crossedCuts(l, cuts), [13]);
  assert.deepEqual(pos[l.index + l.text.length - 1], { x: 11, y: 4 });
});

test('a web link across rows counts only when the row it leaves was full', () => {
  const full = joinRows([{ y: 1, rows: ['  see https://example.com/a/very/long/pa'] }, { y: 2, rows: ['  th/x'] }]);
  const l = findLinks(full.text)[0];
  assert.equal(l.text, 'https://example.com/a/very/long/path/x');
  assert.equal(wrappedUrl(l, full.cuts, full.pos, 42).text, l.text);
  const short = joinRows([{ y: 1, rows: ['  see https://x.com/a'] }, { y: 2, rows: ['  and more'] }]);
  assert.equal(wrappedUrl(findLinks(short.text)[0], short.cuts, short.pos, 80), null);
  // Full row, then a short row, then the next line: the link stops at the short row's end.
  const three = joinRows([{ y: 1, rows: ['  see https://example.com/a/very/long/pa'] }, { y: 2, rows: ['  th/x'] }, { y: 3, rows: ['  next'] }]);
  assert.equal(wrappedUrl(findLinks(three.text)[0], three.cuts, three.pos, 42).text, 'https://example.com/a/very/long/path/x');
  // #1002: the row ends at the URL's real end near the edge, and the next row is prose.
  const url = 'http://localhost:8731/tmp/caching-short/linkedin-review-draft.mp4';
  const prose = joinRows([{ y: 1, rows: ['  ' + url] }, { y: 2, rows: ["  I'd export."] }]);
  assert.equal(wrappedUrl(findLinks(prose.text)[0], prose.cuts, prose.pos, url.length + 2, 8, prose.text), null);
  const cap = joinRows([{ y: 1, rows: ['  ' + url] }, { y: 2, rows: ['  Next: watch it'] }]);
  assert.equal(wrappedUrl(findLinks(cap.text)[0], cap.cuts, cap.pos, url.length + 2, 8, cap.text), null);
  // A long URL that truly wraps mid-way still links whole, even when the rest starts in capitals.
  const mid = joinRows([{ y: 1, rows: ['  see https://example.com/a/very/long/pa'] }, { y: 2, rows: ['  th/Report-2026.mp4'] }]);
  assert.equal(wrappedUrl(findLinks(mid.text)[0], mid.cuts, mid.pos, 42, 8, mid.text).text, 'https://example.com/a/very/long/path/Report-2026.mp4');
});

test('opensInExplorer picks binary files by extension, not text files', () => {
  assert.ok(opensInExplorer(String.raw`G:\S\android\app\build\outputs\apk\release\app-release.apk`));
  assert.ok(opensInExplorer('D:/x/Setup.EXE') && opensInExplorer('a.png') && opensInExplorer('b.pdf'));
  assert.ok(opensInExplorer(String.raw`D:\Videos\intro-rough-2.editbay`), 'a video editor project (#317)');
  assert.ok(opensInExplorer(String.raw`D:\SideProjects\Papers\output\sprite-pipeline\report.html`) && opensInExplorer('a.HTM'), 'a web page (#318)');
  assert.ok(!opensInExplorer('README.md') && !opensInExplorer('main.js') && !opensInExplorer('D:\\x\\apk'));
});

test('joinReadings offers a joined path cut short at each later join, then whole', () => {
  const { text, cuts } = joinRows([{ y: 1, rows: [String.raw`  D:\Side`] }, { y: 2, rows: [String.raw`  \Proj`] }, { y: 3, rows: ['  see'] }]);
  assert.deepEqual(joinReadings(findLinks(text)[0], cuts), [String.raw`D:\Side\Proj`, String.raw`D:\Side\Projsee`]);
});

import { touchRecent, recentList, lastSession } from './presets.js';

test('recent: newest first, limited, skips projects that no longer exist', () => {
  let r = {};
  r = touchRecent(r, 'A', 1); r = touchRecent(r, 'B', 3); r = touchRecent(r, 'C', 2); r = touchRecent(r, 'A', 4);
  assert.deepEqual(recentList(r, 2), ['A', 'B']);
  assert.deepEqual(recentList(r, 5, n => n !== 'B'), ['A', 'C']);
});

test('lastSession only when the previous run had project tabs', () => {
  assert.equal(lastSession(null), null);
  assert.equal(lastSession({ openTabs: [] }), null);
  assert.deepEqual(lastSession({ openTabs: ['A', 'B'], layoutId: 'm-2r', pinMgr: true }).projects, ['A', 'B']);
});

import { setMark, doneOf, historyLabel, itemTags, hasTag, toggleTag } from './tasks.js';
import { encodeProjectDir, summarizeSession, lastConversation } from './history.js';

test('setMark changes only the numbered task', () => {
  const md = '# A tasks\n- [ ] #1 one (2026-10-01, user)\n- [~] #12 twelve (2026-10-01, lead-A)\n';
  assert.equal(setMark(md, 12, 'x'), '# A tasks\n- [ ] #1 one (2026-10-01, user)\n- [x] #12 twelve (2026-10-01, lead-A)\n');
  assert.equal(setMark(md, 1, 'x').includes('- [x] #1 one'), true);
  assert.equal(setMark(md, 2, 'x'), md);
  assert.equal(setMark(md, 1, 'z'), md);
});

test('setMark writes the closed date under an item marked done, and drops it on reopen (#219)', () => {
  const md = '# A tasks\n- [ ] #1 one (2026-10-01, user)\n  > Priority: 1\n- [ ] #2 two (2026-10-02, user)\n';
  const done = setMark(md, 1, 'x', '2026-10-07 14:05');
  assert.equal(done, '# A tasks\n- [x] #1 one (2026-10-01, user)\n  > Priority: 1\n  > Done: 2026-10-07 14:05\n- [ ] #2 two (2026-10-02, user)\n');
  assert.equal(setMark(done, 1, 'x', '2026-10-08 09:00'), done, 'already done: the first closed date stays');
  assert.equal(setMark(done, 1, ' ', '2026-10-08 09:00'), md);
  const t = parseTasks(done)[0];
  assert.equal(doneOf(t), '2026-10-07 14:05');
  assert.equal(historyLabel(t, new Date(2026, 9, 7)), 'added 1 Oct · done 7 Oct');
  assert.equal(historyLabel(parseTasks(md)[1], new Date(2027, 0, 1)), 'added 2 Oct 2026');
  const old = parseTasks('- [x] #3 old (2026-10-01, user)')[0];
  assert.equal(historyLabel(old, new Date(2026, 9, 7)), 'added 1 Oct');
});

test('withTrusted adds the missing project folders to VS Code trust for this port only (#226)', () => {
  const byHand = JSON.stringify({ uriTrustInfo: [{ uri: { scheme: 'vscode-remote', authority: '127.0.0.1:47123', path: '/d:/BX/project' }, trusted: true },
    { uri: { scheme: 'vscode-remote', authority: '127.0.0.1:50791', path: '/d:/SideProjects/A' }, trusted: true }] });
  const next = JSON.parse(withTrusted(byHand, 47123, ['D:\\SideProjects\\A', 'd:\\sideprojects\\a\\', 'D:\\BX\\project']));
  assert.equal(next.uriTrustInfo.length, 3, 'kept both, added A once; BX was already there');
  assert.deepEqual(next.uriTrustInfo[2], { uri: { $mid: 1, scheme: 'vscode-remote', authority: '127.0.0.1:47123', path: '/d:/SideProjects/A' }, trusted: true });
  assert.equal(withTrusted(JSON.stringify(next), 47123, ['D:\\SideProjects\\A']), null, 'nothing missing');
  assert.equal(JSON.parse(withTrusted('', 47123, ['G:\\X'])).uriTrustInfo[0].uri.path, '/g:/X');
});

test('item tags read, match any case and toggle on the Tags line (#224)', () => {
  const t = parseTasks('- [ ] #1 Read the report (2026-10-07, user)\n  > D:\\r\\report.md\n  > Tags: Research, video')[0];
  assert.deepEqual(itemTags(t), ['Research', 'video']);
  assert.equal(hasTag(t, 'research'), true);
  assert.equal(hasTag(t, 'Bug'), false);
  assert.equal(toggleTag(t, 'Bug'), 'Research, video, Bug');
  assert.equal(toggleTag(t, 'RESEARCH'), 'video');
  assert.equal(toggleTag(parseTasks('- [ ] #2 x (2026-10-07, user)\n  > Tags: Research')[0], 'Research'), null);
  assert.deepEqual(itemTags(parseTasks('- [ ] #3 x (2026-10-07, user)')[0]), []);
});

test('Settings keeps a clean tag list, Research by default (#224)', () => {
  assert.deepEqual(normalizeSettings({}).tags, ['Research']);
  assert.deepEqual(normalizeSettings({ tags: [' Bug ', 'bug', 'a,b', '', 7] }).tags, ['Bug', 'a b', '7']);
  assert.deepEqual(normalizeSettings({ tags: [] }).tags, []);
});

test('Me Done lists the latest closed first, then undated ones by number (#219)', () => {
  const md = ['- [x] #29 a (2026-10-06, user)', '- [x] #18 b (2026-10-04, user)', '  > Done: 2026-10-07 13:00',
    '- [x] #5 c (2026-10-01, user)', '  > Done: 2026-10-05 08:00', '- [x] #28 d (2026-10-06, user)'].join('\n');
  assert.deepEqual(groupMe(parseTasks(md), new Date(2026, 9, 7)).done.map(t => t.n), [18, 5, 29, 28]);
});

test('encodeProjectDir matches Claude Code folder names', () => {
  assert.equal(encodeProjectDir(String.raw`G:\SideProjects\Papers`), 'G--SideProjects-Papers');
});

test('summarizeSession picks the first typed message and counts turns', () => {
  const lines = [
    JSON.stringify({ type: 'custom-title', customTitle: 'lead-Streaky' }),
    JSON.stringify({ type: 'user', timestamp: '2026-10-01T10:00:00Z', message: { content: 'Another Claude session sent a message: TASK #1' } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-10-01T10:01:00Z', message: { content: [] } }),
    JSON.stringify({ type: 'user', timestamp: '2026-10-01T10:05:00Z', message: { content: [{ type: 'text', text: 'Add dark mode   please' }] } }),
    'not json',
  ];
  const s = summarizeSession(lines, 'abc');
  assert.deepEqual([s.title, s.start, s.end, s.user, s.assistant], ['Add dark mode please', '2026-10-01T10:00:00Z', '2026-10-01T10:05:00Z', 2, 1]);
  assert.equal(summarizeSession([JSON.stringify({ type: 'custom-title', customTitle: 'Login bug hunt' })], 'x').title, 'Login bug hunt');
  assert.equal(summarizeSession([], 'x').title, 'Empty session');
});

import { newAlerts } from './tasks.js';

test('newAlerts fires once when a task starts needing the user', () => {
  const first = newAlerts(null, { A: '- [~] #1 build (2026-10-01, lead-A)' });
  assert.equal(first.alerts.length, 0);
  const second = newAlerts(first.snapshot, { A: '- [?] #1 build (2026-10-01, lead-A) -> which colour?\n- [!] #2 deploy (2026-10-01, lead-A)' });
  assert.deepEqual(second.alerts.map(a => [a.project, a.n, a.mark]), [['A', 1, '?'], ['A', 2, '!']]);
  const third = newAlerts(second.snapshot, { A: '- [?] #1 build (2026-10-01, lead-A) -> which colour?\n- [x] #2 deploy (2026-10-01, lead-A)' });
  assert.equal(third.alerts.length, 0);
});

import { holdAlerts, dueAlerts, seenAlerts, ALERT_DELAY } from './tasks.js';

test('a needs-you alert notifies only if still marked five minutes later', () => {
  const marked = newAlerts(newAlerts(null, { A: '- [~] #1 build' }).snapshot, { A: '- [?] #1 build -> which colour?' });
  let pending = holdAlerts({}, marked.alerts, marked.snapshot, 0);
  assert.equal(dueAlerts(pending, 0).due.length, 0, 'nothing at once');
  assert.equal(dueAlerts(pending, ALERT_DELAY - 1).due.length, 0);
  const later = dueAlerts(pending, ALERT_DELAY);
  assert.deepEqual(later.due.map(a => [a.project, a.n, a.mark]), [['A', 1, '?']]);
  assert.deepEqual(later.pending, {}, 'it notifies once');
  const answered = newAlerts(marked.snapshot, { A: '- [~] #1 build' });
  pending = holdAlerts(pending, answered.alerts, answered.snapshot, 60000);
  assert.equal(dueAlerts(pending, ALERT_DELAY * 2).due.length, 0, 'answered within five minutes: no notification');
  const still = newAlerts(marked.snapshot, { A: '- [?] #1 build -> which colour?\n- [ ] #2 other' });
  pending = holdAlerts(holdAlerts({}, marked.alerts, marked.snapshot, 0), still.alerts, still.snapshot, 60000);
  assert.equal(dueAlerts(pending, ALERT_DELAY).due.length, 1, 'another change to the file keeps the five minutes running');
  const two = { 'A#1': { project: 'A', n: 1, mark: '?', since: 0 }, 'A#2': { project: 'A', n: 2, mark: '!', since: 0 }, 'B#1': { project: 'B', n: 1, mark: '?', since: 0 } };
  assert.deepEqual(Object.keys(seenAlerts(two, 'A', 2)), ['A#1', 'B#1'], 'opening an item drops its alert');
  assert.deepEqual(Object.keys(seenAlerts(two, 'A')), ['B#1'], "opening a project's page drops all of its alerts");
});

import { setTaskText, splitTaskNotes, briefOutcome } from './tasks.js';
import { readmeSummary } from './readme.js';

test('setTaskText rewords one task and keeps everything else', () => {
  const md = '# A tasks\n- [~] #3 fix login (2026-10-01, lead-A) -> half done\n- [ ] #4 other';
  assert.equal(setTaskText(md, 3, '  fix  the login crash '), '# A tasks\n- [~] #3 fix the login crash (2026-10-01, lead-A) -> half done\n- [ ] #4 other');
  assert.equal(setTaskText(md, 4, 'other thing').endsWith('- [ ] #4 other thing'), true);
  assert.equal(setTaskText(md, 9, 'x'), md);
  assert.equal(setTaskText(md, 3, '   '), md);
});

test('splitTaskNotes attaches "#n" notes to their task', () => {
  const r = splitTaskNotes([{ when: 'a', text: '#3 ask about colours' }, { when: 'b', text: 'general thought' }, { when: 'c', text: '#3 done' }]);
  assert.deepEqual(r.byTask['3'].map(n => n.text), ['ask about colours', 'done']);
  assert.deepEqual(r.general.map(n => n.text), ['general thought']);
});

test('briefOutcome counts guesses and joins the task result', () => {
  const brief = 'Guesses:\n- a (decides what gets built: yes)\n- b (decides what gets built: no)';
  assert.deepEqual(briefOutcome(brief, { mark: 'x', result: 'tests pass' }), { mark: 'x', result: 'tests pass', guesses: 2, yes: 1 });
  assert.deepEqual(briefOutcome('no guesses', null), { mark: '', result: '', guesses: 0, yes: 0 });
});

test('readmeSummary skips headings, badges and short lines', () => {
  const md = '# Streaky\n\n[![build](x.svg)](y)\n\nTiny.\n\nStreaky is a habit tracker that keeps your streak alive with **freezes** and [goals](g.md).\n\nMore.';
  assert.equal(readmeSummary(md), 'Streaky is a habit tracker that keeps your streak alive with freezes and goals.');
  assert.equal(readmeSummary(''), '');
  assert.equal(readmeSummary('x'.repeat(700), 100).length, 100);
});

test('summarizeSession names a manager-started session after its task', () => {
  const line = JSON.stringify({ type: 'user', timestamp: '2026-10-01T10:00:00Z', message: { content: 'Another Claude session sent a message:\n<cross-session-message from="x">\nTASK #3:\nYour words: "make the streak green when on track"\n\nGoal: ...' } });
  assert.equal(summarizeSession([line], 'a').title, 'Task #3: make the streak green when on track');
});

import * as G from './groups.js';

test('groups: names are session-safe', () => {
  assert.equal(G.groupName('  Mobile apps! '), 'Mobile-apps');
  assert.equal(G.groupName('--x'), 'x');
  assert.equal(G.groupName('é'), '');
  assert.equal(G.groupName('a'.repeat(50)).length, 30);
});

test('groups: manager ids', () => {
  assert.equal(G.mgrId(null), 'cto');
  assert.equal(G.mgrId('Mobile'), 'cto-Mobile');
  assert.ok(G.isMgr('cto') && G.isMgr('cto-Mobile') && !G.isMgr('Streaky'));
  assert.equal(G.groupOfMgr('cto-Mobile'), 'Mobile');
  assert.equal(G.groupOfMgr('cto'), null);
  assert.equal(G.groupOfMgr('Streaky'), null);
});

test('groups: a project joins one group and moves out of any other', () => {
  let g = G.addToGroup([], 'Mobile', ['Streaky', 'FormCheck']);
  g = G.addToGroup(g, 'Web', ['Budgetly']);
  assert.deepEqual(G.movesInto(g, 'Web', ['Streaky', 'Budgetly', 'New']), [{ project: 'Streaky', from: 'Mobile' }]);
  g = G.addToGroup(g, 'web', ['Streaky']);
  assert.deepEqual(g, [{ name: 'Mobile', projects: ['FormCheck'] }, { name: 'Web', projects: ['Budgetly', 'Streaky'] }]);
  assert.equal(G.groupOf(g, 'Streaky'), 'Web');
  assert.equal(G.managerFor(g, 'Streaky'), 'cto-Web');
  assert.equal(G.managerFor(g, 'Other'), 'cto');
  assert.equal(G.addToGroup(g, '!!', ['X']), g);
  g = G.removeFromGroup(g, 'WEB', 'Budgetly');
  assert.deepEqual(G.findGroup(g, 'Web').projects, ['Streaky']);
  assert.deepEqual(G.deleteGroup(g, 'mobile').map(x => x.name), ['Web']);
});

test('groups: a new group is named after its projects, and renaming keeps them (#1024)', () => {
  const g = [{ name: 'FocusShell-Brewlog', projects: ['X'] }];
  assert.equal(G.suggestName([], ['FocusShell']), 'FocusShell');
  assert.equal(G.suggestName([], ['A', 'B', 'C', 'D']), 'A-B-plus2');
  assert.equal(G.suggestName(g, ['FocusShell', 'Brewlog']), 'FocusShell-Brewlog-2');
  assert.equal(G.suggestName([], []), 'Group');
  assert.deepEqual(G.renameGroup(g, 'focusshell-brewlog', 'Daily work'), [{ name: 'Daily-work', projects: ['X'] }]);
  assert.equal(G.renameGroup(g, 'FocusShell-Brewlog', '!!'), g);
  assert.equal(G.renameGroup([...g, { name: 'Web', projects: [] }], 'Web', 'focusshell-brewlog')[1].name, 'Web');
});

test('groups: a right-click acts on the whole split and every tab in it joins', () => {
  assert.deepEqual(G.tabTargets('split', ['A', 'B', 'C'], 'B'), ['A', 'B', 'C']);
  assert.deepEqual(G.tabTargets('split', ['A', 'B'], 'D'), ['D']);
  assert.deepEqual(G.tabTargets('single', ['A', 'B'], 'A'), ['A']);
  const g = [{ name: 'Mobile', projects: ['A'] }, { name: 'Web', projects: ['A', 'B', 'C'] }];
  assert.deepEqual(G.tabMenu(g, ['A', 'B', 'C']), { add: ['Mobile'], leave: ['Mobile', 'Web'] });
  assert.deepEqual(G.tabMenu(g, ['D']), { add: ['Mobile', 'Web'], leave: [] });
  const joined = G.addToGroup(g, 'Tools', G.tabTargets('split', ['A', 'B', 'C', 'D'], 'C'));
  for (const p of ['A', 'B', 'C', 'D']) assert.equal(G.groupOf(joined, p), 'Tools');
});

test('groups: hand-edited files keep each project in its first group', () => {
  const g = G.normalizeGroups({ groups: [
    { name: 'A', projects: ['X', 'Y', 'X'] }, { name: 'a', projects: ['Z'] }, { name: 'B', projects: ['Y', 'Z', 3] }, null, { name: '' },
  ] });
  assert.deepEqual(g, [{ name: 'A', projects: ['X', 'Y'] }, { name: 'B', projects: ['Z'] }]);
  assert.deepEqual(G.normalizeGroups('nonsense'), []);
});

test('groups: a remembered view fits the members and the layout', () => {
  const grp = { name: 'A', projects: ['P', 'Q', 'R', 'S', 'T'] };
  assert.deepEqual(G.viewFor(grp, null), { shown: ['P', 'Q', 'R', 'S', 'T'], layoutId: 'm-3x2' });
  const six = { name: 'B', projects: ['P', 'Q', 'R', 'S', 'T', 'U', 'V'] };
  assert.deepEqual(G.viewFor(six, { shown: ['P', 'Q', 'R', 'S', 'T', 'U'], layoutId: 'm-3x2' }), { shown: ['P', 'Q', 'R', 'S', 'T', 'U'], layoutId: 'm-3x2' }, 'a six-project split comes back whole');
  assert.deepEqual(G.viewFor(grp, { shown: ['R', 'Gone'], layoutId: 'm-3r' }), { shown: ['R'], layoutId: 'm-3r' });
  assert.deepEqual(G.viewFor(grp, { shown: ['P', 'Q', 'R'], layoutId: 'm-2r' }).layoutId, 'm-3r');
  assert.deepEqual(G.viewFor(grp, { shown: ['P', 'Q'], layoutId: '2c', pinMgr: false }).layoutId, 'm-2r', 'a split saved without the CTO comes back with it');
  assert.deepEqual(G.viewFor(grp, { shown: ['Gone'] }).shown, ['P', 'Q', 'R', 'S', 'T']);
});

test('links: a path with spaces offers longer readings to check on disk', () => {
  const s = String.raw`Edited D:\Claude Setup\.claude\settings.local.json: added the rule`;
  const [l] = findLinks(s);
  assert.equal(l.text, String.raw`D:\Claude`);
  const c = stretchCandidates(s, l);
  assert.equal(c[0], String.raw`D:\Claude Setup\.claude\settings.local.json`);
  assert.equal(c.length, 4);
  // The app keeps the longest reading that exists, so the following words stay out.
  const onDisk = new Set([String.raw`D:\Claude Setup\.claude\settings.local.json`]);
  assert.equal([...c].reverse().find(p => onDisk.has(p)), String.raw`D:\Claude Setup\.claude\settings.local.json`);
});

test('links: a path Claude Code broke at its space is read back with the space (#350)', () => {
  const file = String.raw`D:\Brew Notes\setup-visual\media\setup-map-1080x1350.mp4`, onDisk = new Set([file]);
  // What the pane does: every reading, shortest first, keep the longest that exists.
  const pick = (text, l, cuts) => {
    const plain = [...joinReadings(l, cuts), ...stretchCandidates(text, l)];
    const all = [...plain.map(t => ({ text: t, target: t })), ...plain.flatMap(t => spacedReadings(t, l, cuts))].sort((a, b) => a.target.length - b.target.length);
    return [...all].reverse().find(r => onDisk.has(r.target));
  };
  for (const [a, b] of [[String.raw`LinkedIn, with D:\Brew`, String.raw`Notes\setup-visual\media\setup-map-1080x1350.mp4:`],
    [String.raw`with D:\Brew`, String.raw`Notes\setup-visual\media\setup-map-1080x1350.mp4. Done`]]) {
    const { text, cuts } = joinRows([{ y: 1, rows: [a] }, { y: 2, rows: [b] }]);
    const l = findLinks(text)[0], r = pick(text, l, cuts);
    assert.equal(r.target, file, b);
    assert.equal(r.text, String.raw`D:\BrewNotes\setup-visual\media\setup-map-1080x1350.mp4`, 'the on-screen span, for the cells');
  }
  // In backticks it is one path, on one row or broken at its space.
  const tick = '`' + file + '`: done';
  assert.equal(findLinks(tick)[0].text, file);
  const { text, cuts } = joinRows([{ y: 1, rows: [String.raw`see ` + '`' + String.raw`D:\Brew`] }, { y: 2, rows: [String.raw`Notes\setup-visual\media\setup-map-1080x1350.mp4` + '`.'] }]);
  assert.equal(pick(text, findLinks(text)[0], cuts).target, file);
  // On one row, followed by a colon, the stretch finds it as before.
  const one = String.raw`with ${file}: posted`;
  assert.equal([...stretchCandidates(one, findLinks(one)[0])].reverse().find(p => onDisk.has(p)), file);
  // Ordinary words after a path are never pulled in: nothing longer exists.
  const prose = String.raw`D:\Claude is a drive`;
  assert.equal([...stretchCandidates(prose, findLinks(prose)[0])].reverse().find(p => onDisk.has(p)), undefined);
  assert.deepEqual(spacedReadings('x', { index: 0, text: 'x' }, []), []);
});

test('links: paths without spaces and web links link as before', () => {
  const s = String.raw`see G:\SideProjects\Streaky\app.json, then https://x.io/a.`;
  const ls = findLinks(s);
  assert.deepEqual(ls.map(l => l.text), [String.raw`G:\SideProjects\Streaky\app.json`, 'https://x.io/a']);
  assert.equal(stretchCandidates(s, ls[1]).length, 0);
  assert.equal(stretchCandidates(String.raw`end D:\x`, findLinks(String.raw`end D:\x`)[0]).length, 0);
});

test('links: a quoted path links whole', () => {
  const s = String.raw`open "D:\My Files\a b.txt" now`;
  assert.deepEqual(findLinks(s).map(l => l.text), [String.raw`D:\My Files\a b.txt`]);
  assert.deepEqual(stretchCandidates(s, findLinks(s)[0]), []);
});

test('links: a path after "Open in VS Code:" is marked to open in VS Code', () => {
  const s = String.raw`Open in VS Code: D:\SideProjects\FocusShell\app\main.js`;
  assert.deepEqual(findLinks(s).map(l => [l.text, !!l.code]), [[String.raw`D:\SideProjects\FocusShell\app\main.js`, true]]);
  assert.equal(findLinks(String.raw`see D:\x\y.js`)[0].code, undefined);
  assert.equal(findLinks(String.raw`open in vscode: "D:\My Files\a b.txt"`)[0].code, true);
});

test('projectForPath finds the deepest project folder holding a path', () => {
  const ps = [{ name: 'A', path: String.raw`G:\S\A` }, { name: 'Inner', path: String.raw`G:\S\A\sub` }, { name: 'AB', path: String.raw`G:\S\AB` }];
  assert.equal(projectForPath(ps, String.raw`g:/s/a/src/x.js`).name, 'A');
  assert.equal(projectForPath(ps, String.raw`G:\S\A\sub\y.js`).name, 'Inner');
  assert.equal(projectForPath(ps, String.raw`G:\S\AB\z.js`).name, 'AB');
  assert.equal(projectForPath(ps, String.raw`G:\Other\z.js`), null);
});

test('tasks: detail lines under a task belong to it and survive edits', () => {
  const md = [
    '# A tasks',
    '- [?] #1 Dark mode (2026-10-01, lead-A) -> system or toggle?',
    '  > Owner asked for dark mode on every screen.',
    '  > Result: follow the system or add a toggle? | options: system, toggle | suggest: system',
    'stray',
    '  > not a detail of anything',
    '- [ ] #2 Next (2026-10-01, user)',
  ].join('\n');
  const t = parseTasks(md);
  assert.deepEqual(t.map(x => x.details.length), [2, 0]);
  assert.equal(t[0].details[0], 'Owner asked for dark mode on every screen.');
  assert.deepEqual(optionsOf(t[0]), { options: ['system', 'toggle'], suggest: 'system' });
  const edited = setTaskText(setMark(md, 1, 'x'), 1, 'Dark mode everywhere');
  assert.deepEqual(parseTasks(edited)[0].details, t[0].details);
  assert.equal(parseTasks(edited)[0].text, 'Dark mode everywhere');
  assert.equal(parseTasks(addTaskLine(md, 'Third', 'user', '2026-10-02')).at(-1).n, 3);
});

import { normalizeSettings, DEFAULTS, modelFor, upgradeSettings } from './settings.js';

test('settings: unknown or bad values fall back to defaults', () => {
  assert.deepEqual(normalizeSettings(null), DEFAULTS);
  assert.deepEqual(normalizeSettings({ pmDock: 'top', pmSize: 'x', extra: 1 }), DEFAULTS);
  // the Status refresh interval (#1034): 5, 30, 60 or 120 minutes, 30 when unset or odd
  assert.equal(normalizeSettings({ statusEvery: 120 }).statusEvery, 120);
  assert.equal(normalizeSettings({ statusEvery: 7 }).statusEvery, 30);
  // Preferences (#1026): a known theme, spacing and font are kept, anything else is the default
  const p = normalizeSettings({ theme: 'nord', space: 'spacious', font: 'plex' });
  assert.deepEqual([p.theme, p.space, p.font], ['nord', 'spacious', 'plex']);
  const q = normalizeSettings({ theme: 'neon', space: 'huge', font: 'Comic Sans' });
  assert.deepEqual([q.theme, q.space, q.font], ['graphite', 'normal', 'inter']);
  // Maybe missed above the CTO (#1101): on unless switched off
  assert.equal(normalizeSettings({}).showMissed, true);
  assert.equal(normalizeSettings({ showMissed: false }).showMissed, false);
  assert.equal(normalizeSettings({}).showTavern, true);
  assert.equal(normalizeSettings({ showTavern: false }).showTavern, false);
  const s =normalizeSettings({ pmDock: 'bottom', pmSize: 5000, pmFolded: true, sideSplit: 2, foldPm: true });
  assert.deepEqual([s.pmDock, s.pmSize, s.pmFolded, s.sideSplit, s.foldPm, s.foldCto], ['bottom', 900, true, 0.85, true, false]);
  assert.equal(normalizeSettings({ pmSize: 10 }).pmSize, 240);
});

test('settings: the PM is off unless turned on, also in a file that never set it (#172)', () => {
  assert.equal(normalizeSettings(null).runPm, false);
  assert.equal(normalizeSettings({ pmDock: 'left' }).runPm, false);
  assert.equal(normalizeSettings({ runPm: 'yes' }).runPm, false);
  assert.equal(normalizeSettings({ runPm: true }).runPm, true);
});

test('models: the PM on Sonnet, the helper on Haiku, CTOs on Claude default; leads never set (#142, #174)', () => {
  assert.deepEqual([modelFor({}, 'pm'), modelFor({}, 'cto'), modelFor({}, 'helper'), modelFor({}, 'Streaky')], ['sonnet', '', 'haiku', '']);
  // An older file's lead models are ignored, and dropped on the next save.
  const s = { models: { cto: 'opus', pm: '', helper: 'sonnet' }, leadModels: { Streaky: 'haiku' } };
  assert.deepEqual([modelFor(s, 'pm'), modelFor(s, 'cto'), modelFor(s, 'cto-Mobile'), modelFor(s, 'helper'), modelFor(s, 'Streaky'), modelFor(s, 'Streaky:2')],
    ['', 'opus', 'opus', 'sonnet', '', '']);
  assert.equal('leadModels' in normalizeSettings(s), false);
  assert.deepEqual(normalizeSettings({ models: { pm: 'gpt', helper: 'x' } }).models, { cto: '', pm: 'sonnet', helper: 'haiku', catchup: 'haiku' });
});

import { pushAllowed, setPushRule, PUSH_ALLOW, PUSH_ASK } from './pushperm.js';

test('push rule: on adds the allow and force-ask rules, off removes exactly them', () => {
  const before = JSON.stringify({ permissions: { allow: ['Bash(npm test:*)'], deny: ['Read(.env)'] }, env: { A: '1' } });
  const on = setPushRule(before, true);
  assert.equal(pushAllowed(on), true);
  assert.deepEqual(JSON.parse(on).permissions.allow, ['Bash(npm test:*)', ...PUSH_ALLOW]);
  assert.deepEqual(JSON.parse(on).permissions.ask, PUSH_ASK);
  assert.equal(setPushRule(on, true), on);
  const off = setPushRule(on, false);
  assert.equal(pushAllowed(off), false);
  assert.deepEqual(JSON.parse(off), JSON.parse(before));
});

test('push rule: works from an empty or missing file, and refuses broken JSON', () => {
  assert.deepEqual(JSON.parse(setPushRule('', false)), {});
  assert.equal(pushAllowed(setPushRule('', true)), true);
  assert.deepEqual(JSON.parse(setPushRule(setPushRule('', true), false)), {});
  assert.throws(() => setPushRule('{ not json', true));
  assert.equal(pushAllowed('{ not json'), false);
});

import { dueOf, groupMe, dueLabel } from './me.js';

test('me: due dates come from a detail line, and items group by when they are due', () => {
  const md = [
    '# Me tasks',
    '- [ ] #1 Call the bank (2026-10-02, user)', '  > Due: 2026-10-02 17:00',
    '- [ ] #2 Dentist (2026-10-02, user)', '  > Due: 2026-10-06 10:30',
    '- [ ] #3 Sort the recordings folder (2026-10-02, user)',
    '- [ ] #4 Renew passport (2026-10-02, user)', '  > Due: 2026-12-01',
    '- [ ] #5 Pay the old bill (2026-09-30, user)', '  > Due: 2026-09-30',
    '- [x] #6 Renew the Copilot seat (2026-10-01, user)',
  ].join('\n');
  const ts = parseTasks(md), now = new Date(2026, 9, 2, 12, 0);
  assert.equal(dueOf(ts[0]).timed, true);
  assert.equal(dueOf(ts[2]), null);
  const g = groupMe(ts, now);
  assert.deepEqual([g.today, g.reminders, g.todo, g.done].map(l => l.map(t => t.n)), [[5, 1], [5, 1, 2, 4], [3], [6]]);
  assert.equal(dueLabel(dueOf(ts[0]), now), 'today 17:00');
  assert.equal(dueLabel(dueOf(ts[1]), now), 'Tue 10:30');
  assert.equal(dueLabel(dueOf(ts[3]), now), '1 Dec');
  assert.match(dueLabel(dueOf(ts[4]), now), /^overdue/);
});

import { dueReminders } from './me.js';

test('me: reminders notify once when due, again if the due time changes', () => {
  const md = '- [ ] #1 Bank (2026-10-02, user)\n  > Due: 2026-10-02 17:00\n- [ ] #2 Later (2026-10-02, user)\n  > Due: 2026-10-09\n- [x] #3 Done (2026-10-02, user)\n  > Due: 2026-10-01';
  const ts = parseTasks(md);
  assert.deepEqual(dueReminders(ts, new Date(2026, 9, 2, 16, 59), []), []);
  const due = dueReminders(ts, new Date(2026, 9, 2, 17, 0), []);
  assert.deepEqual(due.map(r => r.n), [1]);
  assert.deepEqual(dueReminders(ts, new Date(2026, 9, 2, 18, 0), due.map(r => r.key)), []);
  const moved = parseTasks(md.replace('17:00', '19:00'));
  assert.deepEqual(dueReminders(moved, new Date(2026, 9, 2, 20, 0), due.map(r => r.key)).map(r => r.n), [1]);
});

test('links: a bare file name with an extension is offered, words and paths are not', () => {
  const s = String.raw`Saved thumbnail-final.jpg. See D:\Blogger\Videos\2\a.png and https://x.io/b.html, version 1.2, e.g. done`;
  assert.deepEqual(findBareNames(s).map(n => n.text), ['thumbnail-final.jpg', 'e.g']);
  assert.deepEqual(findBareNames('plain words only'), []);
  assert.equal(findBareNames('Wrote notes_v2.md:').map(n => n.index)[0], 6);
});

test('links: folders named in recent output come newest first, without web links', () => {
  const rows = [String.raw`Working in D:\Blogger\Videos\1`, 'see https://x.io', String.raw`Now D:\Blogger\Videos\2 and D:\Blogger\Videos\1`];
  assert.deepEqual(folderHints(rows), [String.raw`D:\Blogger\Videos\1`, String.raw`D:\Blogger\Videos\2`]);
});

test('sessions: a second lead has its own id and name, never a project name', () => {
  assert.equal(secondId('FocusShell'), 'FocusShell:2');
  assert.equal(secondOf('FocusShell:2'), 'FocusShell');
  assert.equal(secondOf('FocusShell'), null);
  assert.equal(secondOf('Budgetly-2'), null);
  assert.equal(leadArgs('FocusShell-2', 'p.md')[3], 'lead-FocusShell-2');
});

test('sessions: the second lead is told its name and how to share the project', () => {
  const same = secondLeadNote('Budgetly', null);
  assert.match(same, /lead-Budgetly-2/);
  assert.match(same, /git stash/);
  assert.doesNotMatch(same, /worktree/i);
  const wt = secondLeadNote('Budgetly', { main: 'G:/SideProjects/Budgetly' });
  assert.match(wt, /merge --ff-only lead-2/);
  assert.match(wt, /G:\/SideProjects\/Budgetly/);
});

test('settings: boards in test view are kept as a list of board keys', () => {
  assert.deepEqual(normalizeSettings({ testBoards: ['', 'Budgetly', 'Budgetly', 3] }).testBoards, ['', 'Budgetly']);
  assert.deepEqual(normalizeSettings({ testBoards: 'x' }).testBoards, []);
});

import { askOf, tldrOf } from './tasks.js';

test('askOf reads lettered options and the suggestion from a NEEDS YOU result line', () => {
  const t = { result: 'needs you on the tooltip', details: ['words', 'Result: icons hidden (ff77). NEEDS YOU: the top-right icon is the formula tooltip. a) move it beside the title, b) put a "based on" icon there, c) keep both; suggest a'] };
  const a = askOf(t);
  assert.equal(a.question, 'the top-right icon is the formula tooltip.');
  assert.deepEqual(a.options.map(o => o.key), ['a', 'b', 'c']);
  assert.equal(a.options[1].text, 'put a "based on" icon there');
  assert.equal(a.suggest, 'a');
});

test('askOf reads "options:" and "suggest:", and keeps numbered questions whole', () => {
  const a = askOf({ result: 'NEEDS YOU #4 | Cache for five minutes or an hour? | options: five minutes, an hour | suggest: an hour', details: [] });
  assert.equal(a.question, 'Cache for five minutes or an hour?');
  assert.deepEqual(a.options.map(o => o.text), ['five minutes', 'an hour']);
  assert.equal(a.suggest, 'an hour');
  const b = askOf({ details: ['Result: NEEDS YOU: (1) tab or switcher? (2) where does it live? suggest: own tab, state'] });
  assert.equal(b.question, '(1) tab or switcher? (2) where does it live?');
  assert.deepEqual(b.options, []);
  assert.equal(b.suggest, 'own tab, state');
  assert.equal(askOf({ result: 'done', details: ['words'] }), null);
});

test('askOf and optionsOf split the #1015 question into exactly (a), (b), (c) (#1038)', () => {
  const line = 'NEEDS YOU: no clean app-side way to hide the launcher | options: (a) owner switches Voice typing launcher off in the Win+H bar ... menu (gone everywhere, Win+H and card mics still work), (b) mark only the terminal panes private and the owner watches for a few days, (c) leave it | suggest: a, or b if the owner wants the launcher in other apps';
  const a = askOf({ details: [line] });
  assert.deepEqual(a.options.map(o => o.key), ['a', 'b', 'c']);
  assert.equal(a.options[0].text, 'owner switches Voice typing launcher off in the Win+H bar ... menu (gone everywhere, Win+H and card mics still work)');
  assert.equal(a.options[2].text, 'leave it');
  assert.equal(a.suggest, 'a, or b if the owner wants the launcher in other apps');
  assert.equal(optionsOf({ text: 'x', details: [line] }).options.length, 3);
  // no letters: commas inside brackets or quotes stay inside their option
  const b = askOf({ result: 'NEEDS YOU | Which? | options: keep it (small, quiet), "move it, left", drop it | suggest: drop it' });
  assert.deepEqual(b.options.map(o => o.text), ['keep it (small, quiet)', '"move it, left"', 'drop it']);
});

test('tldrOf gives the first words without screenshot notes, and the latest result', () => {
  const t = { result: 'short', details: ['[screenshot: a page] Move the tooltip to the title', 'Result: first try', 'Owner chose a', 'Result: tooltip moved'] };
  assert.deepEqual(tldrOf(t), { about: 'Move the tooltip to the title', last: 'tooltip moved' });
  assert.equal(tldrOf({ result: 'only this', details: [] }).last, 'only this');
});


import { relatedFiles } from './tasks.js';
test('relatedFiles: own .md paths and those of the task it follows', () => {
  const md = [
    '- [x] #3 Research (2026-10-02, lead-X) -> done',
    '  > Result: report at output/sales/report.md: sell now; see also D:\\Notes\\a.md.',
    '- [ ] #4 Ask an adviser (2026-10-03, lead-X, for owner) -> after #3',
    '  > Read notes/extra.md first',
    '- [ ] #5 Other (2026-10-03, lead-X) -> other.md',
  ].join('\n');
  const tasks = parseTasks(md), t4 = tasks.find(t => t.n === 4);
  assert.deepEqual(relatedFiles(t4, tasks), { paths: ['notes/extra.md', 'output/sales/report.md', 'D:\\Notes\\a.md'], after: [3] });
  assert.deepEqual(relatedFiles(tasks[0], tasks), { paths: ['output/sales/report.md', 'D:\\Notes\\a.md'], after: [] });
});

import { parsePlan, setPlan, currentVersion, planOf, byPriority, setTaskKey } from './plan.js';
const PLAN_MD = ['# V tasks', '> Version 0.5: current', '> Version 0.6',
  '- [ ] #1 a (2026-10-01, user)', '  > words', '  > Version: 0.6', '  > Priority: 3', '- [ ] #2 b (2026-10-01, user)', '  > Priority: first'].join('\n');
test('parsePlan reads versions; task lines unaffected', () => {
  assert.deepEqual(parsePlan(PLAN_MD), { versions: [{ name: '0.5', state: 'current' }, { name: '0.6', state: '' }] });
  assert.deepEqual(parsePlan('# X tasks\n- [ ] #1 a'), { versions: [] });
  assert.equal(parseTasks(PLAN_MD).length, 2);
  assert.deepEqual(parseTasks(PLAN_MD)[0].details, ['words', 'Version: 0.6', 'Priority: 3']);
});
test('setPlan rewrites only the plan lines', () => {
  const out = setPlan(PLAN_MD, { versions: [{ name: '0.5', state: 'done' }, { name: '0.6', state: 'current' }] });
  assert.equal(out.split('\n').slice(0, 3).join('|'), '# V tasks|> Version 0.5: done|> Version 0.6: current');
  assert.equal(out.split('\n').slice(3).join('\n'), PLAN_MD.split('\n').slice(3).join('\n'));
  assert.equal(setPlan('# X tasks\n- [ ] #1 a', { versions: [] }), '# X tasks\n- [ ] #1 a');
});
test('currentVersion is the one marked current, else the first not done, else none', () => {
  assert.equal(currentVersion(parsePlan(PLAN_MD)), '0.5');
  assert.equal(currentVersion({ versions: [{ name: '0.4', state: 'done' }, { name: '0.6', state: '' }, { name: '0.7', state: '' }] }), '0.6');
  assert.equal(currentVersion({ versions: [{ name: '0.4', state: 'done' }] }), null);
  assert.equal(currentVersion({ versions: [] }), null);
});
test('planOf reads version and priority; byPriority puts 1 first and unset last', () => {
  const [a, b] = parseTasks(PLAN_MD);
  assert.deepEqual(planOf(a), { version: '0.6', priority: 3 });
  assert.equal(planOf(b).priority, 1);
  const c = { n: 0, details: [] };
  assert.deepEqual([a, c, b].sort(byPriority).map(t => t.n), [2, 1, 0]);
});
test('setTaskKey adds, replaces and removes one detail line', () => {
  let md = setTaskKey(PLAN_MD, 2, 'Version', '0.5');
  assert.deepEqual(parseTasks(md)[1].details, ['Priority: first', 'Version: 0.5']);
  md = setTaskKey(md, 1, 'Priority', 1);
  assert.deepEqual(parseTasks(md)[0].details, ['words', 'Version: 0.6', 'Priority: 1']);
  md = setTaskKey(md, 1, 'Version', null);
  assert.deepEqual(parseTasks(md)[0].details, ['words', 'Priority: 1']);
  assert.equal(setTaskKey(PLAN_MD, 9, 'Version', '0.5'), PLAN_MD);
});

test('codeweb: serve-web args, port from its output, folder address, own-server check', () => {
  assert.deepEqual(serveWebArgs('t1').slice(0, 5), ['serve-web', '--host', '127.0.0.1', '--port', '0']);
  assert.deepEqual(serveWebArgs('tok.txt').slice(5, 7), ['--connection-token-file', 'tok.txt'], 'its own token file, never the shared one (#201)');
  assert.ok(!serveWebArgs('tok.txt').includes('--connection-token'));
  assert.equal(servePort('*\nWeb UI available at http://127.0.0.1:52811?tkn=abc\n'), 52811);
  assert.equal(servePort('Downloading server'), null);
  assert.equal(codeUrl(7811, 'a b', 'D:\\SideProjects\\FocusShell\\'), 'http://127.0.0.1:7811/?tkn=a%20b&folder=%2Fd%3A%2FSideProjects%2FFocusShell');
  const withFile = new URL(codeUrl(7811, 't', 'D:\\Side Projects\\X', 'D:\\Side Projects\\X\\docs\\a b.md'));
  assert.equal(withFile.searchParams.get('folder'), '/d:/Side Projects/X');
  assert.deepEqual(JSON.parse(withFile.searchParams.get('payload')), [['openFile', 'vscode-remote://127.0.0.1:7811/d:/Side%20Projects/X/docs/a%20b.md']]);
  assert.ok(isCodeUrl('http://127.0.0.1:7811/static/x.js', 7811));
  assert.ok(!isCodeUrl('http://127.0.0.1:7812/', 7811));
  assert.ok(!isCodeUrl('https://example.com/', 7811));
  assert.ok(!isCodeUrl('not a url', 7811));
});

test('whiteboardCards: waiting items of one CTO, sorted by priority, then age; projects by oldest card', async () => {
  const { whiteboardCards, cardCount } = await import('./whiteboard.js');
  const md = (...l) => ['# x', ...l].join('\n');
  const tasks = {
    A: md('- [?] #3 Newer (2026-10-03, lead-A) -> NEEDS YOU: Pick? options: x, y | suggest: x',
      '- [?] #1 Older (2026-10-01, lead-A)', '- [?] #2 Urgent (2026-10-02, lead-A)', '  > Priority: 1',
      '- [ ] #4 Open (2026-09-01, user)', '- [?] #5 Check it (2026-09-01, lead-A, for owner)'),
    B: md('- [?] #7 Oldest (2026-09-20, lead-B)'),
    G: md('- [?] #1 Grouped (2026-09-01, lead-G)'),
    Me: md('- [?] #1 Mine (2026-09-01, user)'),
  };
  const groups = [{ name: 'Grp', projects: ['G'] }];
  const main = whiteboardCards(tasks, groups, 'cto', ['Me']);
  assert.deepEqual(main.map(g => g.project), ['B', 'A']);
  assert.deepEqual(main[1].cards.map(c => c.task.n), [2, 1, 3]);
  assert.equal(main[1].cards[2].ask.suggest, 'x');
  assert.equal(cardCount(main), 4);
  assert.deepEqual(whiteboardCards(tasks, groups, 'cto-Grp').map(g => g.project), ['G']);
});

test('codesync: which desktop extensions come over, and how the server manifest points at them', () => {
  assert.equal(uriPath('C:\\Users\\me\\ext\\'), '/c:/Users/me/ext');
  assert.deepEqual(serveWebArgs('t', 'D:\\s').slice(-2), ['--server-data-dir', 'D:\\s']);
  assert.ok(!serveWebArgs('t').includes('--server-data-dir'));
  assert.deepEqual(serveWebArgs('t', 'D:\\s', 47123).slice(3, 5), ['--port', '47123'], 'the port kept from last time (#226)');
  const m = [{ identifier: { id: 'a.x' }, relativeLocation: 'a.x-1' }, { identifier: { id: 'b.y' }, relativeLocation: 'b.y-2' },
    { identifier: { id: 'c.z' }, relativeLocation: 'c.z-3' }, { identifier: { id: 'no.loc' } }];
  const live = liveExtensions(m, ['a.x-1', 'b.y-2', 'extensions.json'], { 'b.y-2': true });
  assert.deepEqual(live.map(e => e.relativeLocation), ['a.x-1']);
  assert.deepEqual(liveExtensions(null, [], null), []);
  assert.deepEqual(extensionPlan(m.slice(0, 2), ['a.x-1', 'old-0', 'b.y-2.part', 'extensions.json', '.obsolete']), { copy: ['b.y-2'], remove: ['old-0', 'b.y-2.part'] });
  assert.equal(serverManifest(m.slice(0, 1), 'D:\\deck\\state\\vscode-server\\extensions')[0].location.path, '/d:/deck/state/vscode-server/extensions/a.x-1');
  assert.ok(pageSyncScript({ '/User/keybindings.json': '[\'x\']' }).includes(JSON.stringify('[\'x\']')));
  assert.equal(machineSettings('{\n  "a": 1 // c\n}', 'Dark 2026'), '{ "workbench.colorTheme": "Dark 2026",\n  "a": 1 // c\n}');
  assert.equal(machineSettings('{ "workbench.colorTheme": "Red" }', 'Dark 2026'), '{ "workbench.colorTheme": "Red" }');
  assert.equal(machineSettings('', null), '{}');
  assert.equal(machineSettings('{}', 'Dark 2026'), '{ "workbench.colorTheme": "Dark 2026",}');
});

test('codesync: settings, keybindings, snippets and extensions copied one way', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codesync-'));
  const user = path.join(root, 'User'), desk = path.join(root, 'ext'), server = path.join(root, 'server');
  fs.mkdirSync(path.join(user, 'snippets'), { recursive: true });
  fs.writeFileSync(path.join(user, 'settings.json'), '{ "editor.fontSize": 15 // mine\n}');
  fs.writeFileSync(path.join(user, 'snippets', 'js.json'), '{}');
  fs.writeFileSync(path.join(user, 'snippets', 'notes.txt'), 'x');
  fs.mkdirSync(path.join(desk, 'a.x-1', 'themes'), { recursive: true });
  fs.writeFileSync(path.join(desk, 'a.x-1', 'themes', 't.json'), '{}');
  fs.writeFileSync(path.join(desk, 'extensions.json'), JSON.stringify([{ identifier: { id: 'a.x' }, relativeLocation: 'a.x-1', location: { path: '/elsewhere' } }]));
  fs.mkdirSync(path.join(server, 'extensions', 'old-0'), { recursive: true });
  assert.deepEqual(await syncServer({ userDir: user, desktopExtDir: desk, serverDir: server }), { copied: 1, removed: 1, total: 1 });
  assert.equal(fs.readFileSync(path.join(server, 'data', 'Machine', 'settings.json'), 'utf8'), '{ "editor.fontSize": 15 // mine\n}');
  assert.ok(fs.existsSync(path.join(server, 'extensions', 'a.x-1', 'themes', 't.json')));
  assert.ok(!fs.existsSync(path.join(server, 'extensions', 'old-0')));
  assert.match(JSON.parse(fs.readFileSync(path.join(server, 'extensions', 'extensions.json'), 'utf8'))[0].location.path, /server\/extensions\/a\.x-1$/);
  assert.deepEqual(await syncServer({ userDir: user, desktopExtDir: desk, serverDir: server }), { copied: 0, removed: 0, total: 1 });
  assert.deepEqual(pageFiles(user), { '/User/keybindings.json': '[]', '/User/snippets/js.json': '{}' });
  // FocusShell's own extension (#365) is copied, listed, and kept on the next start.
  const own = path.join(root, 'own');
  fs.mkdirSync(own);
  fs.writeFileSync(path.join(own, 'package.json'), JSON.stringify({ publisher: 'FocusShell', name: 'open-file', version: '1.0.0' }));
  fs.writeFileSync(path.join(own, 'extension.js'), '');
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(await syncServer({ userDir: user, desktopExtDir: desk, serverDir: server, own: [own] }), { copied: 0, removed: 0, total: 1 });
    assert.ok(fs.existsSync(path.join(server, 'extensions', 'focusshell.open-file-1.0.0', 'extension.js')));
    const listed = JSON.parse(fs.readFileSync(path.join(server, 'extensions', 'extensions.json'), 'utf8'));
    assert.deepEqual(listed.map(e => e.identifier.id), ['a.x', 'focusshell.open-file']);
    assert.match(listed[1].location.path, /server\/extensions\/focusshell\.open-file-1\.0\.0$/);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('codesync: the kind of theme desktop shows, as the workbench class', () => {
  assert.equal(themeBase({ id: 'vs-dark vscode-theme-defaults-themes-2026-dark-json', settingsId: 'Dark 2026' }), 'vs-dark');
  assert.equal(themeBase({ id: 'vs vscode-theme-defaults-themes-light_modern-json' }), 'vs');
  assert.equal(themeBase({ id: 'hc-black x' }), 'hc-black');
  assert.equal(themeBase({ id: 'weird x' }), null);
  assert.equal(themeBase(null), null);
});

import { plainText, waitingFor, alertStep } from './prompts.js';

test('prompts: a lead stopped on a permission dialog or a question picker', () => {
  const E = '\x1b';
  const bash = `${E}[2K${E}[1G Bash command${E}[K\r\n  npx eas build -p android\r\n Do${E}[1Cyou want to proceed?\r\n ${E}[36m❯ 1. Yes${E}[39m\r\n   2. Yes, and don't ask again\r\n   3. No, and tell Claude what to do differently (esc)`;
  assert.equal(waitingFor(bash), 'Do you want to proceed?');
  assert.equal(waitingFor('Do you want to make this edit to app.js?\r\n❯ 1. Yes\r\n 2. No'), 'Do you want to make this edit to app.js?');
  assert.equal(waitingFor('Which colour?\r\n❯ 1. Red\r\n 2. Blue\r\nEnter to select · ↑/↓ to navigate · Esc to cancel'), 'a question in its pane');
  assert.equal(waitingFor('✻ Working… (12s · esc to interrupt)'), null);
  assert.equal(waitingFor('I asked: do you want to proceed? Reply in the CTO pane.'), null, 'prose without the options is not a prompt');
  assert.equal(plainText(`a${E}[3Cb${E}]0;title\x07c`), 'a bc');
  assert.equal(waitingFor('Do you want to proceed?\r\n❯ 1. Yes\r\n 2. No\r\n✻ Working… (3s · esc to interrupt)'), null, 'answered elsewhere, working again');
});

import { readPrompt, answerKeys, samePrompt } from './prompts.js';

test('prompts: two prompts with the same wording are not the same prompt (#388)', () => {
  const screen = cmd => [' Bash command', `   ${cmd}`, ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No, and tell Claude what to do differently (esc)'];
  const a = readPrompt(screen('rm tmp/out.log')), b = readPrompt(screen('git push --force'));
  assert.equal(a.ask, b.ask);
  assert.equal(samePrompt(a, readPrompt(screen('rm tmp/out.log'))), true);
  assert.equal(samePrompt(a, b), false);
  assert.equal(samePrompt(a, { ...a, at: 2 }), false);
  assert.equal(samePrompt(a, { ...a, options: a.options.slice(0, 1) }), false);
  assert.equal(samePrompt(a, null), false);
});

test('prompts: read a permission dialog off the screen and answer it (#152)', () => {
  const rows = ['', '╭──────────────────────────────╮', '│ Bash command                 │', '│                              │',
    '│   git push origin main       │', '│   Push to remote             │', '│                              │',
    '│ Do you want to proceed?      │', '│ ❯ 1. Yes                     │',
    "│   2. Yes, and don't ask again for git push commands in│", '│   D:\\SideProjects\\Arcade │',
    '│   3. No, and tell Claude what to do differently (esc) │', '╰──────────────────────────────╯', ''];
  const p = readPrompt(rows);
  assert.equal(p.kind, 'permission');
  assert.equal(p.ask, 'Do you want to proceed?');
  assert.equal(p.detail, 'Bash command\n\ngit push origin main\nPush to remote');
  assert.deepEqual(p.options.map(o => o.label), ['Yes', "Yes, and don't ask again for git push commands in D:\\SideProjects\\Arcade", 'No, and tell Claude what to do differently (esc)']);
  assert.equal(p.at, 1); assert.equal(p.other, 3);
  assert.deepEqual(answerKeys(p, { n: 1 }), ['\r']);
  assert.deepEqual(answerKeys(p, { n: 2 }), ['\x1b[B\r']);
  assert.deepEqual(answerKeys(p, { text: ' use the release branch\n' }), ['\x1b', 'use the release branch', '\r']);
  assert.deepEqual(answerKeys(p, { text: '  ' }), []);
  // No box, and a dialog with no option for typed words.
  const edit = readPrompt([' Edit file app.js', ' ────────────────', ' + one line', ' Do you want to make this edit to app.js?', ' ❯ 1. Yes', '   2. No']);
  assert.equal(edit.ask, 'Do you want to make this edit to app.js?');
  assert.equal(edit.detail, '+ one line'); assert.equal(edit.other, null);
  assert.equal(readPrompt(['✻ Working… (3s · esc to interrupt)']), null);
});

test('prompts: read a question picker and answer it, by option or typed words (#152)', () => {
  const rows = [' ☐ Colour', '', ' Which colour should the logo be?', '', '   1. Red', '      Warm and loud', ' ❯ 2. Blue',
    '      Calm', '   3. Type something.', '', ' Enter to select · ↑/↓ to navigate · Esc to cancel'];
  const p = readPrompt(rows);
  assert.equal(p.kind, 'question');
  assert.equal(p.ask, 'Which colour should the logo be?');
  assert.deepEqual(p.options.map(o => o.label), ['Red', 'Blue', 'Type something.']);
  assert.equal(p.at, 2); assert.equal(p.other, 3);
  assert.deepEqual(answerKeys(p, { n: 1 }), ['\x1b[A\r']);
  assert.deepEqual(answerKeys(p, { n: 2 }), ['\r']);
  assert.deepEqual(answerKeys(p, { text: 'green' }), ['\x1b[B', 'green', '\r']);
  const plain = readPrompt([' Pick one', ' ❯ 1. A', '   2. B', ' Enter to select']);
  assert.equal(plain.other, null);
  assert.deepEqual(answerKeys(plain, { text: 'neither' }), ['\x1b', 'neither', '\r']);
});

import { livePrompt } from './prompts.js';

test('prompts: only a prompt live on the screen counts, not one answered and left in view (#191)', () => {
  const dialog = ['╭──────────────────────────╮', '│ Bash command             │', '│   npm run build          │', '│ Do you want to proceed?  │',
    '│ ❯ 1. Yes                 │', '│   2. No, and tell Claude what to do differently (esc) │', '╰──────────────────────────╯'];
  assert.equal(livePrompt(['', ...dialog, '']).ask, 'Do you want to proceed?', 'a live dialog at the bottom');
  // Answered: the lead worked on in a narrow pane (no "esc to interrupt") and is idle at its input line.
  const idle = ['─── lead-BX ───', '> ', '────────────────', '  Opus 5.5', '  ⏵⏵ auto'];
  assert.equal(livePrompt([...dialog, '● Cleaning up', '  Envisioning…', ...idle]), null);
  assert.equal(livePrompt([...dialog, '│ > fix the login page │']), null, 'typing at the input line');
  const picker = [' Which colour?', ' ❯ 1. Red', '   2. Blue', ' Enter to select · ↑/↓ to navigate · Esc to cancel'];
  assert.equal(livePrompt(picker).kind, 'question');
  assert.equal(livePrompt([...picker, ...idle]), null, 'an answered picker');
  assert.equal(livePrompt(idle), null);
});

test('prompt alerts: once per prompt, only after five minutes, none if answered sooner (#146)', () => {
  const run = steps => { let st = null, n = 0; for (const [what, t] of steps) { const r = alertStep(st, what, t * 60e3); st = r.state; n += r.alert; } return n; };
  const P = 'Do you want to proceed?';
  assert.equal(run([[P, 0], [P, 4], [null, 4.5], [null, 6], [P, 7]]), 0, 'answered at 4.5 min, a new prompt at 7 is not 5 min old yet');
  assert.equal(run([[P, 0], [P, 3], [P, 5], [P, 6], [P, 9], [P, 30]]), 1, 'held for 30 min, told once');
  assert.equal(run([[P, 0], [null, 2], [P, 2.5], [P, 5.1]]), 1, 'a redraw blink does not restart the clock');
  assert.equal(run([[P, 0], [P, 6], [null, 7], [null, 9], [P, 10], [P, 16]]), 2, 'a second prompt later is told again');
  assert.equal(run([[P, 0], ['a question in its pane', 2], ['a question in its pane', 6]]), 0, 'a different prompt starts its own clock');
});

// ---------- ideas deck and saved sketches (#130) ----------
import { parseIdeas, allTags, setTags, setState, nextState, addDetail, setSent, setAbout, ideaLine } from './ideas.js';
import { sketchRel, parseRel, sketchName, sketchId, sketchesOf, attachToTask, detachFromTask, attachToNote, detachFromNote, dropSketch, renameSketch, notesWithSketches, usesOf } from './sketches.js';

const IDEAS = ['# Me ideas',
  '- [ ] #1 Pushing AI to its limits (2026-10-03, user)', '  > A series: give Claude a task just past what it can do', '  > Tags: YouTube, series', '  > State: growing',
  '- [ ] #2 Merging games (2026-10-03, user)', '  > State: parked',
  '- [ ] #3 Own site (2026-10-03, user)', '  > State: became Me #4', '  > Sketch: sketches/Me/site.excalidraw',
  '- [x] #4 Dropped one (2026-10-03, user)',
  '- [ ] #5 Fresh (2026-10-03, user)'].join('\n');

test('parseIdeas reads tags, state and description, drops done ideas, orders growing, new, became, parked', () => {
  const ideas = parseIdeas(IDEAS);
  assert.deepEqual(ideas.map(i => i.n), [1, 5, 3, 2]);
  assert.deepEqual(ideas[0].tags, ['youtube', 'series']);
  assert.deepEqual(ideas[0].about, ['A series: give Claude a task just past what it can do']);
  assert.equal(ideas[2].state, 'became');
  assert.equal(ideas[2].became, 'Me #4');
  assert.deepEqual(ideas[2].about, []);
  assert.equal(ideas[1].state, 'new');
  assert.deepEqual(allTags(ideas), ['series', 'youtube']);
});

test('setTags, setState and addDetail write the idea lines in place', () => {
  let md = setTags(IDEAS, 2, ['App', ' app ', 'life']);
  assert.match(md, /#2 Merging games.*\n  > State: parked\n  > Tags: app, life\n- \[ \] #3/);
  md = setState(md, 2, 'growing');
  assert.match(md, /#2 Merging games.*\n  > Tags: app, life\n  > State: growing\n/);
  md = addDetail(md, 5, 'first  line');
  assert.match(md, /#5 Fresh \(2026-10-03, user\)\n  > first line$/);
  assert.equal(setTags(IDEAS, 2, []), IDEAS);
  assert.equal(nextState('new'), 'growing');
  assert.equal(nextState('parked'), 'new');
});

test('an idea sent to the CTO keeps its state, shows the day and makes one IDEA line (#342)', () => {
  const md = setSent(IDEAS, 3, '2026-10-13');
  const i = parseIdeas(md).find(x => x.n === 3);
  assert.equal(i.state, 'became');
  assert.equal(i.sent, '2026-10-13');
  assert.deepEqual(i.about, []);
  assert.equal(parseIdeas(IDEAS).find(x => x.n === 3).sent, '');
  assert.equal(ideaLine(i), 'IDEA #3: Own site | sketch: sketches/Me/site.excalidraw');
  const one = parseIdeas(addDetail(IDEAS, 1, 'D:\\ideas\\refs\\x')).find(x => x.n === 1);
  assert.equal(ideaLine(one), 'IDEA #1: Pushing AI to its limits | A series: give Claude a task just past what it can do | D:\\ideas\\refs\\x');
});

test('an idea description edited as one text keeps its keyed lines; the IDEA line carries what was typed (#343)', () => {
  const md = setAbout(setSent(IDEAS, 1, '2026-10-13'), 1, 'First line\n\n  D:\\refs\\x  \nThird   line');
  assert.match(md, /#1 Pushing AI.*\n  > First line\n  > D:\\refs\\x\n  > Third line\n  > Tags: YouTube, series\n  > State: growing\n  > Sent: CTO 2026-10-13\n- \[ \] #2/);
  const i = parseIdeas(md).find(x => x.n === 1);
  assert.deepEqual(i.about, ['First line', 'D:\\refs\\x', 'Third line']);
  assert.equal(i.state, 'growing');
  assert.equal(ideaLine(i, ' make it  3d '), 'IDEA #1: Pushing AI to its limits | First line | D:\\refs\\x | Third line | You: make it 3d');
  assert.equal(setAbout(IDEAS, 99, 'x'), IDEAS);
});

test('sketch paths: only sketches/<Project>/<id>.excalidraw is accepted', () => {
  assert.equal(sketchRel('Me', 'ai-limits'), 'sketches/Me/ai-limits.excalidraw');
  assert.deepEqual(parseRel('sketches/Clipper/flow-2.excalidraw'), { project: 'Clipper', id: 'flow-2' });
  for (const bad of ['sketches/../x.excalidraw', 'sketches/Me/../../a.excalidraw', 'sketches/Me/A.excalidraw', 'sketches/Me/a.png', 'C:/sketches/Me/a.excalidraw', 'sketches/a:b/x.excalidraw', 'sketches/../Me/x.excalidraw'])
    assert.equal(parseRel(bad), null, bad);
  assert.equal(sketchName('sketches/Me/ai-limits.excalidraw'), 'ai limits');
});

test('sketchId makes a short safe id, unique among the taken ones', () => {
  assert.equal(sketchId('Episode map: AI limits!'), 'episode-map-ai-limits');
  assert.equal(sketchId('  '), 'sketch');
  assert.equal(sketchId('Site', ['site', 'site-2']), 'site-3');
  assert.ok(sketchId('x'.repeat(90)).length <= 40);
});

test('a sketch attaches to a task once, and detaches from it', () => {
  const rel = 'sketches/Me/flow.excalidraw';
  let md = attachToTask(IDEAS, 1, rel);
  assert.match(md, /  > State: growing\n  > Sketch: sketches\/Me\/flow.excalidraw\n- \[ \] #2/);
  assert.equal(attachToTask(md, 1, rel), md);
  assert.deepEqual(sketchesOf(parseIdeas(md).find(i => i.n === 1)), [rel]);
  assert.equal(detachFromTask(md, 1, rel), IDEAS);
  assert.equal(attachToTask(IDEAS, 1, '../evil.excalidraw'), IDEAS);
  assert.equal(attachToTask(IDEAS, 99, rel), IDEAS);
});

test('a sketch attaches to a note by its time and text; dropSketch removes every line of a board', () => {
  const notes = '# Notes\n- 2026-10-03 14:10 Logo at 16px\n- 2026-10-03 15:00 Other';
  const rel = 'sketches/Me/logo.excalidraw';
  const md = attachToNote(notes, '2026-10-03 14:10', 'Logo at 16px', rel);
  assert.equal(md, '# Notes\n- 2026-10-03 14:10 Logo at 16px\n  > Sketch: sketches/Me/logo.excalidraw\n- 2026-10-03 15:00 Other');
  assert.deepEqual(notesWithSketches(md).map(n => n.sketches), [[rel], []]);
  assert.deepEqual(parseNotes(md).map(n => n.text), ['Logo at 16px', 'Other']);
  assert.equal(detachFromNote(md, '2026-10-03 14:10', 'Logo at 16px', rel), notes);
  assert.equal(dropSketch(md, rel), notes);
});

test('renameSketch points every line of a board at its new id, and nothing else (#144)', () => {
  const a = 'sketches/Me/logo.excalidraw', b = 'sketches/Me/logo-small.excalidraw', c = 'sketches/Me/icon.excalidraw';
  const md = `# Me tasks\n- [ ] #1 A (2026-10-03, user)\n  > Sketch: ${a}\n  > Sketch: ${c}\n- [ ] #2 B (2026-10-03, user)\n  > Sketch: ${a}\n  > See ${a} too`;
  assert.equal(renameSketch(md, a, b), md.replace(`> Sketch: ${a}\n  > Sketch: ${c}`, `> Sketch: ${b}\n  > Sketch: ${c}`).replace(`#2 B (2026-10-03, user)\n  > Sketch: ${a}`, `#2 B (2026-10-03, user)\n  > Sketch: ${b}`));
  assert.equal(renameSketch(md, 'sketches/Me/none.excalidraw', b), md);
});

test('usesOf lists every item that carries a board', () => {
  const rel = 'sketches/Me/site.excalidraw';
  const tasks = { Me: `- [ ] #4 Make the site (2026-10-03, user)\n  > Sketch: ${rel}`, Clipper: '- [ ] #30 Export (2026-10-03, user)' };
  const notes = `- 2026-10-03 14:10 Site colours\n  > Sketch: ${rel}`;
  assert.deepEqual(usesOf(rel, { tasks, ideas: IDEAS, notes }).map(u => u.label), ['idea #3', 'Me #4', 'a note']);
});

// ---------- the AI helper (#154) ----------
import { systemPrompt, parseReply, addItem, noteText, draftText, textDraft, helperCommand, DOC_CAP } from './helper.js';

test('helper system prompt names the kind, lists open items and caps the CLAUDE.md', () => {
  const p = systemPrompt({ kind: 'task', project: 'Streaky', open: ['#8 Streak freeze'], doc: { name: 'CLAUDE.md', text: 'x'.repeat(DOC_CAP + 50) } });
  assert.match(p, /a task for the Streaky project/);
  assert.match(p, /- #8 Streak freeze/);
  assert.match(p, /\[cut\]$/);
  assert.ok(p.length < DOC_CAP + 2000);
  assert.match(systemPrompt({ kind: 'task', project: 'Me', open: [] }), /a to-do on the owner's own list/);
  assert.doesNotMatch(systemPrompt({ kind: 'idea' }), /Open items/);
});

test('helper reply parses clean JSON, JSON in a code fence, and plain text', () => {
  const j = '{"reply":"Which day?","draft":{"title":"Book flights","lines":["For the June trip", " "]}}';
  assert.deepEqual(parseReply(j), { reply: 'Which day?', draft: { title: 'Book flights', lines: ['For the June trip'] } });
  assert.deepEqual(parseReply('```json\n' + j + '\n```').draft.title, 'Book flights');
  assert.deepEqual(parseReply('Sorry, I cannot.'), { reply: 'Sorry, I cannot.', draft: null });
  assert.deepEqual(parseReply('{"reply": "ok", "draft": {"title": ""}}'), { reply: 'ok', draft: null });
  assert.equal(parseReply('{broken').draft, null);
});

test('helper adds a task with its lines as detail lines', () => {
  const r = addItem('# Me tasks\n- [ ] #4 Old (2026-10-01, user)\n', { title: 'Book flights', lines: ['For the June trip', 'Check  bags'] }, 'user', '2026-10-04');
  assert.equal(r.n, 5);
  assert.equal(r.md, '# Me tasks\n- [ ] #4 Old (2026-10-01, user)\n- [ ] #5 Book flights (2026-10-04, user)\n  > For the June trip\n  > Check bags\n');
  const t = parseTasks(r.md).find(x => x.n === 5);
  assert.deepEqual(t.details, ['For the June trip', 'Check bags']);
  assert.equal(addItem('', { title: 'Solo', lines: [] }, 'user', '2026-10-04').md, '- [ ] #1 Solo (2026-10-04, user)\n');
});

test('helper note is one line, and the draft box round-trips', () => {
  assert.equal(noteText({ title: 'Flights are cheaper on Tuesdays', lines: ['Seen on two sites'] }), 'Flights are cheaper on Tuesdays. Seen on two sites.');
  assert.equal(noteText({ title: 'Just this', lines: [] }), 'Just this');
  const d = { title: 'Book flights', lines: ['For June'] };
  assert.deepEqual(textDraft(draftText(d)), d);
  assert.equal(textDraft('\n  \n'), null);
});

test('helper command keeps settings out, resumes by id, and refuses odd input', () => {
  const first = helperCommand({ promptFile: 'C:\a b\p.txt' });
  assert.match(first, /--model haiku --tools "" /);
  assert.match(first, /--setting-sources ""/);
  assert.match(first, /--system-prompt-file "C:\a b\p.txt"$/);
  const id = 'fb5bcd84-76e6-4e35-8628-01a5e6addba4';
  assert.match(helperCommand({ session: id, promptFile: 'x' }), new RegExp(`--resume ${id}$`));
  assert.doesNotMatch(helperCommand({ session: 'x & del *', promptFile: 'a"b' }), /resume|prompt-file|del \*/);
  // The model picked in Settings (#174); Claude's default leaves the flag out.
  assert.match(helperCommand({ promptFile: 'x', model: 'sonnet' }), /^claude -p --model sonnet --tools/);
  assert.match(helperCommand({ promptFile: 'x', model: '' }), /^claude -p --tools/);
  assert.match(helperCommand({ promptFile: 'x', model: 'x & del' }), /^claude -p --tools/);
  // Effort is low for the helper; the recorder's extraction asks for more (#369).
  assert.match(helperCommand({ promptFile: 'x' }), /--effort low/);
  assert.match(helperCommand({ promptFile: 'x', effort: 'medium' }), /--effort medium/);
  assert.match(helperCommand({ promptFile: 'x', effort: 'x & del' }), /--effort low/);
});

import { isSomeday, setSomeday } from './me.js';

test('me: a Someday item groups apart from To do, moves up and back with one line', () => {
  const md = [
    '# Me tasks',
    '- [ ] #1 Pay the bill (2026-10-02, user)',
    '- [ ] #2 Learn Rust (2026-10-02, user)', '  > Someday',
    '- [ ] #3 Tidy the garage (2026-10-02, user)', '  > Due: 2026-10-02', '  > Someday',
    '- [x] #4 Old one (2026-10-01, user)', '  > Someday',
  ].join('\n');
  const ts = parseTasks(md), g = groupMe(ts, new Date(2026, 9, 2, 12, 0));
  assert.equal(isSomeday(ts[1]), true);
  assert.equal(isSomeday(ts[0]), false);
  assert.deepEqual([g.today, g.todo, g.someday, g.done].map(l => l.map(t => t.n)), [[], [1], [2, 3], [4]]);
  // A due Someday item still raises its reminder.
  assert.deepEqual(dueReminders(ts, new Date(2026, 9, 2, 12, 0), []).map(r => r.n), [3]);
  const up = setSomeday(md, 2, false);
  assert.equal(isSomeday(parseTasks(up)[1]), false);
  assert.doesNotMatch(up, /#2 Learn Rust[^\n]*\n {2}> Someday/);
  const down = setSomeday(md, 1, true);
  assert.match(down, /#1 Pay the bill \(2026-10-02, user\)\n {2}> Someday\n- \[ \] #2/);
  assert.equal(setSomeday(down, 1, true), down);
  assert.match(setSomeday(md, 3, false), /#3 Tidy the garage \(2026-10-02, user\)\n {2}> Due: 2026-10-02\n- \[x\] #4/);
});

test('main CTO view: its last split comes back while two or more of its projects are open (#176)', () => {
  const saved = { shown: ['FocusShell', 'Workout', 'Clipper'], layoutId: 'm-3c' };
  assert.deepEqual(G.mainViewFor(saved, () => true), saved);
  // A project closed since: the rest come back in a layout that fits them.
  assert.deepEqual(G.mainViewFor({ ...saved, layoutId: 'm-1' }, n => n !== 'Clipper'), { shown: ['FocusShell', 'Workout'], layoutId: 'm-2r' });
  assert.deepEqual(G.mainViewFor(saved, n => n !== 'Clipper'), { shown: ['FocusShell', 'Workout'], layoutId: 'm-3c' });
  assert.equal(G.mainViewFor(saved, n => n === 'FocusShell'), null);
  assert.equal(G.mainViewFor(null, () => true), null);
});

// ---------- Personal (#177) ----------
import { isPersonal, personalArgs, seedPersonal } from './personal.js';
import { mergeProjects as mergeP } from './projects.js';
import fsP from 'node:fs';
import osP from 'node:os';
import pathP from 'node:path';

test('Personal: projects.json marks the kind; it starts without the lead prompt', () => {
  const out = mergeP([{ name: 'Personal', path: 'G:/S/Personal', kind: 'personal' }, { name: 'A', path: 'G:/S/A', kind: 'weird' }], [{ name: 'A', path: 'G:/S/A' }], 'G:/S/FocusShell/manager');
  assert.deepEqual(out.map(p => [p.name, p.kind]), [['A', ''], ['Personal', 'personal']]);
  assert.ok(isPersonal(out[1]) && !isPersonal(out[0]));
  const args = personalArgs('Personal');
  assert.deepEqual(args.slice(2, 6), ['-n', 'lead-Personal', '--remote-control', 'lead-Personal']);
  assert.ok(!args.some(a => /append-system-prompt/.test(a)));
  assert.deepEqual(personalArgs('Personal', 'fb5bcd84-76e6-4e35-8628-01a5e6addba4').slice(-2), ['--resume', 'fb5bcd84-76e6-4e35-8628-01a5e6addba4']);
});

test('Personal: the template seeds a new folder once, never overwriting, with a pre-push hook', () => {
  const tmp = fsP.mkdtempSync(pathP.join(osP.tmpdir(), 'personal-')), tpl = pathP.join(tmp, 'tpl'), dir = pathP.join(tmp, 'Personal');
  fsP.mkdirSync(pathP.join(tpl, 'topics'), { recursive: true }); fsP.mkdirSync(pathP.join(tpl, 'git-hooks'));
  fsP.writeFileSync(pathP.join(tpl, 'CLAUDE.md'), 'rules'); fsP.writeFileSync(pathP.join(tpl, 'topics', 'training.md'), 'stub');
  fsP.writeFileSync(pathP.join(tpl, 'git-hooks', 'pre-push'), 'exit 1');
  fsP.mkdirSync(pathP.join(dir, 'topics'), { recursive: true }); fsP.writeFileSync(pathP.join(dir, 'topics', 'training.md'), 'mine');
  const calls = [], git = (args, cwd) => { calls.push(args[0]); if (args[0] === 'init') fsP.mkdirSync(pathP.join(cwd, '.git')); };
  assert.equal(seedPersonal(tpl, dir, git), true);
  assert.equal(fsP.readFileSync(pathP.join(dir, 'CLAUDE.md'), 'utf8'), 'rules');
  assert.equal(fsP.readFileSync(pathP.join(dir, 'topics', 'training.md'), 'utf8'), 'mine');
  assert.ok(!fsP.existsSync(pathP.join(dir, 'git-hooks')));
  assert.equal(fsP.readFileSync(pathP.join(dir, '.git', 'hooks', 'pre-push'), 'utf8'), 'exit 1');
  assert.deepEqual(calls, ['init', 'add', 'commit']);
  assert.equal(seedPersonal(tpl, dir, git), false, 'a folder with CLAUDE.md is left alone');
  fsP.rmSync(tmp, { recursive: true, force: true });
});

test('VS Code servers left by an FocusShell that is gone are found, a running one is not (#196)', () => {
  const dir = 'D:\SideProjects\Atlas\state\vscode-server';
  const procs = [
    { pid: 1, ppid: 0, created: 100, cmd: 'electron.exe app' },
    { pid: 2, ppid: 1, created: 200, cmd: `code-tunnel.exe serve-web --server-data-dir ${dir}` },
    { pid: 3, ppid: 2, created: 210, cmd: `node.exe server-main.js --server-data-dir ${dir}` },
    { pid: 4, ppid: 99, created: 50, cmd: `node.exe server-main.js --server-data-dir d:\sideprojects\atlas\state\vscode-server` },
    { pid: 5, ppid: 6, created: 60, cmd: `node.exe server-main.js --server-data-dir ${dir}` },
    { pid: 6, ppid: 0, created: 900, cmd: 'notepad.exe' },
    { pid: 7, ppid: 99, created: 70, cmd: 'node.exe other.js' },
  ];
  assert.deepEqual(orphanServers(procs, dir), [4, 5]);
});

import { repeatOf, repeatLabel, nextDue, rollRepeat, setSchedule } from './me.js';

test('me: a repeating item ticked done moves to its next date and notifies again then (#198)', () => {
  const md = [
    '# Me tasks',
    '- [ ] #1 Invest (2026-10-05, user)', '  > Due: 2026-10-05 09:00', '  > Repeat: every 1 week', '  > Sketch: sketches/Me/a.excalidraw',
    '- [ ] #2 Water plants (2026-10-05, user)', '  > Due: 2026-10-05', '  > Repeat: every 3 days',
    '- [ ] #3 No date (2026-10-05, user)', '  > Repeat: every 1 week',
  ].join('\n');
  const ts = parseTasks(md);
  assert.deepEqual(repeatOf(ts[0]), { every: 1, unit: 'week', days: 7 });
  assert.equal(repeatLabel(repeatOf(ts[1])), 'every 3 days');
  assert.equal(repeatLabel(repeatOf(ts[0])), 'every week');
  assert.deepEqual(repeatOf(parseTasks('- [ ] #9 X (d, user)\n  > Due: 2026-10-05\n  > Repeat: every week')[0]), { every: 1, unit: 'week', days: 7 });
  assert.equal(repeatOf(ts[2]), null, 'a repeat needs a Due line');
  // Ticked on the day: a week after the old due date, same time, other lines kept.
  const rolled = rollRepeat(md, ts[0], new Date(2026, 9, 5, 9, 30));
  const t1 = parseTasks(rolled)[0];
  assert.equal(t1.mark, ' ');
  assert.deepEqual(t1.details, ['Due: 2026-10-12 09:00', 'Repeat: every 1 week', 'Sketch: sketches/Me/a.excalidraw']);
  assert.equal(rollRepeat(md, ts[2]), null);
  // It notifies again on the new date, not before.
  const seen = dueReminders(ts, new Date(2026, 9, 5, 9, 0), []).map(r => r.key);
  assert.deepEqual(dueReminders(parseTasks(rolled), new Date(2026, 9, 11, 9, 0), seen).filter(r => r.n === 1), []);
  assert.deepEqual(dueReminders(parseTasks(rolled), new Date(2026, 9, 12, 9, 0), seen).filter(r => r.n === 1).length, 1);
  // Missed for three weeks: still overdue and notified once, then ticked: the coming Monday.
  const late = new Date(2026, 9, 27, 15, 0);
  assert.ok(groupMe(ts, late).today.some(t => t.n === 1));
  assert.equal(dueReminders(ts, late, seen).filter(r => r.n === 1).length, 0);
  assert.equal(nextDue(dueOf(ts[0]), repeatOf(ts[0]), late).day, '2026-11-02');
  // Ticked early: still one period on.
  assert.equal(nextDue(dueOf(ts[1]), repeatOf(ts[1]), new Date(2026, 9, 1)).day, '2026-10-08');
});

test('me: the Self page sets, changes and clears an item\'s time and repeat (#198)', () => {
  const md = '- [ ] #1 Invest (2026-10-05, user)\n  > Someday\n- [ ] #2 Other (2026-10-05, user)';
  const set = setSchedule(md, 1, { day: '2026-10-12', time: '09:00', every: 2, unit: 'week' });
  assert.deepEqual(parseTasks(set)[0].details, ['Due: 2026-10-12 09:00', 'Repeat: every 2 weeks', 'Someday']);
  const daily = setSchedule(set, 1, { day: '2026-10-12', time: '', every: 1, unit: 'day' });
  assert.deepEqual(parseTasks(daily)[0].details, ['Due: 2026-10-12', 'Repeat: every 1 day', 'Someday']);
  assert.deepEqual(repeatOf(parseTasks(daily)[0]), { every: 1, unit: 'day', days: 1 });
  assert.deepEqual(parseTasks(setSchedule(daily, 1, { day: '', every: 1 }))[0].details, ['Someday']);
  assert.equal(parseTasks(set)[1].details.length, 0);
});

test('a model the CTO names in an open request is read, anything else is ignored (#202)', () => {
  assert.equal(requestModel('Habitly\r\nmodel=haiku\r\n'), 'haiku');
  assert.equal(requestModel('worktree\nmodel=Sonnet'), 'sonnet');
  assert.equal(requestModel('Habitly'), '');
  assert.equal(requestModel('Habitly\nmodel=gpt4'), '');
});

test('the owner\'s tavern robots live in settings, empty by default (#358)', () => {
  assert.deepEqual(normalizeSettings({}).tavernRobots, {});
  assert.deepEqual(normalizeSettings({ tavernRobots: { NoteNest: 'compass', '*': 'general-1', Bad: 'x y', N: 3 } }).tavernRobots, { NoteNest: 'compass', '*': 'general-1' });
});

test('Remote Control and the backup push: off for a new install, kept on for an older settings file (#346)', () => {
  assert.equal(normalizeSettings(null).remoteControl, false);
  assert.equal(normalizeSettings({}).backupPush, false);
  assert.equal(normalizeSettings({ remoteControl: true, backupPush: 'yes' }).remoteControl, true);
  assert.equal(normalizeSettings({ backupPush: 'yes' }).backupPush, false);
  assert.deepEqual(upgradeSettings({ runPm: true }), { runPm: true, remoteControl: true, backupPush: true });
  assert.deepEqual(upgradeSettings({ remoteControl: false }), { remoteControl: false, backupPush: true });
  assert.equal(upgradeSettings({ remoteControl: false, backupPush: false }), null);
  assert.equal(upgradeSettings(null), null);
  const lead = withoutRemote(leadArgs('Habitly', 'p.md'));
  assert.ok(!lead.includes('--remote-control'));
  assert.deepEqual(lead.slice(2, 4), ['-n', 'lead-Habitly']);
  assert.deepEqual(withoutRemote(managerArgs()), ['/c', 'claude', '-n', 'cto', '--permission-mode', 'auto']);
  assert.deepEqual(pmArgs(undefined, 'pm.md').slice(-2), ['--append-system-prompt-file', 'pm.md'], 'the PM gets the note on where FocusShell is');
  assert.ok(!pmArgs().includes('--append-system-prompt-file'));
});

test('the CTO and PM skip exactly the developer guide above their folders (#349)', () => {
  const s = ownSetupSettings('D:\\Data\\FocusShell\\');
  assert.deepEqual(s.claudeMdExcludes, ['D:/Data/FocusShell/CLAUDE.md', 'D:/Data/FocusShell/CLAUDE.local.md', 'D:\\Data\\FocusShell\\CLAUDE.md', 'D:\\Data\\FocusShell\\CLAUDE.local.md']);
  assert.deepEqual(withSettings(managerArgs('cto', 'p.md'), 's.json').slice(-2), ['--settings', 's.json']);
  assert.deepEqual(withSettings(['a'], null), ['a']);
});

test('Demo sessions run as demo-<name> without Remote Control, so they never clash with real ones (#135)', () => {
  const lead = demoArgs(leadArgs('Habitly', 'p.md', 'fb5bcd84-76e6-4e35-8628-01a5e6addba4'));
  assert.deepEqual(lead.slice(2, 4), ['-n', 'demo-lead-Habitly']);
  assert.ok(!lead.includes('--remote-control') && !lead.includes('lead-Habitly'));
  assert.deepEqual(lead.slice(-2), ['--resume', 'fb5bcd84-76e6-4e35-8628-01a5e6addba4']);
  assert.deepEqual(demoArgs(managerArgs()).slice(2, 4), ['-n', 'demo-cto']);
  assert.deepEqual(demoArgs(pmArgs()).slice(2, 4), ['-n', 'demo-pm']);
  assert.equal(sessionName('Habitly:2', 'demo-'), 'demo-lead-Habitly-2');
  assert.match(DEMO_NOTE, /Never message a session whose name does not start with `demo-`/);
});

import { sortTodo } from './me.js';

test('me: To do lists newest first by default, or oldest first, or by priority (#204)', () => {
  const md = [
    '- [ ] #1 Old (2026-10-01, user)', '  > Priority: 2',
    '- [ ] #2 Newer (2026-10-05, user)',
    '- [ ] #3 Same day, added later (2026-10-05, user)', '  > Priority: 1',
    '- [ ] #4 Middle (2026-10-03, user)', '  > Priority: 2',
  ].join('\n');
  const order = by => sortTodo(parseTasks(md), by).map(t => t.n);
  assert.deepEqual(groupMe(parseTasks(md), new Date(2026, 9, 6)).todo.map(t => t.n), [3, 2, 4, 1]);
  assert.deepEqual(order('oldest'), [1, 4, 2, 3]);
  assert.deepEqual(order('priority'), [3, 4, 1, 2]);
  assert.deepEqual(groupMe(parseTasks(md), new Date(2026, 9, 6), 'oldest').todo.map(t => t.n), [1, 4, 2, 3]);
});

test('textParts cuts an item line into text and links (#207)', () => {
  const s = String.raw`Report: D:\Work\project\docs\a.md (evidence beside it), see https://x.dev/p.`;
  const p = textParts(s);
  assert.deepEqual(p.map(x => x.text), ['Report: ', String.raw`D:\Work\project\docs\a.md`, ' (evidence beside it), see ', 'https://x.dev/p', '.']);
  assert.deepEqual(p.map(x => !!x.link), [false, true, false, true, false]);
  assert.deepEqual(textParts('no links here'), [{ text: 'no links here' }]);
  // A path stretched past a space swallows what looked like a second link.
  const t = String.raw`D:\Claude Setup\x.md and D:\y.md`;
  const ls = findLinks(t); ls[0] = { ...ls[0], text: t };
  assert.deepEqual(textParts(t, ls).map(x => x.text), [t]);
});

import { messageText, summarize, firstDifference, inputsSummary } from '../../manager/.claude/skills/compare-models/compare.mjs';

test('compare-models reads the prompt, report, timing and tokens from a lead conversation (#211)', () => {
  const wrap = t => `Another Claude session sent a message:\n<cross-session-message from="uds:x" from-name="cto" from-mode="prompting">\n${t}\n</cross-session-message>\n\nThis came from another Claude session`;
  assert.equal(messageText(wrap('TASK #1: build it')), 'TASK #1: build it');
  assert.equal(messageText('typed by hand'), null);
  const line = o => JSON.stringify(o);
  const lines = [
    line({ type: 'user', timestamp: '2026-10-06T10:00:00.000Z', message: { content: wrap('TASK #1: build it') } }),
    line({ type: 'assistant', timestamp: '2026-10-06T10:01:00.000Z', message: { id: 'm1', model: 'claude-haiku-4-5', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 }, content: [] } }),
    line({ type: 'assistant', timestamp: '2026-10-06T10:01:00.000Z', message: { id: 'm1', model: 'claude-haiku-4-5', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 }, content: [] } }),
    'not json',
    line({ type: 'user', timestamp: '2026-10-06T10:02:00.000Z', message: { content: wrap('ANSWER #1: later') } }),
    line({ type: 'assistant', timestamp: '2026-10-06T10:04:00.000Z', message: { id: 'm2', model: 'claude-haiku-4-5', usage: { input_tokens: 1, output_tokens: 7 },
      content: [{ type: 'tool_use', name: 'SendMessage', input: { to: 'cto', message: 'DONE #1 | built | tests: none | commit: abc' } }] } }),
  ];
  const s = summarize(lines);
  assert.equal(s.prompt, 'TASK #1: build it', 'the first message is the prompt, a later one is not');
  assert.deepEqual([s.received, s.last, s.models, s.report], ['2026-10-06T10:00:00.000Z', '2026-10-06T10:04:00.000Z', ['claude-haiku-4-5'], 'DONE #1 | built | tests: none | commit: abc']);
  assert.deepEqual([s.messages, s.tokens.output, s.tokens.input, s.tokens.cacheRead], [2, 12, 11, 100], 'a message written twice counts once');
  assert.equal(firstDifference('same', 'same'), -1);
  assert.equal(firstDifference('abcd', 'abXd'), 2);
});

test('compare-models says whether every folder started from the same input files (#214)', () => {
  const pics = { 'images/01.jpg': 'aa', 'images/02.jpg': 'bb' };
  assert.equal(inputsSummary([pics, { ...pics }]), 'Inputs: identical in every folder, 2 files (images/).');
  assert.equal(inputsSummary([{}, {}]), 'Inputs: none, every folder started empty.');
  assert.match(inputsSummary([pics, { ...pics, 'images/02.jpg': 'cc' }]), /^Inputs: NOT identical/);
  assert.match(inputsSummary([pics, { 'images/01.jpg': 'aa' }]), /2 file\(s\) against 1 file\(s\)/);
});

import { searchIndex, searchItems } from './search.js';
test('search: word starts, typos, numbers, projects, open before done', () => {
  const idx = searchIndex([
    ...parseTasks(md).map(task => ({ project: 'Streaky', task })),
    { project: 'Me', task: { mark: ' ', n: 3, text: 'Renew the domain', date: '2026-10-05', details: ['Before the streak site expires'] } },
  ]);
  const titles = q => searchItems(idx, q).map(e => e.task.text);
  assert.deepEqual(titles('dark mo'), ['Dark mode']);
  assert.deepEqual(titles('midnite'), []); // short of five letters and wrong: no guess
  assert.deepEqual(titles('rollovr'), ['Fix midnight rollover bug']); // one letter off
  assert.deepEqual(titles('#8'), ['Streak freeze purchase flow']);
  assert.deepEqual(titles('streak').slice(0, 2), ['Streak freeze purchase flow', 'Dark mode']); // title first, then the project name
  assert.deepEqual(titles('streak').slice(2), ['Renew the domain', 'Fix midnight rollover bug']); // a detail line, then a done item
  assert.deepEqual(titles('me renew'), ['Renew the domain']);
  assert.deepEqual(titles('').length, 3);
  assert.ok(!titles('').includes('Fix midnight rollover bug')); // nothing typed: open items only
  assert.deepEqual(titles('ბ'), []);
});

import { searchSections, sectionOf, matchedDetail } from './search.js';
test('search: sections in Home order with Done last, and the detail that matched (#235)', () => {
  const t = (mark, n, text, extra = {}) => ({ project: 'X', task: { mark, n, text, date: '2026-10-0' + n, details: [], ...extra } });
  const idx = searchIndex([
    t('x', 1, 'Reddit post done'), t(' ', 2, 'Reddit thread'), t('~', 3, 'Reddit ads'),
    t('?', 4, 'Reddit budget'), t(' ', 5, 'Ship it', { forOwner: true, details: ['Tags: Research', 'Post the link on reddit'] }),
  ]);
  assert.equal(sectionOf({ mark: '!' }), 'you');
  assert.equal(sectionOf({ mark: '~', forOwner: true }), 'you');
  const secs = searchSections(searchItems(idx, 'reddit'));
  assert.deepEqual(secs.map(s => s.label), ['For you', 'Open', 'Doing', 'Done']);
  assert.deepEqual(secs[0].items.map(e => e.task.n), [4, 5]); // title match before detail match
  assert.deepEqual(searchSections(searchItems(idx, 'thread')).map(s => s.key), ['open']); // empty sections left out
  const ship = idx.find(e => e.task.n === 5);
  assert.equal(matchedDetail(ship, 'reddit'), 'Post the link on reddit');
  assert.equal(matchedDetail(ship, 'research'), ''); // a Tags line shows as a badge, not a detail
  assert.equal(matchedDetail(ship, 'ship'), ''); // matched the title
});
import './tavern.test.js';
import './boardsort.test.js';
import './package.test.js';
import './status.test.js';
import './windowguard.test.js';
import './guard.test.js';
import './pidfile.test.js';
import './joined.test.js';

import { inputDraft } from './prompts.js';

test('prompts: the owner\'s unsent draft in the input box (#243)', () => {
  const rule = '────────────────────────────────────────';
  assert.equal(inputDraft(['> ANSWER #23: sent earlier', '', rule, '> ', rule, '  ? for shortcuts']), '');
  assert.equal(inputDraft(['', rule, '> 23- show me on the', rule]), '23- show me on the');
  assert.equal(inputDraft([rule, '❯ first line', '  second line', rule, '']), 'first line\n  second line');
  assert.equal(inputDraft(['╭──────────────────╮', '│ > half written   │', '╰──────────────────╯']), 'half written');
  // A sent prompt in the conversation, an option of a dialog, or no box at all.
  assert.equal(inputDraft(['> ANSWER #23: show it live first', '  ⎿ sent']), null);
  assert.equal(inputDraft([rule, '> 1. Yes', '  2. No']), null);
  assert.equal(inputDraft(['D:\SideProjects\FocusShell>']), null);
});

import { navHistory, MAX_STEPS } from './navhistory.js';
test('back and forward: a new view is a step, the same view only updates it (#301)', () => {
  const nav = navHistory(s => s.view);
  assert.equal(nav.note({ view: 'dash' }), true);
  assert.equal(nav.note({ view: 'dash', scroll: 40 }), false);
  nav.note({ view: 'project' }); nav.note({ view: 'me' });
  assert.equal(nav.size, 3);
  assert.deepEqual(nav.back(), { view: 'project' });
  assert.deepEqual(nav.back(), { view: 'dash', scroll: 40 });
  assert.equal(nav.back(), null);
  assert.deepEqual(nav.forward(), { view: 'project' });
  assert.deepEqual(nav.forward(), { view: 'me' });
  assert.equal(nav.forward(), null);
});
test('back and forward: something new after going back drops the forward steps; at most 50 kept', () => {
  const nav = navHistory(s => s.view);
  ['a', 'b', 'c'].forEach(view => nav.note({ view }));
  nav.back(); nav.back(); nav.note({ view: 'd' });
  assert.equal(nav.forward(), null);
  assert.deepEqual(nav.back(), { view: 'a' });
  const long = navHistory(s => s.n);
  for (let n = 0; n < 70; n++) long.note({ n });
  assert.equal(long.size, MAX_STEPS);
  assert.equal(long.current.n, 69);
});
test('back and forward: a step whose tab has closed is skipped', () => {
  const nav = navHistory(s => s.view);
  ['a', 'gone', 'c'].forEach(view => nav.note({ view }));
  const ok = s => s.view !== 'gone';
  assert.deepEqual(nav.back(ok), { view: 'a' });
  assert.deepEqual(nav.forward(ok), { view: 'c' });
  assert.equal(nav.back(() => false), null);
  assert.equal(nav.current.view, 'c');
});

import { laterToasts } from './toasts.js';
test('toasts wait five minutes, go once, and only if it still waits (#320)', () => {
  const MIN = 60e3, t = laterToasts(5 * MIN);
  t.hold('wait:A', { what: 'Proceed?' }, 0);
  t.hold('words:1', { lead: 'lead-B' }, 0);
  t.hold('wait:A', { what: 'Proceed?' }, 2 * MIN);           // seen again: keeps its first time
  assert.deepEqual(t.due(4 * MIN), [], 'nothing before five minutes');
  t.drop('words:1');                                          // answered in the app
  const due = t.due(5 * MIN);
  assert.deepEqual(due.map(a => a.key), ['wait:A']);
  assert.deepEqual(t.due(20 * MIN), [], 'never twice');
  t.hold('wait:A', { what: 'Proceed?' }, 21 * MIN);
  assert.deepEqual(t.due(40 * MIN), [], 'a key that toasted stays quiet');
  t.hold('wait:C', {}, 0);
  assert.deepEqual(t.due(10 * MIN, () => false), [], 'no longer waiting: dropped');
  assert.equal(t.size, 0);
});

import { usingApp, shouldToast, ACTIVE_FOR } from './toasts.js';
test('using FocusShell: focused, not minimised, touched in the last minute (#320)', () => {
  assert.equal(usingApp({ focused: true, minimized: false, idleSecs: 5 }), true);
  assert.equal(usingApp({ focused: true, minimized: false, idleSecs: ACTIVE_FOR / 1000 + 1 }), false, 'focused but left alone: away');
  assert.equal(usingApp({ focused: false, minimized: false, idleSecs: 0 }), false, 'in the background: away');
  assert.equal(usingApp({ focused: true, minimized: true, idleSecs: 0 }), false, 'minimised: away');
});
test('due alerts toast only while away; Me reminders always (#320)', () => {
  assert.equal(shouldToast('alert', true), false);
  assert.equal(shouldToast('alert', false), true);
  assert.equal(shouldToast('reminder', true), true);
  assert.equal(shouldToast('reminder', false), true);
});

test('a Claude session keeps its shell after Claude exits (#353)', () => {
  const k = keepShell(leadArgs('FocusShell', 'p.md'));
  assert.deepEqual(k.slice(0, 2), ['/k', 'claude']);
  assert.deepEqual(k.slice(k.indexOf('&'), k.indexOf('&') + 3), ['&', 'title', CLAUDE_ENDED]);
  assert.ok(k.includes('--append-system-prompt-file'));
  const smoke = ['/k', 'echo hi'];
  assert.equal(keepShell(smoke), smoke);
});
test('cmd special characters in a folder name or path never run as commands (#388)', () => {
  assert.equal(nameProblem('FocusShell'), null);
  assert.equal(nameProblem('My Project-2.0_x'), null);
  for (const bad of ['R&D', 'x|y', 'a^b', '50%', 'hi!', 'a(b)', 'q"t', 'a<b', 'a>b']) assert.match(nameProblem(bad), /cannot start: .*Rename the folder/, bad);
  const line = commandLine(keepShell(leadArgs('X', 'C:\\Users\\A&B\\AppData\\deck\\state\\prompts\\lead-X.md')));
  assert.match(line, /^\/k claude -n lead-X /);
  assert.ok(line.includes('--append-system-prompt-file "C:\\Users\\A&B\\AppData\\deck\\state\\prompts\\lead-X.md" & title focusshell-claude-ended & echo'), line);
  assert.equal(commandLine(['/c', 'claude', '--add-dir', 'D:\\a b\\']), '/c claude --add-dir "D:\\a b\\\\"');
  assert.throws(() => commandLine(['/c', 'claude', '--settings', 'C:\\Users\\50%off\\s.json']), /holds %/);
  assert.throws(() => commandLine(['/c', 'claude', '--settings', 'C:\\q"t\\s.json']), /holds "/);
  assert.equal(spawnArgs(['/k', 'echo smoke']).length, 2, 'not a Claude session: left to node-pty');
  assert.equal(typeof spawnArgs(['/c', 'claude', '-n', 'pm']), 'string');
});
test('cmd\'s title tells when Claude ended in a pane and when it came back (#353)', () => {
  const t = s => `\x1b]0;${s}\x1b\\`;
  assert.equal(shellTitle('plain output'), null);
  assert.equal(shellTitle(t('C:\\WINDOWS\\system32\\cmd.exe - title  focusshell-claude-ended ')), null);
  assert.equal(shellTitle(t('focusshell-claude-ended ') + 'Claude has exited.'), 'ended');
  assert.equal(shellTitle(t('focusshell-claude-ended  - dir')), 'ended');
  assert.equal(shellTitle(t('focusshell-claude-ended  - claude  --resume "cto"')), 'back');
  assert.equal(shellTitle(t('focusshell-claude-ended  - claude.cmd')), 'back');
  assert.equal(shellTitle(t('focusshell-claude-ended  - claude.exe')), 'back');
  assert.equal(shellTitle(t('focusshell-claude-ended  - claudette')), 'ended');
  assert.equal(shellTitle(`\x1b]0;focusshell-claude-ended  - claude\x07` + t('focusshell-claude-ended ')), 'ended');
  assert.equal(shellTitle('focusshell-claude-ended printed as text'), null);
});
test('a project keeps its pane colour, whatever the case of its name', () => {
  assert.equal(paneColour('FocusShell', 8), paneColour('focusshell', 8));
  for (const n of ['FocusShell', 'Blogger', 'Streaky', '']) assert.ok(paneColour(n, 8) >= 0 && paneColour(n, 8) < 8);
  assert.notEqual(paneColour('FocusShell', 8), paneColour('Blogger', 8));
});

import { onPath, missingTools, olderThan } from './requirements.js';
test('Claude Code older than 2.1.234 is too old for the CTO and leads to message each other (#1113)', () => {
  assert.equal(olderThan('2.1.233'), true);
  assert.equal(olderThan('2.1.234 (Claude Code)'), false);
  assert.equal(olderThan('2.1.302'), false);
  assert.equal(olderThan('2.0.999'), true);
  assert.equal(olderThan('3.0.0'), false);
  assert.equal(olderThan(''), false, 'an unreadable version is not called old');
});
test('Claude Code is found as claude.exe or claude.cmd, and a missing tool shows with its link (#390)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'req-')), a = path.join(tmp, 'a'), b = path.join(tmp, 'b');
  fs.mkdirSync(a); fs.mkdirSync(b);
  fs.writeFileSync(path.join(a, 'claude.exe'), ''); fs.writeFileSync(path.join(b, 'node.cmd'), ''); fs.writeFileSync(path.join(b, 'claude'), '');
  const env = { PATH: [a, b].join(path.delimiter), PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  assert.equal(onPath('claude', env), true);
  assert.equal(onPath('node', env), true);
  assert.equal(onPath('claude', { ...env, PATH: b }), false, 'an extensionless npm shell script is not something cmd runs');
  assert.equal(onPath('claude', { PATH: `"${a}"` }), true, 'quoted PATH folder, default PATHEXT');
  assert.equal(onPath('git', env), false);
  assert.deepEqual(missingTools(() => true), []);
  const miss = missingTools(t => t !== 'node');
  assert.deepEqual(miss.map(m => m.name), ['Node.js']);
  assert.match(miss[0].url, /^https:\/\/nodejs\.org\//);
  assert.equal(missingTools(() => false).length, 2);
  fs.rmSync(tmp, { recursive: true, force: true });
});

import { updatesOn, updateLabel } from './update.js';
test('updates: only the installed app updates itself, and the title bar names the version (#1088)', () => {
  assert.equal(updatesOn({ packaged: true }), true);
  assert.equal(updatesOn({ packaged: false }), false, 'a development run');
  assert.equal(updatesOn({ packaged: true, smoke: true }), false);
  assert.equal(updatesOn({ packaged: true, tryRun: true }), false);
  assert.equal(updatesOn({ packaged: true, demo: true }), false);
  assert.equal(updateLabel({ ready: true, version: '0.4.0', latest: '0.5.0' }), 'Update ready: v0.5.0');
  assert.equal(updateLabel({ ready: false, version: '0.4.0', latest: '0.5.0' }), '');
  assert.equal(updateLabel(null), '');
});
