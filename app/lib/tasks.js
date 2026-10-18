// Task and note files shared with the manager, the leads and the backlog skill.
// Task line: - [<mark>] #<n> <task> (<YYYY-MM-DD>, <who>[, for owner]) -> <result>
// ", for owner" marks something the owner has to test, check or do themselves.
// <task> is a short title and <result> a short result. The full description, context and
// long results go on detail lines right under the task, indented: "  > <text>".
// "  > Sketch: sketches/<Project>/<id>.excalidraw" attaches a saved Sketch board (lib/sketches.js).
// "  > Done: <YYYY-MM-DD HH:MM>" is when an item was marked done (#219), whoever marked it.
// "  > Tags: Research, ..." tags an item (#224); an owner item to read or look into a research
// result goes on Me tagged Research, not on a project as a for-owner line.

const TASK_RE = /^- \[(.)\] #(\d+) (.*?)(?: \((\d{4}-\d{2}-\d{2}), ([^)]*)\))?(?: -> (.*))?\s*$/;
const FOR_OWNER = /,\s*for owner\s*$/i;
const DETAIL_RE = /^\s+> ?(.*)$/;

export function parseTasks(md) {
  const out = [];
  let last = null;
  String(md).split(/\r?\n/).forEach((line, i) => {
    const d = line.match(DETAIL_RE);
    if (d && last) { last.details.push(d[1]); return; }
    const m = line.match(TASK_RE);
    last = null;
    if (!m) return;
    const who = m[5] || '';
    last = { mark: m[1], n: Number(m[2]), text: m[3], date: m[4] || '', who: who.replace(FOR_OWNER, ''),
      forOwner: FOR_OWNER.test(who), result: m[6] || '', details: [], line: i };
    out.push(last);
  });
  return out;
}

export function nextNumber(md) {
  return parseTasks(md).reduce((a, t) => Math.max(a, t.n), 0) + 1;
}

// One counter for every task board, Me included (#411): a new task's number is one more than the
// highest on any board and never below SHARED_START, so a number from it names one task. Numbers
// below it are the old per-board kind and need their project ("FocusShell #41"). Ideas keep their own.
export const SHARED_START = 1000;
export function sharedNext(mds) {
  return Math.max(SHARED_START, ...mds.map(md => nextNumber(md)));
}

function withLine(md, line) {
  const body = String(md).replace(/\s*$/, '');
  return (body ? body + '\n' : '') + line + '\n';
}

// n: the number to give it (a task board's from the shared counter); the board's own next by default.
export function addTaskLine(md, text, who, date, n = nextNumber(md)) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return withLine(md, `- [ ] #${n} ${clean} (${date}, ${who})`);
}

// One state per project, for the tab dot and the card header.
export function projectState(tasks) {
  const marks = new Set(tasks.map(t => t.mark));
  if (marks.has('?')) return 'needs';
  if (marks.has('!')) return 'blocked';
  if (marks.has('~')) return 'working';
  return 'idle';
}

