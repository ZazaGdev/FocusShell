// The board guard (#349). Imported by lib.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isBoard, guardReason } from './guard.js';

const D = String.raw`D:\Data\FocusShell`;
const edit = file_path => ({ tool_name: 'Edit', tool_input: { file_path } });
const sh = command => ({ tool_name: 'Bash', tool_input: { command } });

test('guard: board files are tasks, ideas, notes and notes.md; goals and briefs are not (#349)', () => {
  for (const f of [String.raw`D:\Data\FocusShell\tasks\Me.md`, 'd:/data/focusshell/ideas/Me.md', String.raw`D:\Data\FocusShell\notes\X.md`, String.raw`D:\Data\FocusShell\notes.md`])
    assert.ok(isBoard(f, D), f);
  for (const f of [String.raw`D:\Data\FocusShell\goals\Me.md`, String.raw`D:\Data\FocusShell\briefs\X\1.md`, String.raw`D:\Data\FocusShell\manager\CLAUDE.md`, String.raw`D:\Other\tasks\Me.md`, String.raw`D:\Data\FocusShell\tasksx.md`])
    assert.ok(!isBoard(f, D), f);
});

test('guard: refuses a hand edit or a scripted write of a board, lets everything else run (#349)', () => {
  assert.match(guardReason(edit(String.raw`D:\Data\FocusShell\tasks\Me.md`), D), /board file: change boards only with the deck command/);
  assert.match(guardReason({ tool_name: 'Write', tool_input: { file_path: String.raw`D:\Data\FocusShell\notes.md` } }, D), /board file/);
  assert.equal(guardReason(edit(String.raw`D:\Data\FocusShell\goals\Me.md`), D), '');
  assert.equal(guardReason(edit(String.raw`D:\Data\FocusShell\briefs\FocusShell\9.md`), D), '');
  assert.match(guardReason(sh(`echo x >> tasks/Me.md`), D), /board file/);
  assert.match(guardReason(sh(String.raw`sed -i 's/a/b/' D:\Data\FocusShell\tasks\Me.md`), D), /board file/);
  assert.match(guardReason({ tool_name: 'PowerShell', tool_input: { command: String.raw`Set-Content -Path D:\Data\FocusShell\ideas\Me.md -Value x` } }, D), /board file/);
  assert.equal(guardReason(sh(String.raw`node 'D:\Data\FocusShell\deck.mjs' add Me 'x' > out.txt`), D), '');
  assert.equal(guardReason(sh(`grep -n x tasks/Me.md > /tmp/found.txt`), D), '', 'reading a board and writing elsewhere is fine');
  assert.equal(guardReason(sh(`cat tasks/Me.md`), D), '');
  assert.equal(guardReason(sh(`echo hi > goals/Me.md`), D), '');
  assert.equal(guardReason({ tool_name: 'Read', tool_input: { file_path: String.raw`D:\Data\FocusShell\tasks\Me.md` } }, D), '');
});
