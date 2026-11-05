// Waiting on you cards, design A, and their plain summaries (#1521).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTasks, askOf } from './tasks.js';
import { cardView, reportParts, resultGroups, headlineOf, suggestParts } from './cardview.js';
import { summaryKey, summaryInput, parseSummary, scrub, readMarkdown } from './cardsummary.js';

const one = md => parseTasks(md)[0];

test('cardview: a report line splits into its fields and body', () => {
  const r = reportParts('DONE #5 | did it; applied: x | tests: pass | commits: abc1234 (vault), Repo def5678');
  assert.equal(r.head, 'DONE #5'); assert.equal(r.tests, 'pass');
  assert.deepEqual(r.commits, ['abc1234 (vault)', 'Repo def5678']);
  assert.deepEqual(r.body, ['did it; applied: x']);
  assert.deepEqual(reportParts('DONE #5 | x | commit: none').commits, []);
});

test('cardview: a long result groups at "label: " pieces', () => {
  assert.deepEqual(resultGroups('notes a; recurring: (1) one; (2) two; applied: fix (abc1234)'), [
    { label: '', items: ['notes a'] }, { label: 'recurring', items: ['(1) one', '(2) two'] }, { label: 'applied', items: ['fix (abc1234)'] }]);
});

test('cardview: the headline is the question, not a dot inside a file name', () => {
  assert.deepEqual(headlineOf('kit settings.json enables expo (pushed). App template settings.json is copied: add the same switch?'),
    { headline: 'App template settings.json is copied: add the same switch?', rest: 'kit settings.json enables expo (pushed)' });
  assert.deepEqual(headlineOf('permission check refused publishing (scratch clone; main untouched); needed for run 4'),
    { headline: 'permission check refused publishing', rest: '(scratch clone; main untouched); needed for run 4' });
  assert.deepEqual(headlineOf('Which format?'), { headline: 'Which format?', rest: '' });
});

test('cardview: the suggestion loses its tucked-in words and gives its reason', () => {
  assert.deepEqual(suggestParts('yes (every kit app is Expo)'), { pick: 'yes', why: 'every kit app is Expo', words: '' });
  assert.deepEqual(suggestParts('yes | words: yes, push 9362'), { pick: 'yes', why: '', words: 'yes, push 9362' });
});

test('cardview: a question card marks the suggested option and keeps the words', () => {
  const t = one(`- [?] #3 Mac (2026-10-22, lead-V) -> words
  > Result: NEEDS YOU #3 | permission check refused the push (main untouched) | options: yes, no | suggest: yes | words: yes, push mac-dev`);
  const v = cardView(t, askOf(t));
  assert.equal(v.headline, 'permission check refused the push');
  assert.deepEqual(v.options.map(o => [o.text, o.suggested]), [['yes', true], ['no', false]]);
  assert.equal(v.words, 'yes, push mac-dev');
});

test('cardview: a DONE that mentions NEEDS YOU in passing is a report, led by its short result (#1516)', () => {
  const t = one(`- [?] #9 Iteration run (2026-10-22, lead-C) -> both runs done; 2 proposed
  > Result: DONE #9 | notes x; applied: the skill sends NEEDS YOU to the CTO (60b1185); proposals: P1 one; P2 two | commits: 3b6cc27`);
  const v = cardView(t, askOf(t));
  assert.equal(v.headline, 'both runs done; 2 proposed');
  assert.deepEqual(v.options, []);
  assert.deepEqual(v.commits, ['3b6cc27']);
  assert.deepEqual(v.groups.map(g => g.label), ['', 'applied', 'proposals']);
});

test('cardsummary: the key changes only with the card text, and the input leaves out bookkeeping lines', () => {
  const t = one('- [?] #4 A (2026-10-22, lead-A) -> x\n  > Result: NEEDS YOU #4 | which? | options: a, b\n  > Done: 2026-10-22 10:00');
  assert.equal(summaryKey('P', t), summaryKey('P', one('- [?] #4 A (2026-10-22, lead-A) -> x\n  > Result: NEEDS YOU #4 | which? | options: a, b')));
  assert.notEqual(summaryKey('P', t), summaryKey('P', one('- [?] #4 A (2026-10-22, lead-A) -> y')));
  assert.doesNotMatch(summaryInput('P', t), /Done:/);
});

test('cardsummary: codes the model let through are taken out', () => {
  assert.equal(scrub('The kit has it (commit b27326a) and the template too (#141).'), 'The kit has it and the template too.');
  assert.equal(scrub('Next step on task 1388 is run 6 for lead-VideoEditor in D:\\x\\y.md'), 'Next step is run 6 for the lead in a file');
  assert.equal(scrub('a \u2014 b'), 'a , b'.replace(' ,', ','));
});

test('cardsummary: the reply is read, an error or empty one is not used', () => {
  assert.equal(parseSummary(JSON.stringify({ result: '**Do it.**' })), '**Do it.**');
  assert.equal(parseSummary(JSON.stringify({ result: 'x', is_error: true })), null);
  assert.equal(parseSummary('not json'), null);
});

test('cardsummary: the small Markdown reads bold, bullets and paragraphs', () => {
  assert.deepEqual(readMarkdown('**Decide.** Now\n\n- **a**: one\n- b'), [
    { p: [{ b: true, text: 'Decide.' }, { b: false, text: ' Now' }] },
    { ul: [[{ b: true, text: 'a' }, { b: false, text: ': one' }], [{ b: false, text: 'b' }]] }]);
});
