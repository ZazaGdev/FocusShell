// How full a pane's context is and how its last turn stands (#3016). Run through lib.test.js.
// Made-up logs only, shaped like Claude Code's: one line per content block of a reply.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inScope, tailEntries, tokensOf, windowOf, askAt, mirrorPercent, percentOf, lastTurn, turnState, readyPart, step, askSent, SMALL, LARGE, AGAIN_MS, MAX_ASKS, DAY_HOUR, DAY_IDLE_MS, dayStart, newDay } from './context.js';
import { conversationFinder } from '../background.js';

const T0 = Date.parse('2026-03-02T10:00:00.000Z');
const at = s => new Date(T0 + s * 1000).toISOString();
// A reply's block: usage and stop_reason sit on every block of it, as Claude Code writes them.
const reply = (id, s, block, stop, extra = {}) => ({ type: 'assistant', isSidechain: false, timestamp: at(s),
  message: { id, model: 'claude-sample-1', stop_reason: stop, content: [block], usage: { input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: 50000, output_tokens: 300 } }, ...extra });
const text = t => ({ type: 'text', text: t });
const tool = { type: 'tool_use', id: 'tu1', name: 'Bash', input: {} };
const user = (s, content, extra = {}) => ({ type: 'user', isSidechain: false, timestamp: at(s), message: { role: 'user', content }, ...extra });
const other = (type, s) => ({ type, timestamp: at(s) });
// Claude Code's line once a turn is over (no Stop hook sent it on).
const done = s => ({ type: 'system', subtype: 'turn_duration', isSidechain: false, timestamp: at(s), durationMs: 1000 });
const queue = (operation, s) => ({ type: 'queue-operation', operation, timestamp: at(s) });
// A finished turn whose reply is that text.
const turn = (s, t) => [reply(`r${s}`, s, text(t), 'end_turn'), done(s + 0.1)];
const lines = list => list.map(d => JSON.stringify(d)).join('\n');

test('inScope: the CTOs and the leads, not the PM, Personal or a brainstorm session (#3016)', () => {
  assert.equal(inScope('cto'), true);
  assert.equal(inScope('cto-Studio'), true);
  assert.equal(inScope('Pebblecart'), true);
  assert.equal(inScope('Pebblecart:3'), true, 'an extra lead');
  assert.equal(inScope('pm'), false);
  assert.equal(inScope('Diary', { personal: ['Diary'] }), false, 'Personal');
  assert.equal(inScope('brainstorm-cto', { brainstorm: true }), false);
});

test('tokensOf: the last main reply\'s input, cache writes and cache reads; sidechain and synthetic replies skipped, a cut first line dropped (#3016)', () => {
  const big = reply('m0', 0, text('earlier'), 'end_turn');
  big.message.usage = { input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 900000 };
  const main = reply('m1', 10, text('done'), 'end_turn');
  const side = reply('s1', 11, text('subagent'), 'end_turn', { isSidechain: true });
  side.message.usage = { input_tokens: 1, cache_creation_input_tokens: 1, cache_read_input_tokens: 1 };
  const synthetic = reply('x1', 12, text('API Error'), 'stop_sequence');
  synthetic.message.model = '<synthetic>';
  synthetic.message.usage = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const piece = lines([big, main, user(10.5, [{ type: 'tool_result', content: 'ok' }]), side, synthetic, other('system', 13)]) + '\n{"type":"assistant","mess';
  assert.equal(tokensOf(tailEntries(piece, false)), 51002, 'the main reply, not the subagent\'s or the synthetic one');
  // Read from mid-file, the first line is a cut one: here a whole one that would otherwise count.
  assert.equal(tokensOf(tailEntries(lines([big, other('system', 1)]), true)), null, 'only that reply in the piece, and it is dropped');
  assert.equal(tokensOf(tailEntries(lines([big, other('system', 1)]), false)), 900005);
  assert.equal(tailEntries('garbage\n{"type":"user"', true).length, 0, 'a cut first line and a half-written last one');
  assert.equal(tokensOf([]), null);
  assert.equal(tokensOf([user(1, 'hi')]), null);
});

test('windowOf: 1M for a [1m] model, the default model only when the pane has none, or over 200k tokens (#3016)', () => {
  assert.equal(windowOf({ model: 'opus[1m]' }), LARGE);
  assert.equal(windowOf({ model: 'claude-sample-1[1m]', tokens: 10 }), LARGE);
  assert.equal(windowOf({ model: 'sonnet' }), SMALL);
  assert.equal(windowOf({ model: '', defaultModel: 'opus[1m]' }), LARGE, 'Claude\'s own default model');
  assert.equal(windowOf({ model: 'sonnet', defaultModel: 'opus[1m]' }), SMALL, 'the pane\'s model wins');
  assert.equal(windowOf({ model: '', defaultModel: '' }), SMALL);
  assert.equal(windowOf({ model: 'sonnet', tokens: 200001 }), LARGE, 'already past 200k');
  assert.equal(windowOf({ model: 'sonnet', tokens: 200000 }), SMALL);
  assert.equal(windowOf(), SMALL);
});

test('askAt: a CTO or an extra lead is asked at 40 in a 1M window, the override still wins (#3245)', () => {
  assert.equal(askAt(LARGE, undefined, true), 40);
  assert.equal(askAt(SMALL, undefined, true), 70);
  assert.equal(askAt(LARGE, '12', true), 12);
  assert.equal(askAt(LARGE, undefined, false), 90);
});

