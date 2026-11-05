// The Mac side of starting sessions and Claude turns (#2562), checked on any system.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { shellCommand, pathFromProbe, mergePath, loginPath, PATH_PROBE } from './shell.js';
import { posixSpawn, leadArgs, CLAUDE_ENDED, shellTitle } from './sessions.js';
import { onPath } from './requirements.js';
import { helperCommand } from './helper.js';

test('a command line runs through cmd.exe on Windows and sh in its own process group on a Mac', () => {
  assert.deepEqual(shellCommand('claude -p', 'win32'), { file: 'cmd.exe', args: ['/d', '/s', '/c', 'claude -p'], opts: { windowsHide: true, windowsVerbatimArguments: true } });
  assert.deepEqual(shellCommand('claude -p', 'darwin'), { file: '/bin/sh', args: ['-c', 'claude -p'], opts: { detached: true } });
});

test('the login shell PATH is read between markers and comes first', () => {
  assert.equal(pathFromProbe(`Welcome!\n__FOCUSSHELL_PATH__/Users/a/.local/bin:/opt/homebrew/bin:/usr/bin__FOCUSSHELL_PATH__\n`), '/Users/a/.local/bin:/opt/homebrew/bin:/usr/bin');
  assert.equal(pathFromProbe('nothing here'), null);
  assert.equal(mergePath('/a:/usr/bin', '/usr/bin:/bin'), '/a:/usr/bin:/bin');
  let asked;
  const run = (sh, args) => { asked = [sh, args]; return '__FOCUSSHELL_PATH__/x/bin:/usr/bin__FOCUSSHELL_PATH__'; };
  assert.equal(loginPath({ SHELL: '/bin/bash', PATH: '/usr/bin:/bin' }, 'darwin', run), '/x/bin:/usr/bin:/bin');
  assert.deepEqual(asked, ['/bin/bash', ['-ilc', PATH_PROBE]]);
  assert.equal(loginPath({ PATH: '/usr/bin' }, 'darwin', () => { throw new Error('no shell'); }), '/usr/bin', 'a failing shell keeps the app PATH');
  assert.equal(loginPath({ PATH: 'C:\\x' }, 'win32', () => { throw new Error('not asked'); }), 'C:\\x', 'Windows keeps its own PATH');
});

test('a Mac session passes claude its arguments as they are, then stays a shell with the title marker', () => {
  const args = leadArgs('R&D "x" $(rm)', '/Users/a/deck/state/prompts/lead-R&D.md');
  const s = posixSpawn(args, '/bin/zsh');
  assert.equal(s.file, '/bin/zsh');
  assert.equal(s.line[0], '-c');
  assert.equal(s.line[2], '/bin/zsh', '$0 is the shell, for the exec at the end');
  assert.deepEqual(s.line.slice(3), args.slice(1), 'every argument goes through "$@" untouched');
  assert.match(s.line[1], /^"\$@"; printf/);
  assert.ok(s.line[1].includes(CLAUDE_ENDED));
  assert.match(s.line[1], /exec "\$0" -l$/);
  assert.equal(shellTitle(`\x1b]0;${CLAUDE_ENDED}\x07`), 'ended', 'the marker the script prints reads as ended');
  assert.equal(posixSpawn(args, '').file, '/bin/zsh', 'no SHELL falls back to zsh');
});

test('the smoke run\'s cmd-style lines run as sh lines on a Mac', () => {
  assert.deepEqual(posixSpawn(['/k', "echo 'cto (smoke)'"], '/bin/sh').line, ['-c', `echo 'cto (smoke)'; exec "$0"`, '/bin/sh']);
  assert.deepEqual(posixSpawn(['/c', 'echo No conversation found; exit 1'], '/bin/sh').line, ['-c', 'echo No conversation found; exit 1', '/bin/sh']);
});

test('the smoke run\'s cmd lines are said in sh\'s words on a Mac', async () => {
  const { shLine } = await import('./smokeshell.js');
  assert.equal(shLine('cls\r'), 'clear\r');
  assert.equal(shLine('cls & echo  Do you want to proceed? & echo  ^> 1. Yes\r'), "clear; echo ' Do you want to proceed?'; echo ' > 1. Yes'\r");
  assert.equal(shLine("echo it's\r"), "echo 'it'\\''s'\r");
  assert.equal(shLine('typed-1387'), 'typed-1387', 'text typed into a prompt goes as it is');
  assert.equal(shLine('\x1b'), '\x1b');
});

test('a Mac finds a tool on PATH by its bare name', () => {
  // A folder relative to here, so its name holds no drive colon when this runs on Windows.
  const d = fs.mkdtempSync('onpath-');
  try {
    fs.writeFileSync(path.join(d, 'claude'), '');
    assert.ok(onPath('claude', { PATH: `/nope:${d}` }, 'darwin'));
    assert.ok(!onPath('node', { PATH: d }, 'darwin'));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('a Mac helper turn leaves out a path sh would expand', () => {
  assert.match(helperCommand({ promptFile: '/Users/a/p.txt' }, 'darwin'), /--system-prompt-file "\/Users\/a\/p\.txt"/);
  assert.doesNotMatch(helperCommand({ promptFile: '/Users/$HOME/p.txt' }, 'darwin'), /system-prompt-file/);
  assert.match(helperCommand({ read: '/Users/a/r 1/frames' }, 'darwin'), /--add-dir "\/Users\/a\/r 1\/frames"/);
  assert.match(helperCommand({ read: 'D:\\r 1\\frames' }, 'win32'), /--add-dir "D:\\r 1\\frames"/, 'Windows unchanged');
});
