// The Pixel Tavern (#240, #246): FocusShell's sessions turned into guests, the robots they are,
// the helpers and the token board. Imported by lib.test.js, so `node --test
// lib/lib.test.js` runs these too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tavernAgents, settleAgents, lookFor, LOOKS, BARKEEPER, robotFor } from './tavern/agents.js';
import { normalizeSettings } from './settings.js';
import { finishedCounts } from './tavern/finished.js';


const board = (...lines) => '# X tasks\n' + lines.join('\n') + '\n';
const sessions = [
  { id: 'cto', role: 'cto', name: 'CTO', state: 'idle' },
  { id: 'pm', role: 'pm', name: 'PM', state: 'working' },
  { id: 'Habitly', role: 'lead', name: 'lead-Habitly', project: 'Habitly', state: 'working' },
  { id: 'NoteNest', role: 'lead', name: 'lead-NoteNest', project: 'NoteNest', state: 'blocked' },
  { id: 'Gone', role: 'lead', name: 'lead-Gone', project: 'Gone', state: 'ended' },
];
const tasksMd = {
  Habitly: board('- [ ] #1 Streaks (2026-10-01, user)'),
  NoteNest: board('- [?] #4 Save notes where? (2026-10-01, lead-NoteNest) -> NEEDS YOU #4 | json or sqlite? | options: json, sqlite | suggest: json',
    '- [ ] #5 Check bold text (2026-10-01, lead-NoteNest, for owner)'),
  RecipeScale: board('- [?] #7 Which cup weights? (2026-10-01, lead-RecipeScale)'),
  Me: board('- [?] #1 Mine (2026-10-01, user)'),
};

test('tavern: every live session is a guest; ended ones are not', () => {
  const a = tavernAgents({ sessions, tasksMd, skip: ['Me'] });
  assert.deepEqual(a.filter(x => !x.id.startsWith('visit:')).map(x => [x.id, x.role, x.state]),
    [['cto', 'cto', 'idle'], ['pm', 'pm', 'working'], ['Habitly', 'lead', 'working'], ['NoteNest', 'lead', 'asking']]);
  assert.equal(a.find(x => x.id === 'pm').project, 'The board');
});

test('tavern: a NEEDS YOU or a prompt sends its lead to the bar, prompts first; a project with no lead running sends nobody (#311)', () => {
  const a = tavernAgents({ sessions, tasksMd, skip: ['Me'], prompts: [{ id: 'Habitly', session: 'Habitly', what: 'Run npm test?' }, { id: 'words:9', session: 'NoteNest' }] });
  const by = id => a.find(x => x.id === id);
  assert.deepEqual(by('Habitly').asks, [{ kind: 'prompt', id: 'Habitly', what: 'Run npm test?' }]);
  assert.equal(by('Habitly').state, 'asking');
  assert.deepEqual(by('NoteNest').asks, [{ kind: 'prompt', id: 'words:9', what: '' }, { kind: 'item', project: 'NoteNest', n: 4 }], "the owner's own to-do (#5) is not a question");
  assert.ok(!a.some(x => x.project === 'RecipeScale'), 'RecipeScale has a question but no lead running');
  assert.ok(!a.some(x => x.project === 'Me'), 'Me is never a guest');
  assert.equal(a.filter(x => x.state === 'asking').length, 2);
  // No panes at all: only the CTO, always there.
  assert.deepEqual(tavernAgents({ sessions: [], tasksMd, skip: ['Me'] }).map(x => [x.id, x.robot, x.state]), [['cto', 'cto', 'idle']]);
  assert.deepEqual(tavernAgents({ sessions: [{ id: 'pm', role: 'pm', name: 'PM', state: 'idle' }], tasksMd }).map(x => x.id), ['cto', 'pm']);
});

test('tavern: an item answered here stops waiting until its question changes; the second lead does not repeat it', () => {
  const a = tavernAgents({ sessions, tasksMd, skip: ['Me'], answered: new Set(['NoteNest#4', 'RecipeScale#7']) });
  assert.equal(a.find(x => x.id === 'NoteNest').state, 'idle');
  assert.ok(!a.some(x => x.id === 'visit:RecipeScale'));
  const two = tavernAgents({ sessions: [...sessions, { id: 'NoteNest-2', role: 'lead', name: 'lead-NoteNest-2', project: 'NoteNest', state: 'idle' }], tasksMd, skip: ['Me'] });
  assert.deepEqual(two.find(x => x.id === 'NoteNest-2').asks, []);
});

