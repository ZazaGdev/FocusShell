// What FocusShell needs on the PC to run its sessions (#390): Claude Code, started as `claude`
// so cmd finds claude.exe (native install) or claude.cmd (npm), and Node.js, which runs every
// `deck` board command and the CTO and PM guard hook. Checked once at start; whatever is
// missing shows as a card with the install link.
import fs from 'node:fs';
import path from 'node:path';

export const NEEDS = [
  { tool: 'claude', name: 'Claude Code', why: 'Every pane runs a Claude Code session.', url: 'https://docs.anthropic.com/en/docs/claude-code/setup' },
  { tool: 'node', name: 'Node.js', why: 'The CTO, the PM and the leads change the boards with node.', url: 'https://nodejs.org/en/download' },
];

// True when cmd would find name on this PATH: one of the PATHEXT extensions in any PATH folder.
export function onPath(name, env = process.env) {
  const exts = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const dirs = (env.PATH || env.Path || '').split(path.delimiter).map(d => d.replace(/^"|"$/g, '')).filter(Boolean);
  return dirs.some(d => exts.some(x => { try { return fs.statSync(path.join(d, name + x.toLowerCase())).isFile(); } catch { return false; } }));
}

// The CTO and the leads message each other with Claude Code's cross-session messaging, which
// on Windows needs this version or later; older ones list no other session and send nothing,
// silently (#1113).
export const MESSAGING_MIN = '2.1.234';
// True when version ("2.1.302", or "2.1.302 (Claude Code)") is older than min; false when unreadable.
export function olderThan(version, min = MESSAGING_MIN) {
  const v = String(version || '').match(/(\d+)\.(\d+)\.(\d+)/), m = min.split('.').map(Number);
  if (!v) return false;
  const n = v.slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (n[i] !== m[i]) return n[i] < m[i];
  return false;
}

// The NEEDS entries not found; has(tool) decides, onPath by default.
export function missingTools(has = t => onPath(t)) {
  return NEEDS.filter(n => !has(n.tool));
}
