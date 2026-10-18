// Maybe missed (#367). Run through lib.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversation, splitItems, responds, maybeMissed, waitingItems, visibleItems, sameThing } from './missed.js';

const T0 = Date.parse('2026-10-15T17:00:00Z');
const at = s => new Date(T0 + s * 1000).toISOString();
const cto = (s, text) => JSON.stringify({ type: 'assistant', timestamp: at(s), message: { content: [{ type: 'text', text }] } });
const owner = (s, text) => JSON.stringify({ type: 'user', timestamp: at(s), origin: { kind: 'human' }, message: { content: text } });
const peer = s => JSON.stringify({ type: 'user', timestamp: at(s), isMeta: true, origin: { kind: 'peer' }, message: { content: 'Another Claude session sent a message: <cross-session-message from="x">DONE #1</cross-session-message>' } });
const tool = s => JSON.stringify({ type: 'user', timestamp: at(s), toolUseResult: {}, message: { content: [{ type: 'tool_result', content: 'ok' }] } });
const NOW = T0 + 600e3;

const THREE = `Brewlog #280 is built. Three things from you:
1. Thumbnail: keep 3.jpg or switch to the new one for the upload?
2. Where does 4.jpg go: the end card or the description?
3. FocusShell #364: OK to ship the tray icon change tonight?`;

test('missed: the log as CTO replies, owner messages and peer messages', () => {
  const c = conversation([cto(0, 'Looking.'), tool(1), cto(2, 'Done: here it is.'), peer(3), owner(10, 'thanks'), '{bad json', cto(12, 'ok')].join('\n'));
  assert.deepEqual(c.map(e => e.who), ['cto', 'peer', 'owner', 'cto']);
  assert.equal(c[0].text, 'Looking.\n\nDone: here it is.');
  assert.equal(c[0].t, T0 + 2000);
  assert.equal(c[2].text, 'thanks');
});

test('missed: a reply cut into questions and results', () => {
  const items = splitItems(`Done (Brewlog #279). The video: \`D:\\Brewlog\\Videos\\ad.mp4\`

Needs you:
- FocusShell #367: which layout?
  - (a) its own board
  - (b) a tab
- Shall I send it to the lead

People:
- [A](https://x.test/a)
- [B](https://x.test/b)
- [C](https://x.test/c)`);
  assert.deepEqual(items.map(i => i.kind), ['result', 'question', 'question', 'result']);
  assert.equal(items[0].path, 'D:\\Brewlog\\Videos\\ad.mp4');
  assert.deepEqual([items[1].project, items[1].n], ['FocusShell', 367]);
  assert.match(items[1].text, /\(a\) its own board \(b\) a tab$/);
  assert.match(items[3].text, /and 2 more in the same list/);
  assert.equal(items[3].of, 4);
  assert.ok(items[2].words > items[1].words);
});

test('missed: does a message respond to an item', () => {
  const [a, b, c] = splitItems(THREE);
  assert.equal(responds(c, '364 yes ship it'), 'yes');
  assert.equal(responds(a, 'keep the 3.jpg thumbnail for the upload'), 'yes');
  assert.equal(responds(b, 'new idea: a button for things I missed'), 'no');
  assert.equal(responds(b, 'the description please'), 'unsure');
  assert.equal(responds(a, 'yes', { only: true }), 'yes');
  assert.equal(responds(a, 'yes'), 'unsure');
  assert.equal(responds(b, '1) keep 2) end card', { numbered: true }), 'yes');
  const [r] = splitItems('The report: D:\\Research\\out\\report.md');
  assert.equal(responds(r, 'read report.md, looks good'), 'yes');
});

