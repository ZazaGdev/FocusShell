// The chalkboard's token leaderboard (#272): how many tokens each Claude agent session has used,
// read from Claude Code's own logs (~/.claude/projects/<folder>/<conversation>.jsonl). Read-only.
// A reply is logged once per content block, every line repeating the same usage, so replies are
// counted once each by message id and request id. Fresh tokens are input + output + cache
// writes; cache reads (the context re-read every turn) are kept apart, as they dwarf the rest.
import fs from 'node:fs';
import path from 'node:path';
import { encodeProjectDir } from '../history.js';

// The usage in one log's text: { fresh, input, output, cacheWrite, cacheRead, replies }.
export function usageTotals(text) {
  const t = { fresh: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, replies: 0 }, seen = new Set();
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const m = d.message, u = m && m.usage;
    if (d.type !== 'assistant' || !u) continue;
    const key = `${m.id || ''}|${d.requestId || ''}`;
    if (m.id && seen.has(key)) continue;
    seen.add(key);
    t.input += u.input_tokens || 0; t.output += u.output_tokens || 0;
    t.cacheWrite += u.cache_creation_input_tokens || 0; t.cacheRead += u.cache_read_input_tokens || 0;
    t.replies++;
  }
  t.fresh = t.input + t.output + t.cacheWrite;
  return t;
}

// A log's totals, read again only when the file has changed (the leaderboard's; the live board reads
// its logs incrementally below).
const cache = new Map();
function totalsOf(file) {
  const mtime = fs.statSync(file).mtimeMs, hit = cache.get(file);
  if (hit && hit.mtime === mtime) return hit.t;
  const t = usageTotals(fs.readFileSync(file, 'utf8'));
  cache.set(file, { mtime, t });
  return t;
}

// The live board's logs (#2928), read once and then only their new whole lines, as the period board
// below does, in slices of at most 4 MB with the event loop free between them: at 18 hours the
// live conversations and their helpers held about 1 GB, read whole and parsed on every refresh,
// seconds of frozen app each time. Per log: the bytes read so far, its replies' keys (a reply is
// logged once per content block), its running totals and, for a helper log, its replies as rows,
// so a reply in two helper logs of one conversation still counts once (a forked helper's log starts
// with copies of its parent's replies). A log that shrinks is read again from the start.
const SLICE = 4 * 1048576;
const zero = () => ({ fresh: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, replies: 0 });
const reads = new Map(); // file -> { size, gen, seen, t, rows: [[key or null, input, output, cacheWrite, cacheRead]] or null }
let gens = 0;

function addReply(c, d) {
  const m = d.message, u = m && m.usage;
  if (d.type !== 'assistant' || !u) return;
  const key = m.id ? `${m.id}|${d.requestId || ''}` : null;
  if (key) {
    if (c.seen.has(key)) return;
    c.seen.add(key);
  }
  const row = [key, u.input_tokens || 0, u.output_tokens || 0, u.cache_creation_input_tokens || 0, u.cache_read_input_tokens || 0];
  c.t.input += row[1]; c.t.output += row[2]; c.t.cacheWrite += row[3]; c.t.cacheRead += row[4]; c.t.replies++;
  if (c.rows) c.rows.push(row);
}
function addText(c, text) {
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    addReply(c, d);
  }
}

async function readLog(file, keepRows) {
  const { size } = await fs.promises.stat(file);
  let c = reads.get(file);
  if (!c || size < c.size || !c.rows !== !keepRows) c = { size: 0, gen: ++gens, seen: new Set(), t: zero(), rows: keepRows ? [] : null };
  reads.set(file, c);
  if (size <= c.size) return c;
  const fh = await fs.promises.open(file, 'r');
  try {
    let pos = c.size, carry = []; // carry: the start of a line not yet whole, never holding a newline
    while (pos < size) {
      // Each read is awaited, so the app's other work runs between slices.
      const buf = Buffer.allocUnsafe(Math.min(SLICE, size - pos));
      const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
      if (!bytesRead) break;
      pos += bytesRead;
      const got = buf.subarray(0, bytesRead), end = got.lastIndexOf(10);
      if (end < 0) { carry.push(got); continue; }
      addText(c, Buffer.concat([...carry, got.subarray(0, end)]).toString('utf8'));
      c.size = pos - (bytesRead - end - 1);
      carry = end + 1 < bytesRead ? [got.subarray(end + 1)] : [];
    }
    // A last line with no newline yet counts once it is whole JSON; one still being written never is.
    if (carry.length) {
      const last = Buffer.concat(carry).toString('utf8');
      let d;
      try { d = JSON.parse(last); } catch { d = undefined; }
      if (d !== undefined) {
        if (d && last.includes('"usage"')) addReply(c, d);
        c.size = pos;
      }
    }
  } finally { await fh.close(); }
  c.t.fresh = c.t.input + c.t.output + c.t.cacheWrite;
  return c;
}

