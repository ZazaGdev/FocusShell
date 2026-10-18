// Screenshot lines that point into a folder about to go (#1030): a recording's screenshots are
// copied out before the recording is deleted, and the items' "> Screenshot: <path>" lines
// follow them to the new folder.
const SHOT_RE = /^(\s*> Screenshot: )(.+?)\s*$/;
const norm = p => String(p).replace(/\//g, '\\').replace(/\\+$/, '');

// md with every Screenshot line under from (a folder) moved to the same name under to, and the
// old paths it moved. Windows paths: the match ignores case and slash direction.
export function relinkShots(md, from, to) {
  const f = norm(from) + '\\', t = norm(to) + '\\', moved = [];
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
