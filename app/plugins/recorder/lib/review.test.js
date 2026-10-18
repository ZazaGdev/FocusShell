// Stage 3 of the recorder (#369): the review events, extraction reply checking and sending.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, newSession, next, buttonFor } from './session.js';
import { namedProjects, extractPrompt, transcriptText, parseCards, shotName, ffmpegShotArgs, settleShot } from './extract.js';
import { writesFor, ctoLine } from './send.js';

const T0 = 1_000_000;
const card = (id, o = {}) => ({ id, kind: 'task', project: 'FocusShell', title: `Card ${id}`, description: 'What it is.', quote: 'said', at: 5,
  shotAt: [5], shots: [], due: '', mergeInto: null, mergeTitle: '', status: 'open', placed: null, mark: null, before: null, ...o });
function reviewWith(cards) {
  let s = next(newSession('r', T0), { type: 'stop', at: T0 });
  for (const step of STEPS) s = next(s, { type: 'stepDone', step, ...(step === 'items' ? { cards } : {}) });
  return s;
}

test('recorder review: four steps, cards from the items step', () => {
  assert.deepEqual(STEPS, ['audio', 'transcript', 'items', 'screenshots']);
  const s = reviewWith([card('c1')]);
  assert.equal(s.state, 'review');
  assert.equal(s.cards[0].id, 'c1');
  // the screenshots step brings the cards back with their files
  let p = next(newSession('r', T0), { type: 'stop', at: T0 });
  for (const step of STEPS.slice(0, 3)) p = next(p, { type: 'stepDone', step, ...(step === 'items' ? { cards: [card('c1')] } : {}) });
  p = next(p, { type: 'stepDone', step: 'screenshots', cards: [card('c1', { shots: ['D:\\s\\0005.png'] })] });
  assert.deepEqual(p.cards[0].shots, ['D:\\s\\0005.png']);
});

test('recorder review: edit changes only the editable fields', () => {
  const s = reviewWith([card('c1'), card('c2')]);
  const e = next(s, { type: 'edit', id: 'c1', patch: { title: 'New', description: 'Lines', status: 'accepted', shots: ['x'], project: 'Gymbuddy' } });
  assert.equal(e.cards[0].title, 'New');
  assert.equal(e.cards[0].description, 'Lines');
  assert.equal(e.cards[0].project, 'Gymbuddy');
  assert.equal(e.cards[0].status, 'open');
  assert.deepEqual(e.cards[0].shots, []);
  assert.equal(e.cards[1], s.cards[1]);
  // a reminder is always Me's; a project changed away drops the merge
  const r = next(s, { type: 'edit', id: 'c2', patch: { kind: 'reminder' } });
  assert.equal(r.cards[1].project, 'Me');
  const m = next(reviewWith([card('c1', { mergeInto: 4, mergeTitle: 'Old' })]), { type: 'edit', id: 'c1', patch: { project: 'Me' } });
  assert.equal(m.cards[0].mergeInto, null);
  assert.equal(next(s, { type: 'edit', id: 'nope', patch: { title: 'x' } }), s);
});

test('recorder review: dropShot, drop and restore', () => {
  const s = reviewWith([card('c1', { shots: ['a.png', 'b.png'] })]);
  assert.deepEqual(next(s, { type: 'dropShot', id: 'c1', path: 'a.png' }).cards[0].shots, ['b.png']);
  const d = next(s, { type: 'drop', id: 'c1' });
  assert.equal(d.cards[0].status, 'dropped');
  assert.equal(next(d, { type: 'restore', id: 'c1' }).cards[0].status, 'open');
});