test('askAt: 90 for a 1M window, 70 for 200k, FOCUSSHELL_CONTEXT_AT replaces it (#3016)', () => {
  assert.equal(askAt(LARGE), 90);
  assert.equal(askAt(SMALL), 70);
  assert.equal(askAt(LARGE, '12'), 12);
  assert.equal(askAt(SMALL, '95'), 95);
  for (const bad of ['', '  ', 'soon', '0', '-5', '150', undefined, null]) assert.equal(askAt(LARGE, bad), 90, `override ${JSON.stringify(bad)}`);
});

test('mirrorPercent and percentOf: the status line\'s number only when fresh and for that conversation (#3016)', () => {
  const now = T0, conv = 'aaaa-1111';
  const fresh = { at: now / 1000 - 60, session_id: conv, context_used_pct: 91 };
  assert.equal(mirrorPercent(fresh, conv, now), 91);
  assert.equal(mirrorPercent({ ...fresh, at: now / 1000 - 181 }, conv, now), null, 'over three minutes old');
  assert.equal(mirrorPercent({ ...fresh, session_id: 'bbbb-2222' }, conv, now), null, 'another conversation');
  assert.equal(mirrorPercent({ at: now / 1000, context_used_pct: 40 }, conv, now), 40, 'no session_id: the file name says whose');
  assert.equal(mirrorPercent({ ...fresh, context_used_pct: '91' }, conv, now), null);
  assert.equal(mirrorPercent({ session_id: conv, context_used_pct: 91 }, conv, now), null, 'no time');
  assert.equal(mirrorPercent(null, conv, now), null);
  assert.equal(percentOf({ tokens: 150000, window: SMALL, mirror: 91 }), 91, 'the mirror wins');
  assert.equal(percentOf({ tokens: 150000, window: SMALL, mirror: null }), 75);
  assert.equal(percentOf({ tokens: 905000, window: LARGE }), 90);
  assert.equal(percentOf({ tokens: null, window: SMALL }), null, 'nothing known');
});

test('lastTurn and turnState: ended only when the last main entry is a reply that ended its turn; READY only after the ask (#3016)', () => {
  const asked = T0 + 100 * 1000;
  const ready = 'READY TO REOPEN | #12, #15';
  const ended = [user(90, 'CONTEXT FULL: ...'), reply('m1', 110, { type: 'thinking', thinking: '' }, 'end_turn'),
    reply('m1', 111, text(`HALF #12 | stopped at: x | next: y\n\n${ready}`), 'end_turn'), done(111.1), other('attachment', 112), other('system', 113)];
  let last = lastTurn(ended);
  assert.equal(last.endedAt, T0 + 111 * 1000, 'attachment and other system lines after the reply do not count');
  assert.deepEqual(turnState(last, asked), { endedAt: T0 + 111 * 1000, ready });
  assert.equal(turnState(last, T0 + 200 * 1000).ready, null, 'a READY line from before the ask does not count');
  assert.equal(turnState(last, null).ready, null, 'not asked');
  // A turn still running: READY printed, then a tool call in the same reply, or a tool result after.
  const running = [user(90, 'x'), reply('m2', 110, text(ready), 'tool_use'), reply('m2', 111, tool, 'tool_use')];
  assert.deepEqual(turnState(lastTurn(running), asked), { endedAt: null, ready: null });
  assert.deepEqual(turnState(lastTurn([...running, user(112, [{ type: 'tool_result', content: 'ok' }])]), asked), { endedAt: null, ready: null });
  // A line typed or sent from another session after the reply starts a new turn.
  const sent = user(120, 'Another Claude session sent a message: ...', { isMeta: true });
  assert.deepEqual(turnState(lastTurn([...ended, sent]), asked), { endedAt: null, ready: null });
  // A subagent's lines in the main log do not end or start the main turn.
  last = lastTurn([...ended, reply('s1', 130, text('side'), 'tool_use', { isSidechain: true }), user(131, 'x', { isSidechain: true })]);
  assert.equal(turnState(last, asked).ready, ready);
  // The line must stand alone and be the reply's last line.
  const said = t => turnState(lastTurn(turn(120, t)), asked).ready;
  assert.equal(said('I will print the READY TO REOPEN line later.'), null);
  assert.equal(said('READY TO REOPEN | #1\n  READY TO REOPEN | none  \n\n'), 'READY TO REOPEN | none');
  assert.equal(said('READY TO REOPEN | #12\nOne more thing before I stop.'), null, 'text after the READY line');
  assert.equal(said('READY TO REOPENED'), null);
  assert.deepEqual(lastTurn([]), { endedAt: null, text: '' });
  assert.deepEqual(turnState(null, asked), { endedAt: null, ready: null });
});

