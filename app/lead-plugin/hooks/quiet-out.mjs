// The filter a wrapped run pipes into (#3073, quiet-runs.mjs makes the wrapper). It saves
// the full output, as it arrives, in the temp folder's focusshell-runs and names that file
// first, so a run cut off by the Bash timeout still points at it; at the end it prints a short
// summary for a pass whose log was written in full, or else the complete output, byte for byte
// with only the marker line taken out, and exits with the command's code.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MARK, markAfter, summarize } from '../../lib/quietrun.js';

const KEEP_MS = 2 * 24 * 3600 * 1000;
const started = Date.now();
const dir = path.join(os.tmpdir(), 'focusshell-runs');
let file = '', out = null, logOk = false, ended = false, closed = false;
const chunks = [];

try {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.log')) continue;
    try {
      const p = path.join(dir, name);
      if (started - fs.statSync(p).mtimeMs > KEEP_MS) fs.unlinkSync(p);
    } catch {}
  }
  const stamp = new Date(started).toISOString().replace(/[:.]/g, '-');
  file = path.join(dir, `${stamp}-${process.pid}.log`);
  out = fs.createWriteStream(file);
  logOk = true;
  out.on('error', () => { logOk = false; });
  // After end() or an error; finish() waits for it, so a pass is summarized only once its
  // log is complete.
  out.on('close', () => { closed = true; finish(); });
  process.stdout.write(`[FocusShell] full output: ${file}\n`);
} catch {
  logOk = false;
  if (out) { try { out.destroy(); } catch {} }
  out = null;
  closed = true;
}

// The raw bytes without the marker line, and the code from it (null: no marker).
function split(buf) {
  const at = buf.lastIndexOf(MARK);
  const m = at < 0 ? null : markAfter(buf.subarray(at + MARK.length, at + MARK.length + 16).toString('latin1'));
  if (!m) return { bytes: buf, code: null };
  return { bytes: Buffer.concat([buf.subarray(0, at), buf.subarray(at + MARK.length + m.length)]), code: m.code };
}

let done = false;
function finish() {
  if (!ended || !closed || done) return;
  done = true;
  const { bytes, code } = split(Buffer.concat(chunks));
  let summary = null;
  if (code !== null && logOk) {
    try { summary = summarize({ text: bytes.toString('utf8'), code, secs: (Date.now() - started) / 1000, file }); } catch {}
  }
  if (summary !== null) process.stdout.write(summary + '\n');
  else process.stdout.write(bytes);
  process.exitCode = code === null ? 1 : code;
}

process.stdin.on('data', c => {
  chunks.push(c);
  if (out && logOk) out.write(c);
});
process.stdin.on('end', () => {
  ended = true;
  if (out && !closed) out.end();
  finish();
});