test('missed: answered one of three and changed topic within seconds gives two cards, each with why', () => {
  const log = [cto(0, THREE), owner(5, 'keep 3.jpg thumbnail for the upload. Also, new idea: a button that catches what I skip')].join('\n');
  const r = maybeMissed(conversation(log), { now: NOW });
  assert.equal(r.items.length, 2);
  assert.match(r.items[1].text, /^Where does 4\.jpg go/);
  assert.equal(r.items[0].n, 364, 'the lowest item scores highest');
  for (const it of r.items) {
    assert.match(it.why.join('; '), /moved on after 5 s/);
    assert.ok(it.ctx[1] === it.text);
  }
  // Read slowly enough, nothing is flagged.
  assert.equal(maybeMissed(conversation([cto(0, THREE), owner(120, 'new idea')].join('\n')), { now: NOW }).items.length, 0);
});

test('missed: answered later in chat, typed before the reply, typing start and clicked results', () => {
  const later = [cto(0, THREE), owner(5, 'keep 3.jpg thumbnail for the upload, new idea'), owner(60, '4.jpg: the end card, not the description'), owner(70, '364 ship it')].join('\n');
  assert.equal(maybeMissed(conversation(later), { now: NOW }).items.length, 0);
  // A message sent within 2 s was written while the CTO worked; the next one is what counts.
  const queued = [cto(0, THREE), owner(1, 'unrelated note'), owner(200, 'other topic')].join('\n');
  assert.equal(maybeMissed(conversation(queued), { now: NOW }).items.length, 0);
  // Typing started 4 s after the reply, sent a minute later: moved on after 4 s.
  const slow = [cto(0, THREE), owner(60, 'other topic entirely: the tavern robots should wave when a lead finishes')].join('\n');
  assert.equal(maybeMissed(conversation(slow), { now: NOW }).items.length, 0);
  const r = maybeMissed(conversation(slow), { now: NOW, typing: [T0 + 4000] });
  assert.equal(r.items.length, 3);
  assert.match(r.items[0].why.join(' '), /after 4 s/);
  const res = [cto(0, 'Here is the cut you asked for, rendered at full size and checked frame by frame: D:\\V\\cut.mp4'), owner(3, 'other topic')].join('\n');
  assert.equal(maybeMissed(conversation(res), { now: NOW }).items[0].kind, 'result');
  assert.equal(maybeMissed(conversation(res), { now: NOW, opened: ['d:\\v\\cut.mp4'] }).items.length, 0);
  // Older than a day: not looked at.
  assert.equal(maybeMissed(conversation([cto(0, THREE), owner(5, 'x y z new topic here')].join('\n')), { now: T0 + 25 * 3600e3 }).items.length, 0);
});

test('missed: a question asked again is one question; a later answer or a question-box pick clears it (#412)', () => {
  const no = new Proxy({}, { has: () => true, get: () => false }); // every unsure match judged "no"
  const first = 'Latest caching video (Brewlog #304): http://localhost:8731/v.mp4\n\nNeeds you, two answers:\n1. FocusShell #408: plain text or remove?\n2. The video: export it, or what should change?';
  const again = 'Sent it on.\n\nStill open:\n1. FocusShell #408: plain text or remove?\n2. Brewlog #304: export the caching video, or change something?';
  // The real case: off-topic reply after 5 s, the CTO asks again, then the owner answers the copy.
  const log = [cto(0, first), owner(5, "Let's have the board columns merged instead of having the spacing"), cto(20, again),
    owner(200, 'prompt caching should be red, the timer starts twice and runs out too fast'), owner(260, '408 plain text')].join('\n');
  const left = maybeMissed(conversation(log), { now: NOW, judged: no }).items.map(i => i.text);
  assert.ok(!left.some(t => /video/.test(t)), `no copy of the video question is left: ${JSON.stringify(left)}`);
  // Without the repeat, a later message that may answer it clears it too: no nagging when unsure.
  const once = [cto(0, first), owner(5, 'the board columns should merge, no spacing'), owner(200, 'in the video the timer runs out too fast'), owner(260, '408 plain text')].join('\n');
  assert.ok(!maybeMissed(conversation(once), { now: NOW, judged: no }).items.some(i => /video/.test(i.text)));
  // Still flagged when nothing later touches it.
  const never = [cto(0, first), owner(5, 'the board columns should merge, no spacing'), owner(260, '408 plain text')].join('\n');
  assert.ok(maybeMissed(conversation(never), { now: NOW, judged: no }).items.some(i => /video/.test(i.text)));
  // A pick in the question boxes is an answer.
  const pick = JSON.stringify({ type: 'user', timestamp: at(150), toolUseResult: { questions: [], answers: { 'Brewlog #304: export the caching video?': 'Export' } },
    message: { content: [{ type: 'tool_result', content: 'Your questions have been answered' }] } });
  const c = conversation([cto(0, first), owner(5, 'the board columns should merge, no spacing'), pick, owner(260, '408 plain text')].join('\n'));
  assert.deepEqual(c.map(e => e.who), ['cto', 'owner', 'owner', 'owner']);
  assert.ok(!maybeMissed(c, { now: NOW, judged: no }).items.some(i => /video/.test(i.text)));
});

