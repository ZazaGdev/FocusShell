// Fake agents for the mock-up (#238): stands in for FocusShell's real session list. It
// changes on its own a little, so guests come and go, work, drink and walk up with questions.
// The real app replaces this file with its sessions and their open prompts.

const QUESTIONS = [
  { text: 'Long break: keep 15 minutes or make it 20?', options: ['Keep 15', 'Make it 20'], suggest: 'Keep 15' },
  { text: 'Save notes to a notes.json file, or to SQLite?', options: ['notes.json', 'SQLite'], suggest: 'notes.json' },
  { text: 'Ship the thumbnail with the red arrow or the plain one?', options: ['Red arrow', 'Plain'], suggest: 'Plain' },
  { text: 'The build is green. Push it to main now?', options: ['Push now', 'Wait for me'], suggest: 'Push now' },
  { text: 'Use US cup weights or UK cup weights for flour?', options: ['US weights', 'UK weights'], suggest: 'US weights' },
];

// look: [col, row] of a ready-made character in Kenney's Roguelike Characters sheet.
export function startingAgents() {
  return [
    { id: 'cto', name: 'CTO', role: 'cto', project: 'All projects', state: 'working', look: [1, 11] },
    { id: 'pm', name: 'PM', role: 'pm', project: 'The board', state: 'idle', look: [1, 5] },
    { id: 'lead-FocusShell', name: 'FocusShell', role: 'lead', project: 'FocusShell', state: 'asking', look: [0, 9],
      question: { text: 'Search results: put Done items in their own section at the end?', options: ['Yes, Done last', 'Keep one list'], suggest: 'Yes, Done last' } },
    { id: 'lead-Blogger', name: 'Blogger', role: 'lead', project: 'Blogger', state: 'working', look: [0, 7] },
    { id: 'lead-Arcade', name: 'Arcade', role: 'lead', project: 'Arcade', state: 'working', look: [1, 6] },
    { id: 'lead-Clipper', name: 'Clipper', role: 'lead', project: 'Clipper', state: 'idle', look: [0, 8] },
    { id: 'helper-1', name: 'helper', role: 'helper', project: 'Blogger', state: 'working', look: [1, 8], ttl: 12 },
  ];
}

// One tick of make-believe, every few seconds: a lead may finish and go for a drink, a
// drinker may start work, someone may walk up with a question, helpers come and go.
// rnd is injected so a test run is the same every time.
export function tickAgents(agents, rnd = Math.random, now = 0) {
  let out = agents.map(a => ({ ...a }));
  for (const a of out) {
    if (a.role === 'helper') continue;
    if (a.state === 'asking') continue;               // waits for the barkeeper
    const r = rnd();
    if (r < 0.08 && out.filter(x => x.state === 'asking').length < 3) {
      a.state = 'asking'; a.question = QUESTIONS[Math.floor(rnd() * QUESTIONS.length)];
    } else if (r < 0.2) a.state = a.state === 'working' ? 'idle' : 'working';
  }
  out = out.filter(a => a.role !== 'helper' || (a.ttl ?? 1) > 0).map(a => a.role === 'helper' ? { ...a, ttl: a.ttl - 1 } : a);
  const helpers = out.filter(a => a.role === 'helper').length;
  if (helpers < 2 && rnd() < 0.15) {
    const n = Math.floor(now) % 1000;
    out.push({ id: `helper-${n}-${Math.floor(rnd() * 1e6)}`, name: 'helper', role: 'helper', project: ['FocusShell', 'Arcade', 'Clipper'][Math.floor(rnd() * 3)],
      state: 'working', look: [[1, 8], [1, 9], [0, 10]][Math.floor(rnd() * 3)], ttl: 6 + Math.floor(rnd() * 8) });
  }
  return out;
}

// The barkeeper answered: the agent goes back to work.
export const answerAgent = (agents, id) => agents.map(a => a.id === id ? { ...a, state: 'working', question: undefined } : a);
