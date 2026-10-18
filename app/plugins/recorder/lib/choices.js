// What Settings offers for the recorder's Whisper folder, Whisper model and ffmpeg (#407): a
// dropdown of what was found on this PC, so a typo cannot break processing. Each choice is
// { value, label, ok }; ok false marks one that would not work (kept so the current value shows).
import fs from 'node:fs';
import path from 'node:path';
import { expandEnv } from './transcript.js';
import { onPath } from '../../../lib/requirements.js';

const exists = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const uniq = list => list.filter((c, i) => c.value && list.findIndex(o => o.value.toLowerCase() === c.value.toLowerCase()) === i);

// Files under dir (and up to depth folders below) whose name passes keep, relative to dir.
function filesUnder(dir, keep, depth = 2, rel = '') {
  let out = [], ents = [];
  try { ents = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const r = rel ? path.join(rel, e.name) : e.name;
    if (e.isFile() && keep(e.name)) out.push(r);
    else if (e.isDirectory() && depth > 0) out = out.concat(filesUnder(dir, keep, depth - 1, r));
  }
  return out;
}

// key: the setting; s: the recorder's settings now; d: { env, defaults, findCli(dir) }.
export function choicesFor(key, s, d) {
  const env = d.env || process.env, x = v => expandEnv(String(v || ''), env);
  if (key === 'whisperDir') {
    const dirs = [s.whisperDir, d.defaults.whisperDir];
    for (const p of (env.PATH || env.Path || '').split(path.delimiter)) if (p && exists(path.join(p, 'whisper-cli.exe'))) dirs.push(p);
    return uniq(dirs.map(v => ({ value: v, ok: !!d.findCli(x(v)) })).map(c => ({ ...c, label: `${x(c.value)}${c.ok ? '' : ' (no whisper-cli.exe here)'}` })));
  }
  if (key === 'model') {
    const found = filesUnder(x(s.whisperDir), n => /^ggml-.*\.bin$/i.test(n));
    const list = found.map(v => ({ value: v, label: v, ok: true }));
    if (s.model && !list.some(c => c.value.toLowerCase() === String(s.model).toLowerCase())) list.unshift({ value: s.model, label: `${s.model} (not in the Whisper folder)`, ok: false });
    return uniq(list);
  }
  if (key === 'ffmpeg') {
    const list = [];
    if (onPath('ffmpeg', env)) list.push({ value: 'ffmpeg', label: 'ffmpeg on the PATH', ok: true });
    for (const f of filesUnder(x(s.whisperDir), n => n.toLowerCase() === 'ffmpeg.exe')) list.push({ value: path.join(s.whisperDir, f), label: path.join(x(s.whisperDir), f), ok: true });
    if (s.ffmpeg && !list.some(c => c.value.toLowerCase() === String(s.ffmpeg).toLowerCase())) {
      const ok = s.ffmpeg === 'ffmpeg' ? onPath('ffmpeg', env) : exists(x(s.ffmpeg));
      list.unshift({ value: s.ffmpeg, label: s.ffmpeg === 'ffmpeg' ? `ffmpeg on the PATH${ok ? '' : ' (not found)'}` : `${x(s.ffmpeg)}${ok ? '' : ' (not found)'}`, ok });
    }
    return uniq(list);
  }
  return null;
}