test('missed: unsure matches wait for the small model, then follow its verdict', () => {
  const log = [cto(0, THREE), owner(5, 'the description please')].join('\n');
  const first = maybeMissed(conversation(log), { now: NOW });
  const u = first.unsure.find(x => /4\.jpg/.test(x.item));
  assert.ok(u, 'item 2 is unsure');
  assert.ok(!first.items.some(i => /4\.jpg/.test(i.text)), 'not shown while unsure');
  assert.ok(!maybeMissed(conversation(log), { now: NOW, judged: { [u.key]: true } }).items.some(i => /4\.jpg/.test(i.text)));
  assert.ok(maybeMissed(conversation(log), { now: NOW, judged: { [u.key]: false } }).items.some(i => /4\.jpg/.test(i.text)));
});

test('missed: never anything on Waiting on you, and marks and closed items drop out', () => {
  const items = maybeMissed(conversation([cto(0, THREE), owner(3, 'brand new topic: the tavern robots should wave when a lead finishes')].join('\n')), { now: NOW }).items;
  assert.equal(items.length, 3);
  const tasksMd = {
    Brewlog: '- [?] #280 Where 4.jpg goes (2026-10-15, cto) -> NEEDS YOU #280 | end card or description?\n',
    FocusShell: '- [x] #364 Tray icon (2026-10-15, cto)\n',
    Me: '- [ ] #9 Check the thumbnail choice, keep 3.jpg or switch to the new one (2026-10-15, cto)\n',
  };
  const waiting = waitingItems(tasksMd, [{ project: 'Streakwise', question: 'Do you want to proceed?' }]);
  assert.deepEqual(waiting.map(w => w.n), [280, 9, null]);
  // #280 is on Waiting on you by number, #364 is closed, and item 1 is on the Me board by its words.
  assert.deepEqual(visibleItems(items, { tasksMd, waiting }), []);
  assert.equal(visibleItems(items, { tasksMd: {}, waiting: [] }).length, 3);
  // A NEEDS YOU without a number still matches by text.
  const byText = visibleItems(items, { waiting: [{ project: 'FocusShell', n: null, text: 'ship the tray icon change tonight' }] });
  assert.ok(!byText.some(i => i.n === 364));
  // A for-owner item counts too.
  assert.equal(waitingItems({ X: '- [ ] #5 Try it on the phone (2026-10-15, cto, for owner)\n- [ ] #6 Build it (2026-10-15, cto)\n' }).length, 1);
  const k = items.map(i => i.key);
  const state = { seen: { [k[0]]: 1 }, answered: { [k[1]]: 1 }, later: { [k[2]]: NOW + 1000 } };
  assert.equal(visibleItems(items, { state, now: NOW }).length, 0);
  assert.equal(visibleItems(items, { state, now: NOW + 2000 }).length, 1, 'Later comes back');
  assert.ok(sameThing('ship the tray icon tonight', 'OK to ship the tray icon change tonight?'));
  assert.ok(!sameThing('ship the tray icon tonight', 'where does 4.jpg go'));
});
