// In-app updates (#1088): the installed app looks for a newer version on the public repo's
// GitHub Releases (build.publish in package.json, written into the app as app-update.yml),
// downloads it quietly and tells the page; nothing installs until the user presses Restart to
// update. FOCUSSHELL_UPDATE_URL points it at a plain folder of builds instead, for a local test.
import electronUpdater from 'electron-updater';
import { CHECK_EVERY_MS } from './lib/update.js';

const { autoUpdater } = electronUpdater;

// d: { app, ipcMain, send(channel, payload), on: updatesOn(...), smoke, log(line) }
export function registerUpdater({ app, ipcMain, send, on, smoke, log }) {
  let state = { version: app.getVersion(), on, checking: false, ready: false, latest: '', error: '' };
  const tell = patch => { state = { ...state, ...patch }; send('update:state', state); };
  ipcMain.handle('update:state', () => state);
  if (!on) {
    ipcMain.handle('update:check', () => state);
    // A smoke run shows the "Update ready" button for a made-up version; it installs nothing.
    ipcMain.handle('update:install', () => { if (smoke) tell({ installAsked: true }); return false; });
    if (smoke) ipcMain.handle('update:fake', (_e, latest) => { tell({ ready: !!latest, latest: latest || '' }); return state; });
    return;
  }

  autoUpdater.autoDownload = true;          // quietly, in the background
  autoUpdater.autoInstallOnAppQuit = false; // only when the user presses Restart to update
  autoUpdater.logger = { info: m => log(`update: ${m}`), warn: m => log(`update: ${m}`), error: m => log(`update error: ${m}`), debug: () => {} };
  if (process.env.FOCUSSHELL_UPDATE_URL) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.FOCUSSHELL_UPDATE_URL });

  autoUpdater.on('checking-for-update', () => tell({ checking: true, error: '' }));
  autoUpdater.on('update-available', i => tell({ latest: i.version }));
  autoUpdater.on('update-not-available', () => tell({ checking: false }));
  autoUpdater.on('update-downloaded', i => {
    tell({ checking: false, ready: true, latest: i.version });
    // The local update test (a test feed and FOCUSSHELL_UPDATE_TEST=install) stands in for the
    // user's Restart to update press; an installed app from a release never does this.
    if (process.env.FOCUSSHELL_UPDATE_URL && process.env.FOCUSSHELL_UPDATE_TEST === 'install') setTimeout(() => autoUpdater.quitAndInstall(true, true), 2000);
  });
  autoUpdater.on('error', e => tell({ checking: false, error: String((e && e.message) || e).split('\n')[0].slice(0, 200) }));

  const check = () => { if (!state.ready) autoUpdater.checkForUpdates().catch(() => { /* reported by the error event */ }); return state; };
  ipcMain.handle('update:check', () => check());
  // Quits like a normal close (sessions end), runs the new installer and starts the new version.
  ipcMain.handle('update:install', () => { if (!state.ready) return false; setImmediate(() => autoUpdater.quitAndInstall(true, true)); return true; });

  setTimeout(check, 15000).unref();
  setInterval(check, CHECK_EVERY_MS).unref();
}
