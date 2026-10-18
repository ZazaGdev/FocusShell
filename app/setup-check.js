// The first-run setup's Claude Code step (#1061): whether `claude` is installed, its version,
// and whether it is signed in, asked the way a session would start it (the Demo's own Claude
// folder in the Demo). Smoke and try runs answer with a canned result, no Claude.
import { execFile } from 'node:child_process';
import { onPath, olderThan, MESSAGING_MIN } from './lib/requirements.js';

const run = (args, env) => new Promise(resolve => {
  // cmd finds claude.exe or claude.cmd, as a pane does.
  execFile('cmd.exe', ['/d', '/s', '/c', 'claude', ...args], { env, windowsHide: true, timeout: 20000, encoding: 'utf8' },
    (err, out) => resolve(err && !out ? null : String(out || '')));
});

// d: { ipcMain, SMOKE, env() the environment a session starts with }
export function registerSetupCheck({ ipcMain, SMOKE, env }) {
  ipcMain.handle('setup:claude', async () => {
    if (SMOKE) return { found: true, version: '2.1.0 (smoke)', loggedIn: true };
    const e = env();
    if (!onPath('claude', e)) return { found: false };
    const version = ((await run(['--version'], e)) || '').trim().split(/\s+/)[0] || '';
    let loggedIn = false;
    try { loggedIn = JSON.parse((await run(['auth', 'status'], e)) || '{}').loggedIn === true; } catch { /* not signed in, or an old Claude Code */ }
    return { found: true, version, loggedIn, tooOld: olderThan(version), min: MESSAGING_MIN };
  });
}
