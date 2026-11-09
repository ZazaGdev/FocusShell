// The deck command (#225): `node <data folder>/deck.mjs <verb> ...`. Sessions change boards
// only through it; the launcher in the data folder sets FOCUSSHELL_DATA and imports this.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { run } from './lib/deckcli.js';
import { guardReason } from './lib/guard.js';
import { PANE_VERBS, runPane } from './lib/deckpanes.js';

const argv = process.argv.slice(2);
const at = argv.indexOf('--data');
const data = path.resolve(at >= 0 ? argv.splice(at, 2)[1] : process.env.FOCUSSHELL_DATA || process.cwd());
const git = args => execFileSync('git', ['-C', data, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
// `deck guard` is the CTO's and PM's PreToolUse hook (#349): it reads the tool call on stdin
// and exits 2 with the reason when it would edit a board by hand, so Claude Code refuses it.
if (argv[0] === 'guard') {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
  const why = guardReason(input, data);
  if (why) { console.error(why); process.exit(2); }
  process.exit(0);
}
// The CTO's pane requests (#2562): they wait on the running app's answer.
if (PANE_VERBS.has(argv[0])) {
  try {
    const r = await runPane(argv[0], argv.slice(1), { data });
    console.log(r.out);
    process.exit(r.code);
  } catch (e) { console.error(`deck: ${e.message}`); process.exit(1); }
}
// The worktree sweep (#2726): every project's worktrees, keep or remove and why; --clean
// removes the safe ones and saves the report where the app keeps its daily one. A lead removes
// a worktree it made with worktree-remove, under the same checks. Both wait for CLEAN_ON.
if (argv[0] === 'worktrees' || argv[0] === 'worktree-remove') {
  try {
    const W = await import('./lib/worktrees.js');
    const off = 'removing worktrees is switched off for now (#2726)';
    if (argv[0] === 'worktree-remove') {
      if (argv.length !== 2) { console.error("deck: worktree-remove takes one folder: worktree-remove '<folder>'"); process.exit(1); }
      if (!W.CLEAN_ON) { console.error(`deck: ${off}; leave the worktree in place and name its folder in your DONE result`); process.exit(1); }
      const r = await W.removeOne({ dir: argv[1], data });
      console.log(r.out);
      process.exit(r.removed ? 0 : 1);
    }
    const extra = argv.slice(1).filter(a => a !== '--clean');
    if (extra.length) { console.error(`deck: worktrees takes only --clean, not ${extra.join(' ')}`); process.exit(1); }
    const clean = argv.includes('--clean');
    if (clean && !W.CLEAN_ON) { console.error(`deck: ${off}; deck worktrees without --clean still lists them`); process.exit(1); }
    // The app keeps its open panes' folders in state/live-folders.json, read again before each removal.
    const text = W.report(await W.sweep({ projects: W.projectFolders(data), data, clean, inUse: () => W.liveFolders(data) }));
    if (clean) W.saveReport(data, text);
    console.log(text);
    process.exit(0);
  } catch (e) { console.error(`deck: ${e.message}`); process.exit(1); }
}
try {
  console.log(run(argv, { data, lock: path.join(data, 'state', 'board.lock'), git }));
} catch (e) {
  console.error(`deck: ${e.message}`);
  process.exit(1);
}