export function optionsOf(task) {
  const s = [task.text, task.result, ...(task.details || [])].join(' | ');
  const o = s.match(/options:\s*([^|]+)/i);
  const g = s.match(/suggest:\s*([^|]+)/i);
  // Lettered options split on their letters; others at top-level commas or "or" (#1038).
  const l = o && lettered(o[1]);
  return {
    options: !o ? [] : l ? l.options.map(x => `(${x.key}) ${x.text}`) : topSplit(o[1]).flatMap(x => (/[("]/.test(x) ? [x] : x.split(/\bor\b/))).map(x => x.trim()).filter(Boolean),
    suggest: g ? g[1].trim() : '',
  };
}

// Notes: - <YYYY-MM-DD HH:MM> <text>
const NOTE_RE = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) (.+)$/;

export function parseNotes(md) {
  return String(md).split(/\r?\n/).map(l => l.match(NOTE_RE)).filter(Boolean).map(m => ({ when: m[1], text: m[2] }));
}

export function addNoteLine(md, text, when) {
  return withLine(md || '# Notes', `- ${when} ${String(text).replace(/\s+/g, ' ').trim()}`);
}

// Change one task's mark in place, leaving every other line untouched.
// With `when` ("YYYY-MM-DD HH:MM"), an item marked done gets a "  > Done: <when>" line, its
// closed date beside the added date on its task line (#219); reopened, the line goes.
export function setMark(md, n, mark, when) {
  if (!/^[ ~?!x]$/.test(mark)) return md;
  const lines = String(md).split(/\r?\n/);
  const prefix = `#${Number(n)} `;
  const i = lines.findIndex(l => /^- \[.\] /.test(l) && l.slice(6).startsWith(prefix));
  if (i < 0) return md;
  const was = lines[i][3];
  lines[i] = lines[i].replace(/^- \[.\]/, `- [${mark}]`);
  if (!when || (mark === 'x') === (was === 'x')) return lines.join('\n');
  let end = i + 1;
  while (end < lines.length && DETAIL_RE.test(lines[end])) end++;
  const kept = lines.slice(i + 1, end).filter(l => !DONE_LINE.test(l));
  if (mark === 'x') kept.push(`  > Done: ${when}`);
  return [...lines.slice(0, i + 1), ...kept, ...lines.slice(end)].join('\n');
}
const DONE_LINE = /^\s+> ?Done:/i;
// When an item was closed, "YYYY-MM-DD" or "YYYY-MM-DD HH:MM", or '' (#219).
export function doneOf(task) {
  for (const d of task.details || []) { const m = d.match(/^Done:\s*(\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?)\s*$/i); if (m) return m[1]; }
  return '';
}
// Tags (#224): "  > Tags: Research, Video" under an item, the ideas deck's line. They show as
// badges and boards filter by them; the list to pick from is in Settings.
export function itemTags(task) {
  for (const d of task.details || []) { const m = d.match(/^Tags:\s*(.*)$/i); if (m) return m[1].split(',').map(s => s.trim()).filter(Boolean); }
  return [];
}
export const hasTag = (task, tag) => itemTags(task).some(x => x.toLowerCase() === String(tag).toLowerCase());
// The Tags line's value with `tag` added or taken off; null when none are left.
export function toggleTag(task, tag) {
  const now = itemTags(task), on = hasTag(task, tag);
  const next = on ? now.filter(x => x.toLowerCase() !== tag.toLowerCase()) : [...now, tag];
  return next.length ? next.join(', ') : null;
}
// An item's small history on a card (#219): "added 3 Oct", then "· done 7 Oct" once closed.
// The year shows only when it is not this year's.
export function historyLabel(task, now = new Date()) {
  const short = s => {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    return `${d} ${'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[m - 1]}${y === now.getFullYear() ? '' : ` ${y}`}`;
  };
  const done = task.mark === 'x' ? doneOf(task) : '';
  return [task.date ? `added ${short(task.date)}` : '', done ? `done ${short(done)}` : ''].filter(Boolean).join(' · ');
}

// Marks that need the user. Returns the tasks whose mark became `?` or `!` since `prev`,
// plus the new snapshot. `prev` is null on the first call, which never alerts.
export function newAlerts(prev, tasksByProject) {
  const now = {};
  const alerts = [];
  for (const [project, md] of Object.entries(tasksByProject)) {
    for (const t of parseTasks(md)) {
      const key = `${project}#${t.n}`;
      now[key] = t.mark;
      if (prev && (t.mark === '?' || t.mark === '!') && prev[key] !== t.mark) alerts.push({ project, ...t });
    }
  }
  return { alerts, snapshot: now };
}

// A new alert waits five minutes before it notifies (#120): the owner often answers the
// CTO's question in its pane at once. One that leaves its mark in the meantime is dropped.
// pending maps "Project#n" to the alert and when it was raised.
export const ALERT_DELAY = 5 * 60 * 1000;
export function holdAlerts(pending, alerts, snapshot, now) {
  const out = {};
  for (const [k, a] of Object.entries(pending || {})) if (snapshot[k] === a.mark) out[k] = a;
  for (const a of alerts) out[`${a.project}#${a.n}`] = { ...a, since: now };
  return out;
}
// The owner opened the item, or its project's page (no n): its alert will not notify.
export function seenAlerts(pending, project, n) {
  const out = {};
  for (const [k, a] of Object.entries(pending || {})) if (a.project !== project || (n != null && a.n !== Number(n))) out[k] = a;
  return out;
}
export function dueAlerts(pending, now, delay = ALERT_DELAY) {
  const due = [], rest = {};
  for (const [k, a] of Object.entries(pending || {})) if (now - a.since >= delay) due.push(a); else rest[k] = a;
  return { due, pending: rest };
}

// Sets task n's short result, the " -> <result>" end of its line ('' takes it off) (#225).
export function setResult(md, n, result) {
  const clean = String(result ?? '').replace(/\s+/g, ' ').trim();
  const lines = String(md).split(/\r?\n/);
  const i = lines.findIndex(l => { const m = l.match(TASK_RE); return m && Number(m[2]) === Number(n); });
  if (i < 0) return md;
  const m = lines[i].match(TASK_RE);
  lines[i] = `- [${m[1]}] #${m[2]} ${m[3]}${m[4] ? ` (${m[4]}, ${m[5]})` : ''}${clean ? ` -> ${clean}` : ''}`;
  return lines.join('\n');
}

// Sets who task n is with, keeping ", for owner" and everything else on the line (#225).
export function setWho(md, n, who) {
  const clean = String(who ?? '').replace(/[(),]/g, ' ').replace(/\s+/g, ' ').trim();
  const lines = String(md).split(/\r?\n/);
  const i = lines.findIndex(l => { const m = l.match(TASK_RE); return m && Number(m[2]) === Number(n); });
  if (i < 0 || !clean) return md;
  const m = lines[i].match(TASK_RE), owner = FOR_OWNER.test(m[5] || '') ? ', for owner' : '';
  lines[i] = `- [${m[1]}] #${m[2]} ${m[3]} (${m[4] || new Date().toISOString().slice(0, 10)}, ${clean}${owner})${m[6] ? ` -> ${m[6]}` : ''}`;
  return lines.join('\n');
}

// Adds a detail line below task n's existing ones; nothing already there changes (#225).
export function addDetail(md, n, text) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  const lines = String(md).split(/\r?\n/);
  const i = lines.findIndex(l => { const m = l.match(TASK_RE); return m && Number(m[2]) === Number(n); });
  if (i < 0 || !clean) return md;
  let end = i + 1;
  while (end < lines.length && DETAIL_RE.test(lines[end])) end++;
  return [...lines.slice(0, end), `  > ${clean}`, ...lines.slice(end)].join('\n');
}

// Reword one task, keeping its mark, number, date, owner and result.
export function setTaskText(md, n, text) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (!clean) return md;
  const lines = String(md).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(TASK_RE);
    if (!m || Number(m[2]) !== Number(n)) continue;
    const meta = m[4] ? ` (${m[4]}, ${m[5]})` : '';
    const result = m[6] ? ` -> ${m[6]}` : '';
    lines[i] = `- [${m[1]}] #${m[2]} ${clean}${meta}${result}`;
    return lines.join('\n');
  }
  return md;
}

