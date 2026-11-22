// Whether a line FocusShell typed into a pane reached its Claude: the IPC behind
// `deck.ctoArrived`, read from the pane's own Claude Code log. Kept out of main.js.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { logDirs, paneConversation } from './lib/history.js';
import { sessionName } from './lib/sessions.js';
import { arrived } from './lib/ctoline.js';

// d: { ipcMain, SMOKE, DEMO, demoClaude, sessions }
export function registerArrived(d) {
  const { ipcMain, SMOKE, DEMO, demoClaude, sessions } = d;
  const projectsDir = DEMO ? path.join(demoClaude, 'projects') : path.join(os.homedir(), '.claude', 'projects');

  // The pane's own conversation: the log in its folder written since it started, named after it,
  // or a newer unnamed one when Claude was started again by hand in the pane (#1887). The known
  // log is kept only while it is the newest, so a restart by hand is noticed.
  // A pane's folder may be reached through a junction (#3098): Claude Code names its log folder
  // after the real path, so the real one is tried first, then the cwd as given. The known log is
  // the full path, compared only within its own folder.
  const logOf = new Map();
  function logFile(id, s) {
    const known = logOf.get(id);
    for (const dir of logDirs(projectsDir, s.cwd, p => fs.realpathSync.native(p))) {
      let files = [];
      try { files = fs.readdirSync(dir).filter(n => n.endsWith('.jsonl')).map(n => ({ n, mtime: fs.statSync(path.join(dir, n)).mtimeMs })).filter(f => f.mtime >= s.startedAt - 1000); } catch { continue; }
      const newest = files.reduce((a, f) => (!a || f.mtime > a.mtime ? f : a), null);
      if (known && newest && path.join(dir, newest.n) === known) return known;
      const conv = paneConversation(files.map(f => ({ id: f.n.slice(0, -6), mtime: f.mtime, text: head(path.join(dir, f.n), 256 * 1024) })), sessionName(id, DEMO ? 'demo-' : ''));
      if (!conv) continue;
      const full = path.join(dir, `${conv}.jsonl`);
      logOf.set(id, full);
      return full;
    }
    return null;
  }
  // Only the end of a long log is read: replies older than a day are not looked at anyway.
  function tail(file, bytes = 4 * 1024 * 1024) {
    const size = fs.statSync(file).size, fd = fs.openSync(file, 'r');
    try {
      const b = Buffer.alloc(Math.min(size, bytes));
      fs.readSync(fd, b, 0, b.length, size - b.length);
      const s = b.toString('utf8');
      return size > bytes ? s.slice(s.indexOf('\n') + 1) : s;
    } finally { fs.closeSync(fd); }
  }

  // Whether a line FocusShell typed into a CTO pane reached its Claude (#1029). A smoke or try
  // run has no Claude, so its lines count as arrived, except a text holding smoke-never-arrives
  // (#2991: the words card's not-delivered path). Any pane's log is read the same way; null
  // means no log was found for the pane, which never counts as arrived.
  ipcMain.handle('session:arrived', (_e, id, text, since) => {
    if (SMOKE) return !String(text).includes('smoke-never-arrives');
    const s = sessions.get(id);
    const file = s && logFile(id, s);
    if (!file) return null;
    try { return arrived(tail(file, 1024 * 1024), text, since); } catch { return false; }
  });
}

function head(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try { const b = Buffer.alloc(bytes); return b.toString('utf8', 0, fs.readSync(fd, b, 0, bytes, 0)); } finally { fs.closeSync(fd); }
}