test('lastTurn: a turn ends only at its turn_duration line, and not while a message is queued (#3016)', () => {
  const r = reply('m5', 10, text('READY TO REOPEN | none'), 'end_turn'), hook = { type: 'attachment', isSidechain: false, timestamp: at(10.2), attachment: { type: 'hook_success', hookEvent: 'Stop' } };
  assert.equal(lastTurn([user(5, 'x'), r, hook]).endedAt, null, 'a Stop hook ran and no turn_duration yet: it may send the turn on');
  assert.equal(lastTurn([user(5, 'x'), r, hook, user(10.3, 'Stop hook feedback: ...', { isMeta: true })]).endedAt, null);
  assert.equal(lastTurn([user(5, 'x'), r, hook, done(10.4)]).endedAt, T0 + 10 * 1000);
  assert.equal(lastTurn([r, done(10.1), queue('enqueue', 20)]).endedAt, null, 'a message waits to be handed over');
  assert.equal(lastTurn([r, done(10.1), queue('enqueue', 20), queue('enqueue', 20.1), queue('dequeue', 20.2)]).endedAt, null, 'one of two taken, one still queued');
  assert.equal(lastTurn([r, done(10.1), queue('enqueue', 20), queue('dequeue', 20.1), user(20.2, 'Another Claude session sent a message: ...', { isMeta: true })]).endedAt, null);
  assert.equal(lastTurn([r, done(10.1), queue('enqueue', 20), queue('remove', 21)]).endedAt, T0 + 10 * 1000, 'a queued message taken back out');
  assert.equal(lastTurn([queue('enqueue', 1), user(2, 'x'), r, done(10.1)]).endedAt, T0 + 10 * 1000, 'queue lines before the reply do not count');
  assert.equal(lastTurn([r, { ...done(10.1), isSidechain: true }]).endedAt, null, 'a subagent\'s turn_duration is not the main turn\'s');
});

test('turnState and readyPart: markdown around the READY line is taken off (#3016)', () => {
  const asked = T0;
  const said = t => turnState(lastTurn(turn(10, t)), asked).ready;
  assert.equal(said('`READY TO REOPEN | none`'), 'READY TO REOPEN | none');
  assert.equal(said('Done.\n\n**READY TO REOPEN | #12, #15**'), 'READY TO REOPEN | #12, #15');
  assert.equal(said('> READY TO REOPEN | #3'), 'READY TO REOPEN | #3');
  assert.equal(readyPart('READY TO REOPEN | #12, #15'), '#12, #15');
  assert.equal(readyPart('**READY TO REOPEN | #12, #15**'), '#12, #15');
  assert.equal(readyPart('`READY TO REOPEN | stopped at: board | next: ask about #4`'), 'stopped at: board | next: ask about #4', 'only the first | splits');
  assert.equal(readyPart('READY TO REOPEN'), '');
  assert.equal(readyPart(null), '');
});

test('lastTurn: Claude Code\'s own error reply ends a turn, with no READY (#3016)', () => {
  const synthetic = reply('x2', 20, text('API Error: overloaded'), 'stop_sequence');
  synthetic.message.model = '<synthetic>';
  const last = lastTurn([user(10, 'CONTEXT FULL: ...'), synthetic, done(20.1)]);
  assert.equal(last.endedAt, T0 + 20 * 1000);
  assert.deepEqual(turnState(last, T0), { endedAt: T0 + 20 * 1000, ready: null });
  assert.equal(lastTurn([user(10, 'x'), synthetic]).endedAt, null, 'no turn_duration yet');
  assert.equal(lastTurn([user(10, 'x'), synthetic, done(20.1), queue('enqueue', 21)]).endedAt, null, 'a message queued after it');
});

test('step: asks at the ask point unless a prompt, a words request or an exited pane holds it (#3016)', () => {
  const now = T0, u = { percent: 91, askAt: 90, endedAt: null, ready: null, subagents: null };
  const pane = { exited: false, prompt: null, words: false, back: null, quietMs: 60000, draft: '', ownerMs: Infinity };
  assert.deepEqual(step(null, u, pane, now), { st: { sending: true, why: 'full' }, act: 'ask' });
  assert.deepEqual(step(null, { ...u, percent: 89 }, pane, now), { st: null, act: null }, 'below the ask point');
  assert.deepEqual(step(null, { ...u, percent: 70, askAt: 70 }, pane, now).act, 'ask', '70% of a 200k window');
  assert.deepEqual(step(null, { ...u, percent: null }, pane, now), { st: null, act: null }, 'not known');
  assert.deepEqual(step(null, undefined, pane, now), { st: null, act: null });
  for (const held of [{ prompt: 'Do you want to proceed?' }, { words: true }, { exited: true }]) assert.deepEqual(step(null, u, { ...pane, ...held }, now), { st: null, act: null }, JSON.stringify(held));
  assert.deepEqual(step({ sending: true }, u, pane, now), { st: { sending: true }, act: null }, 'a line already on its way');
  const st = askSent({ sending: true }, now);
  assert.deepEqual(st, { sending: false, askedAt: now, asks: 1 });
  assert.equal(step(st, u, pane, now + 1000).act, null, 'asked: waits for READY');
});

test('step: reopens on READY only once nothing is going in the pane (#3016)', () => {
  const asked = T0, st = askSent({ sending: true }, asked), now = asked + 60000;
  const u = { percent: 92, askAt: 90, endedAt: asked + 30000, ready: 'READY TO REOPEN | #12', subagents: 0 };
  const pane = { exited: false, prompt: null, words: false, back: null, quietMs: 6000, draft: '', ownerMs: 20000 };
  assert.deepEqual(step(st, u, pane, now), { st: { ...st, reopening: true }, act: 'reopen' });
  const waits = [
    ['a subagent running', { subagents: 1 }, {}], ['subagents not known', { subagents: null }, {}], ['a turn that ended before the ask', { endedAt: asked - 1 }, {}],
    ['a background shell', {}, { back: '1 shell' }], ['a prompt', {}, { prompt: 'Allow?' }], ['a words request', {}, { words: true }], ['an exited pane', {}, { exited: true }],
    ['output in the last 5 s', {}, { quietMs: 4000 }], ['a draft in the box', {}, { draft: 'half' }], ['no input box', {}, { draft: null }], ['the owner typing', {}, { ownerMs: 3000 }],
  ];
  for (const [why, uu, pp] of waits) assert.deepEqual(step(st, { ...u, ...uu }, { ...pane, ...pp }, now), { st, act: null }, why);
  const going = { ...st, reopening: true };
  assert.deepEqual(step(going, { ...u, percent: 3 }, pane, now), { st: going, act: null }, 'a reopen under way is left alone');
});

