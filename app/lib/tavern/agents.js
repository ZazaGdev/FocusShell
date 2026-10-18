// The tavern's agent list (#240): FocusShell's live sessions and what waits on the owner,
// turned into the agents the tavern shows as guests. Pure, so who sits where is tested.
//
// An agent: { id, name, role: 'cto'|'pm'|'lead'|'helper', project, state: 'working'|'idle'|
// 'asking', look: [col, row], asks: [{ kind: 'prompt', id, what } | { kind: 'item', project, n }] }.

import { parseTasks } from '../tasks.js';

// The ready-made characters in the art sheet that can be a guest, as [col, row]. The
// barkeeper (the owner) keeps his own; the CTO and the PM have theirs by default.
export const BARKEEPER = [0, 6];
export const LOOKS = [[0, 5], [1, 5], [1, 6], [0, 7], [1, 7], [0, 8], [1, 8], [0, 9], [1, 9], [0, 10], [1, 10], [0, 11], [1, 11]];
const HELPER_LOOKS = [[1, 8], [1, 9], [0, 10]];
const FIXED = { cto: [1, 11], pm: [1, 5] };
const LEAD_LOOKS = LOOKS.filter(l => !Object.values(FIXED).some(f => f[0] === l[0] && f[1] === l[1]));
const hash = s => [...String(s)].reduce((a, c) => (a * 31 + c.codePointAt(0)) >>> 0, 7);
const sameLook = (a, b) => Array.isArray(a) && a[0] === b[0] && a[1] === b[1];
const validLook = l => LOOKS.some(x => sameLook(l, x));

// The look a session wears: the owner's pick in Settings, else one chosen from its name and
// kept (the same name always gets the same one). key: 'cto', 'pm' or a project name.
export function lookFor(key, picks = {}) {
  if (validLook(picks[key])) return picks[key];
  return FIXED[key] || LEAD_LOOKS[hash(key) % LEAD_LOOKS.length];
}

// The robot a guest is in the room (#246): the CTO and the PM their own, a group's CTO the miner,
// each lead a project robot, helpers one of the two small ones. The names are the sprites in
// tavern/art/sprites (robot-<name>.png).
const PROJECT_ROBOTS = ['focus-shell', 'ai-fun', 'budget-expense-tracker', 'builder', 'claude-setup', 'compass', 'gym',
  'personal', 'research', 'video-editor', 'web'];
// robots: { Project: robot } chosen elsewhere: the owner's own in Settings (tavernRobots,
// where '*' is every other project's robot) or the Demo's (#305). A project it does not name
// gets one picked from its name, so it keeps the same one (#358).
export function robotFor(role, id, project, robots = {}) {
  if (role === 'cto') return id === 'cto' ? 'cto' : 'spare';
  if (role === 'pm') return 'pm';
  if (role === 'helper') return hash(id) % 2 ? 'helper-2' : 'helper';
  return robots[project] || robots['*'] || PROJECT_ROBOTS[hash(String(project)) % PROJECT_ROBOTS.length];
}

// The Demo's leads wear the project robots (#305), a new mix each time the Demo starts
// (seed), no two alike while there are robots enough: { Project: robot }.
export function demoRobots(projects, seed) {
  const pool = [...PROJECT_ROBOTS].sort((a, b) => hash(`${seed}:${a}`) - hash(`${seed}:${b}`) || a.localeCompare(b));
  return Object.fromEntries([...projects].sort().map((p, i) => [p, pool[i % pool.length]]));
}

// What waits on the owner from one project's board: its `?` items, not the owner's own.
export const waitingItems = md => parseTasks(md || '').filter(t => t.mark === '?' && !t.forOwner).map(t => t.n);

// input: {
//   sessions: [{ id, role: 'cto'|'pm'|'lead', name, project, state }]   state as the tab dot says it:
//             'working' | 'idle' | 'needs' | 'blocked' | 'ended'
//   prompts:  [{ id, session, what }] a prompt card's id, the session it belongs to and what it
//             asks: a lead stopped on a prompt in its pane, or asking for the owner's words
//   tasksMd:  { project: markdown }  the boards, for NEEDS YOU items
//   helpers:  [{ id, parent, project }] subagents writing right now
//   picks:    { key: [col, row] }    the owner's looks from Settings
//   skip:     [project]              boards that are not a project's (Me)
//   answered: Set of "<project>#<n>" NEEDS YOU items answered here and not yet closed by the CTO
// }
export function tavernAgents({ sessions = [], prompts = [], tasksMd = {}, helpers = [], picks = {}, skip = [], answered = new Set(), robots = {} }) {
  const out = [], leadOf = new Set();
  const open = project => waitingItems(tasksMd[project]).filter(n => !answered.has(`${project}#${n}`));
  const asksFor = (id, project) => [
    ...prompts.filter(p => p.session === id).map(p => ({ kind: 'prompt', id: p.id, what: p.what || '' })),
    ...(project && !leadOf.has(project) && !skip.includes(project) ? open(project).map(n => ({ kind: 'item', project, n })) : []),
  ];
  for (const s of sessions) {
    if (s.state === 'ended') continue;
    const key = s.role === 'lead' ? s.project : s.id;
    const asks = asksFor(s.id, s.role === 'lead' ? s.project : null);
    if (s.role === 'lead') leadOf.add(s.project);
    out.push({ id: s.id, name: s.name, role: s.role, project: s.project || (s.role === 'pm' ? 'The board' : 'All projects'),
      state: asks.length ? 'asking' : s.state === 'working' ? 'working' : 'idle', look: lookFor(key, picks), robot: robotFor(s.role, s.id, s.project, robots), asks });
  }
  // Only running sessions are in the room (#311): a project with no lead running sends nobody.
  // The CTO is always there, its pane open or not.
  if (!out.some(a => a.id === 'cto')) out.unshift({ id: 'cto', name: 'CTO', role: 'cto', project: 'All projects', state: 'idle', look: lookFor('cto', picks), robot: robotFor('cto', 'cto'), asks: [] });
  for (const hp of helpers) {
    out.push({ id: `helper:${hp.id}`, name: 'helper', role: 'helper', parent: hp.parent, project: hp.project, state: 'working', look: HELPER_LOOKS[hash(hp.id) % HELPER_LOOKS.length], robot: robotFor('helper', hp.id), asks: [] });
  }
  return out;
}

// A session counts as busy while it printed something in the last few seconds, so its state
// flickers. Guests change between working and drinking only once the new state has held for
// `holdMs`; a question (asking) and its end take effect at once. held: Map id -> { state,
// since, seen } kept between calls; returns the agents with their settled states.
export function settleAgents(agents, held, now, holdMs = 20000) {
  for (const a of agents) {
    const h = held.get(a.id);
    if (!h || a.state === 'asking' || h.state === 'asking') { held.set(a.id, { state: a.state, since: now, seen: a.state }); continue; }
    if (a.state !== h.seen) { h.seen = a.state; h.since = now; }
    if (a.state !== h.state && now - h.since >= holdMs) h.state = a.state;
  }
  for (const id of [...held.keys()]) if (!agents.some(a => a.id === id)) held.delete(id);
  return agents.map(a => ({ ...a, state: held.get(a.id).state }));
}
