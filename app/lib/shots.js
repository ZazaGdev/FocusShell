// Screenshot lines that point into a folder about to go (#1030): a recording's screenshots are
// copied out before the recording is deleted, and the items' "> Screenshot: <path>" lines
// follow them to the new folder.
import { MAC } from './platform.js';
const SHOT_RE = /^(\s*> Screenshot: )(.+?)\s*$/;

// md with every Screenshot line under from (a folder) moved to the same name under to, and the
// old paths it moved. Windows paths: the match ignores case and slash direction. A Mac's paths
// keep their forward slashes (#2562).
export function relinkShots(md, from, to, mac = MAC) {
  const sep = mac ? '/' : '\\';
  const norm = p => String(p).replace(/[\\/]/g, sep).replace(/[\\/]+$/, '');
  const f = norm(from) + sep, t = norm(to) + sep, moved = [];
  const out = String(md).split('\n').map(l => {
    const m = l.replace(/\r$/, '').match(SHOT_RE);
    if (!m) return l;
    const p = norm(m[2]);
    if (!p.toLowerCase().startsWith(f.toLowerCase())) return l;
    moved.push(m[2]);
    return m[1] + t + p.slice(f.length) + (l.endsWith('\r') ? '\r' : '');
  }).join('\n');
  return { md: out, moved };
}
