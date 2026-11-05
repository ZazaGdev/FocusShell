// Keeps remote pages out of FocusShell's windows (#388). Imported first by main.js, so every
// ipcMain.handle and ipcMain.on registered after it, in any module, refuses a sender that is not
// one of the app's own files. guardWindow stops a window navigating away from its page (a link
// dropped on it) and opening new windows.
import { ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { trustedSender, opensOutside } from './lib/windowguard.js';

const APP_URL = pathToFileURL(path.dirname(fileURLToPath(import.meta.url))).href.replace(/\/?$/, '/');
const ok = e => trustedSender(e && e.senderFrame && e.senderFrame.url, APP_URL);

const handle = ipcMain.handle.bind(ipcMain), on = ipcMain.on.bind(ipcMain), once = ipcMain.once.bind(ipcMain);
ipcMain.handle = (ch, fn) => handle(ch, (e, ...a) => {
  if (!ok(e)) throw new Error(`refused: ${ch} from a page that is not FocusShell's`);
  return fn(e, ...a);
});
ipcMain.on = (ch, fn) => on(ch, (e, ...a) => { if (ok(e)) fn(e, ...a); });
ipcMain.once = (ch, fn) => once(ch, (e, ...a) => { if (ok(e)) fn(e, ...a); });

export function guardWindow(win) {
  const wc = win.webContents;
  wc.on('will-navigate', e => e.preventDefault()); // the app never navigates its own windows
  wc.setWindowOpenHandler(({ url }) => { if (opensOutside(url)) shell.openExternal(url); return { action: 'deny' }; });
}