test('recorder review: send, placed, sent', () => {
  const s = reviewWith([card('c1'), card('c2')]);
  let x = next(s, { type: 'send', ids: ['c1'], cto: true });
  assert.equal(x.state, 'sending');
  assert.deepEqual(x.sending, { ids: ['c1'], cto: true });
  assert.equal(buttonFor(x, T0).state, 'busy');
  x = next(x, { type: 'placed', id: 'c1', board: 'FocusShell', n: 12 });
  assert.equal(x.cards[0].status, 'accepted');
  assert.deepEqual(x.cards[0].placed, { board: 'FocusShell', n: 12 });
  x = next(x, { type: 'sent' });
  assert.equal(x.state, 'review'); // c2 is still open
  assert.equal(x.sending, null);
  x = next(next(next(x, { type: 'send', ids: ['c2'] }), { type: 'placed', id: 'c2', board: 'Me', n: 3 }), { type: 'sent' });
  assert.equal(x.state, 'done');
});

test('recorder review: all dropped and sent ends it; a failed send keeps what was placed', () => {
  const s = reviewWith([card('c1'), card('c2')]);
  let x = next(next(next(s, { type: 'drop', id: 'c2' }), { type: 'send', ids: ['c1'] }), { type: 'placed', id: 'c1', board: 'FocusShell', n: 1 });
  assert.equal(next(x, { type: 'sent' }).state, 'done');
  const f = next(next(next(s, { type: 'send', ids: ['c1', 'c2'] }), { type: 'placed', id: 'c1', board: 'FocusShell', n: 1 }), { type: 'sendFailed', error: 'locked' });
  assert.equal(f.state, 'review');
  assert.equal(f.error, 'locked');
  assert.equal(f.cards[0].status, 'accepted');
  assert.equal(f.cards[1].status, 'open');
  // a restart mid-send goes back to the review
  const r = next(next(s, { type: 'send', ids: ['c1'] }), { type: 'resume', at: T0 });
  assert.equal(r.state, 'review');
  // the next send clears an old error
  assert.equal(next(f, { type: 'send', ids: ['c2'] }).error, null);
});

test('recorder review: cards placed for the CTO before a restart wait for the next CTO line (#369 review)', () => {
  const s = reviewWith([card('c1'), card('c2'), card('c3')]);
  const placed = next(next(s, { type: 'send', ids: ['c1', 'c2'], cto: true }), { type: 'placed', id: 'c1', board: 'FocusShell', n: 1 });
  const r = next(placed, { type: 'resume' });
  assert.deepEqual(r.ctoPending, ['c1'], 'c1 reached its board but the CTO never heard');
  // a send without the CTO keeps them waiting; one with the CTO tells it and clears them
  const plain = next(next(next(r, { type: 'send', ids: ['c2'] }), { type: 'placed', id: 'c2', board: 'FocusShell', n: 2 }), { type: 'sent' });
  assert.deepEqual(plain.ctoPending, ['c1']);
  const told = next(next(next(plain, { type: 'send', ids: ['c3'], cto: true }), { type: 'placed', id: 'c3', board: 'FocusShell', n: 3 }), { type: 'sent' });
  assert.deepEqual(told.ctoPending, []);
  // a failed send for the CTO answers with the line for what it placed, so nothing waits
  const failed = next(next(next(r, { type: 'send', ids: ['c2'], cto: true }), { type: 'placed', id: 'c2', board: 'FocusShell', n: 2 }), { type: 'sendFailed', error: 'locked' });
  assert.deepEqual(failed.ctoPending, []);
  // a restart mid-send without the CTO adds nothing
  assert.deepEqual(next(next(next(s, { type: 'send', ids: ['c1'] }), { type: 'placed', id: 'c1', board: 'FocusShell', n: 1 }), { type: 'resume' }).ctoPending || [], []);
});

test('recorder review: review events outside the review change nothing', () => {
  const p = next(newSession('r', T0), { type: 'stop', at: T0 });
  for (const type of ['edit', 'dropShot', 'drop', 'restore', 'send', 'placed', 'sent', 'sendFailed']) assert.equal(next(p, { type, id: 'c1', ids: ['c1'] }), p, type);
  const s = reviewWith([card('c1')]);
  assert.equal(next(s, { type: 'send', ids: [] }), s);
  assert.equal(next(s, { type: 'send', ids: ['zz'] }), s);
});