test('lastTurn: a local slash command or a ! line typed after the reply does not hide it (#3016)', () => {
  const ready = 'READY TO REOPEN | #12', base = [user(5, 'CONTEXT FULL: ...'), ...turn(10, `HALF #12 | stopped at: x | next: y\n\n${ready}`)];
  const ended = list => turnState(lastTurn([...base, ...list]), T0);
  const caveat = s => user(s, '<local-command-caveat>Caveat: the messages below were made by a local command.</local-command-caveat>', { isMeta: true });
  const cmd = (s, name) => user(s, `<command-name>/${name}</command-name>\n<command-message>${name}</command-message>\n<command-args></command-args>`);
  // A local slash command such as /context: its caveat, its name and its output, no reply.
  assert.deepEqual(ended([caveat(20), cmd(20.1, 'context'), user(20.2, '<local-command-stdout>Context usage: 91%</local-command-stdout>')]), { endedAt: T0 + 10 * 1000, ready });
  assert.equal(ended([caveat(20), cmd(20.1, 'nosuchcommand'), user(20.2, '<local-command-stderr>Unknown command</local-command-stderr>')]).ready, ready, 'its error output');
  assert.equal(ended([caveat(20), cmd(20.1, 'cost'), user(20.2, '<local-command-stdout>a</local-command-stdout>'), caveat(30), cmd(30.1, 'model'), user(30.2, '<local-command-stdout>b</local-command-stdout>')]).ready, ready, 'two in a row');
  // A ! line: its input and its output, no reply.
  assert.equal(ended([user(20, '<bash-input>git status</bash-input>'), user(20.5, '<bash-stdout>nothing to commit</bash-stdout><bash-stderr></bash-stderr>')]).ready, ready);
  assert.equal(ended([user(20, '<bash-input>no-such-tool</bash-input>'), user(20.5, '<bash-stderr>not found</bash-stderr>')]).ready, ready, 'its error output');
  // A slash command that starts a turn (a skill or a custom command): its name, then its prompt.
  assert.deepEqual(ended([cmd(20, 'sample-skill')]), { endedAt: null, ready: null }, 'just written, no output after it: may start a turn');
  assert.deepEqual(ended([cmd(20, 'sample-skill'), user(20.1, 'Run the sample skill.', { isMeta: true })]), { endedAt: null, ready: null });
  assert.deepEqual(ended([caveat(20), cmd(20.1, 'context'), user(20.2, '<local-command-stdout>x</local-command-stdout>'), cmd(30, 'sample-skill')]), { endedAt: null, ready: null }, 'a turn started after a local command');
  // Typed words after a local command start a turn as before.
  assert.deepEqual(ended([caveat(20), cmd(20.1, 'context'), user(20.2, '<local-command-stdout>x</local-command-stdout>'), user(30, 'carry on')]), { endedAt: null, ready: null });
  // Output with no reply before it at all: still nothing ended.
  assert.deepEqual(turnState(lastTurn([user(1, '<bash-input>ls</bash-input>'), user(2, '<bash-stdout>a</bash-stdout>')]), T0), { endedAt: null, ready: null });
});

test('step: an asked pane that is held for good tells the owner once, 30 minutes after its last ask (#3016)', () => {
  const t0 = T0, st = askSent({ sending: true }, t0), late = t0 + MAX_ASKS * AGAIN_MS;
  const pane = { exited: false, prompt: null, words: false, back: null, quietMs: 60000, draft: '', ownerMs: Infinity };
  const ready = { percent: 93, askAt: 90, endedAt: t0 + 1000, ready: 'READY TO REOPEN | #12', subagents: 0 };
  const held = [
    ['a subagent whose meta never says finished', { ...ready, subagents: 1 }, pane],
    ['a background shell that never ends, no READY', { ...ready, ready: null }, { ...pane, back: '1 shell' }],
    ['a draft left in the box', ready, { ...pane, draft: 'half a line' }],
    ['its turn never ends', { ...ready, endedAt: null, ready: null }, pane],
  ];
  for (const [why, u, p] of held) {
    assert.equal(step(st, u, p, late - 1).act, null, `${why}: not yet`);
    const gave = step(st, u, p, late);
    assert.deepEqual(gave, { st: { ...st, gaveUp: true }, act: 'giveup' }, why);
    assert.equal(step(gave.st, u, p, late + AGAIN_MS).act, null, `${why}: told once`);
  }
  // A re-ask still queued behind the owner's draft holds no give-up back.
  assert.equal(step({ ...st, sending: true }, { ...ready, ready: null }, pane, late).act, 'giveup');
  // READY with everything safe still reopens, before and after the give-up.
  assert.equal(step(st, ready, pane, late + 1).act, 'reopen');
  assert.equal(step({ ...st, gaveUp: true }, ready, pane, late + AGAIN_MS).act, 'reopen');
});

