// The app's daily worktree sweep (#2726). Ten minutes after start, then every hour, it checks
// whether a day has passed since the last clean (this one or `deck worktrees --clean`); if so
// it removes the safe worktrees of every project, leaving the folders of live sessions alone,
// and saves the report in state/worktree-sweep.txt. It also keeps state/live-folders.json, the
// folders of live sessions, so the deck commands leave them alone too. Never in a smoke, try or
// demo run: those share the data folder with the real app. Removing waits for CLEAN_ON.
import { sweep, report, sweepState, saveReport, saveLiveFolders, CLEAN_ON, DAY_MS } from './lib/worktrees.js';

export function registerWorktreeSweep({ app, SMOKE, DEMO, DECK, projects, liveFolders, cleanOn = CLEAN_ON }) {
  if (SMOKE || DEMO) return;
  let written = null;
  const writeLive = folders => {
    const text = JSON.stringify(folders);
    if (text === written) return;
    try { saveLiveFolders(DECK, folders); written = text; } catch (e) { console.error('live folders:', e.message); }
  };
  writeLive(liveFolders());
  setInterval(() => writeLive(liveFolders()), 15e3).unref();
  app.on('before-quit', () => writeLive([]));
  if (!cleanOn) return;
  let running = false;
  const tick = async () => {
    if (running || Date.now() - (sweepState(DECK).last || 0) < DAY_MS) return;
    running = true;
    try {
      // Open panes are asked for again just before each removal.
      const res = await sweep({ projects: projects(), data: DECK, clean: true, inUse: liveFolders });
      saveReport(DECK, report(res));
    } catch (e) { console.error('worktree sweep:', e.message); }
    finally { running = false; }
  };
  setTimeout(tick, 10 * 60e3).unref();
  setInterval(tick, 3600e3).unref();
}
