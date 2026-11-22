// Background subagents each lead pane still runs (#2706), so its tab dot stays purple until they
// end. Read from Claude Code's own files: the pane's conversation folder holds a meta file per
// subagent (lib/history.js runningSubagents). Background shells show in the pane's footer and
// are read from its screen instead (lib/prompts.js backgroundWork). Read-only. Kept out of main.js.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { encodeProjectDir, paneConversation, runningSubagents } from './lib/history.js';
import { sessionName } from './lib/sessions.js';
import { isMgr, PM } from './lib/groups.js';

const FIND_AGAIN_MS = 30000; // how long a pane's conversation is trusted before it is looked up again

// The meta files of one subagents folder worth counting. ended (meta file name -> its time when
// it was read as finished) spares reading a finished one every few seconds, but only while the
// file is unchanged: a subagent resumed with SendMessage, such as a lead's builder (#2780),
// writes "finished": false into the same file again while it runs.
export function subagentMetas(sub, ended) {
  let names = [];
  try { names = fs.readdirSync(sub).filter(n => n.endsWith('.meta.json')); } catch { return []; }
  for (const n of ended.keys()) if (!names.includes(n)) ended.delete(n);
  return names.map(n => {
    const file = path.join(sub, n);
    let t; try { t = fs.statSync(file).mtimeMs; } catch { return null; }
    if (ended.get(n) === t) return null;
    try {
      const m = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (m && m.finished === true) ended.set(n, t); else ended.delete(n);
      return m;
    } catch { return null; }
  });
}

// The pane's own conversation, shared with app/context.js (#3016): the log in its folder
// (projectsDir/<encoded cwd>) written since it started, named after it, or a newer unnamed one
// when Claude was started again by hand there (as the line arrived check in arrived.js does). Returns
// find(id, s, now) -> conversation id or null; find.forget(id) and find.keepOnly(ids) drop panes.
export function conversationFinder(projectsDir, demo) {
  const found = new Map(); // pane id -> { conv, at, startedAt }
  const find = (id, s, now = Date.now()) => {
    const f = found.get(id);
    if (f && f.startedAt === s.startedAt && now - f.at < FIND_AGAIN_MS) return f.conv;
    const dir = path.join(projectsDir, encodeProjectDir(s.cwd));
    let files = [];
    try { files = fs.readdirSync(dir).filter(n => n.endsWith('.jsonl')).map(n => ({ n, mtime: fs.statSync(path.join(dir, n)).mtimeMs })).filter(x => x.mtime >= s.startedAt - 1000); } catch { files = []; }
    const conv = files.length ? paneConversation(files.map(x => ({ id: x.n.slice(0, -6), mtime: x.mtime, text: head(path.join(dir, x.n), 64 * 1024) })), sessionName(id, demo ? 'demo-' : '')) : null;
    found.set(id, { conv, at: now, startedAt: s.startedAt });
    return conv;
  };
  find.forget = id => found.delete(id);
  find.keepOnly = ids => { for (const id of found.keys()) if (!ids.has(id)) found.delete(id); };
  return find;
}

// d: { ipcMain, SMOKE, DEMO, demoClaude, sessions, live(s) -> whether Claude runs in that pane }
export function registerBackground(d) {
  const { ipcMain, SMOKE, DEMO, demoClaude, sessions, live } = d;
  const projectsDir = DEMO ? path.join(demoClaude, 'projects') : path.join(os.homedir(), '.claude', 'projects');
  const conversationOf = conversationFinder(projectsDir, DEMO);
  const finished = new Map(); // subagents folder -> Map(meta file name -> its time when read as finished)
  // { pane id: how many background subagents it still runs }, only panes with one or more.
  ipcMain.handle('session:subagents', () => {
    const out = {}, now = Date.now();
    if (SMOKE) return out;
    for (const [id, s] of sessions) {
      if (isMgr(id) || id === PM || !s.cwd || !live(s)) { conversationOf.forget(id); continue; }
      const dir = path.join(projectsDir, encodeProjectDir(s.cwd)), conv = conversationOf(id, s, now);
      if (!conv) continue;
      const sub = path.join(dir, conv, 'subagents');
      const ended = finished.get(sub) || new Map();
      finished.set(sub, ended);
      const n = runningSubagents(subagentMetas(sub, ended));
      if (n) out[id] = n;
    }
    conversationOf.keepOnly(sessions);
    return out;
  });
}

function head(file, bytes) {
  try {
    const fd = fs.openSync(file, 'r');
    try { const b = Buffer.alloc(bytes); return b.toString('utf8', 0, fs.readSync(fd, b, 0, bytes, 0)); } finally { fs.closeSync(fd); }
  } catch { return ''; }
}