// A conversation's helpers: its logs' rows summed with one seen set, adding only the rows read since
// the last refresh; summed again from the start when one of its logs was read again or is gone.
const folds = new Map(); // subagents folder -> { seen, t, done: Map(file -> { gen, n }) }
function foldHelpers(sub, logs) {
  let f = folds.get(sub);
  if (!f || [...f.done].some(([file, d]) => !logs.has(file) || logs.get(file).gen !== d.gen)) f = { seen: new Set(), t: zero(), done: new Map() };
  for (const [file, c] of logs) {
    const d = f.done.get(file) || { gen: c.gen, n: 0 };
    for (let i = d.n; i < c.rows.length; i++) {
      const [key, input, output, cacheWrite, cacheRead] = c.rows[i];
      if (key) {
        if (f.seen.has(key)) continue;
        f.seen.add(key);
      }
      f.t.input += input; f.t.output += output; f.t.cacheWrite += cacheWrite; f.t.cacheRead += cacheRead; f.t.replies++;
    }
    d.n = c.rows.length;
    f.done.set(file, d);
  }
  f.t.fresh = f.t.input + f.t.output + f.t.cacheWrite;
  folds.set(sub, f);
  return f.t;
}

// Who a log folder belongs to: FocusShell's manager folder is the CTO's, its pm folder the PM's,
// a second lead's worktree is lead-<Project>-2, any other folder a lead named after its project:
// the project whose folder it is (`known.projects`, by either drive letter it is reached by),
// else the part after one of the project roots (`known.roots`), else after the drive. The Demo's
// deck and toy projects (#314) read the same way.
export function agentName(folder, known = {}) {
  if (/FocusShell(Demo-deck)?-manager$/.test(folder)) return 'CTO';
  if (/FocusShell(Demo-deck)?-pm$/.test(folder)) return 'PM';
  const wt = folder.match(/-state-worktrees-(.+)$/);
  if (wt) return `lead-${wt[1]}`;
  const demo = folder.match(/FocusShellDemo-projects-(.+)$/);
  if (demo) return `lead-${demo[1]}`;
  const lower = folder.toLowerCase(), enc = p => encodeProjectDir(String(p).replace(/[\\/]+$/, '')).toLowerCase();
  const own = (known.projects || []).find(p => p && p.path && enc(p.path) === lower);
  if (own) return `lead-${own.name}`;
  const root = (known.roots || []).map(r => `${enc(r)}-`).find(r => lower.startsWith(r) && lower.length > r.length);
  return `lead-${root ? folder.slice(root.length) : folder.replace(/^[A-Z]--/, '')}`;
}

