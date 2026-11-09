// The recorded videos list (#1482): regenerating a recording's cards and the Talk to agent line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, newSession, next, replaceCards } from './session.js';
import { talkLine, ctoLine, noCtoReason } from './send.js';

const T0 = 1_000_000;
const card = (id, title, o = {}) => ({ id, kind: 'task', project: 'FocusShell', title, status: 'accepted', placed: { board: 'FocusShell', n: 7 }, ...o });
function doneWith(cards) {
  let s = next(newSession('r', T0), { type: 'stop', at: T0 + 9000 });
  for (const step of STEPS) s = next(s, { type: 'stepDone', step, ...(step === 'items' ? { cards } : {}) });
  return next(s, { type: 'done' });
}

test('recorder: regenerate runs the card step again on a finished recording (#1482)', () => {
  const s = next(doneWith([card('c1', 'Fix the chime')]), { type: 'regenerate' });
  assert.equal(s.state, 'processing');
  assert.equal(s.step, 'items');
  assert.deepEqual(s.done, ['audio', 'transcript']);
  assert.equal(s.regen, true);
  assert.equal(next(newSession('x', T0), { type: 'regenerate' }).state, 'recording', 'only a finished recording regenerates');
});

test('recorder: regenerate replaces the cards and remembers where the placed ones went (#2185)', () => {
  let s = next(doneWith([card('c1', 'Fix the chime'), card('c2', 'Add streaks', { status: 'dropped', placed: null })]), { type: 'regenerate' });
  // the new read words the first card differently: it must not come back as an extra card
  s = next(s, { type: 'stepDone', step: 'items', cards: [{ id: 'c1', title: 'Fix the chime sound', project: 'FocusShell', status: 'open' }, { id: 'c2', title: 'Dark mode', project: 'FocusShell', status: 'open' }] });
  assert.deepEqual(s.cards.map(c => [c.id, c.title, c.status]), [['c1', 'Fix the chime sound', 'open'], ['c2', 'Dark mode', 'open']]);
  assert.deepEqual(s.earlier, [{ title: 'Fix the chime', placed: { board: 'FocusShell', n: 7 } }]);
  assert.equal(s.regen, false);
  s = next(s, { type: 'stepDone', step: 'screenshots', cards: s.cards });
  assert.equal(s.state, 'review');
  assert.equal(s.earlier.length, 1, 'the screenshot step keeps earlier');
  // a second regenerate adds to earlier instead of forgetting the first read's items
  s = next(next(s, { type: 'send', ids: ['c1'] }), { type: 'placed', id: 'c1', board: 'FocusShell', n: 9 });
  s = next(next(next(s, { type: 'sent' }), { type: 'done' }), { type: 'regenerate' });
  s = next(s, { type: 'stepDone', step: 'items', cards: [] });
  assert.deepEqual(s.earlier.map(c => c.placed.n), [7, 9]);
  assert.deepEqual(replaceCards({ cards: [] }, []), { cards: [], earlier: [] });
});

test('recorder: a send for the CTO that placed only Me cards says why nothing went (#2185)', () => {
  const me = [card('c1', 'A', { placed: { board: 'Me', n: 1 } }), card('c2', 'B', { placed: { board: 'Me', n: 2 } })];
  assert.equal(ctoLine(me, { transcript: 't.md' }), null);
  assert.match(noCtoReason(me), /^Nothing sent to the CTO: all 2 cards went on Me, and Me items never go to the CTO\./);
  assert.match(noCtoReason(me.slice(0, 1)), /: the card went on Me/);
});

test('recorder: Talk to agent hands the recording to the CTO with its paths (#1482)', () => {
  assert.equal(talkLine({ title: 'Recording 2026-10-22 21:13', transcript: 'D:\\r\\transcript.md', video: 'D:\\r\\video.webm',
    cards: [card('c1', 'Fix the chime'), { title: 'Dark mode', placed: null }] }),
  'RECORDING TALK: Recording 2026-10-22 21:13 | transcript: D:\\r\\transcript.md | video: D:\\r\\video.webm | cards: FocusShell #7: Fix the chime; Dark mode');
  assert.equal(talkLine({ title: 'R', transcript: null, video: 'v.webm', cards: [] }), 'RECORDING TALK: R | no transcript | video: v.webm | no cards');
});