test('step: below the ask point an ask that went in is kept: never asked again there, READY still reopens (#3016)', () => {
  const t0 = T0, pane = { exited: false, prompt: null, words: false, back: null, quietMs: 60000, draft: '', ownerMs: Infinity };
  const low = { percent: 40, askAt: 90, endedAt: t0 + 1000, ready: null, subagents: 0 };
  // Forgotten before the line went in: never asked, or its line failed to go.
  assert.deepEqual(step(null, low, pane, t0), { st: null, act: null });
  assert.deepEqual(step({ sending: false }, low, pane, t0), { st: null, act: null }, 'its line failed');
  assert.deepEqual(step({ fresh: true }, low, pane, t0), { st: null, act: null }, 'a reopened pane');
  // Kept once it is on its way or went in (a CONTEXT FULL line still queued when the pane compacted).
  assert.deepEqual(step({ sending: true }, low, pane, t0), { st: { sending: true }, act: null });
  const st = askSent({ sending: true }, t0);
  assert.deepEqual(step(st, low, pane, t0 + AGAIN_MS), { st, act: null }, 'not asked again below its ask point');
  assert.deepEqual(step(st, low, pane, t0 + 2 * AGAIN_MS + 1), { st, act: null });
  assert.equal(step(st, { ...low, ready: 'READY TO REOPEN | none' }, pane, t0 + 60000).act, 'reopen', 'its READY reopens it');
  assert.equal(step(st, low, pane, t0 + MAX_ASKS * AGAIN_MS).act, 'giveup', 'or the owner is told');
});

test('step: an asked pane always reaches reopen or giveup within 30 minutes of the ask, whatever holds it (#3016)', () => {
  const t0 = T0, STEP = 60000, end = t0 + MAX_ASKS * AGAIN_MS + STEP;
  const us = [], panes = [];
  for (const percent of [93, 40]) for (const endedAt of [null, t0 - 1000, t0 + 1000]) for (const ready of [null, 'READY TO REOPEN | none'])
    for (const subagents of [null, 0, 1]) us.push({ percent, askAt: 90, endedAt, ready, subagents });
  for (const exited of [false, true]) for (const prompt of [null, 'Allow?']) for (const words of [false, true]) for (const back of [null, '1 shell'])
    for (const quietMs of [0, 60000]) for (const draft of ['', 'half', null]) for (const ownerMs of [0, Infinity]) panes.push({ exited, prompt, words, back, quietMs, draft, ownerMs });
  let runs = 0;
  for (const goesIn of [true, false]) for (const u of us) for (const p of panes) {
    let st = askSent({ sending: true }, t0), act = null;
    for (let now = t0 + STEP; now <= end && act !== 'reopen' && act !== 'giveup'; now += STEP) {
      ({ st, act } = step(st, u, p, now));
      if (act === 'ask' && goesIn) st = askSent(st, now); // the line went in at once, or stays queued
    }
    runs++;
    assert.ok(act === 'reopen' || act === 'giveup', `stuck: ${JSON.stringify({ goesIn, u, p, st })}`);
  }
  assert.equal(runs, 2 * us.length * panes.length);
});

test('step: asks again after 10 minutes, three times, then gives up once; a compaction keeps an ask that went in (#3016)', () => {
  const t0 = T0, pane = { exited: false, prompt: null, words: false, back: null, quietMs: 60000, draft: '', ownerMs: Infinity };
  const u = at => ({ percent: 93, askAt: 90, endedAt: at, ready: null, subagents: 0 });
  let st = askSent({ sending: true }, t0);
  assert.equal(step(st, u(t0 + 1000), pane, t0 + AGAIN_MS - 1).act, null, 'not yet 10 minutes');
  assert.equal(step(st, u(null), pane, t0 + AGAIN_MS).act, null, 'its turn still runs');
  assert.equal(step(st, { ...u(t0 + 1000), subagents: 1 }, pane, t0 + AGAIN_MS).act, null, 'a subagent runs');
  assert.equal(step(st, u(t0 + 1000), { ...pane, back: '1 shell' }, t0 + AGAIN_MS).act, null, 'a shell runs');
  assert.equal(step(st, u(t0 + 1000), { ...pane, prompt: 'Allow?' }, t0 + AGAIN_MS).act, null, 'a prompt');
  let now = t0;
  for (const n of [2, 3]) {
    now += AGAIN_MS;
    const r = step(st, u(now - 5000), pane, now);
    assert.equal(r.act, 'ask', `ask ${n}`);
    st = askSent(r.st, now);
    assert.equal(st.asks, n);
  }
  now += AGAIN_MS;
  const gave = step(st, u(now - 5000), pane, now);
  assert.equal(gave.act, 'giveup');
  assert.equal(step(gave.st, u(now), pane, now + 5 * AGAIN_MS).act, null, 'told once, then quiet');
  assert.equal(step(gave.st, { ...u(now + 1000), ready: 'READY TO REOPEN | none' }, { ...pane, quietMs: 9000 }, now + 2000).act, 'reopen', 'READY after all still reopens');
  assert.deepEqual(step(gave.st, { ...u(now), percent: 40 }, pane, now), { st: gave.st, act: null }, 'compacted below the ask point: the ask went in, so it is kept');
  assert.deepEqual(step({ sending: false }, { ...u(now), percent: 40 }, pane, now), { st: null, act: null }, 'one that never went in is forgotten');
  // A synthetic error reply ended the turn: it is asked again like any other.
  assert.equal(step(askSent(null, t0), { percent: 91, askAt: 90, endedAt: t0 + 2000, ready: null, subagents: 0 }, pane, t0 + AGAIN_MS).act, 'ask');
});