test('tavern: looks are chosen once per name, kept, never the barkeeper, and the owner can pick another', () => {
  assert.deepEqual(lookFor('cto'), [1, 11]);
  assert.deepEqual(lookFor('Habitly'), lookFor('Habitly'));
  const seen = new Set(['A', 'B', 'C', 'Arcade', 'Blogger', 'Clipper'].map(p => String(lookFor(p))));
  assert.ok(seen.size > 1, 'projects get different looks');
  for (const l of LOOKS) assert.notDeepEqual(l, BARKEEPER);
  assert.deepEqual(lookFor('Habitly', { Habitly: [0, 9] }), [0, 9]);
  assert.deepEqual(lookFor('Habitly', { Habitly: [99, 99] }), lookFor('Habitly'), 'a pick that is not a character is ignored');
  assert.deepEqual(tavernAgents({ sessions, tasksMd, helpers: [{ id: 'abc', parent: 'Habitly', project: 'Habitly' }] }).at(-1).role, 'helper');
  assert.deepEqual(normalizeSettings({ tavernLooks: { cto: [0, 9], bad: 'x', pm: [1, 2, 3] } }).tavernLooks, { cto: [0, 9] });
});

test('tavern: a guest changes between working and drinking only after the new state holds; questions are at once', () => {
  const held = new Map(), a = (state, asks = []) => [{ id: 'x', state, asks }];
  assert.equal(settleAgents(a('working'), held, 0)[0].state, 'working');
  assert.equal(settleAgents(a('idle'), held, 1000)[0].state, 'working');
  assert.equal(settleAgents(a('working'), held, 3000)[0].state, 'working', 'a flicker back resets the wait');
  assert.equal(settleAgents(a('idle'), held, 5000)[0].state, 'working');
  assert.equal(settleAgents(a('idle'), held, 26000)[0].state, 'idle');
  assert.equal(settleAgents(a('asking'), held, 26500)[0].state, 'asking');
  assert.equal(settleAgents(a('working'), held, 27000)[0].state, 'working');
  settleAgents([], held, 28000);
  assert.equal(held.size, 0);
});

import { activeHelpers } from './tavern/helpers.js';
import { encodeProjectDir } from './history.js';
import fsx from 'node:fs';
import osx from 'node:os';
import pathx from 'node:path';
test('tavern: a subagent transcript written in the last minute is a helper of the pane in that folder', () => {
  const root = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'tav-')), cwd = 'D:\Side\Habitly';
  const sub = pathx.join(root, encodeProjectDir(cwd), 'conv1', 'subagents');
  fsx.mkdirSync(sub, { recursive: true });
  fsx.writeFileSync(pathx.join(sub, 'agent-a.jsonl'), '{}');
  fsx.writeFileSync(pathx.join(sub, 'agent-old.jsonl'), '{}');
  const old = (Date.now() - 5 * 60000) / 1000; fsx.utimesSync(pathx.join(sub, 'agent-old.jsonl'), old, old);
  const got = activeHelpers([{ id: 'Habitly', cwd, startedAt: 0 }, { id: 'Habitly-2', cwd, startedAt: 0 }, { id: 'X', cwd: 'D:\none', startedAt: 0 }], root);
  assert.deepEqual(got, [{ id: 'conv1/agent-a', parent: 'Habitly', project: undefined }]);
  assert.deepEqual(activeHelpers([{ id: 'Habitly', cwd, startedAt: Date.now() + 60000 }], root), [], 'not from before the pane started');
  fsx.rmSync(root, { recursive: true, force: true });
});

