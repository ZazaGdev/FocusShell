// The Status view's IPC (#383): reads the lines the CTOs wrote with `deck status`. A smoke or
// try run reads and writes its own copy under state/smoke, never the real one.
import path from 'node:path';
import { setStatus } from './lib/status.js';
import { readStatus, writeStatus } from './lib/statusfile.js';

// d: { ipcMain, P, SMOKE }
export function registerStatus({ ipcMain, P, SMOKE }) {
  const file = path.join(P.state, SMOKE ? 'smoke' : '', 'lead-status.json');
  ipcMain.handle('status:read', () => readStatus(file));
  if (SMOKE) ipcMain.handle('status:fake', (_e, lead, line) => { writeStatus(file, setStatus(readStatus(file), lead, line, Date.now())); return true; });
}
