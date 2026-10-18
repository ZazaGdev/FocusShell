import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readProposal, applyProposal, undoCard, undoAll, brainstormPrompt } from './brainstorm.js';
import { newSession, next } from './session.js';

const card = (id, o = {}) => ({ id, kind: 'task', project: 'FocusShell', title: `Card ${id}`, description: 'Line', quote: `said ${id}`, at: 3,
  shotAt: [5], shots: [`D:\\s\\${id}.png`], due: '', mergeInto: null, mergeTitle: '', status: 'open', placed: null, mark: null, before: null, ...o });
const OPEN = { FocusShell: [{ n: 7, title: 'Crypto widget weekly change' }] };

test('recorder brainstorm: a proposal is read from the agent\'s JSON, odd entries left out', () => {
  const p = readProposal('```json\n{"cards": [{"id": "c1", "action": "rewrite", "title": "New"}, {"action": "explode"}, 5, {"action": "add", "title": "Extra"}]}\n```');
  assert.deepEqual(p.map(e => e.action), ['rewrite', 'add']);
  assert.throws(() => readProposal('no json here'), /proposal/);
  assert.throws(() => readProposal('{"cards": "x"}'), /proposal/);
});

test('recorder brainstorm: rewrite, merge, drop, add and unchanged, each marked with what Undo restores', () => {
  const cards = [card('c1'), card('c2'), card('c3'), card('c4'), card('c5', { status: 'accepted', placed: { board: 'FocusShell', n: 9 } })];
  const out = applyProposal(cards, [
    { id: 'c1', action: 'rewrite', title: 'Show the weekly change', description: ['One', 'Two'], kind: 'reminder', due: '2026-10-19 09:00' },
    { id: 'c2', action: 'merge', mergeInto: 7 },
    { id: 'c3', action: 'merge', mergeWith: 'c1' },
    { id: 'c4', action: 'drop' },
    { id: 'c5', action: 'drop' },
    { action: 'add', kind: 'note', project: 'Gymbuddy', title: 'A new note', description: 'Said later' },
  ], { open: OPEN, projects: ['FocusShell', 'Gymbuddy'] });
  const [c1, c2, c3, c4, c5, c6] = out;
  assert.equal(c1.mark, 'rewritten');
  assert.equal(c1.title, 'Show the weekly change');
  assert.equal(c1.description, 'One\nTwo');
  assert.equal(c1.project, 'Me', 'a reminder is a Me item');
  assert.equal(c1.before.title, 'Card c1');
  assert.deepEqual(c1.shots, ['D:\\s\\c1.png', 'D:\\s\\c3.png'], 'the merged card brings its screenshots');
  assert.match(c1.quote, /said c3/);
  assert.equal(c2.mark, 'merged');
  assert.equal(c2.mergeInto, 7);
  assert.equal(c2.mergeTitle, 'Crypto widget weekly change');
  assert.equal(c3.mark, 'merged');
  assert.equal(c3.status, 'dropped');
  assert.equal(c3.mergedWith, 'c1');
  assert.equal(c4.mark, 'dropped');
  assert.equal(c4.status, 'dropped');
  assert.equal(c5.status, 'accepted', 'a card on its board is never changed');
  assert.equal(c5.mark, null);
  assert.equal(c6.mark, 'added');
  assert.equal(c6.id, 'c6');
  assert.equal(c6.project, 'Gymbuddy');
  assert.equal(c6.status, 'open');
});

test('recorder brainstorm: open cards the proposal leaves out are Unchanged; a merge into a missing item is not made', () => {
  const out = applyProposal([card('c1'), card('c2')], [{ id: 'c2', action: 'merge', mergeInto: 99 }], { open: OPEN, projects: ['FocusShell'] });
  assert.equal(out[0].mark, 'unchanged');
  assert.equal(out[1].mark, 'unchanged');
  assert.equal(out[1].mergeInto, null);
});

test('recorder brainstorm: Undo goes back to before the first brainstorm, and takes an added card away', () => {
  let cards = applyProposal([card('c1'), card('c2')], [{ id: 'c1', action: 'rewrite', title: 'First' }, { action: 'add', title: 'Extra' }], { open: {}, projects: ['FocusShell'] });
  cards = applyProposal(cards, [{ id: 'c1', action: 'rewrite', title: 'Second' }, { id: 'c2', action: 'drop' }], { open: {}, projects: ['FocusShell'] });
  assert.equal(cards[0].title, 'Second');
  assert.equal(cards[0].before.title, 'Card c1');
  const one = undoCard(cards, 'c1');
  assert.equal(one[0].title, 'Card c1');
  assert.equal(one[0].mark, null);
  assert.equal(one[1].status, 'dropped', 'the others stay');
  assert.equal(undoCard(cards, 'c3').length, 2, 'an added card goes');
  const all = undoAll(cards);
  assert.deepEqual(all.map(c => [c.id, c.title, c.status, c.mark]), [['c1', 'Card c1', 'open', null], ['c2', 'Card c2', 'open', null]]);
});

test('recorder brainstorm: the review opens, applies and ends a brainstorm; the cards stay editable', () => {
  let s = { ...newSession('r', 1), state: 'review', cards: [card('c1'), card('c2')] };
  s = next(s, { type: 'brainstorm', who: 'pm' });
  assert.deepEqual(s.brainstorm, { who: 'pm' });
  assert.equal(next(s, { type: 'brainstorm', who: 'cto' }), s, 'one brainstorm at a time');
  s = next(s, { type: 'proposal', cards: applyProposal(s.cards, [{ id: 'c1', action: 'drop' }], { open: {}, projects: [] }) });
  assert.equal(s.cards[0].mark, 'dropped');
  assert.equal(next(s, { type: 'edit', id: 'c2', patch: { title: 'Typed' } }).cards[1].title, 'Typed');
  assert.equal(next(s, { type: 'undo', id: 'c1' }).cards[0].status, 'open');
  assert.equal(next(s, { type: 'undoAll' }).cards[0].mark, null);
  s = next(s, { type: 'brainstormEnd' });
  assert.equal(s.brainstorm, null);
  assert.equal(s.cards[0].mark, 'dropped', 'the marks stay after the session ends');
  // the review ending ends the brainstorm with it
  const b = next({ ...newSession('r', 1), state: 'review', cards: [card('c1')] }, { type: 'brainstorm', who: 'cto' });
  assert.equal(next(b, { type: 'done' }).brainstorm, null);
  assert.equal(next(b, { type: 'discard' }).brainstorm, null);
});

test('recorder brainstorm: the prompt holds the cards, the transcript, the open items and where to write', () => {
  const p = brainstormPrompt({ who: 'cto', cards: [card('c1')], transcript: '[00:03-00:07] Hello', transcriptFile: 'D:\\r\\transcript.md',
    proposedFile: 'D:\\r\\proposed.json', open: OPEN });
  assert.match(p, /CTO/);
  assert.match(p, /"id": "c1"/);
  assert.match(p, /\[00:03-00:07\] Hello/);
  assert.match(p, /#7 Crypto widget weekly change/);
  assert.match(p, /D:\\r\\proposed\.json/);
  assert.match(p, /never/i);
  assert.doesNotMatch(p, /[\u2013\u2014]/);
  assert.match(brainstormPrompt({ who: 'pm', cards: [], transcript: '', transcriptFile: 'x', proposedFile: 'y', open: {} }), /PM/);
});
