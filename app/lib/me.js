// "Me": the owner's own board, tasks/Me.md in the usual task format. It is not a project,
// so no lead ever gets its items. A timed item carries a detail line "> Due: <date> [<time>]".
// A "> Someday" line (#170) puts an open item in Someday: good to do, not now.
import { doneOf } from './tasks.js';

const DUE_RE = /^Due:\s*(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?\s*$/i;

// The due date of a task, from its detail lines, or null.
export function dueOf(task) {
  for (const d of task.details || []) {
    const m = d.match(DUE_RE);
    if (!m) continue;
    const [y, mo, da] = m[1].split('-').map(Number);
    return { date: new Date(y, mo - 1, da, m[2] ? Number(m[2]) : 0, m[3] ? Number(m[3]) : 0), timed: !!m[2], day: m[1] };
  }
  return null;
}

const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const SOMEDAY_RE = /^Someday\s*$/i;
export const isSomeday = task => (task.details || []).some(d => SOMEDAY_RE.test(d));

// Adds or removes the "> Someday" line under item n; other lines stay as they are.
export function setSomeday(md, n, on) {
  const lines = String(md).split(/\r?\n/);
  const i = lines.findIndex(l => new RegExp(`^- \\[.\\] #${n}\\b`).test(l));
  if (i < 0) return String(md);
  let end = i + 1;
  while (end < lines.length && /^\s+> ?/.test(lines[end])) end++;
  const kept = lines.slice(i + 1, end).filter(l => !/^\s+> ?Someday\s*$/i.test(l));
  if (on) kept.push('  > Someday');
  return [...lines.slice(0, i + 1), ...kept, ...lines.slice(end)].join('\n');
}

// Groups for the Me panel: overdue and today; Reminders (#198), every open item with a time,
// soonest first, so today's are in both; To do, the undated ones; Someday; and done.
export function groupMe(tasks, now = new Date(), sort = 'newest') {
  const today = dayKey(now);
  const out = { today: [], reminders: [], todo: [], someday: [], done: [] };
  for (const t of tasks) {
    if (t.mark === 'x') { out.done.push(t); continue; }
    if (isSomeday(t)) { out.someday.push(t); continue; }
    const due = dueOf(t);
    if (!due) { out.todo.push(t); continue; }
    if (due.day <= today) out.today.push(t);
    out.reminders.push(t);
  }
  const byDue = (a, b) => dueOf(a).date - dueOf(b).date || a.n - b.n;
  out.today.sort(byDue); out.reminders.sort(byDue);
  sortTodo(out.todo, sort);
  out.someday.sort((a, b) => a.n - b.n);
  // Done (#219): the latest closed first; items closed before dates were kept, highest number first.
  out.done.sort((a, b) => doneOf(b).localeCompare(doneOf(a)) || b.n - a.n);
  return out;
}

// How a due date reads on a card: "today 17:00", "Tue 10:30", "Oct 14", "overdue".
export function dueLabel(due, now = new Date()) {
  if (!due) return '';
  const time = due.timed ? ` ${String(due.date.getHours()).padStart(2, '0')}:${String(due.date.getMinutes()).padStart(2, '0')}` : '';
  const today = dayKey(now);
  if (due.day < today) return `overdue, ${due.day}${time}`;
  if (due.day === today) return `today${time}`;
  const days = (due.date - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5;
  if (days < 7) return due.date.toLocaleDateString('en-GB', { weekday: 'short' }) + time;
  return due.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + time;
}

// Open Me items whose due time has come and that have not been notified yet. `seen` holds
// keys already notified; a changed due date gets a new key, so it notifies again.
export function dueReminders(tasks, now, seen) {
  return tasks.filter(t => t.mark !== 'x').map(t => ({ t, due: dueOf(t) }))
    .filter(({ due }) => due && due.date <= now)
    .map(({ t, due }) => ({ n: t.n, text: t.text, key: `${t.n}|${due.date.toISOString()}` }))
    .filter(r => !seen.includes(r.key));
}

// A repeating item (#198) carries "> Repeat: every <N> day(s)|week(s)" beside its Due line,
// which it counts from. Null without a Due line, or when the line does not read.
const REPEAT_RE = /^Repeat:\s*every\s+(?:(\d+)\s*)?(day|week)s?\s*$/i;
export function repeatOf(task) {
  if (!dueOf(task)) return null;
  for (const d of task.details || []) {
    const m = d.match(REPEAT_RE);
    const every = m ? Number(m[1] || 1) : 0;
    if (every > 0) return { every, unit: m[2].toLowerCase(), days: every * (m[2].toLowerCase() === 'week' ? 7 : 1) };
  }
  return null;
}
// How it reads on a row ("every week"), and as the line writes it ("every 1 week").
export const repeatLabel = r => (!r ? '' : r.every === 1 ? `every ${r.unit}` : `every ${r.every} ${r.unit}s`);
const repeatLine = r => `  > Repeat: every ${r.every} ${r.unit}${r.every === 1 ? '' : 's'}`;

// The next due date of a repeating item ticked at `now`: a period on from the due date, and on
// past now when periods were missed, keeping the rhythm (weekly from a Monday stays Monday).
export function nextDue(due, rep, now = new Date()) {
  const d = due.date;
  let k = 1, next;
  do { next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + rep.days * k++, d.getHours(), d.getMinutes()); }
  while (next <= now);
  return { date: next, timed: due.timed, day: dayKey(next) };
}
const dueLine = due => `  > Due: ${due.day}${due.timed ? ` ${String(due.date.getHours()).padStart(2, '0')}:${String(due.date.getMinutes()).padStart(2, '0')}` : ''}`;

// Item n with its Due and Repeat lines replaced by `lines`; its other detail lines stay.
function withSchedule(md, n, lines) {
  const all = String(md).split(/\r?\n/);
  const i = all.findIndex(l => new RegExp(`^- \\[.\\] #${n}\\b`).test(l));
  if (i < 0) return String(md);
  let end = i + 1;
  while (end < all.length && /^\s+> ?/.test(all[end])) end++;
  const kept = all.slice(i + 1, end).filter(l => !/^\s+> ?(Due|Repeat):/i.test(l));
  return [...all.slice(0, i + 1), ...lines, ...kept, ...all.slice(end)].join('\n');
}

// Ticking a repeating item done keeps it open and moves its Due line to the next date; any
// other item is left for the usual mark. Null when item n does not repeat.
export function rollRepeat(md, task, now = new Date()) {
  const due = dueOf(task), rep = repeatOf(task);
  if (!rep) return null;
  return withSchedule(md, task.n, [dueLine(nextDue(due, rep, now)), repeatLine(rep)]);
}

// Sets item n's time from the Self page (#198): day "YYYY-MM-DD" or '' to clear, time "HH:MM"
// or '', and a repeat every N days or weeks (0 for none). A repeat needs a day.
export function setSchedule(md, n, { day, time, every, unit }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return withSchedule(md, n, []);
  const lines = [`  > Due: ${day}${/^\d{1,2}:\d{2}$/.test(time || '') ? ` ${time}` : ''}`];
  const k = Math.floor(Number(every));
  if (k > 0) lines.push(repeatLine({ every: k, unit: unit === 'week' ? 'week' : 'day' }));
  return withSchedule(md, n, lines);
}

// How To do is ordered (#204): newest first (the default), oldest first, or by priority (a
// "> Priority: 1-4" line, items without one last, newest first among equals). The date is the
// one on the task line; the higher number is the newer on the same day.
export const TODO_SORTS = { newest: 'Newest first', oldest: 'Oldest first', priority: 'Priority' };
const prioOf = t => { for (const d of t.details || []) { const m = d.match(/^Priority:\s*([1-4])\s*$/i); if (m) return Number(m[1]); } return 9; };
export function sortTodo(list, by = 'newest') {
  const newest = (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || b.n - a.n;
  const cmp = by === 'oldest' ? (a, b) => -newest(a, b) : by === 'priority' ? (a, b) => prioOf(a) - prioOf(b) || newest(a, b) : newest;
  return list.sort(cmp);
}
