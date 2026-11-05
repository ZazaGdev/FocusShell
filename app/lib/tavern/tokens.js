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

// A log's totals, read again only when the file has changed (the board refreshes while open).
const cache = new Map();
function totalsOf(file) {
  const mtime = fs.statSync(file).mtimeMs, hit = cache.get(file);
  if (hit && hit.mtime === mtime) return hit.t;
  const t = usageTotals(fs.readFileSync(file, 'utf8'));
  cache.set(file, { mtime, t });
  return t;
}

// Who a log folder belongs to: FocusShell's manager folder is the CTO's, its pm folder the PM's,
// a second lead's worktree is lead-<Project>-2, any other folder a lead named after its project.
// The Demo's deck and toy projects (#314) read the same way.
export function agentName(folder) {
  if (/FocusShell(Demo-deck)?-manager$/.test(folder)) return 'CTO';
  if (/FocusShell(Demo-deck)?-pm$/.test(folder)) return 'PM';
  const wt = folder.match(/-state-worktrees-(.+)$/);
  if (wt) return `lead-${wt[1]}`;
  const side = folder.match(/(?:SideProjects|FocusShellDemo-projects)-(.+)$/);
  return `lead-${side ? side[1] : folder.replace(/^[A-Z]--/, '')}`;
}

// The board: every conversation written to in the last six hours (the sessions running now),
// counted from its start, and its helpers (subagent logs) as a row of their own. Temporary
// folders (scratchpads, test runs) are left out. Sorted by fresh tokens, most first.
export function leaderboard(projectsDir, now = Date.now(), windowMs = 6 * 3600e3) {
  const rows = [];
  let folders = [];
  try { folders = fs.readdirSync(projectsDir, { withFileTypes: true }).filter(d => d.isDirectory() && !/-Temp-|^C--Users-[^-]+$/.test(d.name)).map(d => d.name); } catch { return rows; }
  for (const folder of folders) {
    const dir = path.join(projectsDir, folder), who = agentName(folder);
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
export function sessionBoard(projectsDir, sessions) {
  const rows = [], byFolder = new Map();
  for (const s of sessions) {
    if (!s.cwd) continue;
    const f = encodeProjectDir(s.cwd);
    if (!byFolder.has(f)) byFolder.set(f, []);
    byFolder.get(f).push(s);
  }
  for (const [folder, list] of byFolder) {
    const dir = path.join(projectsDir, folder);
    let logs = [];
    try { logs = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs })); } catch { continue; }
    const panes = [...list].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    const oldest = Math.min(...panes.map(p => p.startedAt || 0));
    const convs = logs.filter(l => l.mtime >= oldest).sort((a, b) => b.mtime - a.mtime);
    panes.forEach((p, i) => {
      const c = convs[i];
      if (!c) return;
      const conv = c.f.slice(0, -6);
      rows.push({ id: p.id, who: p.name, kind: p.kind || 'lead', log: path.join(folder, c.f), ...totalsOf(path.join(dir, c.f)) });
      const sub = path.join(dir, conv, 'subagents');
      let subs = [];
      try { subs = fs.readdirSync(sub).filter(x => x.endsWith('.jsonl')); } catch { return; }
      const h = usageTotals(subs.map(x => fs.readFileSync(path.join(sub, x), 'utf8')).join('\n'));
      if (h.replies) rows.push({ id: p.id, who: `${p.name}'s helpers (${subs.length})`, kind: 'helpers', log: path.join(folder, conv, 'subagents'), ...h });
    });
  }
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
export async function periodBoard(projectsDir, since) {
  const byWho = new Map();   // one row per agent, though its project be reached by two drive letters
  let folders = [];
  try { folders = (await fs.promises.readdir(projectsDir, { withFileTypes: true })).filter(d => d.isDirectory() && !/-Temp-|^C--Users-[^-]+$/.test(d.name)).map(d => d.name); } catch { return []; }
  for (const folder of folders) {
    const dir = path.join(projectsDir, folder), who = agentName(folder);
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
