// Lines typed into a pane and checked in the CTO's log (#1029). Run through lib.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunksOf, arrived, boxAfterLine, voiceLive, leftLine } from './ctoline.js';

test('ctoline: a long line goes in pieces that add back up to it', () => {
  const line = 'RECORDING: ' + 'x'.repeat(2083);
  const parts = chunksOf(line);
  assert.equal(parts.length, 11);
  assert.ok(parts.every(p => p.length <= 200));
  assert.equal(parts.join(''), line);
  assert.deepEqual(chunksOf('short'), ['short']);
  assert.deepEqual(chunksOf(''), []);
});

const T = Date.parse('2026-10-18T01:13:15Z');
const user = (t, content) => JSON.stringify({ type: 'user', timestamp: new Date(t).toISOString(), message: { role: 'user', content } });
const queued = (t, content) => JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: new Date(t).toISOString(), content });
const LINE = 'RECORDING: D:\\rec\\transcript.md | FocusShell #1020: Remove it';

test('ctoline: the line is found when sent, when queued mid-turn, and not when cut', () => {
  assert.ok(arrived([user(T, LINE)].join('\n'), LINE, T));
  assert.ok(arrived(['{bad', queued(T + 500, LINE)].join('\n'), LINE, T));
  assert.ok(arrived(user(T, [{ type: 'text', text: LINE }]), LINE, T));
  // what 2026-10-18-0504 actually delivered: only the tail
  assert.equal(arrived(user(T, 'Version 2: chat view as an alternative to terminal view'), LINE, T), false);
  // an older copy of the same line does not count
  assert.equal(arrived(user(T - 60e3, LINE), LINE, T), false);
  assert.equal(arrived('', LINE, T), false);
});

test('ctoline: the prompt box is checked before a typed-in line gets its Enter (#1277)', () => {
  const W = 'WORDS ClaudeSetup #1210: the owner approved; typed into lead-ClaudeSetup: "yes"';
  assert.equal(boxAfterLine(W, W), 'send');
  // wrapped over two rows of the box
  assert.equal(boxAfterLine('WORDS ClaudeSetup #1210: the owner approved; typed into\nlead-ClaudeSetup: "yes"', W), 'send');
  // what 05:29 sent: the owner's dictated words were already in the box
  assert.equal(boxAfterLine(`Can you bring that GIF back to me. ${W}`, W), 'owner');
  // a long line Claude Code took in with characters lost between pieces, after the owner's words
  const L = `RECORDING: D:/rec/t.md | ${'FocusShell #1020: Remove it and more words here '.repeat(6)}`;
  assert.equal(boxAfterLine(`Can you bring that GIF back to me.${L.replace('more words', 'mowords')}`, L), 'mixed');
  // the screen has not caught up yet
  assert.equal(boxAfterLine('WORDS ClaudeSetup #1210: the', W), 'wait');
  assert.equal(boxAfterLine('', W), 'wait');
  // no Claude Code input box on screen (a plain shell)
  assert.equal(boxAfterLine(null, W), 'send');
  // a pane too short for the box: the ❯ row went off screen after the line was typed (#1340)
  assert.equal(boxAfterLine(null, W, true), 'wait');
});

test('ctoline: a line left without its Enter comes out only when it is the box tail (#1340)', () => {
  const W = 'ANSWER FocusShell #1340: a';
  assert.equal(leftLine(`my words ${W}`, W), 'out');
  assert.equal(leftLine(W, W), 'out');
  assert.equal(leftLine(`${W} and words typed after it`, W), 'keep');
  assert.equal(leftLine(null, W), 'keep');
});

test('ctoline: Claude Code dictating holds typed-in lines (#1277)', () => {
  // the screen of a real Claude Code 2.1.302 while Space was held
  const rule = '─'.repeat(110), at = s => [...Array(18).fill(''), `${' '.repeat(98)}${s}`, rule, '❯ ▁', rule, '  Opus 5.5 (1M context)', '  ⏵⏵ auto mode on ·'];
  assert.ok(voiceLive(at('listening…')));
  assert.ok(voiceLive(at('connecting…')));
  assert.equal(voiceLive(at('No speech detected.')), false);
  assert.equal(voiceLive(at('◐ medium · /effort')), false);
  // the word far up in the conversation does not count
  assert.equal(voiceLive(['I am listening…', ...Array(20).fill('')]), false);
  // an idle CTO whose last output ends that way is not dictating (#1340)
  const idle = s => [...Array(18).fill(''), s, rule, '❯ ', rule, '  Opus 5.5 (1M context)'];
  assert.equal(voiceLive(idle('Server ready, listening...')), false);
  assert.equal(voiceLive(idle('  ⎿ Connecting...')), false);
  assert.equal(voiceLive([...Array(14).fill(''), `${' '.repeat(98)}listening…`, 'Server ready, listening...', '', rule, '❯ ', rule]), false);
});
