// The owner's whiteboard (#52): one card per item waiting on the owner (`?`) in the
// projects a CTO handles, so they can answer them all in one place.
import { parseTasks, askOf } from './tasks.js';
import { planOf } from './plan.js';
import { managerFor } from './groups.js';

// The question a card shows. A card the owner removed (#1168) is kept as { "<Project>#<n>": question }
// and comes back when its question changes.
export const cardQuestion = (task, ask) => (ask && ask.question) || task.text;

// tasksMd: { project: markdown }. mgr: the CTO whose projects to show ('cto' covers the
// projects in no group). Returns [{ project, cards: [{ task, ask }] }]: within a project
// highest priority first, then oldest; projects with the oldest waiting card first.
export function whiteboardCards(tasksMd, groups, mgr, skip = [], hidden = {}) {
  const byDate = (a, b) => (planOf(a).priority ?? 9) - (planOf(b).priority ?? 9) || (a.date || '9').localeCompare(b.date || '9') || a.n - b.n;
  const out = [];
  for (const [project, md] of Object.entries(tasksMd || {})) {
    if (skip.includes(project) || managerFor(groups, project) !== mgr) continue;
    const waiting = parseTasks(md).filter(t => t.mark === '?' && !t.forOwner).sort(byDate);
    const cards = waiting.map(task => ({ task, ask: askOf(task) })).filter(c => (hidden || {})[`${project}#${c.task.n}`] !== cardQuestion(c.task, c.ask));
    if (cards.length) out.push({ project, cards });
  }
  const oldest = g => g.cards.reduce((m, c) => (c.task.date && c.task.date < m ? c.task.date : m), '9');
  return out.sort((a, b) => oldest(a).localeCompare(oldest(b)) || a.project.localeCompare(b.project));
}

export const cardCount = groups => groups.reduce((s, g) => s + g.cards.length, 0);

// The card that holds the owner's place when the list redraws (#1734). rows: [{ key, top, bottom }],
// each card's edges measured from the top of the scrolled view, height the view's height. The card
// being typed in while it is on screen, else the first card still showing at the top. Null if none.
export function scrollAnchor(rows, height, focusKey = null) {
  const seen = r => r.bottom > 0 && r.top < height;
  const r = rows.find(x => x.key === focusKey && seen(x)) || rows.filter(seen).sort((a, b) => a.top - b.top)[0];
  return r ? { key: r.key, offset: r.top } : null;
}