test('recorder extract: namedProjects finds spoken names', () => {
  const lines = [{ at: 1, text: 'On the focus shell dashboard the widget' }, { at: 9, text: 'and gym buddy too, plus Doodlepad.' }];
  assert.deepEqual(namedProjects(lines, ['FocusShell', 'Gymbuddy', 'Doodlepad', 'Bargainly', 'AI']), ['FocusShell', 'Gymbuddy', 'Doodlepad']);
  assert.deepEqual(namedProjects([], ['FocusShell']), []);
});

test('recorder extract: prompt and transcript text', () => {
  const p = extractPrompt({ projects: ['FocusShell', 'Gymbuddy'], open: { FocusShell: [{ n: 4, title: 'Crypto widget' }] }, now: new Date(2026, 9, 16, 14, 5) });
  assert.match(p, /FocusShell, Gymbuddy/);
  assert.match(p, /#4 Crypto widget/);
  assert.match(p, /Friday 2026-10-16 14:05/);
  assert.match(p, /"cards"/);
  assert.doesNotMatch(p, /[\u2013\u2014]/);
  assert.equal(transcriptText([{ at: 83, text: 'Hi.' }]), '[01:23] Hi.');
  // with its end, so the screenshots can be picked inside the words, not in the pause before them
  assert.equal(transcriptText([{ at: 33.86, end: 39.16, text: 'Remind me.' }]), '[00:33-00:39] Remind me.');
  assert.match(p, /middle/);
});

test('recorder: a screenshot in the first half of its transcript line moves to the middle (#369)', () => {
  const lines = [{ at: 33.86, end: 39.16, text: 'Remind me.' }, { at: 39.16, end: 45.96, text: 'A note.' }];
  assert.equal(settleShot(41, lines), 42.6);
  assert.equal(settleShot(44, lines), 44);
  assert.equal(settleShot(50, lines), 50);
  assert.equal(settleShot(5, []), 5);
  const cards = parseCards(JSON.stringify({ cards: [{ kind: 'note', project: 'FocusShell', title: 'A note', shots: [41, 42], at: 39 }] }), { projects: ['FocusShell'], duration: 60, lines });
  assert.deepEqual(cards[0].shotAt, [42.6], 'two seconds that settle on the same frame are one');
});

const OPTS = { projects: ['FocusShell', 'Gymbuddy'], open: { FocusShell: [{ n: 4, title: 'Crypto widget' }] }, duration: 60 };
const reply = cards => '```json\n' + JSON.stringify({ cards }) + '\n```';

test('recorder extract: parseCards checks every field', () => {
  const cards = parseCards(reply([
    { kind: 'task', project: 'focusshell', title: 'Show the weekly change \u2014 on the widget.', description: ['Line one', 'Line two'], quote: 'the widget', at: 2, shots: [3, 3.4, 90, -2, 7, 8], mergeInto: 4 },
    { kind: 'idea', project: 'Nope', title: 'Timer resets', description: 'One\nTwo', at: 10, shots: [] , mergeInto: 9 },
    { kind: 'reminder', project: 'FocusShell', title: 'Call the bank', at: 16, shots: [17], due: '2026-10-17 10:00' },
    { kind: 'reminder', title: 'Pay rent', at: 20, due: 'tomorrow' },
    { kind: 'task', title: '  ', at: 1 },
  ]), OPTS);
  assert.equal(cards.length, 4);
  assert.deepEqual(cards.map(c => c.id), ['c1', 'c2', 'c3', 'c4']);
  const [a, b, c, d] = cards;
  assert.equal(a.project, 'FocusShell');
  assert.equal(a.title, 'Show the weekly change, on the widget');
  assert.equal(a.description, 'Line one\nLine two');
  assert.deepEqual(a.shotAt, [3, 60, 0]);
  assert.equal(a.mergeInto, 4);
  assert.equal(a.mergeTitle, 'Crypto widget');
  assert.equal(a.status, 'open');
  assert.deepEqual(a.shots, []);
  assert.equal(b.kind, 'task');
  assert.equal(b.project, 'Me');
  assert.equal(b.mergeInto, null);
  assert.deepEqual(b.shotAt, [10]);
  assert.equal(c.project, 'Me');
  assert.equal(c.due, '2026-10-17 10:00');
  assert.equal(d.due, '');
});

test('recorder extract: a reply with no JSON or no cards list throws', () => {
  assert.throws(() => parseCards('I could not find anything.', OPTS), /not the JSON/);
  assert.throws(() => parseCards('{"items": []}', OPTS), /not the JSON/);
  assert.deepEqual(parseCards('{"cards": []}', OPTS), []);
});

test('recorder extract: shot names and ffmpeg arguments', () => {
  assert.equal(shotName(83.4), '0123.png');
  assert.equal(shotName(3725), '010205.png');
  assert.deepEqual(ffmpegShotArgs('v.webm', 83.4, 's.png'), ['-v', 'error', '-y', '-ss', '83.4', '-i', 'v.webm', '-frames:v', '1', 's.png']);
  assert.deepEqual(ffmpegShotArgs('v.webm', 83.4, 's.png', true), ['-v', 'error', '-y', '-i', 'v.webm', '-ss', '83.4', '-frames:v', '1', 's.png']);
});

const TR = 'D:\\rec\\transcript.md';

test('recorder send: a task becomes an item with its lines', () => {
  const [w] = writesFor([card('c1', { description: 'First line\nSecond line', quote: 'fix the widget', at: 83, shots: ['D:\\rec\\shots\\0123.png'] })], { transcript: TR });
  assert.deepEqual(w, { id: 'c1', op: 'add', board: 'FocusShell', title: 'Card c1', due: '',
    details: ['First line', 'Second line', 'Said: "fix the widget"', 'Screenshot: D:\\rec\\shots\\0123.png', `Transcript: ${TR} at 01:23`] });
});

test('recorder send: reminders, merges and notes', () => {
  const [r, m, n] = writesFor([
    card('c1', { kind: 'reminder', project: 'Me', due: '2026-10-17 10:00', description: '', quote: '' }),
    card('c2', { mergeInto: 4, shots: ['s.png'], description: 'More', quote: '' }),
    card('c3', { kind: 'note', project: 'Gymbuddy', title: 'Timer resets', description: 'On lock', quote: '', shots: ['a.png', 'b.png'] }),
  ], { transcript: TR });
  assert.equal(r.op, 'add');
  assert.equal(r.board, 'Me');
  assert.equal(r.due, '2026-10-17 10:00');
  assert.deepEqual(m, { id: 'c2', op: 'detail', board: 'FocusShell', n: 4, details: ['From a recording: Card c2', 'More', 'Screenshot: s.png', `Transcript: ${TR} at 00:05`] });
  assert.deepEqual(n, { id: 'c3', op: 'note', board: 'Gymbuddy', text: `Timer resets. On lock. Screenshot: a.png Screenshot: b.png Transcript: ${TR} at 00:05` });
});

test('recorder send: the CTO line skips Me', () => {
  const placed = [
    card('c1', { shots: ['a.png', 'b.png'], placed: { board: 'FocusShell', n: 12 } }),
    card('c2', { kind: 'note', project: 'Gymbuddy', title: 'Timer', placed: { board: 'Gymbuddy', n: null } }),
    card('c3', { kind: 'reminder', project: 'Me', placed: { board: 'Me', n: 3 } }),
  ];
  assert.equal(ctoLine(placed, { transcript: TR }), `RECORDING: ${TR} | FocusShell #12: Card c1 (screenshots: a.png, b.png) | note on Gymbuddy: Timer`);
  assert.equal(ctoLine([placed[2]], { transcript: TR }), null);
});
