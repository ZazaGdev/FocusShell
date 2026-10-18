// One safe way to change a board file (#225): the app and the deck command take the same
// lock, re-read the file, apply one change, check it, and write it whole through a temp file
// renamed over the old one, so no reader ever sees half a board and no writer loses another's
// change. Board files keep their own line endings.
import fs from 'node:fs';
import path from 'node:path';

const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// Holds `lockFile` while fn runs. A lock older than 30 seconds, or whose process is gone,
// is taken over; after `wait` ms of someone else holding it, this throws.
export function withLock(lockFile, fn, wait = 15000) {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const until = Date.now() + wait, mine = `${process.pid} ${Date.now()} ${Math.random().toString(36).slice(2)}`;
  const content = () => { try { return fs.readFileSync(lockFile, 'utf8'); } catch { return null; } };
  let fd = null;
  while (fd === null) {
    try { fd = fs.openSync(lockFile, 'wx'); } catch (e) {
      // Windows answers EPERM while the last holder's lock file is still being deleted.
      if (!['EEXIST', 'EPERM', 'EACCES'].includes(e.code)) throw e;
      // Taken over only when it is still the same lock after its process was found gone:
      // a holder that released and quit has deleted its own file before that check.
      const seen = content();
      const [pid, at] = String(seen || '').split(' ').map(Number);
      if (seen && (Date.now() - at > 30000 || (pid && !alive(pid))) && content() === seen) {
        try { fs.unlinkSync(lockFile); } catch { /* someone else took it over */ }
        continue;
      }
      if (Date.now() > until) throw new Error('the boards are locked by another writer; try again');
      pause(10 + Math.random() * 30);
    }
  }
  try {
    fs.writeSync(fd, mine);
    return fn();
  } finally {
    fs.closeSync(fd);
    // Only its own lock: one taken over after a stall belongs to someone else now.
    if (content() === mine) { try { fs.unlinkSync(lockFile); } catch { /* gone */ } }
  }
}

// Writes text through a temp file renamed over `file`. Windows refuses the rename while
// another process has the file open, so it is retried for a few seconds.
export function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if (i >= 60) { try { fs.unlinkSync(tmp); } catch { /* gone */ } throw new Error(`could not write ${path.basename(file)} (${e.code})`); }
      pause(50);
    }
  }
}

// Changes one board file under the lock: fn gets its text with \n line endings (or `empty`
// when the file is missing) and returns the new text, or null for no change. The file's own
// line endings and a leading byte-order mark come back as they were. Returns fn's result text.
export function update(lockFile, file, fn, empty = '') {
  return withLock(lockFile, () => {
    let raw = null;
    try { raw = fs.readFileSync(file, 'utf8'); } catch { /* new file */ }
    const bom = raw && raw.startsWith('﻿') ? '﻿' : '';
    const crlf = raw ? raw.includes('\r\n') : false;
    const text = raw == null ? empty : raw.slice(bom.length).replace(/\r\n/g, '\n');
    const next = fn(text);
    if (next == null || next === text) return text;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeAtomic(file, bom + (crlf ? String(next).replace(/\r?\n/g, '\r\n') : String(next)));
    return next;
  });
}