// Project notes that start with "#<n> " belong to task <n>; the rest are general.
export function splitTaskNotes(notes) {
  const byTask = {};
  const general = [];
  for (const note of notes) {
    const m = note.text.match(/^#(\d+)\s+(.+)$/);
    if (m) (byTask[m[1]] = byTask[m[1]] || []).push({ when: note.when, text: m[2] });
    else general.push(note);
  }
  return { byTask, general };
}

// How a brief turned out, for judging whether briefs help.
export function briefOutcome(briefText, task) {
  const yes = (String(briefText).match(/decides what gets built:\s*yes/gi) || []).length;
  const guesses = (String(briefText).match(/decides what gets built:/gi) || []).length;
  return { mark: task ? task.mark : '', result: task ? task.result : '', guesses, yes };
}

// What a "needs you" card asks, read from its latest NEEDS YOU line: the question, its
// options (from "options: a, b" or lettered "a) ... b) ..."), and the suggestion.
export function askOf(task) {
  // Reports write NEEDS YOU in capitals; the full report sits on a detail line, so those
  // come before the short result on the task line.
  const lines = [task.result || '', ...(task.details || []).map(d => d.replace(/^Result:\s*/i, ''))];
  const src = [...lines].reverse().find(l => /NEEDS YOU/.test(l));
  if (!src) return null;
  return parseAsk(src.slice(src.search(/NEEDS YOU/)).replace(/^NEEDS YOU\s*(#\d+\s*)?[:|]?\s*/, ''));
}

// Lettered options, "a) ..." or "(a) ...", from a: [{ key, text }], or null when there are none.
function lettered(s) {
  const marks = [...s.matchAll(/(?:^|\s)\(?([a-e])\)\s/g)];
  if (marks.length < 2 || marks[0][1] !== 'a') return null;
  return { at: marks[0].index, options: marks.map((m, i) => ({ key: m[1], text: s.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : undefined).replace(/[\s,;|]+$/, '').trim() })) };
}
// Splits at commas and bars outside brackets and quotes (#1038): "a (x, y), b" is two options.
function topSplit(s) {
  const out = [];
  let depth = 0, quote = '', cur = '';
  for (const ch of s) {
    if (quote) { if (ch === quote) quote = ''; }
    else if (ch === '"') quote = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
    else if ((ch === ',' || ch === '|') && !depth) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}
// A question's text after its NEEDS YOU lead-in, or any question the CTO wrote: the question,
// its options and the suggestion. Options are split on their letters when they have them.
export function parseAsk(text) {
  let q = String(text || '');
  let suggest = '';
  const sg = q.match(/[\s;,.|]*\bsuggest(?:ion|s)?\b[:\s]*(.+)$/i);
  if (sg) { suggest = sg[1].trim(); q = q.slice(0, sg.index); }
  let options = [];
  const op = q.match(/[\s|]*\boptions:\s*(.+)$/i);
  if (op) {
    const l = lettered(op[1]);
    options = l ? l.options : topSplit(op[1]).map(t => ({ key: '', text: t }));
    q = q.slice(0, op.index);
  } else {
    const l = lettered(q);
    if (l) { options = l.options; q = q.slice(0, l.at); }
  }
  return { question: q.replace(/[\s|;,]+$/, '').trim(), options, suggest };
}

// A short "what is this card about" from its own lines: the user's first words, without
// screenshot notes, and the latest result.
export function tldrOf(task) {
  const plain = s => String(s || '').replace(/\[screenshot:[^\]]*\]\s*/gi, '').replace(/^Your words:\s*/i, '').trim();
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);
  const words = (task.details || []).map(plain).find(d => d && !/^(Result|Owner chose|Priority|Due|Version):/i.test(d)) || '';
  const results = (task.details || []).filter(d => /^Result:/i.test(d)).map(d => plain(d.replace(/^Result:\s*/i, '')));
  const last = results.length ? results[results.length - 1] : plain(task.result);
  return { about: cut(words, 220), last: cut(last, 220) };
}

// Markdown files an opened item points at: .md paths named in its own lines, and in the
// lines of the tasks it follows ("after #3"). Paths come back as written (absolute, or
// relative to the project folder); the app resolves them and keeps the ones on disk.
const MD_PATH_RE = /(?:[A-Za-z]:[\\/])?[\w.~-]+(?:[\\/][\w.~-]+)*\.md\b/g;
export function relatedFiles(task, tasks = []) {
  const textOf = t => [t.text, t.result, ...(t.details || [])].join('\n');
  const after = new Set();
  for (const m of [task.result, ...(task.details || [])].join('\n').matchAll(/\bafter #(\d+)/gi)) {
    if (Number(m[1]) !== task.n) after.add(Number(m[1]));
  }
  const deps = tasks.filter(t => after.has(t.n));
  const paths = [];
  for (const t of [task, ...deps]) {
    for (const m of textOf(t).matchAll(MD_PATH_RE)) if (!paths.includes(m[0])) paths.push(m[0]);
  }
  return { paths, after: [...after] };
}
