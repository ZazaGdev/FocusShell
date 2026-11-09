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

// d: { ipcMain, SMOKE, DEMO, demoClaude, sessions, live(s) -> whether Claude runs in that pane }
export function registerBackground(d) {
  const { ipcMain, SMOKE, DEMO, demoClaude, sessions, live } = d;
  const projectsDir = DEMO ? path.join(demoClaude, 'projects') : path.join(os.homedir(), '.claude', 'projects');
  const found = new Map(); // pane id -> { conv, at, startedAt }
  const finished = new Map(); // subagents folder -> meta file names already marked finished
  // The pane's own conversation: the log in its folder written since it started, named after it,
  // or a newer unnamed one when Claude was started again by hand there (as Maybe missed does).
  function conversationOf(id, s, dir, now) {
    const f = found.get(id);
    if (f && f.startedAt === s.startedAt && now - f.at < FIND_AGAIN_MS) return f.conv;
    let files = [];
    try { files = fs.readdirSync(dir).filter(n => n.endsWith('.jsonl')).map(n => ({ n, mtime: fs.statSync(path.join(dir, n)).mtimeMs })).filter(x => x.mtime >= s.startedAt - 1000); } catch { files = []; }
    const conv = files.length ? paneConversation(files.map(x => ({ id: x.n.slice(0, -6), mtime: x.mtime, text: head(path.join(dir, x.n), 64 * 1024) })), sessionName(id, DEMO ? 'demo-' : '')) : null;
    found.set(id, { conv, at: now, startedAt: s.startedAt });
    return conv;
  }
  // { pane id: how many background subagents it still runs }, only panes with one or more.
  ipcMain.handle('session:subagents', () => {
    const out = {}, now = Date.now();
    if (SMOKE) return out;
    for (const [id, s] of sessions) {
      if (isMgr(id) || id === PM || !s.cwd || !live(s)) { found.delete(id); continue; }
      const dir = path.join(projectsDir, encodeProjectDir(s.cwd)), conv = conversationOf(id, s, dir, now);
      if (!conv) continue;
      const sub = path.join(dir, conv, 'subagents');
      // A finished subagent stays finished, so its meta file is read once, not every few seconds.
      const ended = finished.get(sub) || new Set();
      finished.set(sub, ended);
      let metas = [];
      try {
        metas = fs.readdirSync(sub).filter(n => n.endsWith('.meta.json') && !ended.has(n)).map(n => {
          try { const m = JSON.parse(fs.readFileSync(path.join(sub, n), 'utf8')); if (m && m.finished === true) ended.add(n); return m; } catch { return null; }
        });
      } catch { metas = []; }
      const n = runningSubagents(metas);
      if (n) out[id] = n;
    }
    for (const id of found.keys()) if (!sessions.has(id)) found.delete(id);
    return out;
  });
}

function head(file, bytes) {
  try {
    const fd = fs.openSync(file, 'r');
    try { const b = Buffer.alloc(bytes); return b.toString('utf8', 0, fs.readSync(fd, b, 0, bytes, 0)); } finally { fs.closeSync(fd); }
  } catch { return ''; }
}
