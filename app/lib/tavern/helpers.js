// The tavern's helpers (#240): subagents a session is running right now. Claude Code writes
// each subagent's transcript to ~/.claude/projects/<folder>/<conversation>/subagents/*.jsonl;
// one written to in the last minute is a helper at work. Read-only: file names and times.
import fs from 'node:fs';
import path from 'node:path';
import { encodeProjectDir } from '../history.js';

// sessions: [{ id, cwd, project, startedAt }] (FocusShell's live panes). Returns
// [{ id, parent, project }]; a folder two panes share counts for the first of them.
export function activeHelpers(sessions, projectsDir, now = Date.now(), windowMs = 60000) {
  const out = [], seen = new Set();
  for (const s of sessions) {
    if (!s.cwd) continue;
    const dir = path.join(projectsDir, encodeProjectDir(s.cwd));
    if (seen.has(dir)) continue;
    seen.add(dir);
    let convs = [];
    try { convs = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { continue; }
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
