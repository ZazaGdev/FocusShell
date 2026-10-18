// The ideas deck (#130): ideas/Me.md, in the task-list format of lib/tasks.js, kept apart
// from Me's to-dos. An idea's first detail line is its description; it may also carry
// "> Tags: youtube, app" and "> State: new | growing | parked | became Me #<n>", and
// "> Sent: CTO <YYYY-MM-DD>" once sent to the CTO (#342), whatever its state.
import { parseTasks } from './tasks.js';
import { setTaskKey } from './plan.js';

export const STATES = ['new', 'growing', 'parked'];
const KEYED = /^(Tags|State|Sketch|Sent):/i;

const valueOf = (t, key) => {
  const d = (t.details || []).find(x => new RegExp(`^${key}:`, 'i').test(x));
  return d ? d.slice(d.indexOf(':') + 1).trim() : '';
};
export const tagsOf = t => valueOf(t, 'Tags').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
// "became Me #4" is its own state; anything unknown reads as new.
export function stateOf(t) {
  const s = valueOf(t, 'State').toLowerCase();
  if (/^became\b/.test(s)) return 'became';
  return STATES.includes(s) ? s : 'new';
}
export const becameOf = t => (valueOf(t, 'State').match(/became\s+(.+#\d+)/i) || [])[1] || '';
export const aboutOf = t => (t.details || []).filter(d => !KEYED.test(d));
// The day an idea was sent to the CTO, or ''.
export const sentOf = t => (valueOf(t, 'Sent').match(/\d{4}-\d{2}-\d{2}/) || [])[0] || '';

// Open ideas, growing first, then new, then the ones that became tasks, parked last;
// newest first within each. Ideas marked done (x) are dropped and not shown.
const ORDER = { growing: 0, new: 1, became: 2, parked: 3 };
export function parseIdeas(md) {
  return parseTasks(md).filter(t => t.mark !== 'x')
    .map(t => ({ ...t, tags: tagsOf(t), state: stateOf(t), became: becameOf(t), sent: sentOf(t), about: aboutOf(t) }))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.n - a.n);
}
export const allTags = ideas => [...new Set(ideas.flatMap(i => i.tags))].sort();

export const setTags = (md, n, tags) => setTaskKey(md, n, 'Tags', [...new Set(tags.map(s => s.trim().toLowerCase()).filter(Boolean))].join(', ') || null);
export const setState = (md, n, state) => setTaskKey(md, n, 'State', state);
export const setSent = (md, n, day) => setTaskKey(md, n, 'Sent', `CTO ${day}`);
// The one line the app types into the CTO's prompt for an idea (#342): its title, its own
// lines (paths included), its sketches and what the owner typed with it (#343), on one line.
export function ideaLine(idea, say) {
  const one = x => String(x).replace(/\s+/g, ' ').trim();
  const sketches = (idea.details || []).filter(d => /^Sketch:/i.test(d)).map(d => `sketch: ${one(d.slice(7))}`);
  const you = one(say || '');
  return [`IDEA #${idea.n}: ${one(idea.text)}`, ...(idea.about || []).map(one), ...sketches, you && `You: ${you}`].filter(Boolean).join(' | ');
}
// The idea's description edited as one text (#343): each non-empty line becomes a detail
// line, in order; its Tags, State, Sketch and Sent lines stay as they were, after them.
export function setAbout(md, n, text) {
  const lines = String(md).split(/\r?\n/);
  const i = lines.findIndex(l => new RegExp(`^- \\[.\\] #${Number(n)}\\b`).test(l));
  if (i < 0) return String(md);
  let end = i + 1;
  while (end < lines.length && /^\s+> ?/.test(lines[end])) end++;
  const keyed = lines.slice(i + 1, end).filter(l => KEYED.test(l.replace(/^\s+> ?/, '')));
  const about = String(text).split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).map(l => `  > ${l}`);
  return [...lines.slice(0, i + 1), ...about, ...keyed, ...lines.slice(end)].join('\n');
}
// The next state when the owner clicks an idea's state: new, growing, parked, round again.
export const nextState = s => STATES[(STATES.indexOf(s) + 1) % STATES.length];

// A plain detail line added under the idea, after its other lines.
export function addDetail(md, n, text) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  const lines = String(md).split(/\r?\n/);
  const i = lines.findIndex(l => new RegExp(`^- \\[.\\] #${Number(n)}\\b`).test(l));
  if (i < 0 || !clean) return String(md);
  let end = i + 1;
  while (end < lines.length && /^\s+> ?/.test(lines[end])) end++;
  return [...lines.slice(0, end), `  > ${clean}`, ...lines.slice(end)].join('\n');
}
