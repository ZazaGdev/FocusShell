// Today's commits across the projects (#289), for the tavern's chalkboard
// (#285). Kept a minute, so a redraw never runs git more than once a minute. Smoke and try
// runs get canned numbers.
import { execFile } from 'node:child_process';
import { commitsToday } from './lib/commits.js';

const MINUTE = 60e3;

// d: { ipcMain, SMOKE, projectList }
export function registerCommits({ ipcMain, SMOKE, projectList }) {
  let kept = null; // { at, value }
  // { total, projects: [{ name, count }] } for commits made since local midnight.
  const git = (cwd, args) => new Promise(res => execFile('git', ['-C', cwd, ...args], { timeout: 5000, windowsHide: true }, (err, out) => res(err ? '' : String(out))));
  ipcMain.handle('commits:today', async () => {
    if (SMOKE) return { total: 7, projects: [{ name: 'FocusShell', count: 5 }, { name: 'Papers', count: 2 }] };
    if (kept && Date.now() - kept.at < MINUTE) return kept.value;
    const value = await commitsToday(projectList(), git);
    kept = { at: Date.now(), value };
    return value;
  });
}
