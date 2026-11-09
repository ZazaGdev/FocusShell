// The worktree sweep (#2726): every project's git worktrees, each one kept or removed with the
// reason and its size, so worktrees made for lead and agent work stop piling up. Run by
// `deck worktrees [--clean]` and once a day by the app (worktree-sweep.js); a lead removes one
// it made with `deck worktree-remove <folder>`, under the same checks bar the day of idling.
//
// Removed only when all of these hold (the owner's rule, ANSWER #2726):
// - it sits where leads and agents make worktrees (placeOf), and is no project's own folder;
// - no uncommitted or untracked files, and no edits git is told to ignore;
// - its work is already in the main line: main, master, QA, Develop, dev or the remote's
//   default branch, squash merges counted (a pushed branch that is not merged is kept: it may
//   have an open PR);
// - not open in a pane, and on Windows no program holds the folder;
// - nothing in it changed for a day (git, Claude Code and every file and folder in it); not
//   locked in git;
// - nothing in it that git's removal would harm: no link to a folder outside it (git follows a
//   junction and empties its target) and no other worktree or repository inside it.
// Each of these is checked again just before it goes. Its branch is deleted only when both a
// local and a remote main-line branch hold its work. A worktree whose folder is gone only has
// git's record left, removed record by record when it was in such a place and is not all that
// holds commits. Other folders in those places are listed with their size, never deleted,
// except one this sweep was removing itself when Windows held it (retried at the next clean if
// nothing in it changed). A listing changes no branch, file or setting: its trial merges write
// their objects to a temp folder (git may still refresh the time stamp of an object it has).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseProjects, mergeProjects } from './projects.js';
import { DAY_MS, STATUS, BLIND, gitRun, parseWorktrees, real, key, under, inside, plural, ago, fmtSize, pool, mtime,
  touchedAt, hiddenEdits, scanTree, riskOf, heldOpen } from './worktreescan.js';
export { DAY_MS, gitRun, parseWorktrees, fmtSize, folderSize, lastReflogTime, removalRisk, scanTree } from './worktreescan.js';

// The switch for all removing (#2726): the app's daily clean, `deck worktrees --clean` and
// `deck worktree-remove` all wait for it. Listing always works. It was held off until three
// independent reviews' findings were fixed and tested; turn it off again if one goes wrong.
export const CLEAN_ON = false;
const BASE_NAMES = /^(main|master|qa|develop|dev)$/i;
export const STATE_FILE = ['state', 'worktree-sweep.json'];
export const REPORT_FILE = ['state', 'worktree-sweep.txt'];
export const LIVE_FILE = ['state', 'live-folders.json'];
const LOCK_FILE = ['state', 'worktree-sweep.lock'];

// Where a worktree sits, when it is a place leads and agents make worktrees, else ''.
// top: the project's main folder; data: FocusShell's data folder; tmp: the system temp folder;
// bare: the repo is bare, so the folders beside it are its own checkouts, never leftovers.
export function placeOf(wt, { top, data, tmp, bare = false }) {
  if (data && inside(path.join(data, 'state', 'worktrees'), wt)) return "FocusShell's lead worktrees";
  const r = inside(top, wt);
  if (r) {
    const [a, b] = r.split(/[\\/]/);
    if (a === '.claude' && b === 'worktrees') return 'Claude Code agent worktrees';
    if (a === '.worktrees') return "the project's .worktrees";
    return '';
  }
  // Beside the project: wt-* folders, as some projects' leads make them.
  if (!bare && /^wt[-_]/i.test(path.basename(wt)) && key(path.dirname(real(wt))) === key(path.dirname(real(top)))) return 'beside the project';
  if (tmp && inside(path.join(tmp, 'claude'), wt)) return 'a Claude Code scratchpad';
  return '';
}

