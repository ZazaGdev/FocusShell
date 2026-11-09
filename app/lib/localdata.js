// The installed app's big, re-creatable data lives in AppData\Local, not Roaming (#1124):
// Roaming is for small settings and is synced on some work PCs, and one install filled it with
// 1.7 GB (the Code pane's VS Code server and browser storage). Boards and settings stay where
// they are. An install from before keeps its old copies by moving them across, once.
import fs from 'node:fs';
import path from 'node:path';

// What Chromium keeps per session (Electron's sessionData): caches and the Code pane's storage.
export const SESSION_DIRS = ['Partitions', 'Cache', 'Code Cache', 'blob_storage', 'Network', 'Local Storage', 'Session Storage',
  'Shared Dictionary', 'Service Worker', 'IndexedDB', 'WebStorage', 'SharedStorage', 'Trust Tokens', 'DIPS', 'DIPS-wal'];

// Moves each of names from `from` into `to` when it is there and `to` has none of it yet; one
// that is already in `to` is the newer copy, so the old one goes. A move that fails (a file in
// use) is left for the next start. Returns { moved, dropped, left }.
export function moveAcross(from, to, names, f = fs) {
  const out = { moved: [], dropped: [], left: [] };
  if (path.resolve(from) === path.resolve(to)) return out;
  for (const n of names) {
    const a = path.join(from, n), b = path.join(to, n);
    if (!f.existsSync(a)) continue;
    try {
      if (f.existsSync(b)) { f.rmSync(a, { recursive: true, force: true }); out.dropped.push(n); continue; }
      f.mkdirSync(path.dirname(b), { recursive: true });
      f.renameSync(a, b); out.moved.push(n);
    } catch { out.left.push(n); }
  }
  return out;
}
