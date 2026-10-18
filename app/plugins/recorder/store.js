// The recorder's folders (#369): one per recording in the plugin's data folder, named by its
// start time, holding video.webm, audio.wav, transcript.json, transcript.md and session.json.
import fs from 'node:fs';
import path from 'node:path';
import { folderName } from './lib/transcript.js';

// A new, empty recording folder; returns its name (the session id) and path.
export function createRecording(root, now = new Date()) {
  const base = folderName(now);
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`, dir = path.join(root, id);
    if (fs.existsSync(dir)) continue;
    fs.mkdirSync(dir, { recursive: true });
    return { id, dir };
  }
}

// session.json, written whole (a temp file, then a rename) so a crash never leaves half of it.
export function save(dir, session) {
  const f = path.join(dir, 'session.json');
  fs.writeFileSync(f + '.tmp', JSON.stringify(session, null, 2));
  fs.renameSync(f + '.tmp', f);
}

// Every recording that has a readable session.json.
export function loadAll(root) {
  let names = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; }
  const out = [];
  for (const n of names) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(root, n, 'session.json'), 'utf8'))); } catch { /* not a recording */ }
  }
  return out;
}

export const videoFile = dir => path.join(dir, 'video.webm');

// One chunk of the recording, appended as it arrives, so a crash keeps what was recorded.
export function append(dir, bytes) {
  fs.appendFileSync(videoFile(dir), bytes);
}

export function size(f) {
  try { return fs.statSync(f).size; } catch { return 0; }
}

export function remove(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