// The verdict on one worktree's facts: { remove, why }.
// f: { prunable, place, parentGone, orphans, folderLeft, locked, project, inUse, busy, broken,
//      inner, blocked, dirty, hidden, linkOut, touched, detached,
//      merged: { base, how, local, remote } | null, unpushed, pushedTo, remotes, bases }
export function verdict(f, now = Date.now()) {
  const keep = why => ({ remove: false, why }), go = why => ({ remove: true, why });
  if (f.locked) return keep(`locked in git (${f.locked})`);
  if (f.prunable) {
    if (!f.place) return keep('its folder is gone; not where leads or agents make worktrees, so git\'s record of it stays');
    if (f.parentGone) return keep('its folder is gone, and so is the folder it sat in (a drive not connected?), so git\'s record of it stays');
    if (f.folderLeft) return keep('git lost it (its .git file is gone): the folder and git\'s record of it stay; check it yourself');
    if (f.orphans) return keep(`its folder is gone, but git's record of it is all that holds ${plural(f.orphans, 'commit')} on no branch, so it stays`);
    return go('its folder is gone, only git\'s record of it is left');
  }
  if (f.project) return keep(`it is the folder of the FocusShell project ${f.project}`);
  if (!f.place) return keep('not where leads or agents make worktrees');
  if (f.inUse) return keep('open in an FocusShell pane');
  if (f.busy) return keep('a program has the folder open');
  if (f.broken) return keep(`git could not read it (${f.broken})`);
  if (f.inner) return keep(`another worktree or repository is inside it (${f.inner})`);
  if (f.blocked) return keep(`part of it could not be read (${f.blocked})`);
  if (f.dirty) return keep(plural(f.dirty, 'uncommitted or untracked change'));
  if (f.hidden) return keep(`${plural(f.hidden, 'file')} with changes git is told to ignore (skip-worktree or assume-unchanged)`);
  if (f.linkOut) return keep(`it holds a link to ${f.linkOut}, outside it, and git would empty that folder too; remove it by hand`);
  if (now - f.touched < DAY_MS) return keep(`used ${ago(now - f.touched)} ago`);
  if (!f.merged) {
    if (!f.bases) return keep('the project has no main, master, QA or Develop branch to compare with');
    if (f.squashUnsure) return keep(`its changes look squash-merged into ${f.squashUnsure}, but files it changed are different there now, so it may hold later work; check it yourself`);
    if (f.unpushed && f.remotes) return keep(`${plural(f.unpushed, 'commit')} on no remote and not merged`);
    if (f.unpushed) return keep(`${plural(f.unpushed, 'commit')} not merged`);
    return keep(`pushed${f.pushedTo ? ` to ${f.pushedTo}` : ''} but not merged yet (may have an open PR)`);
  }
  if (f.detached && !f.merged.local) return keep(`detached, and only ${f.merged.base}, a remote ref that may be out of date, holds its work`);
  const how = f.merged.how === 'squashed' ? 'its changes are in' : 'its work is in';
  return go(`clean, ${how} ${f.merged.base}, last used ${ago(now - f.touched)} ago`);
}

