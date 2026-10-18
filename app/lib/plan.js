// Versions and priority (#23; sprints dropped in #169). Nothing here changes the task line.
// A project's versions sit in "> " lines right under the "# <Project> tasks" heading, before
// the first task:
//   > Version 0.5: current
//   > Version 0.6
//   > Version 0.4: done
// and each task carries its own on detail lines: "> Version: 0.5", "> Priority: 2".

const HEAD_RE = /^> ?(.*)$/;
const VERSION_RE = /^Version\s+(.+?)(?::\s*(current|done))?\s*$/i;
export const PLAN_KEYS = ['Version', 'Priority'];

// The plan lines of a task file: { versions: [{ name, state }] }. state is 'current',
// 'done' or '' (planned).
export function parsePlan(md) {
  const plan = { versions: [] };
  for (const line of String(md).split(/\r?\n/)) {
    if (/^- \[/.test(line)) break;
    const m = line.match(HEAD_RE);
    if (!m) continue;
    const v = m[1].match(VERSION_RE);
    if (v) plan.versions.push({ name: v[1].trim(), state: (v[2] || '').toLowerCase() });
  }
  return plan;
}

// Writes the plan lines back, keeping the heading and every task untouched.
export function setPlan(md, plan) {
  const lines = String(md).split(/\r?\n/);
  let first = lines.findIndex(l => /^- \[/.test(l));
  if (first < 0) first = lines.length;
  const head = lines.slice(0, first), rest = lines.slice(first);
  const keep = head.filter(l => { const m = l.match(HEAD_RE); return !m || !VERSION_RE.test(m[1]); });
  const out = [];
  for (const v of plan.versions || []) out.push(`> Version ${v.name}${v.state ? `: ${v.state}` : ''}`);
  const at = keep.findIndex(l => /^# /.test(l)) + 1;
  keep.splice(at, 0, ...out);
  return [...keep, ...rest].join('\n');
}

// The version a project's To do holds: the one marked current, else the first not yet done.
export const currentVersion = plan => (plan.versions.find(v => v.state === 'current') || plan.versions.find(v => v.state !== 'done') || {}).name || null;

// A task's own version and priority. "Priority: first" (the PM's older wording)
// counts as 1. Anything unreadable is null.
export function planOf(task) {
  const out = { version: null, priority: null };
  for (const d of task.details || []) {
    const m = d.match(/^(Version|Priority):\s*(.+?)\s*$/i);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2];
    if (k === 'version') out.version = v;
    else if (k === 'priority') out.priority = /^first$/i.test(v) ? 1 : /^[1-4]$/.test(v) ? Number(v) : out.priority;
  }
  return out;
}
// Highest priority (1) first, unset last, then by number.
export const byPriority = (a, b) => (planOf(a).priority ?? 9) - (planOf(b).priority ?? 9) || a.n - b.n;

// Sets (or with null/'' removes) one "> Key: value" detail line of task n, leaving every
// other line as it is. A new line goes after the task's last detail line.
export function setTaskKey(md, n, key, value) {
  const lines = String(md).split(/\r?\n/);
  const i = lines.findIndex(l => new RegExp(`^- \\[.\\] #${n}\\b`).test(l));
  if (i < 0) return String(md);
  let end = i + 1;
  while (end < lines.length && /^\s+> ?/.test(lines[end])) end++;
  const re = new RegExp(`^\\s+> ?${key}:`, 'i');
  const kept = lines.slice(i + 1, end).filter(l => !re.test(l));
  const v = value == null ? '' : String(value).trim();
  if (v) kept.push(`  > ${key}: ${v}`);
  return [...lines.slice(0, i + 1), ...kept, ...lines.slice(end)].join('\n');
}