test('step: a reopened pane is not asked again until it has read below its ask point once (#3016)', () => {
  const pane = { exited: false, prompt: null, words: false, back: null, quietMs: 60000, draft: '', ownerMs: Infinity };
  const fresh = { fresh: true }, u = { percent: 93, askAt: 90, endedAt: T0, ready: null, subagents: 0 };
  assert.deepEqual(step(fresh, u, pane, T0), { st: fresh, act: null }, 'still reading 93%: its old conversation, or not yet below');
  assert.deepEqual(step(fresh, { ...u, ready: 'READY TO REOPEN | none' }, pane, T0), { st: fresh, act: null }, 'never reopened again from that reading');
  assert.deepEqual(step(fresh, { ...u, percent: null }, pane, T0), { st: fresh, act: null });
  const below = step(fresh, { ...u, percent: 4 }, pane, T0);
  assert.deepEqual(below, { st: null, act: null });
  assert.equal(step(below.st, u, pane, T0).act, 'ask', 'full again later: asked as any pane');
});

// Local times, so these hold in any time zone.
const local = (d, h, m = 0) => new Date(2026, 2, d, h, m).getTime();

test('dayStart: the latest local 05:00 at or before now; newDay: a conversation begun before it (#3073)', () => {
  assert.equal(DAY_HOUR, 5);
  assert.equal(DAY_IDLE_MS, 5 * 60000);
  assert.equal(dayStart(local(10, 4, 59)), local(9, 5), 'before 05:00: yesterday\'s');
  assert.equal(dayStart(local(10, 5)), local(10, 5), 'at 05:00: today\'s');
  assert.equal(dayStart(local(10, 23, 30)), local(10, 5));
  assert.equal(dayStart(local(1, 3)), local(0, 5), 'over a month end');
  assert.equal(dayStart(local(10, 7), 8), local(9, 8), 'another hour');
  assert.equal(newDay(local(9, 22), local(10, 9)), true, 'begun last night');
  assert.equal(newDay(local(10, 6), local(10, 9)), false, 'begun this morning');
  assert.equal(newDay(local(10, 1), local(10, 4)), false, 'before 05:00: still the same day');
  assert.equal(newDay(null, local(10, 9)), false, 'not known');
  assert.equal(newDay(0, local(10, 9)), false);
});

test('step: a CTO whose conversation began before 05:00 is asked once it is idle, with why day (#3073)', () => {
  const now = local(10, 9), since = local(9, 22), idleAt = now - 10 * 60000;
  const u = { percent: 30, askAt: 90, endedAt: null, ready: null, subagents: 0, since, idleAt };
  const pane = { cto: true, exited: false, prompt: null, words: false, back: null, quietMs: 10 * 60000, draft: '', ownerMs: Infinity };
  assert.deepEqual(step(null, u, pane, now), { st: { sending: true, why: 'day', dayOf: local(10, 5) }, act: 'ask' });
  const waits = [
    ['quiet only 1 min', {}, { quietMs: 60000 }], ['its turn ended 1 min ago', { idleAt: now - 60000 }, {}], ['a turn running', { idleAt: null }, {}],
    ['the owner typing', {}, { ownerMs: 1000 }], ['a draft', {}, { draft: 'half' }], ['no input box', {}, { draft: null }],
    ['a subagent', { subagents: 1 }, {}], ['subagents not known', { subagents: null }, {}], ['a background shell', {}, { back: '1 shell' }],
    ['a prompt', {}, { prompt: 'Allow?' }], ['exited', {}, { exited: true }],
  ];
  for (const [why, uu, pp] of waits) assert.equal(step(null, { ...u, ...uu }, { ...pane, ...pp }, now).act, null, why);
  // Not due: a lead, a CTO begun today, or one whose start is not known.
  assert.deepEqual(step(null, u, { ...pane, cto: false }, now), { st: null, act: null }, 'a lead with an old conversation');
  assert.deepEqual(step(null, { ...u, since: local(10, 6) }, pane, now), { st: null, act: null }, 'begun today');
  assert.deepEqual(step(null, { ...u, since: null }, pane, now), { st: null, act: null }, 'start not known');
  // The smoke run's shorter idle time.
  assert.equal(step(null, { ...u, idleAt: now }, { ...pane, quietMs: 0, ownerMs: 0, dayIdleMs: 0 }, now).act, 'ask');
  // A full CTO is asked as before, why full, idle or not.
  assert.deepEqual(step(null, { ...u, percent: 91, idleAt: null }, { ...pane, quietMs: 0 }, now), { st: { sending: true, why: 'full' }, act: 'ask' });
  // askSent keeps why.
  assert.deepEqual(askSent({ sending: true, why: 'day' }, now), { sending: false, why: 'day', askedAt: now, asks: 1 });
});