// The main-line refs of a repo: local and remote main, master, QA, Develop, dev, and the
// remote's default branch.
async function mainLine(top, git) {
  const refs = (await git(top, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'])).out.split('\n').filter(Boolean);
  const out = new Set();
  const head = await git(top, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']);
  if (head.ok && head.out.trim()) out.add(head.out.trim());
  for (const r of refs) {
    const m = r.match(/^refs\/(heads|remotes\/[^/]+)\/([^/]+)$/);
    if (m && BASE_NAMES.test(m[2])) out.add(r);
  }
  return [...out];
}
const short = ref => ref.replace(/^refs\/(heads|remotes)\//, '');

// Where a commit's work already is in the main line, or null: every commit reachable from one
// of the refs, or (squash merges, cherry-picks) merging it into one changes nothing and every
// file the branch changed is the same there as on the branch. That last part matters: a commit
// that takes back part of what was squash-merged changes nothing in a trial merge, yet is work.
// When only the trial merge holds, { unsure: <ref> } says so. Names a remote ref when one holds
// it (what others see) and says whether a local and a remote one do: a remote ref may be out of
// date and a local branch may be reset, so a branch goes only when both hold its work. The
// trial merges write their objects to a temp folder, not the repo.
export async function mergedInto(top, head, bases, git = gitRun, objects = '') {
  if (!bases.length || !head) return null;
  const proofs = [];
  let unsure = '';
  const left = await git(top, ['rev-list', '--count', head, '--not', ...bases]);
  if (left.ok && Number(left.out.trim()) === 0) {
    for (const b of bases) if ((await git(top, ['merge-base', '--is-ancestor', head, b])).ok) proofs.push({ ref: b, how: 'merged' });
  }
  if (!proofs.length && objects) {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-objects-'));
    try {
      const env = { ...process.env, GIT_OBJECT_DIRECTORY: scratch, GIT_ALTERNATE_OBJECT_DIRECTORIES: objects };
      for (const b of bases) {
        const m = await git(top, ['merge-tree', '--write-tree', '--no-messages', b, head], { env });
        if (!m.ok) continue;
        const t = await git(top, ['rev-parse', `${b}^{tree}`]);
        if (!t.ok || m.out.split('\n')[0].trim() !== t.out.trim()) continue;
        if (await sameFiles(top, b, head, git)) proofs.push({ ref: b, how: 'squashed' });
        else unsure = unsure || short(b);
      }
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  }
  if (!proofs.length) return unsure ? { unsure } : null;
  const remote = proofs.find(p => p.ref.startsWith('refs/remotes/')), local = proofs.find(p => p.ref.startsWith('refs/heads/'));
  const shown = remote || local || proofs[0];
  return { base: short(shown.ref), how: shown.how, local: !!local, remote: !!remote };
}
// Every file the branch changed since it left b is the same in b as at its head.
async function sameFiles(top, b, head, git) {
  const mb = await git(top, ['merge-base', b, head]);
  if (!mb.ok) return false;
  const touched = await git(top, ['log', '--format=', '--name-only', '--no-renames', `${mb.out.trim()}..${head}`]);
  const differ = await git(top, ['diff', '--name-only', '--no-renames', b, head]);
  if (!touched.ok || !differ.ok) return false;
  const changed = new Set(differ.out.split('\n').filter(Boolean));
  return !touched.out.split('\n').filter(Boolean).some(f => changed.has(f));
}

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
export const sweepState = data => readJson(path.join(data, ...STATE_FILE), {});
function saveState(data, st) {
  try { fs.mkdirSync(path.join(data, 'state'), { recursive: true }); fs.writeFileSync(path.join(data, ...STATE_FILE), JSON.stringify(st, null, 2)); } catch { /* best effort */ }
}
// One removal run at a time (the app's daily clean, a deck command, a lead's removal); a lock
// older than two hours is from a run that died.
function takeLock(data) {
  const f = path.join(data, ...LOCK_FILE);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  for (let i = 0; i < 2; i++) {
    try { fs.writeFileSync(f, String(Date.now()), { flag: 'wx' }); return () => { try { fs.rmSync(f); } catch { /* gone */ } }; }
    catch { if (i || Date.now() - (Number(readJson(f, 0)) || mtime(f)) < 2 * 3600e3) break; try { fs.rmSync(f); } catch { /* raced */ } }
  }
  return null;
}

// The folders of the app's live sessions, which the app keeps in state/live-folders.json, so
// the deck commands leave an open pane's worktree alone too.
export const liveFolders = data => { const j = readJson(path.join(data, ...LIVE_FILE), {}); return Array.isArray(j.folders) ? j.folders.filter(f => typeof f === 'string') : []; };
export function saveLiveFolders(data, folders) {
  fs.mkdirSync(path.join(data, 'state'), { recursive: true });
  fs.writeFileSync(path.join(data, ...LIVE_FILE), JSON.stringify({ at: Date.now(), folders }, null, 2));
}

// The last clean's report, for the owner and the CTO's wrap-up.
export function saveReport(data, text) {
  fs.mkdirSync(path.join(data, 'state'), { recursive: true });
  fs.writeFileSync(path.join(data, ...REPORT_FILE), `${text}\n`);
}

// The projects of a data folder for the deck command, as the app lists them: projects.json
// entries plus every folder under its scanRoots (by default the data folder's parent, unless
// the data sits in the app's user-data folder, as an installed app's does).
export function projectFolders(data, userData = [process.env.APPDATA, path.join(os.homedir(), 'Library', 'Application Support')]) {
  let cfg = { projects: [] };
  try { cfg = parseProjects(fs.readFileSync(path.join(data, 'projects.json'), 'utf8')); } catch { /* none */ }
  const inUserData = userData.filter(Boolean).some(u => inside(u, data));
  const roots = cfg.scanRoots && cfg.scanRoots.length ? cfg.scanRoots : inUserData ? [] : [path.dirname(data)];
  const folders = [];
  for (const root of roots) {
    try { for (const d of fs.readdirSync(root, { withFileTypes: true })) if (d.isDirectory() && !d.name.startsWith('.')) folders.push({ name: d.name, path: path.join(root, d.name) }); } catch { /* missing */ }
  }
  return mergeProjects(cfg.projects, folders, path.join(data, 'manager'), real);
}

// Folders in the worktree places, so the ones that are no worktree of these repos are listed.
function placeFolders(r, data) {
  const out = [];
  const kids = d => { try { return fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(d, e.name)); } catch { return []; } };
  out.push(...kids(path.join(r.top, '.claude', 'worktrees')), ...kids(path.join(r.top, '.worktrees')));
  // Beside the project: folders named wt-*.
  if (!r.bare) out.push(...kids(path.dirname(r.top)).filter(d => /^wt[-_]/i.test(path.basename(d))));
  out.push(...kids(path.join(data, 'state', 'worktrees')));
  return out;
}
// What a folder there is, for the owner: a clone, a worktree of a repo not listed, or a leftover.
async function otherFolder(d, git) {
  const g = path.join(d, '.git');
  let st = null; try { st = fs.statSync(g); } catch { /* none */ }
  if (st && st.isDirectory()) {
    const s = await git(d, STATUS);
    const n = s.ok ? s.out.split('\n').filter(Boolean).length : 0;
    return `a separate clone with its own .git folder${n ? `, ${plural(n, 'uncommitted or untracked change')}` : ''}`;
  }
  if (st && st.isFile()) {
    let to = ''; try { to = ((fs.readFileSync(g, 'utf8').match(/^gitdir:\s*(.+)$/m) || [])[1] || '').trim(); } catch { /* unreadable */ }
    if (to && fs.existsSync(path.resolve(d, to))) return 'a worktree of a repo FocusShell does not list';
  }
  return 'git no longer tracks it';
}

// What the facts need beyond one worktree: open panes (asked again each time), project
// folders, the worktrees git knows of.
function context({ data, tmp, git, home, projects, inUse, registered }) {
  const usedNow = () => [...new Set((typeof inUse === 'function' ? inUse() : inUse || []).filter(Boolean).map(key))];
  const projectKeys = (projects || []).filter(p => p && p.path).map(p => ({ name: p.name, k: key(p.path) }));
  const dataKey = key(data);
  return {
    data, tmp, git, home,
    isUsed: wt => { const k = key(wt); return usedNow().some(u => u === k || under(u, k)); },
    // A project's folder (or one holding a project, or the data folder) is never removed.
    holdsProject: wt => {
      const k = key(wt);
      const p = projectKeys.find(x => x.k === k || under(x.k, k));
      return p ? p.name : dataKey === k || under(dataKey, k) ? 'FocusShell (its data folder)' : '';
    },
    innerOf: wt => { const k = key(wt); const hit = [...registered.keys()].find(x => under(x, k)); return hit ? registered.get(hit) : ''; },
  };
}

// The facts on one worktree git knows of (r: its repo's top, bases, remotes, objects).
async function factsOf(w, r, ctx) {
  const { git } = ctx;
  const f = { ...w, project: '', top: r.top, place: placeOf(w.path, { top: r.top, data: ctx.data, tmp: ctx.tmp, bare: r.bare }) };
  if (!w.prunable && !fs.existsSync(w.path)) f.prunable = 'its folder is gone';
  if (f.prunable) {
    f.parentGone = !fs.existsSync(path.dirname(w.path));
    f.folderLeft = fs.existsSync(w.path);
    // Its record may be all that holds a detached HEAD's commits.
    if (f.place && !f.locked && !f.parentGone && !f.folderLeft && w.head) {
      const n = await git(r.top, ['rev-list', '--count', w.head, '--not', '--branches', '--tags']);
      f.orphans = n.ok ? Number(n.out.trim()) : 1;
    }
    return f;
  }
  f.project = ctx.holdsProject(w.path);
  if (!f.place || f.locked || f.project) return f;
  f.inUse = ctx.isUsed(w.path);
  f.inner = ctx.innerOf(w.path);
  f.touched = await touchedAt(w.path, git, ctx.home);
  const st = await git(w.path, STATUS);
  if (st.ok && !BLIND.test(st.err)) f.dirty = st.out.split('\n').filter(Boolean).length;
  else f.broken = st.err.split('\n').filter(Boolean).pop() || 'git status failed';
  if (!f.broken) { const h = await hiddenEdits(w.path, git); if (h < 0) f.broken = 'git could not list its files'; else f.hidden = h; }
  // Its own branch is no main line for it, even when it is called main or dev.
  const b = r.bases.filter(ref => !(w.branch && ref === `refs/heads/${w.branch}`));
  f.bases = b.length;
  f.remotes = r.remotes;
  const m = await mergedInto(r.top, w.head, b, git, r.objects);
  f.merged = m && !m.unsure ? m : null;
  f.squashUnsure = (m && m.unsure) || '';
  if (!f.merged) {
    const n = await git(r.top, f.remotes ? ['rev-list', '--count', w.head, '--not', '--remotes'] : ['rev-list', '--count', w.head, '--not', ...b]);
    f.unpushed = n.ok ? Number(n.out.trim()) : 1;
    const on = await git(r.top, ['for-each-ref', '--contains', w.head, '--count=1', '--format=%(refname:short)', 'refs/remotes']);
    f.pushedTo = on.ok ? on.out.trim() : '';
  }
  return f;
}

// Just before a removal: nothing changed since the facts were read, nothing to harm inside.
async function stillSafe(i, ctx) {
  const { git } = ctx;
  if (ctx.isUsed(i.path)) return 'it was opened in a pane while the sweep ran';
  const st = await git(i.path, STATUS);
  if (!st.ok || BLIND.test(st.err) || st.out.trim() || (await hiddenEdits(i.path, git)) !== 0) return 'it changed while the sweep ran';
  const head = await git(i.path, ['rev-parse', 'HEAD']);
  if (!head.ok || head.out.trim() !== i.head) return 'it got new commits while the sweep ran';
  const s = await scanTree(i.path, { sizes: false });
  const risk = riskOf(s);
  if (risk) return risk;
  if (Math.max(await touchedAt(i.path, git, ctx.home), s.newest) > i.touched) return 'it was used while the sweep ran';
  return '';
}

// Removes one worktree its facts allow, checking again first. Sets i.removed or i.remove = false
// with the reason; a folder Windows still holds goes on the pending list for the next clean.
async function removeChecked(i, ctx, pending, keep) {
  const { git } = ctx;
  const listed = async () => parseWorktrees((await git(i.top, ['worktree', 'list', '--porcelain'])).out).some(w => key(w.path) === key(i.path));
  if (i.prunable) {
    // Only this record, never `git worktree prune`, which takes every gone record at once.
    if (fs.existsSync(i.path) || !fs.existsSync(path.dirname(i.path))) { i.remove = false; i.why = 'it changed while the sweep ran'; return; }
    const n = i.head ? await git(i.top, ['rev-list', '--count', i.head, '--not', '--branches', '--tags']) : { ok: true, out: '0' };
    if (!n.ok || Number(n.out.trim())) { i.remove = false; i.why = 'git\'s record of it now holds commits on no branch, so it stays'; return; }
    const rm = await git(i.top, ['worktree', 'remove', i.path]);
    if (await listed()) { i.remove = false; i.error = rm.err.split('\n').pop() || 'git kept it'; return; }
    i.removed = true;
    return;
  }
  const changed = await stillSafe(i, ctx);
  if (changed) { i.remove = false; i.why = changed; return; }
  let held;
  try { held = await heldOpen(i.path); } catch (err) { i.remove = false; i.error = err.message; return; }
  if (held) { i.remove = false; i.busy = true; i.why = 'a program has the folder open'; return; }
  pending.set(key(i.path), { path: i.path, at: Date.now() });
  keep();
  // No --force: git itself refuses a worktree with changes or untracked files.
  const rm = await git(i.top, ['worktree', 'remove', i.path]);
  if (await listed()) { pending.delete(key(i.path)); keep(); i.remove = false; i.error = rm.err.split('\n').pop() || 'git kept it'; return; }
  i.removed = true;
  if (fs.existsSync(i.path)) {
    i.error = 'Windows still holds part of the folder; the next clean tries again';
    pending.set(key(i.path), { path: i.path, at: Date.now() });
  } else pending.delete(key(i.path));
  keep();
  // Its branch goes too when a local and a remote main-line branch hold its work and the
  // branch did not move meanwhile. Main-line branches never go.
  if (i.branch && !BASE_NAMES.test(i.branch)) {
    if (!(i.merged.local && i.merged.remote)) i.branchKept = true;
    else {
      const tip = await git(i.top, ['rev-parse', '--verify', '--quiet', `refs/heads/${i.branch}`]);
      if (tip.ok && tip.out.trim() === i.head) i.branchRemoved = (await git(i.top, ['branch', '-D', i.branch])).ok;
      else i.branchKept = true;
    }
  }
}

// A repo for the facts: its main folder, whether it is bare, its objects, its worktrees, its
// main-line refs and whether it has a remote.
async function repoOf(p, git) {
  const common = await git(p, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!common.ok) return null;
  const list = parseWorktrees((await git(p, ['worktree', 'list', '--porcelain'])).out);
  const r = { top: list[0] ? list[0].path : p, bare: !!(list[0] && list[0].bare), common: key(common.out.trim()), objects: path.join(common.out.trim(), 'objects'), list, items: [] };
  if (list.length > 1) { r.bases = await mainLine(r.top, git); r.remotes = !!(await git(r.top, ['remote'])).out.trim(); }
  return r;
}

// The sweep. projects: [{ name, path }]; data: FocusShell's data folder (its state file and
// lead worktrees); clean: remove the safe ones; inUse: folders of live sessions, or a function
// giving them (asked again just before each removal).
// Returns { repos: [{ project, top, items }], leftovers, retried, pending, now, clean }.
export async function sweep({ projects, data, clean = false, inUse = [], now = Date.now(), git = gitRun,
  home = os.homedir(), tmp = os.tmpdir(), sizes = true } = {}) {
  if (!data) throw new Error('sweep needs the data folder');
  const unlock = clean ? takeLock(data) : null;
  if (clean && !unlock) throw new Error('another worktree clean is running; try again in a few minutes');
  try { return await run(); } finally { if (unlock) unlock(); }

  async function run() {
    const repos = [], seen = new Set();
    for (const p of projects || []) {
      if (!p || !p.path || !fs.existsSync(p.path)) continue;
      const r = await repoOf(p.path, git);
      if (!r || seen.has(r.common)) continue;
      seen.add(r.common);
      repos.push({ project: p.name, ...r });
    }
    const registered = new Map(repos.flatMap(r => r.list.map(w => [key(w.path), w.path])));
    const ctx = context({ data, tmp, git, home, projects, inUse, registered });

    // Facts and verdicts.
    const items = await pool(repos.flatMap(r => r.list.slice(1).map(w => ({ r, w }))), 6, async ({ r, w }) => {
      const f = await factsOf(w, r, ctx);
      return Object.assign(f, verdict(f, now));
    });
    // Walk each worktree still on disk: its size, and for one that may go, what git's removal
    // would harm there and whether anything in it changed within the day.
    await pool(items.filter(i => !i.prunable && fs.existsSync(i.path) && (sizes || i.remove)), 4, async i => {
      const s = await scanTree(i.path, { sizes });
      if (sizes) i.size = s.size;
      if (i.remove) {
        Object.assign(i, { inner: s.nested, linkOut: s.linkOut, blocked: s.blocked, touched: Math.max(i.touched, s.newest) });
        Object.assign(i, verdict(i, now));
      }
    });
    for (const r of repos) r.items = items.filter(i => i.top === r.top);

    // Other folders in the worktree places. Folders a clean was removing when Windows held
    // them are listed apart, as waiting.
    const st = sweepState(data);
    const pending = new Map((st.pending || []).filter(e => e && e.path).map(e => [key(e.path), { path: path.resolve(e.path), at: Number(e.at) || 0 }]));
    const leftovers = [];
    const looked = new Set();
    for (const r of repos) {
      for (const d of placeFolders(r, data)) {
        const k = key(d);
        if (looked.has(k) || registered.has(k) || pending.has(k)) continue;
        looked.add(k);
        leftovers.push({ path: path.resolve(d), project: inside(path.join(data, 'state', 'worktrees'), d) ? '' : r.project, what: await otherFolder(d, git) });
      }
    }
    if (sizes) await pool(leftovers, 4, async l => { l.size = (await scanTree(l.path)).size; });

    const retried = [];
    if (clean) {
      const keep = () => saveState(data, { ...st, pending: [...pending.values()] });
      // Folders this sweep was removing when Windows held them: try again, unless git took the
      // path back, anything in it is newer than the try, or it now holds a repository, a link
      // out or a project (then it is listed and stays).
      for (const [k, e] of [...pending]) {
        if (!fs.existsSync(e.path) || registered.has(k)) { pending.delete(k); continue; }
        const s = await scanTree(e.path, { sizes: false });
        if (s.newest > e.at || riskOf(s) || ctx.holdsProject(e.path) || fs.existsSync(path.join(e.path, '.git'))) { pending.delete(k); leftovers.push({ path: e.path, project: '', what: 'a folder a clean was removing, changed since, so it stays' }); continue; }
        try { await fsp.rm(e.path, { recursive: true, force: true, maxRetries: 3 }); pending.delete(k); retried.push({ path: e.path, removed: true }); }
        catch (err) { retried.push({ path: e.path, removed: false, error: err.code || err.message }); }
      }
      keep();
      for (const i of items.filter(x => x.remove)) await removeChecked(i, ctx, pending, keep);
      saveState(data, { ...st, pending: [...pending.values()], last: now });
    }
    return { repos, leftovers, retried, pending: [...pending.values()].map(e => e.path), now, clean };
  }
}

// A lead's removal of a worktree it made, once its work is merged: every check of the sweep
// except the day of idling, and never an extra lead's worktree (the app removes those).
// Returns { removed, out } with one line for the lead.
export async function removeOne({ dir, data, projects = projectFolders(data), inUse = () => liveFolders(data), git = gitRun,
  home = os.homedir(), tmp = os.tmpdir() } = {}) {
  const abs = path.resolve(String(dir || ''));
  const kept = why => ({ removed: false, out: `Kept ${abs}: ${why}.` });
  if (!dir || !fs.existsSync(abs)) return { removed: false, out: `No folder at ${abs}.` };
  if (inside(path.join(data, 'state', 'worktrees'), abs)) return kept("it is an extra lead's worktree, which FocusShell removes when that lead's pane closes");
  const unlock = takeLock(data);
  if (!unlock) return kept('a worktree clean is running; try again in a few minutes');
  try {
    const r = await repoOf(abs, git);
    const w = r && r.list.slice(1).find(x => key(x.path) === key(abs));
    if (!w) return kept('it is not a linked worktree of a git repository (a repository\'s main folder is never removed)');
    const ctx = context({ data, tmp, git, home, projects, inUse, registered: new Map(r.list.map(x => [key(x.path), x.path])) });
    const f = await factsOf(w, r, ctx);
    const v = verdict({ ...f, touched: 0 });
    if (!v.remove) return kept(v.why);
    const s = await scanTree(abs, { sizes: false });
    if (riskOf(s)) return kept(riskOf(s));
    f.touched = Math.max(f.touched, s.newest);
    Object.assign(f, v);
    const st = sweepState(data);
    const pending = new Map((st.pending || []).filter(e => e && e.path).map(e => [key(e.path), { path: path.resolve(e.path), at: Number(e.at) || 0 }]));
    const keep = () => saveState(data, { ...st, pending: [...pending.values()] });
    await removeChecked(f, ctx, pending, keep);
    if (!f.removed) return kept(f.why && f.why !== v.why ? f.why : f.error || f.why);
    const branch = !f.branch ? '' : f.branchRemoved ? ` and its branch ${f.branch}` : `; its branch ${f.branch} stays (its work is not yet in both a local and a pushed main-line branch)`;
    return { removed: true, out: `Removed ${abs}${branch}.${f.error ? ` ${f.error}.` : ''}` };
  } finally { unlock(); }
}

// The app's removal of an extra lead's worktree when its pane closes: '' when it may go, else
// why not. Clean, its branch and its HEAD merged into the project's current branch, and
// nothing in it that git's removal would harm.
export async function leadWorktreeRisk({ dir, projPath, project, branch, git = gitRun }) {
  const st = await git(dir, STATUS);
  if (!st.ok || BLIND.test(st.err)) return `git could not read all of ${dir} (${st.err.split('\n').filter(Boolean).pop() || 'git status failed'})`;
  if (st.out.trim()) return `${dir} has uncommitted changes`;
  if (!(await git(projPath, ['merge-base', '--is-ancestor', branch, 'HEAD'])).ok) return `branch ${branch} has commits not merged into ${project}'s current branch`;
  const head = await git(dir, ['rev-parse', 'HEAD']);
  if (!head.ok || !(await git(projPath, ['merge-base', '--is-ancestor', head.out.trim(), 'HEAD'])).ok) return `its HEAD has commits not merged into ${project}'s current branch`;
  const h = await hiddenEdits(dir, git);
  if (h) return h < 0 ? 'git could not list its files' : `${plural(h, 'file')} with changes git is told to ignore`;
  return riskOf(await scanTree(dir, { sizes: false }));
}

// The sweep as text, one line per worktree, for the deck command and the app's report file.
export function report(res) {
  const { repos, leftovers, retried, now, clean } = res;
  const size = i => (i.size != null ? `  ${fmtSize(i.size)}` : '');
  const lines = [];
  const items = repos.flatMap(r => r.items);
  const removed = items.filter(i => i.removed), toRemove = items.filter(i => i.remove && !i.removed);
  const kept = items.filter(i => !i.remove);
  for (const r of repos.filter(x => x.items.length)) {
    lines.push('', `${r.project} (${r.top})`);
    for (const i of r.items) {
      const what = i.removed ? 'removed' : i.remove ? 'remove ' : 'keep   ';
      const br = i.branch ? `  [${i.branch}]` : i.detached ? '  [detached]' : '';
      const extra = [i.branchRemoved ? 'branch deleted too' : '', i.branchKept ? 'branch kept: its work is not yet in both a local and a pushed main-line branch' : '', i.error || ''].filter(Boolean).join('; ');
      lines.push(`  ${what} ${i.path}${br}${size(i)}  ${i.why}${extra ? ` (${extra})` : ''}`);
    }
  }
  if (leftovers.length) {
    lines.push('', 'Other folders where worktrees go (never removed; check them yourself):');
    for (const l of leftovers) lines.push(`  ${l.path}${size(l)}  ${l.what}${l.project ? ` (${l.project})` : ''}`);
  }
  if (retried.length || (!clean && res.pending.length)) lines.push('', 'Folders a clean was removing when Windows held them (the next clean tries again):');
  for (const r of retried) lines.push(`  ${r.removed ? 'removed' : 'still held'} ${r.path}`);
  if (!clean) for (const p of res.pending) lines.push(`  waiting  ${p}`);
  const sum = list => list.reduce((n, i) => n + (i.size || 0), 0);
  const total = [
    clean ? `${plural(removed.length, 'worktree')} removed${removed.length ? ` (${fmtSize(sum(removed))} freed)` : ''}` : `${plural(toRemove.length, 'worktree')} safe to remove (${fmtSize(sum(toRemove))})`,
    `${kept.length} kept (${fmtSize(sum(kept))})`,
    `${plural(leftovers.length, 'other folder')} (${fmtSize(sum(leftovers))})`,
  ].join(', ');
  const d = new Date(now), p = n => String(n).padStart(2, '0');
  const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  const head = `Worktrees on ${when}: ${total}.`;
  const tail = clean || !toRemove.length ? [] : ['', CLEAN_ON ? `The app's daily clean removes the ${toRemove.length} safe ones.` : 'Removing worktrees is switched off for now (#2726), so nothing is removed.'];
  return [head, ...lines, ...tail].join('\n');
}
