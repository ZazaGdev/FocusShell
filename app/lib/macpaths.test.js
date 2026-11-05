// Mac paths in text and on disk (#2562), checked on any system.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAbsPath, expandHome } from './platform.js';
import { findLinks, useMacLinks } from './links.js';
import { MAC } from './platform.js';
import { mdPathRe, relatedFiles } from './tasks.js';
import { relinkShots } from './shots.js';
import { keptPath } from '../plugins/recorder/lib/cleanup.js';
import { modKey } from './platform.js';
import { updateLabel } from './update.js';
import { macCodePaths, parsePs, orphanServers } from './codeweb.js';
import { helloLine, keystatePath, INPUT_MONITORING } from './keystate.js';
import { keysLine } from '../plugins/recorder/lib/ctrl.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { expandEnv, exeName } from '../plugins/recorder/lib/transcript.js';
import { choicesFor } from '../plugins/recorder/lib/choices.js';

test('the recorder finds whisper-cli and ffmpeg without .exe on a Mac, under ~/', () => {
  assert.equal(expandEnv('~/Library/Application Support/editbay/speech', { HOME: '/Users/a' }), '/Users/a/Library/Application Support/editbay/speech');
  assert.equal(expandEnv('~/x', { HOME: 'C:\\Users\\a' }), '~/x', 'a Windows HOME (Git Bash) leaves it as written');
  assert.equal(exeName('whisper-cli', false), 'whisper-cli');
  assert.equal(exeName('ffmpeg', true), 'ffmpeg.exe');
  const w = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-'));
  fs.writeFileSync(path.join(w, 'ffmpeg'), '');
  const s = { whisperDir: w, ffmpeg: 'ffmpeg' };
  const d = { env: { PATH: '' }, defaults: { whisperDir: w }, findCli: dir => (fs.existsSync(path.join(dir, 'whisper-cli')) ? dir : null), win: false };
  assert.deepEqual(choicesFor('whisperDir', s, d).map(c => c.label), [`${w} (no whisper-cli here)`]);
  assert.ok(choicesFor('ffmpeg', s, d).some(c => c.value === path.join(w, 'ffmpeg')), 'an ffmpeg program in the Whisper folder is offered');
  fs.rmSync(w, { recursive: true, force: true });
});

test('the Mac key helper says first whether it may read the keyboard', () => {
  assert.deepEqual(helloLine('ok\n'), { ok: true });
  assert.deepEqual(helloLine('noperm'), { ok: false, why: INPUT_MONITORING });
  assert.match(INPUT_MONITORING, /Privacy & Security > Input Monitoring/);
  assert.equal(helloLine('10'), null, 'a key line is not a hello');
  assert.deepEqual(keysLine('10'), { ctrl: true, other: false }, 'its key lines read as the Windows watcher\'s');
  assert.equal(keystatePath('/A/app'), path.join('/A/app', 'native', 'bin', 'keystate'));
});

test('a Mac finds VS Code in Applications, then in the home folder\'s', () => {
  const bin = base => `${base}/Visual Studio Code.app/Contents/Resources/app/bin`;
  assert.deepEqual(macCodePaths('/Users/a', p => p === `${bin('/Applications')}/code`), { cli: `${bin('/Applications')}/code`, tunnel: `${bin('/Applications')}/code-tunnel` });
  assert.deepEqual(macCodePaths('/Users/a/', p => p === `${bin('/Users/a/Applications')}/code`).cli, `${bin('/Users/a/Applications')}/code`);
  assert.equal(macCodePaths('/Users/a', () => false), null);
});

test('a Mac\'s process list finds a Code pane server whose app is gone', () => {
  const now = 10_000_000;
  const ps = [
    '  501   1  1-02:03:04 /Applications/Visual Studio Code.app/Contents/Resources/app/bin/code-tunnel serve-web --server-data-dir /Users/a/deck/state/vscode-server',
    '  777 600       05:00 node server-main.js --server-data-dir /Users/a/deck/state/vscode-server',
    '  600   1    01:00:00 /Applications/FocusShell.app/Contents/MacOS/FocusShell',
    'garbage line',
  ].join('\n');
  const procs = parsePs(ps, now);
  assert.deepEqual(procs.map(p => [p.pid, p.ppid, now - p.created]), [[501, 0, (26 * 3600 + 3 * 60 + 4) * 1000], [777, 600, 300000], [600, 0, 3600000]]);
  assert.deepEqual(orphanServers(procs, '/Users/a/deck/state/vscode-server'), [501], 'handed to launchd: gone; a live parent keeps its server');
});

