// The tap barrels' beer (#279): the 5-hour usage allowance, as Claude Code's status line shows
// it. The owner's status line script mirrors its numbers to ~/.claude/usage/<session>.json
// ({ at, five_hour: { used_percentage, resets_at } }, times in seconds); the newest file is the
// account's current window. Past its reset the allowance is full again. Read-only.
import fs from 'node:fs';
import path from 'node:path';

// { used: 0-100, resetsAt: ms or null, at: ms } or null when nothing has been written yet.
export function fiveHour(dir, now = Date.now()) {
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })); } catch { return null; }
  files.sort((a, b) => b.t - a.t);
  for (const { f } of files.slice(0, 5)) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    const five = d && d.five_hour;
    if (!five || typeof five.used_percentage !== 'number') continue;
    const resetsAt = five.resets_at ? five.resets_at * 1000 : null, at = (d.at || 0) * 1000;
    if (resetsAt && resetsAt <= now) return { used: 0, resetsAt: null, at };
    return { used: Math.max(0, Math.min(100, five.used_percentage)), resetsAt, at };
  }
  return null;
}
