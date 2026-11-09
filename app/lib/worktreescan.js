// What the worktree sweep (#2726, lib/worktrees.js) reads about one folder: git's answers, its
// paths with links resolved, what git's removal of it would harm, its size, when it was last
// used, and whether a program holds it.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { encodeProjectDir } from './history.js';

export const DAY_MS = 24 * 3600e3;
// Untracked files counted whatever the repo's status.showUntrackedFiles says: `git worktree
// remove` follows that setting and would delete untracked files a repo hides.
export const STATUS = ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=normal', '--ignore-submodules=none'];
// What `git status` says on stderr, exit code 0 and all, when it could not look everywhere (a
// path over 260 characters, a folder it may not read): then a clean status proves nothing.
export const BLIND = /could not open|too long|permission denied|unable to (read|access|open)/i;

// git in a folder; never throws: { ok, out, err }. opts.env replaces the environment. Long
// paths on: without core.longpaths git on Windows neither sees nor deletes a file whose path
// is over 260 characters, and says so only as a warning.
export function gitRun(cwd, args, opts = {}) {
  return new Promise(resolve => execFile('git', ['-c', 'core.longpaths=true', '-C', cwd, ...args],
    { windowsHide: true, timeout: 120000, maxBuffer: 64e6, encoding: 'utf8', ...(opts.env ? { env: opts.env } : {}) },
    (e, out, err) => resolve({ ok: !e, out: out || '', err: String(err || (e && e.message) || '').trim() })));
}

// `git worktree list --porcelain` -> [{ path, head, branch, detached, bare, locked, prunable }].
export function parseWorktrees(text) {
  return String(text).replace(/\r/g, '').split(/\n\n+/).map(block => {
    const w = { path: '', head: '', branch: '', detached: false, bare: false, locked: null, prunable: null };
    for (const line of block.split('\n')) {
      const i = line.indexOf(' '), k = i < 0 ? line : line.slice(0, i), v = i < 0 ? '' : line.slice(i + 1);
      if (k === 'worktree') w.path = path.resolve(v);
      else if (k === 'HEAD') w.head = v;
      else if (k === 'branch') w.branch = v.replace(/^refs\/heads\//, '');
      else if (k === 'detached') w.detached = true;
      else if (k === 'bare') w.bare = true;
      else if (k === 'locked') w.locked = v || 'no reason given';
      else if (k === 'prunable') w.prunable = v || 'its folder is gone';
    }
    return w;
  }).filter(w => w.path);
}

// A path with links and junctions resolved; for a missing path, through its nearest existing
// folder (a gone worktree registered through G:\ still resolves to its D:\ place).
export function real(p) {
  const abs = path.resolve(p);
  try { return fs.realpathSync.native(abs).replace(/^\\\\\?\\/, ''); } catch { /* missing */ }
  const parent = path.dirname(abs);
  return parent === abs ? abs : path.join(real(parent), path.basename(abs));
}
export const key = p => real(p).replace(/[\\/]+$/, '').toLowerCase();
export const under = (k, dirKey) => k.startsWith(`${dirKey}${path.sep}`);
// p strictly inside dir (after links and junctions are resolved), as a relative path, else null.
export function inside(dir, p) {
  const r = path.relative(real(dir), real(p));
  return r && !r.startsWith('..') && !path.isAbsolute(r) ? r : null;
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export function ago(ms) {
  const d = Math.floor(ms / DAY_MS);
  if (d >= 1) return plural(d, 'day');
  const h = Math.floor(ms / 3600e3);
  return h >= 1 ? plural(h, 'hour') : 'minutes';
}
export const fmtSize = b => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);

// Runs fn over items, at most n at a time.
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}
const pause = ms => new Promise(r => setTimeout(r, ms));

export const mtime = p => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
function newestIn(dir) {
  let t = 0;
  try { for (const n of fs.readdirSync(dir)) t = Math.max(t, mtime(path.join(dir, n))); } catch { /* none */ }
  return t;
}
// The latest of a stat's times: a file copied in keeps its old modified time but gets a new
// creation and change time.
const timesOf = st => Math.max(st.mtimeMs || 0, st.ctimeMs || 0, st.birthtimeMs || 0);

// The time of the last entry in a reflog (git's own record of each checkout, commit or reset),
// read from the entry itself: git's housekeeping rewrites every worktree's reflog file, so its
// file time says nothing. A file that cannot be read that way counts by its file time.
export function lastReflogTime(file) {
  let text = '';
  try {
    const fd = fs.openSync(file, 'r');
    try { const size = fs.fstatSync(fd).size, n = Math.min(size, 8192), buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, size - n); text = buf.toString('utf8'); }
    finally { fs.closeSync(fd); }
  } catch { return 0; }
  // `<old> <new> <who> <email> <seconds> <zone>[\t<message>]`: a new worktree's first entry has no message.
  const last = text.replace(/\r/g, '').split('\n').filter(Boolean).pop() || '';
  const m = last.match(/> (\d{9,11}) [+-]\d{4}(?:\t|$)/);
  return m ? Number(m[1]) * 1000 : mtime(file);
}
// When git and Claude Code last used a worktree: its git folder (a git command run in it takes
// a lock file there; so does the repo's housekeeping, which only delays a removal by a day), its
// HEAD and index, the last entry of its reflog, the folder, and the newest Claude Code session
// log for that folder. The files in it count too, through scanTree's newest. None of the
// sweep's own commands change any of these.
export async function touchedAt(wt, git, home) {
  let t = mtime(wt);
  const gd = await git(wt, ['rev-parse', '--absolute-git-dir']);
  if (gd.ok) {
    const d = gd.out.trim();
    t = Math.max(t, mtime(d), mtime(path.join(d, 'HEAD')), mtime(path.join(d, 'index')), lastReflogTime(path.join(d, 'logs', 'HEAD')));
  }
  for (const p of new Set([path.resolve(wt), real(wt)])) t = Math.max(t, newestIn(path.join(home, '.claude', 'projects', encodeProjectDir(p))));
  return t;
}