test('step: a day ask reopens on READY, and is asked again after 10 minutes while still due (#3073)', () => {
  const t0 = local(10, 9), since = local(9, 22);
  const pane = { cto: true, exited: false, prompt: null, words: false, back: null, quietMs: 10 * 60000, draft: '', ownerMs: Infinity };
  const st = askSent({ sending: true, why: 'day', dayOf: dayStart(t0) }, t0);
  const u = { percent: 30, askAt: 90, endedAt: t0 + 30000, ready: 'READY TO REOPEN | stopped at: x | next: y', subagents: 0, since, idleAt: t0 + 30000 };
  assert.deepEqual(step(st, u, pane, t0 + 60000), { st: { ...st, reopening: true }, act: 'reopen' });
  const noReady = { ...u, ready: null };
  assert.equal(step(st, noReady, pane, t0 + AGAIN_MS - 1).act, null, 'not yet 10 minutes');
  const again = step(st, noReady, pane, t0 + AGAIN_MS);
  assert.deepEqual(again, { st: { ...st, sending: true }, act: 'ask' }, 'below its ask point and idle, asked again');
  assert.equal(again.st.why, 'day');
  // Asked again only as idle as the first time: not into a CTO the owner went back to.
  const busy = { ...noReady, endedAt: t0 + AGAIN_MS - 6000, idleAt: t0 + AGAIN_MS - 6000 };
  assert.equal(step(st, busy, { ...pane, quietMs: 6000, ownerMs: 12000 }, t0 + AGAIN_MS).act, null, 'turn ended 6 s ago, owner typed 12 s ago');
  const waits = [
    ['quiet only 1 min', {}, { quietMs: 60000 }], ['its turn ended 1 min ago', { endedAt: t0 + AGAIN_MS - 60000, idleAt: t0 + AGAIN_MS - 60000 }, {}],
    ['the owner typing', {}, { ownerMs: 1000 }], ['a draft', {}, { draft: 'half' }], ['no input box', {}, { draft: null }],
  ];
  for (const [why, uu, pp] of waits) assert.equal(step(st, { ...noReady, ...uu }, { ...pane, ...pp }, t0 + AGAIN_MS).act, null, why);
  assert.equal(step(st, { ...noReady, since: local(10, 9, 30) }, pane, t0 + AGAIN_MS).act, null, 'no longer due (a new conversation): not asked again');
  assert.equal(step(st, noReady, pane, t0 + MAX_ASKS * AGAIN_MS).act, 'giveup', 'held for good: the owner is told');
  // A full ask below its ask point is still never asked again.
  assert.equal(step(askSent({ sending: true, why: 'full' }, t0), noReady, pane, t0 + AGAIN_MS).act, null);
  // Reopened: its fresh conversation began after the day start, so it is dropped once read, not asked.
  assert.deepEqual(step({ fresh: true }, { ...u, ready: null, since: local(10, 9, 40), idleAt: null }, pane, t0 + 2 * AGAIN_MS), { st: null, act: null });
});

const ctoPane = { cto: true, exited: false, prompt: null, words: false, back: null, quietMs: 10 * 60000, draft: '', ownerMs: Infinity };
const idleCto = (now, extra = {}) => ({ percent: 30, askAt: 90, endedAt: now - 10 * 60000, ready: null, subagents: 0, since: local(9, 22), idleAt: now - 10 * 60000, ...extra });

test('step: a day ask that gave up is dropped above the ask point or on the next day, kept below it the same day (#3073)', () => {
  const t0 = local(10, 9);
  const gave = { ...askSent({ sending: true, why: 'day', dayOf: dayStart(t0) }, t0), asks: MAX_ASKS, gaveUp: true };
  // (a) Full later the same day: asked CONTEXT FULL as any pane.
  assert.deepEqual(step(gave, idleCto(t0 + 3600e3, { percent: 91 }), ctoPane, t0 + 3600e3), { st: { sending: true, why: 'full' }, act: 'ask' });
  // (b) The next day after 05:00, still the old conversation, idle: asked for the day again.
  const next = local(11, 9), r = step(gave, idleCto(next), ctoPane, next);
  assert.equal(r.act, 'ask');
  assert.equal(r.st.why, 'day');
  assert.equal(r.st.dayOf, local(11, 5));
  // (c) Later the same day, below and idle: still given up, not asked again.
  assert.deepEqual(step(gave, idleCto(t0 + 3600e3), ctoPane, t0 + 3600e3), { st: gave, act: null });
});

test('step: a CTO reopened at 04:59 and read below at 05:01 is asked again later (#3073)', () => {
  const since = local(10, 4, 59), read = local(10, 5, 1);
  const r = step({ fresh: true }, { percent: 4, askAt: 90, endedAt: null, ready: null, subagents: 0, since, idleAt: null }, ctoPane, read);
  assert.deepEqual(r, { st: null, act: null }, 'its fresh log read below: fresh dropped');
  const next = local(11, 9);
  assert.deepEqual(step(r.st, idleCto(next, { percent: 92, since }), ctoPane, next), { st: { sending: true, why: 'full' }, act: 'ask' }, 'next day at 92%');
});