// The board: every conversation written to in the last six hours (the sessions running now),
// counted from its start, and its helpers (subagent logs) as a row of their own. Temporary
// folders (scratchpads, test runs) are left out. Sorted by fresh tokens, most first.
export function leaderboard(projectsDir, now = Date.now(), windowMs = 6 * 3600e3, known = {}) {
  const rows = [];
  let folders = [];
  try { folders = fs.readdirSync(projectsDir, { withFileTypes: true }).filter(d => d.isDirectory() && !/-Temp-|^C--Users-[^-]+$/.test(d.name)).map(d => d.name); } catch { return rows; }
  for (const folder of folders) {
    const dir = path.join(projectsDir, folder), who = agentName(folder, known);
    let logs = [];
    try { logs = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')); } catch { continue; }
    const live = logs.map(f => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs })).filter(x => now - x.mtime <= windowMs).sort((a, b) => b.mtime - a.mtime);
    live.forEach(({ f }, i) => {
      const name = who + (i ? ` (${i + 1})` : ''), conv = f.slice(0, -6);
      rows.push({ who: name, kind: who === 'CTO' || who === 'PM' ? who : 'lead', log: path.join(folder, f), ...totalsOf(path.join(dir, f)) });
      const sub = path.join(dir, conv, 'subagents');
      let subs = [];
      try { subs = fs.readdirSync(sub).filter(x => x.endsWith('.jsonl')); } catch { return; }
      if (!subs.length) return;
      const h = usageTotals(subs.map(x => fs.readFileSync(path.join(sub, x), 'utf8')).join('\n'));
      if (h.replies) rows.push({ who: `${name}'s helpers (${subs.length})`, kind: 'helpers', log: path.join(folder, conv, 'subagents'), ...h });
    });
  }
  return rows.sort((a, b) => b.fresh - a.fresh);
}

// The board for FocusShell's live panes (#246): sessions [{ id, name, cwd, startedAt }]. Each pane's
// conversation is found exactly: in its folder, the logs written since it started, newest first,
// one per pane in that folder (newest pane first). Its helpers are a row of their own.
// Async and incremental (#2928); calls run one after another, so two never read the same log at once.
let boardQueue = Promise.resolve();
export function sessionBoard(projectsDir, sessions) {
  const run = boardQueue.then(() => board(projectsDir, sessions));
  boardQueue = run.catch(() => {});
  return run;
}
async function board(projectsDir, sessions) {
  const rows = [], byFolder = new Map(), usedLogs = new Set(), usedSubs = new Set();
  for (const s of sessions) {
    if (!s.cwd) continue;
    const f = encodeProjectDir(s.cwd);
    if (!byFolder.has(f)) byFolder.set(f, []);
    byFolder.get(f).push(s);
  }
  for (const [folder, list] of byFolder) {
    const dir = path.join(projectsDir, folder);
    let logs = [];
    try {
      const names = (await fs.promises.readdir(dir)).filter(f => f.endsWith('.jsonl'));
      logs = (await Promise.all(names.map(f => fs.promises.stat(path.join(dir, f)).then(st => ({ f, mtime: st.mtimeMs }), () => null)))).filter(Boolean);
    } catch { continue; }
    const panes = [...list].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    const oldest = Math.min(...panes.map(p => p.startedAt || 0));
    const convs = logs.filter(l => l.mtime >= oldest).sort((a, b) => b.mtime - a.mtime);
    for (const [i, p] of panes.entries()) {
      const c = convs[i];
      if (!c) continue;
      const conv = c.f.slice(0, -6), file = path.join(dir, c.f);
      let own;
      try { own = await readLog(file, false); } catch { continue; } // gone since the folder was listed
      usedLogs.add(file);
      rows.push({ id: p.id, who: p.name, kind: p.kind || 'lead', log: path.join(folder, c.f), ...own.t });
      const sub = path.join(dir, conv, 'subagents');
      let subs = [];
      try { subs = (await fs.promises.readdir(sub)).filter(x => x.endsWith('.jsonl')); } catch { continue; }
      const got = new Map();
      for (const x of subs) {
        const f = path.join(sub, x);
        try { got.set(f, await readLog(f, true)); usedLogs.add(f); } catch { /* gone since the folder was listed */ }
      }
      usedSubs.add(sub);
      const h = foldHelpers(sub, got);
      if (h.replies) rows.push({ id: p.id, who: `${p.name}'s helpers (${subs.length})`, kind: 'helpers', log: path.join(folder, conv, 'subagents'), ...h });
    }
  }
  // Logs and conversations no longer asked for are let go.
  for (const f of reads.keys()) if (!usedLogs.has(f)) reads.delete(f);
  for (const s of folds.keys()) if (!usedSubs.has(s)) folds.delete(s);
  return rows.sort((a, b) => b.fresh - a.fresh);
}