test('the app\'s shortcuts use Cmd on a Mac and Ctrl elsewhere', () => {
  assert.ok(modKey({ metaKey: true, ctrlKey: false }, true) && !modKey({ ctrlKey: true, metaKey: false }, true));
  assert.ok(modKey({ ctrlKey: true, metaKey: false }, false) && !modKey({ metaKey: true, ctrlKey: false }, false));
});

test('a Mac says a new version is out instead of installing it', () => {
  assert.equal(updateLabel({ manual: true, latest: '2.1.1' }), 'New version: v2.1.1');
  assert.equal(updateLabel({ manual: true, latest: '' }), '');
  assert.equal(updateLabel({ ready: true, latest: '2.1.1' }), 'Update ready: v2.1.1', 'Windows unchanged');
});

test('a "~/" path is opened under the home folder, everything else as it is', async () => {
  const { onDisk } = await import('./localpath.js');
  assert.equal(onDisk('~/Desktop/notes.md', '/Users/a'), path.normalize('/Users/a/Desktop/notes.md'));
  assert.equal(onDisk('D:\\x\\y.md', '/Users/a'), path.normalize('D:\\x\\y.md'));
});

test('an absolute path is a drive path on Windows and a root or home path on a Mac', () => {
  assert.ok(isAbsPath('D:\\x', false) && isAbsPath('D:/x', false));
  assert.ok(!isAbsPath('/Users/a/x', false), 'Windows unchanged');
  assert.ok(isAbsPath('/Users/a/x', true) && isAbsPath('~/x', true));
  assert.ok(!isAbsPath('x/y', true) && !isAbsPath('D:\\x', true));
  assert.equal(expandHome('~/Desktop/a.png', '/Users/a/'), '/Users/a/Desktop/a.png');
  assert.equal(expandHome('/tmp/x', '/Users/a'), '/tmp/x');
});

test('a Mac pane links paths from the root or home folder, never slash commands or URL paths', () => {
  try {
    useMacLinks(true);
    const t = s => findLinks(s).map(l => l.text);
    assert.deepEqual(t('Report: /Users/a/Claude Setup/x/report.md is ready'), ['/Users/a/Claude Setup/x/report.md']);
    assert.deepEqual(t('saved to ~/Desktop/shot.png.'), ['~/Desktop/shot.png']);
    assert.deepEqual(t('"/Users/a b/c.md"'), ['/Users/a b/c.md']);
    assert.deepEqual(t('run /compact and/or /model now'), []);
    assert.deepEqual(t('see https://example.com/Users/a and D:\\x\\y.md'), ['https://example.com/Users/a', 'D:\\x\\y.md']);
    assert.deepEqual(t('/tmp/a.log then /Volumes/Disk/b.mp4'), ['/tmp/a.log', '/Volumes/Disk/b.mp4']);
  } finally { useMacLinks(MAC); }
  assert.deepEqual(findLinks('Report: /Users/a/x.md').map(l => l.text), MAC ? ['/Users/a/x.md'] : [], 'this system\'s own rule is back');
});

test('an item\'s .md paths keep their leading slash on a Mac', () => {
  const task = { n: 1, text: 'x', result: 'plan at /Users/a/p/docs/plan.md and notes/x.md', details: [] };
  assert.deepEqual(relatedFiles(task, [], mdPathRe(true)).paths, ['/Users/a/p/docs/plan.md', 'notes/x.md']);
  assert.deepEqual(relatedFiles(task, [], mdPathRe(false)).paths, ['Users/a/p/docs/plan.md', 'notes/x.md'], 'Windows unchanged');
});

test('screenshots follow a moved recording with Mac slashes', () => {
  const md = '- [ ] #1 x\n  > Screenshot: /Users/a/deck/state/plugins/recorder/r1/shots/0001.png\n';
  const r = relinkShots(md, '/Users/a/deck/state/plugins/recorder/r1/shots/', '/Users/a/deck/screenshots/r1', true);
  assert.equal(r.md, '- [ ] #1 x\n  > Screenshot: /Users/a/deck/screenshots/r1/0001.png\n');
  assert.equal(keptPath('/Users/a/deck/screenshots/', 'r1', '/x/shots/0001.png', true), '/Users/a/deck/screenshots/r1/0001.png');
  assert.equal(keptPath('D:\\Deck\\screenshots\\', 'r1', 'D:\\x\\0001.png', false), 'D:\\Deck\\screenshots\\r1\\0001.png');
});