test('tavern: each guest is a robot: the CTO and PM their own, a group CTO the miner, leads by project (#246, #358)', () => {
  assert.equal(robotFor('cto', 'cto'), 'cto');
  assert.equal(robotFor('cto', 'cto-Work'), 'spare');
  assert.equal(robotFor('pm', 'pm'), 'pm');
  const own = { NoteNest: 'compass', '*': 'general-1' };
  assert.equal(robotFor('lead', 'NoteNest', 'NoteNest', own), 'compass', 'the owner\'s own pick');
  assert.equal(robotFor('lead', 'Habitly', 'Habitly', own), 'general-1', 'every other project, when the owner set one');
  const picked = robotFor('lead', 'Habitly', 'Habitly');
  assert.ok(!['general-1', 'cto', 'pm', 'spare', 'helper', 'helper-2'].includes(picked), 'with no picks, a project robot');
  assert.equal(robotFor('lead', 'Habitly', 'Habitly'), picked, 'the same project, the same robot');
  assert.ok(new Set(['A', 'B', 'C', 'D', 'E', 'F'].map(p => robotFor('lead', p, p))).size > 2, 'projects spread over the robots');
  assert.ok(['helper', 'helper-2'].includes(robotFor('helper', 'x/agent-1')));
  const a = tavernAgents({ sessions: [{ id: 'Clipper', role: 'lead', name: 'lead-Clipper', project: 'Clipper', state: 'working' }] });
  assert.equal(a.find(x => x.id === 'Clipper').robot, robotFor('lead', 'Clipper', 'Clipper'));
});

import { sessionBoard } from './tavern/tokens.js';
test('tavern: the token board counts each live pane\'s own conversation, replies once each, its helpers apart (#246)', () => {
  const root = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'tok-')), cwd = 'D:\\Work\\Proj', dir = pathx.join(root, encodeProjectDir(cwd));
  fsx.mkdirSync(pathx.join(dir, 'c2', 'subagents'), { recursive: true });
  const line = (id, n) => JSON.stringify({ type: 'assistant', requestId: id, message: { id, usage: { input_tokens: n, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 10 } } });
  fsx.writeFileSync(pathx.join(dir, 'c1.jsonl'), line('a', 1000));
  const old = new Date(Date.now() - 3600e3); fsx.utimesSync(pathx.join(dir, 'c1.jsonl'), old, old);
  fsx.writeFileSync(pathx.join(dir, 'c2.jsonl'), [line('b', 5), line('b', 5), line('c', 7)].join('\n'));
  fsx.writeFileSync(pathx.join(dir, 'c2', 'subagents', 'agent-1.jsonl'), line('d', 3));
  const rows = sessionBoard(root, [{ name: 'lead-Proj', cwd, startedAt: Date.now() - 60e3 }]);
  assert.deepEqual(rows.map(r => [r.who, r.fresh, r.cacheRead]), [['lead-Proj', 12, 20], ["lead-Proj's helpers (1)", 3, 10]]);
});

import { fiveHour } from './tavern/usage.js';
test('tavern: the tap barrels read the 5-hour allowance the status line wrote, full again past its reset (#279)', () => {
  const dir = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'use-')), now = 1_800_000_000_000;
  assert.equal(fiveHour(dir, now), null, 'nothing written yet');
  const write = (f, d, t) => { fsx.writeFileSync(pathx.join(dir, f), JSON.stringify(d)); fsx.utimesSync(pathx.join(dir, f), t / 1000, t / 1000); };
  write('old.json', { at: now / 1000 - 600, five_hour: { used_percentage: 10, resets_at: now / 1000 + 3600 } }, now - 600e3);
  write('new.json', { at: now / 1000 - 60, five_hour: { used_percentage: 37, resets_at: now / 1000 + 3600 } }, now - 60e3);
  assert.deepEqual(fiveHour(dir, now), { used: 37, resetsAt: now + 3600e3, at: now - 60e3 });
  assert.equal(fiveHour(dir, now + 3601e3).used, 0, 'past the reset the barrels are full');
  write('newest.json', { at: now / 1000, five_hour: null }, now);
  assert.equal(fiveHour(dir, now).used, 37, 'a file without the window is skipped');
});

// The chalkboard's tabs (#285).
import { periodBoard, periodStart } from './tavern/tokens.js';
import { tasksDone } from './tavern/tally.js';
import { commitsToday } from './commits.js';