// The chalkboard's Today and This week tabs (#285): every reply logged since `since`, by its own
// timestamp, summed per agent (its log folder) with its helpers as a row of their own. Logs only
// grow, so each is read once and then only its new lines; a log not written to since `since` is
// skipped. Async, so a week of logs never blocks the app.
const TODAY = 'today', WEEK = 'week';
export const PERIODS = [TODAY, WEEK];
// Local midnight today, or local midnight on this week's Monday.
export function periodStart(period, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === WEEK) d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

// The replies in a log's text, each counted once: [{ at, fresh, cacheRead }].
export function repliesOf(text, seen = new Set()) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const m = d.message, u = m && m.usage;
    if (d.type !== 'assistant' || !u) continue;
    const key = `${m.id || ''}|${d.requestId || ''}`;
    if (m.id && seen.has(key)) continue;
    seen.add(key);
    out.push({ at: Date.parse(d.timestamp) || 0, fresh: (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0), cacheRead: u.cache_read_input_tokens || 0 });
  }
  return out;
}

const tails = new Map(); // file -> { size, seen, list }: what has been read of it so far
async function repliesIn(file, size) {
  let c = tails.get(file);
  if (!c || size < c.size) c = { size: 0, seen: new Set(), list: [] };
  if (size > c.size) {
    const fh = await fs.promises.open(file, 'r');
    try {
      const buf = Buffer.alloc(size - c.size);
      await fh.read(buf, 0, buf.length, c.size);
      const end = buf.lastIndexOf(10);   // whole lines only; a line still being written waits
      if (end >= 0) {
        for (const r of repliesOf(buf.subarray(0, end).toString('utf8'), c.seen)) c.list.push(r);
        c.size += end + 1;
      }
    } finally { await fh.close(); }
  }
  tails.set(file, c);
  return c.list;
}

// Adds a log's replies since `since` to t; true when it had any.
async function addSince(t, file, since) {
  let st;
  try { st = await fs.promises.stat(file); } catch { return false; }
  if (st.mtimeMs < since) return false;
  let any = false;
  for (const r of await repliesIn(file, st.size)) if (r.at >= since) { t.fresh += r.fresh; t.cacheRead += r.cacheRead; t.replies++; any = true; }
  return any;
}

// [{ who, kind, fresh, cacheRead, replies }], most fresh tokens first.
// known: { projects: [{ name, path }], roots: [folder] }, the running app's, to name the leads.
export async function periodBoard(projectsDir, since, known = {}) {
  const byWho = new Map();   // one row per agent, though its project be reached by two drive letters
  let folders = [];
  try { folders = (await fs.promises.readdir(projectsDir, { withFileTypes: true })).filter(d => d.isDirectory() && !/-Temp-|^C--Users-[^-]+$/.test(d.name)).map(d => d.name); } catch { return []; }
  for (const folder of folders) {
    const dir = path.join(projectsDir, folder), who = agentName(folder, known);
    let items = [];
    try { items = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    if (!byWho.has(who)) byWho.set(who, { own: { fresh: 0, cacheRead: 0, replies: 0 }, help: { fresh: 0, cacheRead: 0, replies: 0 }, helpers: 0 });
    const a = byWho.get(who), { own, help } = a;
    for (const it of items) {
      if (it.isFile() && it.name.endsWith('.jsonl')) { await addSince(own, path.join(dir, it.name), since); continue; }
      if (!it.isDirectory()) continue;
      const sub = path.join(dir, it.name, 'subagents');
      let subs = [];
      try { subs = (await fs.promises.readdir(sub)).filter(x => x.endsWith('.jsonl')); } catch { continue; }
      for (const x of subs) if (await addSince(help, path.join(sub, x), since)) a.helpers++;
    }
  }
  const rows = [];
  for (const [who, { own, help, helpers }] of byWho) {
    if (own.replies) rows.push({ who, kind: who === 'CTO' || who === 'PM' ? who : 'lead', ...own });
    if (help.replies) rows.push({ who: `${who}'s helpers (${helpers})`, kind: 'helpers', ...help });
  }
  return rows.sort((a, b) => b.fresh - a.fresh);
}