test('step: no leftover state holds a pane below its ask point or blocks a later ask (#3073)', () => {
  const t0 = local(10, 9);
  const leftovers = [
    ['a day ask that gave up', { ...askSent({ sending: true, why: 'day', dayOf: dayStart(t0) }, t0), asks: MAX_ASKS, gaveUp: true }],
    ['a full ask that gave up', { ...askSent({ sending: true, why: 'full' }, t0), asks: MAX_ASKS, gaveUp: true }],
    ['a reopened pane', { fresh: true }],
  ];
  const later = t0 + 3600e3, next = local(11, 9), nextLater = local(11, 10);
  for (const [why, st] of leftovers) {
    // Below its ask point and not due (a conversation begun today): nothing to do.
    assert.equal(step(st, idleCto(later, { since: local(10, 6) }), ctoPane, later).act, null, `${why}: below, not due`);
    // After the next day start, a CTO idle on its old conversation is asked for the day (a reopened
    // pane's first round below only drops fresh).
    let day = step(st, idleCto(next), ctoPane, next);
    if (!day.act) day = step(day.st, idleCto(next + 5000), ctoPane, next + 5000);
    assert.equal(day.act, 'ask', `${why}: next day`);
    assert.equal(day.st.why, 'day', `${why}: next day`);
    // A lead read below on the next day, then at 92%: asked CONTEXT FULL.
    const lead = { ...ctoPane, cto: false }, low = step(st, idleCto(next), lead, next);
    assert.equal(low.act, null, `${why}: a lead below`);
    assert.deepEqual(step(low.st, idleCto(nextLater, { percent: 92 }), lead, nextLater), { st: { sending: true, why: 'full' }, act: 'ask' }, `${why}: at 92% the next day`);
  }
});

test('session:context: a pane just reopened is never read with its old conversation (#3016)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-old-'));
  try {
    const handlers = {}, ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
    const { registerContext } = await import('../context.js');
    const claude = path.join(root, 'claude'), dirOf = cwd => path.join(claude, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
    const full = reply('m9', 1, text('done'), 'end_turn');
    full.message.usage = { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 185000 }; // 92% of 200k
    const write = (cwd, conv, name, entries) => { fs.mkdirSync(dirOf(cwd), { recursive: true }); const f = path.join(dirOf(cwd), `${conv}.jsonl`); fs.writeFileSync(f, lines([{ type: 'custom-title', customTitle: name }, ...entries]) + '\n'); return f; };
    const a = path.join(root, 'work', 'Pebblecart'), b = path.join(root, 'work', 'Ferngate');
    const oldA = write(a, 'old-a', 'demo-lead-Pebblecart', [full, done(1.1)]), oldB = write(b, 'old-b', 'demo-lead-Ferngate', [full, done(1.1)]);
    await new Promise(r => setTimeout(r, 1200));
    const startedAt = Date.now(), later = new Date(startedAt + 100);
    // The ended session wrote to its log once more after the fresh pane started.
    fs.utimesSync(oldA, later, later); fs.utimesSync(oldB, later, later);
    const sessions = new Map([['Pebblecart', { cwd: a, startedAt, model: '', alive: true }], ['Ferngate', { cwd: b, startedAt, model: '', alive: true, resumeId: 'old-b' }]]);
    registerContext({ ipcMain, SMOKE: false, DEMO: true, demoClaude: claude, sessions, live: s => s.alive, personal: () => [], brainstorm: () => false });
    let r = await handlers['session:context'](null, { Pebblecart: startedAt + 50 });
    assert.deepEqual(r.Pebblecart, { percent: null, askAt: 70, endedAt: null, ready: null, subagents: null, since: null, idleAt: null }, 'the old log born before the start: nothing read from it');
    assert.ok(r.Ferngate.since > 0 && r.Ferngate.since < startedAt, 'a resumed log keeps its old birth');
    assert.equal(r.Ferngate.idleAt, T0 + 1000, 'its last turn ended at its reply');
    assert.equal(r.Ferngate.percent, 92, 'a log the pane resumed is its own');
    // Its own log appears: read at the next round, not after the finder's 30 s.
    const fresh = write(a, 'new-a', 'demo-lead-Pebblecart', [reply('m10', 2, text('hi'), 'end_turn'), done(2.1)]), newer = new Date(startedAt + 2000);
    fs.utimesSync(fresh, newer, newer);
    r = await handlers['session:context'](null, {});
    assert.equal(r.Pebblecart.percent, 25, 'the fresh log: 51002 of 200k');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('conversationFinder: the log named after the pane, written since it started; looked up again after forget (#3016)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-find-'));
  try {
    const cwd = path.join(root, 'work', 'Pebblecart'), dir = path.join(root, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
    fs.mkdirSync(dir, { recursive: true });
    const s = { cwd, startedAt: Date.now() - 5000 };
    const find = conversationFinder(path.join(root, 'projects'), false);
    assert.equal(find('Pebblecart', s), null, 'no log yet');
    fs.writeFileSync(path.join(dir, 'conv-a.jsonl'), '{"type":"custom-title","customTitle":"lead-Pebblecart","sessionId":"conv-a"}\n');
    fs.writeFileSync(path.join(dir, 'conv-b.jsonl'), '{"type":"custom-title","customTitle":"lead-Pebblecart-2","sessionId":"conv-b"}\n');
    assert.equal(find('Pebblecart', s), null, 'the empty answer is kept for a while');
    find.forget('Pebblecart');
    assert.equal(find('Pebblecart', s), 'conv-a');
    assert.equal(find('Pebblecart:2', s), 'conv-b', 'an extra lead finds its own');
    find.keepOnly(new Set(['Pebblecart']));
    assert.equal(find('Pebblecart', { ...s, startedAt: s.startedAt + 1 }), 'conv-a', 'a restarted pane looks again');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