// Files git keeps out of `git status` (skip-worktree, assume-unchanged) that are on disk: a
// local edit to one would go with the folder. -1 when git cannot list them.
export async function hiddenEdits(dir, git) {
  const r = await git(dir, ['ls-files', '-v', '-z']);
  if (!r.ok) return -1;
  let n = 0;
  for (const entry of r.out.split('\0')) {
    const tag = entry[0];
    if (entry.length > 2 && (tag === 'S' || (tag >= 'a' && tag <= 'z')) && fs.existsSync(path.join(dir, entry.slice(2)))) n++;
  }
  return n;
}

// Walks a folder, many subfolders read at once, never into links. visit(dirent, path, parent).
// Resolves with the first folder that could not be read, or ''.
async function walkTree(dir, visit, workers = 16) {
  const queue = [dir];
  let active = 0, blocked = '';
  await new Promise(done => {
    const next = () => {
      if (!queue.length && !active) return done();
      while (queue.length && active < workers) {
        const d = queue.pop(); active++;
        fsp.readdir(d, { withFileTypes: true })
          .then(async ents => { for (const e of ents) { const p = path.join(d, e.name); if (e.isDirectory()) queue.push(p); await visit(e, p, d); } })
          .catch(err => { if (err.code !== 'ENOENT' && !blocked) blocked = d; })
          .finally(() => { active--; next(); });
      }
    };
    next();
  });
  return blocked;
}
// A .git entry below a worktree's top that is a repository: a folder, a link, or a file
// pointing to a git folder that exists. A file pointing nowhere is no repository only inside a
// package or extension folder, and on Windows only when it names a Mac or Linux path, which no
// drive here can hold (a VS Code extension ships one from its author's Mac: /Users/...).
// Anywhere else it may be a worktree whose repository is on a drive not connected, so it counts.
function repoAt(e, p, parent, top) {
  if (!e.isFile()) return true;
  let to = '';
  try { to = ((fs.readFileSync(p, 'utf8').match(/^gitdir:\s*(.+)$/m) || [])[1] || '').trim(); } catch { return true; }
  if (!to || fs.existsSync(path.resolve(parent, to))) return true;
  if (process.platform === 'win32' && !to.startsWith('/')) return true;
  return !path.relative(top, parent).split(/[\\/]/).some(s => /^(node_modules|extensions)$/i.test(s));
}
// What git's removal of a folder would harm beyond it, its size and when anything in it last
// changed: the first link that leads outside it (git follows a junction and empties its
// target), the first repository below its top (another worktree, a clone, a submodule), the
// first folder that could not be read, and the newest time of any file, folder or link in it.
export async function scanTree(dir, { sizes = true } = {}) {
  const top = key(dir);
  const s = { size: 0, newest: 0, linkOut: '', nested: '', blocked: '' };
  try { s.newest = timesOf(fs.lstatSync(dir)); } catch { /* gone */ }
  s.blocked = await walkTree(dir, async (e, p, parent) => {
    if (e.name === '.git' && parent !== dir && !s.nested && repoAt(e, p, parent, dir)) s.nested = p;
    if (e.isSymbolicLink()) {
      let t = '';
      try { t = fs.realpathSync.native(p).replace(/^\\\\\?\\/, ''); } catch { /* dangling: git removes only the link */ }
      const k = t.replace(/[\\/]+$/, '').toLowerCase();
      if (t && !s.linkOut && k !== top && !under(k, top)) s.linkOut = t;
    }
    let st = null;
    try { st = await fsp.lstat(p); } catch { return; }
    // No wait between reading and writing these: `x += await ...` would lose other walkers' sums.
    const t = timesOf(st);
    if (t > s.newest) s.newest = t;
    if (sizes && e.isFile()) s.size += st.size;
  });
  return s;
}
export const folderSize = async dir => (await scanTree(dir)).size;
export const riskOf = s => (s.nested ? `another worktree or repository is inside it (${s.nested})`
  : s.linkOut ? `it holds a link to ${s.linkOut}, outside it, and git would empty that folder too; remove it by hand`
    : s.blocked ? `part of it could not be read (${s.blocked})` : '');
// Why git's removal of a folder could harm work beyond what `git status` shows, or ''.
export async function removalRisk(dir, git = gitRun) {
  const h = await hiddenEdits(dir, git);
  if (h) return h < 0 ? 'git could not list its files' : `${plural(h, 'file')} with changes git is told to ignore (skip-worktree or assume-unchanged)`;
  return riskOf(await scanTree(dir, { sizes: false }));
}

// Windows refuses to rename a folder a program is in (its working folder, an open file); git
// would then delete the files and leave the empty folder behind. Rename it and back to see.
export async function heldOpen(dir) {
  if (process.platform !== 'win32') return false;
  const probe = `${dir}~sweep-check`;
  if (fs.existsSync(probe)) return true;
  try { await fsp.rename(dir, probe); } catch { return true; }
  for (let i = 0; i < 50; i++) { try { await fsp.rename(probe, dir); return false; } catch { await pause(100); } }
  throw new Error(`renamed it to ${probe} to test it and could not rename it back; rename it back by hand`);
}