test('periods start at local midnight, the week on Monday', () => {
  const fri = new Date(2026, 9, 9, 15, 30);   // Friday 9 Oct 2026
  assert.equal(periodStart('today', fri), new Date(2026, 9, 9).getTime());
  assert.equal(periodStart('week', fri), new Date(2026, 9, 5).getTime());
  assert.equal(periodStart('week', new Date(2026, 9, 11, 9)), new Date(2026, 9, 5).getTime(), 'Sunday still belongs to the week begun on Monday');
  assert.equal(periodStart('week', new Date(2026, 9, 5, 0, 1)), new Date(2026, 9, 5).getTime());
});

test('the period board counts replies since its start, per agent, helpers apart, and reads only new lines', async () => {
  const root = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'chalk-')), since = Date.parse('2026-10-09T00:00:00Z');
  const line = (id, at, fresh) => JSON.stringify({ type: 'assistant', requestId: id, timestamp: at, message: { id, usage: { input_tokens: fresh, output_tokens: 0, cache_read_input_tokens: 1000 } } }) + '\n';
  const lead = pathx.join(root, 'D--SideProjects-Habitly'), cto = pathx.join(root, 'D--SideProjects-FocusShell-manager');
  fsx.mkdirSync(pathx.join(lead, 'c1', 'subagents'), { recursive: true }); fsx.mkdirSync(cto);
  const log = pathx.join(lead, 'c1.jsonl');
  fsx.writeFileSync(log, line('old', '2026-10-08T23:00:00Z', 500) + line('a', '2026-10-09T08:00:00Z', 10) + line('a', '2026-10-09T08:00:00Z', 10));
  fsx.writeFileSync(pathx.join(lead, 'c1', 'subagents', 'agent-1.jsonl'), line('s', '2026-10-09T09:00:00Z', 7));
  fsx.writeFileSync(pathx.join(cto, 'c2.jsonl'), line('b', '2026-10-09T10:00:00Z', 30));
  let rows = await periodBoard(root, since);
  assert.deepEqual(rows.map(r => [r.who, r.kind, r.fresh, r.replies]), [['CTO', 'CTO', 30, 1], ['lead-Habitly', 'lead', 10, 1], ["lead-Habitly's helpers (1)", 'helpers', 7, 1]]);
  fsx.appendFileSync(log, line('c', '2026-10-09T11:00:00Z', 40) + '{"type":"assistant","half a line');
  rows = await periodBoard(root, since);
  assert.equal(rows[0].who, 'lead-Habitly'); assert.equal(rows[0].fresh, 50, 'appended replies are added once, a half-written line waits');
  assert.equal(rows[0].cacheRead, 2000);
  assert.deepEqual(await periodBoard(pathx.join(root, 'missing'), since), []);
});

test('tasks done counts each board\'s items closed today and this week, leaving out Me', () => {
  const now = new Date(2026, 9, 9, 18, 0);
  const md = (...items) => '# X tasks\n' + items.join('\n') + '\n';
  const rows = tasksDone({
    Habitly: md('- [x] #1 A (2026-10-01, user)', '  > Done: 2026-10-09 10:00', '- [x] #2 B (2026-10-01, user)', '  > Done: 2026-10-06 10:00', '- [x] #3 C (2026-10-01, user)', '  > Done: 2026-10-04 10:00', '- [ ] #4 D (2026-10-01, user)', '  > Done: 2026-10-09 11:00'),
    NoteNest: md('- [x] #7 E (2026-10-01, user)', '  > Done: 2026-10-05 09:00', '- [x] #8 F (2026-10-01, user)'),
    Old: md('- [x] #1 G (2026-10-01, user)', '  > Done: 2026-10-02 09:00'),
    Me: md('- [x] #1 H (2026-10-01, user)', '  > Done: 2026-10-09 09:00'),
  }, now);
  assert.deepEqual(rows, [{ who: 'Habitly', today: 1, week: 2 }, { who: 'NoteNest', today: 0, week: 1 }]);
});

