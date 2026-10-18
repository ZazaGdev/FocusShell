// state\app.pid: the running app's process id, which open-pane.ps1 and close-pane.ps1 read to
// find it (#1074). An instance only ever removes its own record, and puts it back when it is gone.
import fs from 'node:fs';

const read = file => { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; } };

// Written when this instance starts, and again whenever the file has gone missing since.
export function keepPid(file, pid) {
  if (read(file)) return false;
  try { fs.writeFileSync(file, String(pid)); return true; } catch { return false; }
}

// On quit: removed only while it still names this instance, so a second instance quitting
// leaves the first one's record in place.
export function releasePid(file, pid) {
  if (read(file) !== String(pid)) return false;
  try { fs.unlinkSync(file); return true; } catch { return false; }
}
