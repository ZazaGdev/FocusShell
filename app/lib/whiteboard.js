// The owner's whiteboard (#52): one card per item waiting on the owner (`?`) in the
// projects a CTO handles, so they can answer them all in one place.
import { parseTasks, askOf } from './tasks.js';
import { planOf } from './plan.js';
import { managerFor } from './groups.js';

// tasksMd: { project: markdown }. mgr: the CTO whose projects to show ('cto' covers the
// projects in no group). Returns [{ project, cards: [{ task, ask }] }]: within a project
// highest priority first, then oldest; projects with the oldest waiting card first.
export function whiteboardCards(tasksMd, groups, mgr, skip = []) {
  const byDate = (a, b) => (planOf(a).priority ?? 9) - (planOf(b).priority ?? 9) || (a.date || '9').localeCompare(b.date || '9') || a.n - b.n;
  const out = [];
  for (const [project, md] of Object.entries(tasksMd || {})) {
    if (skip.includes(project) || managerFor(groups, project) !== mgr) continue;
    const waiting = parseTasks(md).filter(t => t.mark === '?' && !t.forOwner).sort(byDate);
    if (waiting.length) out.push({ project, cards: waiting.map(task => ({ task, ask: askOf(task) })) });
  }
  const oldest = g => g.cards.reduce((m, c) => (c.task.date && c.task.date < m ? c.task.date : m), '9');
  return out.sort((a, b) => oldest(a).localeCompare(oldest(b)) || a.project.localeCompare(b.project));
}

export const cardCount = groups => groups.reduce((s, g) => s + g.cards.length, 0);