test('commits today asks git for every branch since local midnight, one count per project', async () => {
  const asked = [];
  const git = async (cwd, args) => { asked.push([cwd, args]); return { 'C:\a': 'h1\nh2\n', 'C:\b': '', 'C:\c': 'h3\n' }[cwd]; };
  const r = await commitsToday([{ name: 'A', path: 'C:\a' }, { name: 'B', path: 'C:\b' }, { name: 'C', path: 'C:\c' }, { name: 'NoPath' }], git, new Date(2026, 9, 9, 15));
  assert.deepEqual(r, { total: 3, projects: [{ name: 'A', count: 2 }, { name: 'C', count: 1 }] });
  assert.deepEqual(asked[0][1], ['log', '--all', '--since=2026-10-09 00:00', '--format=%H']);
  assert.equal(asked.length, 3);
});

test('tavern: the mug rack and trophy shelf count items closed today and this week, Me left out (#282)', () => {
  const md = {
    Habitly: board('- [x] #1 A (2026-10-01, user)', '  > Done: 2026-10-09 10:15', '- [x] #2 B (2026-10-01, user)', '  > Done: 2026-10-05 09:00',
      '- [x] #3 Last week (2026-10-01, user)', '  > Done: 2026-10-04 23:59', '- [ ] #4 Reopened (2026-10-01, user)', '  > Done: 2026-10-09 11:00', '- [x] #5 No date (2026-10-01, user)'),
    NoteNest: board('- [x] #7 C (2026-10-01, user)', '  > Done: 2026-10-09'),
    Me: board('- [x] #1 Mine (2026-10-01, user)', '  > Done: 2026-10-09 08:00'),
  };
  // Friday 9 October 2026: the week began on Monday the 5th.
  assert.deepEqual(finishedCounts(md, ['Me'], new Date(2026, 9, 9, 15)), { today: 2, week: 3, days: [1, 0, 0, 0, 2, 0, 0] });
  // On a Sunday the week still began on the Monday before.
  assert.equal(finishedCounts(md, ['Me'], new Date(2026, 9, 11, 12)).week, 3);
  assert.equal(finishedCounts(md, ['Me'], new Date(2026, 9, 12, 0, 5)).week, 0);
});

// The Demo's leads in the owner's project robots (#305).
import { demoRobots } from './tavern/agents.js';
test('demo leads wear different project robots, a new mix per start, the CTO, PM and helpers their own', () => {
  const demo = ['Habitly', 'FocusTimer', 'RecipeScale', 'NoteNest'];
  const a = demoRobots(demo, 1), b = demoRobots([...demo].reverse(), 1);
  assert.deepEqual(a, b, 'the same start gives the same mix whatever the order');
  assert.equal(new Set(Object.values(a)).size, 4, 'no two alike');
  assert.ok(Object.values(a).every(r => !['general-1', 'cto', 'pm', 'spare', 'helper', 'helper-2'].includes(r)));
  const mixes = new Set([1, 2, 3, 4, 5, 6].map(s => JSON.stringify(demoRobots(demo, s))));
  assert.ok(mixes.size > 3, 'other starts, other mixes');
  const sessions = [{ id: 'cto', role: 'cto', name: 'CTO', state: 'idle' }, { id: 'pm', role: 'pm', name: 'PM', state: 'idle' },
    { id: 'Habitly', role: 'lead', name: 'lead-Habitly', project: 'Habitly', state: 'working' }];
  const out = tavernAgents({ sessions, helpers: [{ id: 'h1', parent: 'Habitly', project: 'Habitly' }], robots: a });
  assert.deepEqual(out.map(x => x.robot), ['cto', 'pm', a.Habitly, robotFor('helper', 'h1')]);
  assert.equal(tavernAgents({ sessions }).find(x => x.id === 'Habitly').robot, robotFor('lead', 'Habitly', 'Habitly'), 'outside the Demo, picked from its name');
});

import { agentName } from './tavern/tokens.js';
test('agent names: the Demo\'s folders read as its CTO, PM and demo leads (#314)', () => {
  assert.equal(agentName('D--FocusShellDemo-deck-manager'), 'CTO');
  assert.equal(agentName('D--FocusShellDemo-deck-pm'), 'PM');
  assert.equal(agentName('D--FocusShellDemo-projects-Habitly'), 'lead-Habitly');
  assert.equal(agentName('D--SideProjects-FocusShell-manager'), 'CTO');
  assert.equal(agentName('D--SideProjects-Workout'), 'lead-Workout');
});
