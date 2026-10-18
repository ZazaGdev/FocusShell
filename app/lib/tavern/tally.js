// The chalkboard's Tasks done tab (#285): items marked done on each project's board, today and
// this week, read from their "  > Done: <YYYY-MM-DD HH:MM>" lines. The owner's own board (Me)
// is left out: the chalkboard counts the agents' work.
import { parseTasks, doneOf } from '../tasks.js';

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// tasksByProject: { Project: markdown }. [{ who, today, week }], most done today first.
export function tasksDone(tasksByProject, now = new Date()) {
  const today = ymd(now), monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const week = ymd(monday), rows = [];
  for (const [who, md] of Object.entries(tasksByProject || {})) {
    if (who === 'Me') continue;
    let t = 0, w = 0;
    for (const task of parseTasks(md)) {
      if (task.mark !== 'x') continue;
      const day = doneOf(task).slice(0, 10);
      if (!day || day < week || day > today) continue;
      w++;
      if (day === today) t++;
    }
    if (w) rows.push({ who, today: t, week: w });
  }
  return rows.sort((a, b) => b.today - a.today || b.week - a.week || a.who.localeCompare(b.who));
}
