// Serves the tavern mock-up (#238) on every address of this PC, the Tailscale one included,
// so a phone on the tailnet can open it. Run: npm start (in tavern/). PORT sets the port.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { leaderboard } from '../app/lib/tavern/tokens.js';
import { fiveHour } from '../app/lib/tavern/usage.js';
import { finishedCounts } from '../app/lib/tavern/finished.js';
import { periodBoard, periodStart } from '../app/lib/tavern/tokens.js';
import { tasksDone } from '../app/lib/tavern/tally.js';
import { commitsToday } from '../app/lib/commits.js';
import { parseProjects, mergeProjects } from '../app/lib/projects.js';
import { execFile } from 'node:child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5238);
const DECK = path.resolve(ROOT, '..');   // this checkout is the data folder in development

// The projects FocusShell lists, as the app finds them: every folder under the scan roots (the
// data folder's parent by default) plus projects.json's own entries.
function projects() {
  let cfg = { projects: [] };
  try { cfg = parseProjects(fs.readFileSync(path.join(DECK, 'projects.json'), 'utf8')); } catch { /* none */ }
  const folders = [];
  for (const root of cfg.scanRoots && cfg.scanRoots.length ? cfg.scanRoots : [path.dirname(DECK)]) {
    try { for (const d of fs.readdirSync(root, { withFileTypes: true })) if (d.isDirectory() && !d.name.startsWith('.')) folders.push({ name: d.name, path: path.join(root, d.name) }); } catch { /* missing */ }
  }
  const real = p => { try { return fs.realpathSync.native(p); } catch { return p; } };
  return mergeProjects(cfg.projects || [], folders, path.join(DECK, 'manager'), real);
}
const git = (cwd, args) => new Promise(res => execFile('git', ['-C', cwd, ...args], { timeout: 5000, windowsHide: true }, (err, out) => res(err ? '' : String(out))));
// The chalkboard's other tabs (#285): tokens today or this week, tasks done, commits today.
async function boardRows(tab) {
  if (tab === 'today' || tab === 'week') return periodBoard(path.join(os.homedir(), '.claude', 'projects'), periodStart(tab));
  if (tab === 'tasks') {
    const md = {}, dir = path.join(DECK, 'tasks');
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.md')) md[f.slice(0, -3)] = fs.readFileSync(path.join(dir, f), 'utf8');
    return tasksDone(md);
  }
  if (tab === 'commits') return (await commitsToday(projects(), git)).projects.map(p => ({ who: p.name, count: p.count }));
  return [];
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.md': 'text/plain', '.css': 'text/css', '.json': 'application/json' };

http.createServer((req, res) => {
  // The chalkboard's token leaderboard (#272), from Claude Code's logs on this PC.
  if (req.url.startsWith('/api/tokens')) {
    let rows = [];
    try { rows = leaderboard(path.join(os.homedir(), '.claude', 'projects')); } catch { /* none */ }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ at: Date.now(), rows }));
    return;
  }
  if (req.url.startsWith('/api/board')) {
    boardRows(new URL(req.url, 'http://x').searchParams.get('tab')).catch(() => []).then(rows => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ at: Date.now(), rows }));
    });
    return;
  }
  // The tap barrels' beer (#279): the 5-hour allowance the status line last wrote.
  if (req.url.startsWith('/api/usage')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(fiveHour(path.join(os.homedir(), '.claude', 'usage'))));
    return;
  }
  // The mug rack and trophy shelf (#282): items closed today and this week on every project
  // board in the data folder (FOCUSSHELL_HOME, else the FocusShell folder this one sits in), Me left out.
  if (req.url.startsWith('/api/finished')) {
    const dir = path.join(process.env.FOCUSSHELL_HOME || path.join(ROOT, '..'), 'tasks'), md = {};
    try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.md')) md[f.slice(0, -3)] = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { /* none */ }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(finishedCounts(md, ['Me'])));
    return;
  }
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  let file = path.resolve(ROOT, rel);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {   // a folder URL serves its page; add the slash so its relative links work
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.endsWith('/')) { res.writeHead(301, { Location: url.pathname + '/' + url.search }); res.end(); return; }
    file = path.join(file, 'index.html');
  }
  // Only the page, its code and its art; never node_modules or anything outside this folder.
  if (!file.startsWith(ROOT + path.sep) || /node_modules/.test(file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '0.0.0.0', () => console.log(`tavern on http://localhost:${PORT}/`));
