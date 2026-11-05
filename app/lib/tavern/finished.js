// Finished work for the tavern's mug rack and trophy shelf (#282): the items closed today and
// each day this week (Monday to Sunday), by their "> Done:" dates on every project board.
// skip names the boards that are not a project's (Me).
import { parseTasks, doneOf } from '../tasks.js';

const day = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// -> { today, week, days: [Mon..Sun counts] }
export function finishedCounts(tasksMd = {}, skip = [], now = new Date()) {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const dates = Array.from({ length: 7 }, (_, i) => day(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)));
  const days = dates.map(() => 0);
  for (const [project, md] of Object.entries(tasksMd)) {
    if (skip.includes(project)) continue;
    for (const t of parseTasks(md || '')) {
      if (t.mark !== 'x') continue;
      const i = dates.indexOf(doneOf(t).slice(0, 10));
      if (i >= 0) days[i]++;
    }
  }
  const today = days[dates.indexOf(day(now))];
  return { today, week: days.reduce((a, b) => a + b, 0), days };
}
