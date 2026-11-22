// The tavern's helpers (#240): subagents a session is running right now. Claude Code writes
// each subagent's transcript to ~/.claude/projects/<folder>/<conversation>/subagents/*.jsonl;
// one written to in the last minute is a helper at work. Read-only: file names and times.
import fs from 'node:fs';
import path from 'node:path';
import { encodeProjectDir } from '../history.js';

// sessions: [{ id, cwd, project, startedAt }] (FocusShell's live panes). Returns
// [{ id, parent, project }]; a folder two panes share counts for the first of them.
// Only conversations written to since the pane started are looked into (#2928): a project's
// folder keeps every conversation it ever had, hundreds of subagent folders to list and stat.
export function activeHelpers(sessions, projectsDir, now = Date.now(), windowMs = 60000) {
  const out = [], seen = new Set();
  for (const s of sessions) {
    if (!s.cwd) continue;
    const dir = path.join(projectsDir, encodeProjectDir(s.cwd));
    if (seen.has(dir)) continue;
    seen.add(dir);
    let items = [];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    // Since the oldest pane in this folder started: a pane reopened later must not hide the
    // helpers of an older pane that shares the folder.
    const since = Math.min(...sessions.filter(x => x.cwd && path.join(projectsDir, encodeProjectDir(x.cwd)) === dir).map(x => x.startedAt || 0)) - 1000;
    const folders = new Set(items.filter(d => d.isDirectory()).map(d => d.name));
    const convs = items.filter(d => d.isFile() && d.name.endsWith('.jsonl') && folders.has(d.name.slice(0, -6))).map(d => d.name.slice(0, -6)).filter(conv => {
      try { return fs.statSync(path.join(dir, `${conv}.jsonl`)).mtimeMs >= since; } catch { return false; }
    });
    for (const conv of convs) {
      const sub = path.join(dir, conv, 'subagents');
      let files = [];
      try { files = fs.readdirSync(sub).filter(f => f.endsWith('.jsonl')); } catch { continue; }
      for (const f of files) {
        let mtime = 0;
        try { mtime = fs.statSync(path.join(sub, f)).mtimeMs; } catch { continue; }
        if (now - mtime <= windowMs && mtime >= (s.startedAt || 0)) out.push({ id: `${conv}/${f.slice(0, -6)}`, parent: s.id, project: s.project });
      }
    }
  }
  return out;
}
