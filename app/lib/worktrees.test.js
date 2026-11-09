// The worktree sweep (#2726). Run through lib.test.js. The sweep tests make throwaway repos
// (one with a remote) in the temp folder, one worktree per case, and delete it all afterwards.
// Files cannot be made older (their creation and change times are always now), so the sweeps
// run as if three days later and a case that must look recent gets a time in that future.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { parseWorktrees, placeOf, verdict, sweep, report, removeOne, leadWorktreeRisk, removalRisk, folderSize, fmtSize, gitRun,
  lastReflogTime, saveLiveFolders, liveFolders, CLEAN_ON, DAY_MS } from './worktrees.js';
import { registerWorktreeSweep } from '../worktree-sweep.js';

test('parseWorktrees: paths, branches, detached, bare, locked and prunable (#2726)', () => {
  const list = parseWorktrees([
    'worktree D:/p/repo', 'bare', '',
    'worktree D:/p/repo/.worktrees/x', 'HEAD bbb', 'branch refs/heads/feat/x', 'locked busy', '',
    'worktree D:/p/wt-y', 'HEAD ccc', 'detached', 'prunable gitdir file points to non-existent location', '',
  ].join('\n'));
  assert.equal(list.length, 3);
  assert.equal(list[0].bare, true);
  assert.equal(list[1].branch, 'feat/x');
  assert.equal(list[1].locked, 'busy');
  assert.equal(list[2].detached, true);
  assert.match(list[2].prunable, /non-existent/);
  assert.equal(list[1].path, path.resolve('D:/p/repo/.worktrees/x'));
});

test('placeOf: only where leads and agents make worktrees (#2726)', () => {
  const root = path.join(os.tmpdir(), 'place-check'), top = path.join(root, 'proj'), data = path.join(root, 'deck');
  const at = (p, bare) => placeOf(p, { top, data, tmp: os.tmpdir(), bare });
  assert.match(at(path.join(data, 'state', 'worktrees', 'proj-2')), /lead worktrees/);
  assert.match(at(path.join(top, '.claude', 'worktrees', 'agent-1')), /agent worktrees/);
  assert.match(at(path.join(top, '.worktrees', 'x')), /\.worktrees/);
  assert.match(at(path.join(root, 'wt-123')), /beside/);
  assert.equal(at(path.join(root, 'qa-local')), '', 'beside the project only as wt-*');
  assert.equal(at(path.join(root, 'wt-123'), true), '', "a bare repo's checkouts beside it are its own");
  assert.match(at(path.join(os.tmpdir(), 'claude', 'D--x', 'abc', 'scratchpad', 'fx')), /scratchpad/);
  assert.equal(at(path.join(top, '.astro', 'editor-main')), '', "a tool's own copy inside the project");
  assert.equal(at(path.join(top, '.git', 'rel-wt')), '');
});

test('verdict: kept unless clean, merged, idle, free and in a lead or agent place (#2726)', () => {
  const now = Date.now(), old = now - 3 * DAY_MS;
  const ok = { place: 'x', dirty: 0, touched: old, merged: { base: 'origin/main', how: 'merged' }, bases: 2, remotes: true };
  assert.deepEqual(verdict(ok, now).remove, true);
  assert.match(verdict(ok, now).why, /clean, its work is in origin\/main, last used 3 days ago/);
  assert.match(verdict({ ...ok, merged: { base: 'origin/QA', how: 'squashed' } }, now).why, /its changes are in origin\/QA/);
  const keep = (f, why) => { const v = verdict({ ...ok, ...f }, now); assert.equal(v.remove, false, why.source); assert.match(v.why, why); };
  keep({ locked: 'busy' }, /locked in git \(busy\)/);
  keep({ place: '' }, /not where leads or agents make worktrees/);
  keep({ inUse: true }, /open in an FocusShell pane/);
  keep({ busy: true }, /a program has the folder open/);
  keep({ broken: 'fatal: bad' }, /git could not read it/);
  keep({ dirty: 2 }, /2 uncommitted or untracked changes/);
  keep({ touched: now - 3600e3 * 5 }, /used 5 hours ago/);
  keep({ merged: null, unpushed: 3 }, /3 commits on no remote and not merged/);
  keep({ merged: null, unpushed: 1, remotes: false }, /1 commit not merged/);
  keep({ merged: null, unpushed: 0, pushedTo: 'origin/feat' }, /pushed to origin\/feat but not merged yet \(may have an open PR\)/);
  keep({ merged: null, bases: 0 }, /no main, master, QA or Develop branch/);
  keep({ project: 'Pebble' }, /it is the folder of the FocusShell project Pebble/);
  keep({ inner: 'D:\\p\\.worktrees\\a\\.worktrees\\b' }, /another worktree or repository is inside it/);
  keep({ blocked: 'D:\\p\\x' }, /part of it could not be read/);
  keep({ hidden: 1 }, /1 file with changes git is told to ignore/);
  keep({ linkOut: 'D:\\p\\node_modules' }, /holds a link to D:\\p\\node_modules, outside it/);
  keep({ detached: true }, /detached, and only origin\/main, a remote ref that may be out of date/);
  assert.equal(verdict({ ...ok, detached: true, merged: { base: 'origin/main', how: 'merged', local: true } }, now).remove, true, 'a local branch holds it');
  // A folder that is gone: only git's record goes, and only from a lead or agent place.
  assert.equal(verdict({ prunable: 'gone', place: 'x' }, now).remove, true, 'only git\'s record is left');
  assert.match(verdict({ prunable: 'gone', place: 'x', folderLeft: true }, now).why, /the folder and git's record of it stay/);
  assert.equal(verdict({ prunable: 'gone', place: '' }, now).remove, false, 'elsewhere: record stays');
  assert.match(verdict({ prunable: 'gone', place: 'x', parentGone: true }, now).why, /drive not connected/);
  assert.match(verdict({ prunable: 'gone', place: 'x', orphans: 2 }, now).why, /all that holds 2 commits on no branch/);
  assert.equal(verdict({ prunable: 'gone', place: 'x', locked: 'usb' }, now).remove, false, 'git never prunes a locked one');
});

test('folderSize: every file counted while many folders are read at once (#2726)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wtsize-'));
  try {
    let want = 0;
    for (let d = 0; d < 30; d++) for (let f = 0; f < 20; f++) {
      const n = (d * 20 + f) % 97 + 1;
      fs.mkdirSync(path.join(root, `d${d}`, 'sub'), { recursive: true });
      fs.writeFileSync(path.join(root, `d${d}`, f % 2 ? 'sub' : '', `f${f}.txt`), 'x'.repeat(n));
      want += n;
    }
    assert.equal(await folderSize(root), want);
    assert.equal(fmtSize(4314391991), '4.3 GB');
    assert.equal(fmtSize(704e6), '704 MB');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('lastReflogTime: the time inside the last entry, not the file time git housekeeping changes (#2726)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wtreflog-'));
  try {
    const f = path.join(dir, 'HEAD');
    fs.writeFileSync(f, [
      `${'0'.repeat(40)} ${'a'.repeat(40)} T <t@t> 1700000000 +0400\tcommit (initial): start`,
      `${'a'.repeat(40)} ${'b'.repeat(40)} T <t@t> 1760000000 -0500\tcommit: more`, ''].join('\n'));
    assert.equal(lastReflogTime(f), 1760000000 * 1000);
    fs.writeFileSync(f, `${'0'.repeat(40)} ${'a'.repeat(40)} T <t@t> 1750000000 +0400\n`);
    assert.equal(lastReflogTime(f), 1750000000 * 1000, 'a new worktree\'s first entry has no message');
    fs.writeFileSync(f, 'not a reflog\n');
    assert.equal(lastReflogTime(f), fs.statSync(f).mtimeMs, 'unreadable: its file time');
    assert.equal(lastReflogTime(path.join(dir, 'none')), 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: ENV, windowsHide: true });
const put = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const link = (target, at) => fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
const setTime = (p, t) => fs.utimesSync(p, new Date(t), new Date(t));
const tempRoot = name => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), name)));
// A repo with one commit on main, and with a remote when asked.
function makeRepo(root, { remote = false } = {}) {
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  g(repo, 'init', '-q', '-b', 'main');
  put(path.join(repo, '.gitignore'), 'node_modules/\nvendor/\n.worktrees/\n');
  put(path.join(repo, 'a.txt'), 'a\n');
  g(repo, 'add', '.'); g(repo, 'commit', '-qm', 'start');
  if (remote) {
    g(root, 'init', '-q', '--bare', '-b', 'main', 'remote.git');
    g(repo, 'remote', 'add', 'origin', path.join(root, 'remote.git'));
    g(repo, 'push', '-q', '-u', 'origin', 'main');
  }
  return repo;
}

test('sweep: removes only clean, merged, idle worktrees where leads and agents make them (#2726)', async () => {
  const root = tempRoot('wtsweep-');
  const data = path.join(root, 'deck'), home = path.join(root, 'home');
  let held = null;
  try {
    fs.mkdirSync(home);
    const repo = makeRepo(root, { remote: true });
    // A repo that hides untracked files: git worktree remove would then delete them.
    g(repo, 'config', 'status.showUntrackedFiles', 'no');

    const dirs = {};
    const add = (name, where = path.join(repo, '.worktrees', name), branch = name) => { g(repo, 'worktree', 'add', '-q', '-b', branch, where, 'main'); dirs[name] = where; return where; };
    const commit = (dir, file, msg) => { put(path.join(dir, file), `${msg}\n`); g(dir, 'add', '.'); g(dir, 'commit', '-qm', msg); };
    for (const n of ['merged', 'squashed', 'dirty', 'untracked', 'unpushed', 'pushed', 'locked', 'recent', 'fresh', 'inuse', 'gone', 'held',
      'racer', 'raceFile', 'raceLink', 'raceTouch', 'racePane', 'raceSkip', 'junction', 'innerlink', 'nestA', 'cloneIn', 'danglingOut', 'skip',
      'remoteonly', 'localonly', 'squndo', 'longUntracked', 'longIgnored', 'blind', 'halfgone']) add(n);
    add('copy', path.join(repo, 'tools', 'copy'));
    add('lead', path.join(data, 'state', 'worktrees', 'Proj-2'), 'lead-2');
    add('beside', path.join(root, 'wt-beside'));
    add('ownmain', path.join(repo, '.worktrees', 'ownmain'), 'dev'); // its own branch is a main-line name
    add('isproject', path.join(root, 'ProjB')); // another FocusShell project's folder

    commit(dirs.merged, 'm.txt', 'merged work');
    put(path.join(dirs.merged, 'node_modules', 'x.js'), 'ignored build output\n');
    // A package that ships a .git file pointing to its author's machine: no repository here.
    put(path.join(dirs.merged, 'node_modules', 'pkg', '.git'), 'gitdir: /Users/someone/_git/pkg/.git/worktrees/x\n');
    g(repo, 'merge', '-q', '--ff-only', 'merged');
    commit(dirs.squashed, 's1.txt', 'squash one');
    commit(dirs.squashed, 's2.txt', 'squash two');
    g(repo, 'merge', '-q', '--squash', 'squashed'); g(repo, 'commit', '-qm', 'squashed PR');
    // Squash-merged, then a later commit on the branch takes back part of it (a debug line):
    // a trial merge changes nothing, yet that commit is work only the branch holds.
    put(path.join(dirs.squndo, 'a.txt'), 'a\ndebug\n'); commit(dirs.squndo, 'feat.txt', 'feature with a debug line');
    g(repo, 'merge', '-q', '--squash', 'squndo'); g(repo, 'commit', '-qm', 'squndo PR');
    put(path.join(dirs.squndo, 'a.txt'), 'a\n'); g(dirs.squndo, 'commit', '-qam', 'take the debug line out');
    g(repo, 'push', '-q', 'origin', 'main');
    // Paths over 260 characters: git on Windows sees them only with core.longpaths.
    const deep = path.join('a'.repeat(120), 'b'.repeat(120), 'notes.txt');
    put(path.join(dirs.longUntracked, 'notes', deep), 'untracked work at a long path\n');
    put(path.join(dirs.longIgnored, 'node_modules', deep), 'ignored build output at a long path\n');
    // Merged into local main only, never pushed: the worktree may go, its branch stays.
    commit(dirs.localonly, 'l.txt', 'local only');
    g(repo, 'merge', '-q', '--no-ff', '--no-edit', 'localonly');
    put(path.join(dirs.dirty, 'a.txt'), 'changed\n');
    put(path.join(dirs.untracked, 'new.txt'), 'new\n');
    assert.equal(g(dirs.untracked, 'status', '--porcelain'), '', 'git status hides it here, as git worktree remove would');
    commit(dirs.unpushed, 'u.txt', 'unpushed work');
    commit(dirs.ownmain, 'o.txt', 'work on its own dev branch');
    commit(dirs.pushed, 'p.txt', 'pushed work');
    g(dirs.pushed, 'push', '-q', 'origin', 'pushed');
    g(repo, 'worktree', 'lock', '--reason', 'testing', dirs.locked);
    fs.rmSync(dirs.gone, { recursive: true, force: true });
    // A gone record whose commit only its branch holds; the branch is deleted while the clean
    // runs, so the record is then all that holds it.
    add('zgone');
    commit(dirs.zgone, 'z.txt', 'held by its branch');
    fs.rmSync(dirs.zgone, { recursive: true, force: true });

    // An ignored node_modules that is a junction to a folder outside the worktree: git's removal
    // would empty that folder. One that points inside the worktree is harmless.
    put(path.join(root, 'outside-modules', 'keep.txt'), 'not the worktree\'s\n');
    link(path.join(root, 'outside-modules'), path.join(dirs.junction, 'node_modules'));
    put(path.join(dirs.innerlink, 'vendor', 'lib.js'), 'its own\n');
    link(path.join(dirs.innerlink, 'vendor'), path.join(dirs.innerlink, 'node_modules'));
    // A worktree made inside another (ignored there), with work in progress; a separate clone
    // inside one; and a .git file pointing nowhere outside any package folder (a worktree whose
    // repository is on a drive not connected).
    add('nestB', path.join(dirs.nestA, '.worktrees', 'nestB'));
    put(path.join(dirs.nestB, 'a.txt'), 'work in progress\n');
    put(path.join(dirs.cloneIn, 'vendor', 'lib', 'x.txt'), 'x\n');
    g(path.join(dirs.cloneIn, 'vendor', 'lib'), 'init', '-q');
    put(path.join(dirs.danglingOut, 'vendor', 'b2', '.git'), 'gitdir: Z:\\elsewhere\\repo\\.git\\worktrees\\b2\n');
    put(path.join(dirs.danglingOut, 'vendor', 'b2', 'work.txt'), 'its work in progress\n');
    // A local edit git is told to ignore (as is done for local settings files).
    g(dirs.skip, 'update-index', '--skip-worktree', 'a.txt');
    put(path.join(dirs.skip, 'a.txt'), 'local secret setting\n');
    assert.equal(g(dirs.skip, 'status', '--porcelain', '--untracked-files=normal'), '', 'git status does not show it');
    // Work only in origin/dev, a remote ref that could be out of date.
    commit(dirs.remoteonly, 'r.txt', 'remote only');
    g(dirs.remoteonly, 'push', '-q', 'origin', 'remoteonly:dev');
    // Two detached worktrees: one on a commit in main, one on a commit only in origin/qa. And
    // one whose commit is on no branch, whose folder goes while the clean runs.
    dirs.tmpqa = path.join(repo, '.worktrees', 'tmpqa');
    g(repo, 'worktree', 'add', '-q', '-b', 'tmpqa', dirs.tmpqa, 'origin/main'); // not local main, which holds "localonly"
    commit(dirs.tmpqa, 'q.txt', 'qa only');
    g(dirs.tmpqa, 'push', '-q', 'origin', 'tmpqa:qa');
    g(repo, 'worktree', 'remove', dirs.tmpqa); g(repo, 'branch', '-q', '-D', 'tmpqa'); delete dirs.tmpqa;
    for (const [n, at] of [['detlocal', 'main'], ['detremote', 'origin/qa'], ['lateGone', 'origin/main']]) { dirs[n] = path.join(repo, '.worktrees', n); g(repo, 'worktree', 'add', '-q', '--detach', dirs[n], at); }
    commit(dirs.lateGone, 'late.txt', 'on no branch');
    // A worktree git can no longer find (its record lost the file naming its folder): never pruned.
    add('noGitdir');
    fs.rmSync(path.join(repo, '.git', 'worktrees', 'noGitdir', 'gitdir'));
    delete dirs.noGitdir;
    // Folders there that are no worktree.
    put(path.join(repo, '.worktrees', 'leftover', 'notes.txt'), 'git no longer knows this folder\n');
    put(path.join(repo, '.worktrees', 'aclone', 'notes.txt'), 'a clone, not a worktree\n');
    g(path.join(repo, '.worktrees', 'aclone'), 'init', '-q');

    // The sweep runs three days from now. Git's housekeeping rewrites every worktree's reflog
    // file, giving it a fresh file time: no sign of use. "recent" ran a git command an hour ago
    // (its HEAD file says so); "fresh" had an ignored file written ten minutes ago.
    const now = Date.now() + 3 * DAY_MS;
    for (const id of fs.readdirSync(path.join(repo, '.git', 'worktrees'))) {
      const f = path.join(repo, '.git', 'worktrees', id, 'logs', 'HEAD');
      if (fs.existsSync(f)) setTime(f, now - 60e3);
    }
    setTime(path.join(repo, '.git', 'worktrees', 'recent', 'HEAD'), now - 3600e3);
    put(path.join(dirs.fresh, 'node_modules', 'devdb.sqlite'), 'a local database\n');
    setTime(path.join(dirs.fresh, 'node_modules', 'devdb.sqlite'), now - 600e3);

    const projects = [{ name: 'Proj', path: repo }, { name: 'ProjB', path: dirs.isproject }];
    const panes = new Set([dirs.inuse]);
    // "blind": git status exits fine but warns it could not open a folder.
    const blindGit = (cwd, args, o) => (args[1] === 'status' && path.resolve(cwd) === path.resolve(dirs.blind)
      ? Promise.resolve({ ok: true, out: '', err: "warning: could not open directory 'deep/': Permission denied" }) : gitRun(cwd, args, o));
    const opts = { projects, data, home, now, inUse: () => [...panes], git: blindGit };
    const want = {
      merged: [true, /its work is in origin\/main/], squashed: [true, /its changes are in origin\/main/],
      dirty: [false, /1 uncommitted/], untracked: [false, /1 uncommitted or untracked change/],
      unpushed: [false, /1 commit on no remote and not merged/], pushed: [false, /pushed to origin\/pushed but not merged yet/],
      locked: [false, /locked in git \(testing\)/], recent: [false, /used 1 hour ago/], fresh: [false, /used minutes ago/],
      inuse: [false, /open in an FocusShell pane/], gone: [true, /folder is gone/], zgone: [true, /folder is gone/], held: [true, /clean/], copy: [false, /not where leads or agents/],
      lead: [true, /clean/], beside: [true, /clean/], ownmain: [false, /1 commit on no remote and not merged/],
      isproject: [false, /the folder of the FocusShell project ProjB/],
      junction: [false, /holds a link to .*outside-modules, outside it/], innerlink: [true, /clean/],
      nestA: [false, /another worktree or repository is inside it/], nestB: [false, /1 uncommitted/],
      cloneIn: [false, /another worktree or repository is inside it/], danglingOut: [false, /another worktree or repository is inside it/],
      skip: [false, /1 file with changes git is told to ignore/],
      remoteonly: [true, /its work is in origin\/dev/], localonly: [true, /its work is in main/], detlocal: [true, /clean/],
      detremote: [false, /detached, and only origin\/qa, a remote ref that may be out of date/],
      lateGone: [false, /1 commit on no remote and not merged/],
      squndo: [false, /look squash-merged into (origin\/)?main, but files it changed are different there now/],
      longUntracked: [false, /1 uncommitted or untracked change/], longIgnored: [true, /clean/],
      blind: [false, /git could not read it \(.*could not open directory/], halfgone: [true, /clean/],
      racer: [true, /clean/], raceFile: [true, /clean/], raceLink: [true, /clean/], raceTouch: [true, /clean/], racePane: [true, /clean/],
      raceSkip: [true, /clean/],
    };
    const objects = () => fs.readdirSync(path.join(repo, '.git', 'objects')).filter(d => /^[0-9a-f]{2}$/.test(d)).reduce((n, d) => n + fs.readdirSync(path.join(repo, '.git', 'objects', d)).length, 0);
    const objectsBefore = objects();
    const byName = res => Object.fromEntries(res.repos[0].items.map(i => [Object.keys(dirs).find(n => path.resolve(dirs[n]) === i.path), i]));

    // Listing only: every verdict as expected, nothing touched.
    const listed = await sweep(opts);
    const items = byName(listed);
    for (const [n, [remove, why]] of Object.entries(want)) {
      assert.ok(items[n], `${n} is listed`);
      assert.equal(items[n].remove, remove, `${n}: ${items[n].why}`);
      assert.match(items[n].why, why, n);
    }
    assert.ok(items.merged.size > 0, 'sizes measured');
    const others = Object.fromEntries(listed.leftovers.map(l => [path.basename(l.path), l.what]));
    assert.deepEqual(Object.keys(others).sort(), ['aclone', 'leftover', 'noGitdir']);
    assert.match(others.aclone, /a separate clone with its own \.git folder, 1 uncommitted or untracked change/);
    assert.match(others.leftover, /git no longer tracks it/);
    for (const [n, d] of Object.entries(dirs)) if (n !== 'gone' && n !== 'zgone') assert.ok(fs.existsSync(d), `${n} still there after a listing`);
    assert.equal(objects(), objectsBefore, 'a listing writes no new objects into the repo, not even the trial merges');
    assert.match(report(listed), /safe to remove/);

    // A program working in "held" (Windows only refuses to rename such a folder).
    if (process.platform === 'win32') {
      held = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { cwd: dirs.held, stdio: 'ignore' });
      await new Promise(r => setTimeout(r, 500));
    }

    // While the clean runs, between a worktree's facts and its removal: "racer" gets a commit,
    // "raceFile" an untracked file, "raceLink" a junction out, "raceTouch" a fresh ignored file,
    // "racePane" a pane, and "lateGone" loses its folder. Each happens at a git status in that
    // worktree: the first is the facts', the second the last check's.
    const races = {
      racer: [2, () => commit(dirs.racer, 'late.txt', 'late work')],
      raceFile: [2, () => put(path.join(dirs.raceFile, 'new.txt'), 'new\n')],
      raceLink: [2, () => link(path.join(root, 'outside-modules'), path.join(dirs.raceLink, 'node_modules'))],
      raceTouch: [2, () => put(path.join(dirs.raceTouch, 'node_modules', 'cache.bin'), 'written now\n')],
      racePane: [1, () => panes.add(dirs.racePane)],
      raceSkip: [2, () => { g(dirs.raceSkip, 'update-index', '--skip-worktree', 'a.txt'); put(path.join(dirs.raceSkip, 'a.txt'), 'hidden edit\n'); }],
      merged: [2, () => fs.rmSync(dirs.lateGone, { recursive: true, force: true })],
    };
    const statusCalls = {};
    let removals = 0;
    const git = async (cwd, args, o) => {
      const n = Object.keys(races).find(k => path.resolve(cwd) === path.resolve(dirs[k]));
      if (args[1] === 'status' && n && (statusCalls[n] = (statusCalls[n] || 0) + 1) === races[n][0]) races[n][1]();
      // At the first removal, before any gone record is reached: "zgone" loses its branch.
      if (args[0] === 'worktree' && args[1] === 'remove' && ++removals === 1) g(repo, 'update-ref', '-d', 'refs/heads/zgone');
      const res = await blindGit(cwd, args, o);
      // "halfgone": git lets go of it but Windows keeps a file it could not delete.
      if (args[0] === 'worktree' && args[1] === 'remove' && path.resolve(args[2]) === path.resolve(dirs.halfgone)) put(path.join(dirs.halfgone, 'locked.bin'), 'held\n');
      return res;
    };
    const cleaned = await sweep({ ...opts, clean: true, git });
    const after = byName(cleaned);
    for (const n of ['merged', 'squashed', 'lead', 'beside', 'innerlink', 'remoteonly', 'localonly', 'detlocal', 'longIgnored']) {
      assert.equal(after[n].removed, true, `${n} removed: ${after[n].why} ${after[n].error || ''}`);
      assert.ok(!fs.existsSync(dirs[n]), `${n} folder gone`);
    }
    assert.equal(after.halfgone.removed, true);
    assert.match(after.halfgone.error, /Windows still holds part of the folder; the next clean tries again/);
    const race = { racer: /new commits while the sweep ran/, raceFile: /changed while the sweep ran/, raceLink: /holds a link to/,
      raceTouch: /used while the sweep ran/, racePane: /opened in a pane while the sweep ran/, raceSkip: /changed while the sweep ran/ };
    for (const [n, why] of Object.entries(race)) {
      assert.equal(after[n].remove, false, `${n}: ${after[n].why}`);
      assert.match(after[n].why, why, n);
      assert.ok(fs.existsSync(dirs[n]), `${n} kept`);
    }
    const branches = g(repo, 'branch', '--format=%(refname:short)').split('\n').filter(Boolean);
    for (const b of ['merged', 'squashed', 'lead-2', 'beside', 'innerlink']) assert.ok(!branches.includes(b), `branch ${b} deleted`);
    for (const b of ['main', 'unpushed', 'pushed', 'dirty', 'gone', 'racer', 'dev', 'remoteonly', 'localonly']) assert.ok(branches.includes(b), `branch ${b} kept`);
    assert.equal(after.remoteonly.branchKept, true, 'only a remote ref holds its work, so its branch stays');
    assert.equal(after.localonly.branchKept, true, 'only local main holds its work, so its branch stays');
    assert.match(report(cleaned), /branch kept: its work is not yet in both a local and a pushed main-line branch/);
    const list = g(repo, 'worktree', 'list', '--porcelain');
    assert.ok(!/[\\/]gone\b/.test(list), "gone's record removed");
    assert.ok(/[\\/]lateGone\b/.test(list), 'a record that went while the clean ran stays (no repo-wide prune)');
    assert.ok(/[\\/]zgone\b/.test(list), 'a gone record that became all that holds a commit stays');
    assert.match(after.zgone.why, /now holds commits on no branch/);
    assert.ok(fs.existsSync(path.join(repo, '.git', 'worktrees', 'noGitdir')), 'a record git cannot place is never pruned');
    for (const n of ['dirty', 'untracked', 'unpushed', 'pushed', 'locked', 'recent', 'fresh', 'inuse', 'copy', 'ownmain', 'isproject',
      'junction', 'nestA', 'nestB', 'cloneIn', 'danglingOut', 'skip', 'detremote', 'squndo', 'longUntracked', 'blind']) assert.ok(fs.existsSync(dirs[n]), `${n} kept`);
    assert.ok(fs.existsSync(path.join(dirs.longUntracked, 'notes', deep)), 'untracked work at a long path untouched');
    assert.ok(g(repo, 'branch', '--list', 'squndo').trim(), 'the squash-merged branch with later work stays');
    assert.equal(fs.readFileSync(path.join(dirs.dirty, 'a.txt'), 'utf8'), 'changed\n', 'uncommitted work untouched');
    assert.equal(fs.readFileSync(path.join(dirs.untracked, 'new.txt'), 'utf8'), 'new\n', 'a hidden untracked file untouched');
    assert.equal(fs.readFileSync(path.join(root, 'outside-modules', 'keep.txt'), 'utf8'), 'not the worktree\'s\n', 'the folder a junction points to untouched');
    assert.equal(fs.readFileSync(path.join(dirs.nestB, 'a.txt'), 'utf8'), 'work in progress\n', 'the worktree inside another untouched');
    assert.ok(fs.existsSync(path.join(dirs.cloneIn, 'vendor', 'lib', '.git')), 'the clone inside untouched');
    assert.ok(fs.existsSync(path.join(dirs.danglingOut, 'vendor', 'b2', 'work.txt')), 'a worktree of a repo out of reach untouched');
    assert.equal(fs.readFileSync(path.join(dirs.skip, 'a.txt'), 'utf8'), 'local secret setting\n', 'an edit git is told to ignore untouched');
    assert.ok(fs.existsSync(path.join(dirs.fresh, 'node_modules', 'devdb.sqlite')), 'a file in use untouched');
    assert.ok(fs.existsSync(path.join(repo, '.worktrees', 'leftover', 'notes.txt')), 'leftover folder never deleted');
    assert.ok(fs.existsSync(path.join(repo, '.worktrees', 'aclone', '.git')), 'a clone there never deleted');
    if (held) {
      assert.equal(after.held.remove, false);
      assert.match(after.held.why, /a program has the folder open/);
      assert.ok(fs.existsSync(path.join(dirs.held, 'a.txt')), 'files of a held folder untouched');
    }
    const state = JSON.parse(fs.readFileSync(path.join(data, 'state', 'worktree-sweep.json'), 'utf8'));
    assert.equal(state.last, now);
    assert.deepEqual(state.pending.map(e => path.basename(e.path)), ['halfgone'], 'only the half-removed folder waits');
    assert.match(report(cleaned), /removed/);
    assert.equal(g(root, '--git-dir', path.join(root, 'remote.git'), 'branch', '--list', 'pushed').trim(), 'pushed', 'remote untouched');

    // A second clean finishes the half-removed folder and removes nothing more that was kept for
    // a lasting reason. Left out: "held" (the program still has it) and "raceTouch" (only its
    // file's time kept it, and on this clock that is three days old by now).
    const again = await sweep({ ...opts, clean: true, sizes: false });
    assert.deepEqual(again.retried.map(r => [path.basename(r.path), r.removed]), [['halfgone', true]]);
    assert.ok(!fs.existsSync(dirs.halfgone), 'the half-removed folder is gone now');
    const passing = [dirs.held, dirs.raceTouch].map(p => path.resolve(p));
    assert.deepEqual(again.repos[0].items.filter(i => i.removed && !passing.includes(i.path)).map(i => i.path), []);
  } finally {
    if (held) { held.kill(); await new Promise(r => setTimeout(r, 300)); }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('sweep: one clean at a time, gone records removed one by one, held folders retried only if untouched (#2726)', async () => {
  const root = tempRoot('wtsweep2-');
  const data = path.join(root, 'deck'), home = path.join(root, 'home');
  try {
    fs.mkdirSync(home);
    const repo = makeRepo(root);
    const wt = (where, b) => g(repo, 'worktree', 'add', '-q', '-b', b, where, 'main');
    const plain = path.join(repo, '.worktrees', 'plain'), deep = path.join(repo, '.worktrees', 'deep', 'x');
    const orphan = path.join(repo, '.worktrees', 'orphan'), reused = path.join(data, 'state', 'worktrees', 'Reuse-2');
    wt(plain, 'plain'); wt(deep, 'deep');
    // A detached worktree with a commit on no branch: its record is all that holds it.
    g(repo, 'worktree', 'add', '-q', '--detach', orphan, 'main');
    put(path.join(orphan, 'o.txt'), 'only here\n'); g(orphan, 'add', '.'); g(orphan, 'commit', '-qm', 'on no branch');
    fs.rmSync(plain, { recursive: true, force: true });
    fs.rmSync(orphan, { recursive: true, force: true });
    fs.rmSync(path.join(repo, '.worktrees', 'deep'), { recursive: true, force: true }); // as if its drive were gone
    // A live worktree at a path a clean once failed to remove.
    wt(reused, 'lead-2');
    const opts = { projects: [{ name: 'Proj', path: repo }], data, home, sizes: false };

    // A clean already running elsewhere: refused. A lock left by a run that died: taken over.
    put(path.join(data, 'state', 'worktree-sweep.lock'), String(Date.now()));
    await assert.rejects(sweep({ ...opts, clean: true }), /another worktree clean is running/);
    put(path.join(data, 'state', 'worktree-sweep.lock'), String(Date.now() - 3 * 3600e3));

    // Held folders a clean was removing: one untouched since (retried), one with a file written
    // after the try, one with a clone in it.
    const stale = path.join(data, 'state', 'worktrees', 'Old-2'), touched = path.join(data, 'state', 'worktrees', 'Old-3'), cloned = path.join(data, 'state', 'worktrees', 'Old-4');
    put(path.join(stale, 'left.txt'), 'locked leftover\n');
    put(path.join(touched, 'new-work.txt'), 'written after the clean gave up\n');
    put(path.join(cloned, 'x.txt'), 'x\n'); g(cloned, 'init', '-q');
    const later = Date.now() + 60e3;
    put(path.join(data, 'state', 'worktree-sweep.json'), JSON.stringify({ pending: [
      { path: stale, at: later }, { path: touched, at: Date.now() - 60e3 }, { path: cloned, at: later }, { path: reused, at: later }] }));

    const res = await sweep({ ...opts, clean: true });
    const items = res.repos[0].items;
    const byPath = p => items.find(i => i.path === path.resolve(p));
    assert.equal(byPath(deep).remove, false);
    assert.match(byPath(deep).why, /drive not connected/);
    assert.equal(byPath(orphan).remove, false);
    assert.match(byPath(orphan).why, /all that holds 1 commit on no branch/);
    assert.equal(byPath(plain).removed, true, 'its record goes on its own');
    const list = g(repo, 'worktree', 'list', '--porcelain');
    assert.ok(!list.includes('/plain'), "plain's record removed");
    assert.ok(list.includes('/orphan') && list.includes('/deep/x'), 'the others stay');
    assert.ok(!fs.existsSync(stale), 'an untouched held folder is removed on the retry');
    assert.ok(fs.existsSync(path.join(touched, 'new-work.txt')), 'a held folder with new files is never deleted');
    assert.ok(fs.existsSync(path.join(cloned, '.git')), 'a held folder that now holds a repository is never deleted');
    assert.ok(res.leftovers.some(l => l.path === path.resolve(touched)) && res.leftovers.some(l => l.path === path.resolve(cloned)), 'both are listed');
    assert.ok(fs.existsSync(path.join(reused, 'a.txt')), 'a path git took back for a live worktree is left alone');
    assert.ok(!res.leftovers.some(l => l.path === path.resolve(reused)), 'and is no leftover');
    assert.deepEqual(res.retried.map(r => [path.basename(r.path), r.removed]), [['Old-2', true]]);
    assert.ok(!fs.existsSync(path.join(data, 'state', 'worktree-sweep.lock')), 'the lock is let go');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, 'state', 'worktree-sweep.json'), 'utf8')).pending, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('sweep: a bare repo\'s own checkouts beside it are never "beside the project" (#2726)', async () => {
  const root = tempRoot('wtsweep3-');
  const src = path.join(root, 'src'), proj = path.join(root, 'Proj'), data = path.join(root, 'deck'), home = path.join(root, 'home');
  try {
    fs.mkdirSync(home); fs.mkdirSync(src);
    g(src, 'init', '-q', '-b', 'main');
    put(path.join(src, 'a.txt'), 'a\n'); g(src, 'add', '.'); g(src, 'commit', '-qm', 'start');
    fs.mkdirSync(proj);
    g(proj, 'clone', '-q', '--bare', src, path.join(proj, '.bare'));
    put(path.join(proj, '.git'), 'gitdir: ./.bare\n');
    g(proj, 'worktree', 'add', '-q', path.join(proj, 'main'), 'main');
    g(proj, 'worktree', 'add', '-q', '-b', 'feat', path.join(proj, 'feat'), 'main');
    const res = await sweep({ projects: [{ name: 'Proj', path: proj }], data, home, sizes: false, now: Date.now() + 3 * DAY_MS });
    const items = res.repos[0].items;
    assert.deepEqual(items.map(i => path.basename(i.path)).sort(), ['feat', 'main']);
    for (const i of items) {
      assert.equal(i.remove, false, `${path.basename(i.path)}: ${i.why}`);
      assert.match(i.why, /not where leads or agents make worktrees/);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('removeOne: a lead removes a worktree it made once merged, under the same checks (#2726)', async () => {
  const root = tempRoot('wtremove-');
  const data = path.join(root, 'deck'), home = path.join(root, 'home');
  try {
    fs.mkdirSync(home);
    const repo = makeRepo(root, { remote: true });
    const add = (name, where = path.join(repo, '.worktrees', name)) => { g(repo, 'worktree', 'add', '-q', '-b', name, where, 'main'); return where; };
    const ok = add('ok'), dirty = add('dirty'), linked = add('linked'), unmerged = add('unmerged');
    const lead = add('lead-2', path.join(data, 'state', 'worktrees', 'Proj-2'));
    put(path.join(dirty, 'a.txt'), 'changed\n');
    put(path.join(root, 'shared', 'keep.txt'), 'shared\n');
    link(path.join(root, 'shared'), path.join(linked, 'node_modules'));
    put(path.join(unmerged, 'u.txt'), 'u\n'); g(unmerged, 'add', '.'); g(unmerged, 'commit', '-qm', 'not merged');
    const rm = dir => removeOne({ dir, data, home, projects: [{ name: 'Proj', path: repo }], inUse: () => [] });

    const r = await rm(ok);
    assert.equal(r.removed, true, r.out);
    assert.match(r.out, /^Removed .*ok and its branch ok\.$/);
    assert.ok(!fs.existsSync(ok));
    assert.ok(!g(repo, 'branch', '--list', 'ok').trim(), 'its branch went: local and remote main hold its work');
    const kept = async (dir, why) => { const k = await rm(dir); assert.equal(k.removed, false, k.out); assert.match(k.out, why); assert.ok(fs.existsSync(dir)); };
    await kept(dirty, /1 uncommitted/);
    await kept(linked, /holds a link to .*shared, outside it/);
    assert.ok(fs.existsSync(path.join(root, 'shared', 'keep.txt')), 'the linked folder untouched');
    await kept(unmerged, /1 commit on no remote and not merged/);
    await kept(lead, /extra lead's worktree/);
    await kept(repo, /not a linked worktree/);
    assert.match((await rm(path.join(root, 'nothing'))).out, /^No folder at/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('leadWorktreeRisk and removalRisk: what the app checks before removing an extra lead\'s worktree (#2726)', async () => {
  const root = tempRoot('wtlead-');
  try {
    const repo = makeRepo(root);
    const wt = path.join(root, 'Proj-2');
    g(repo, 'worktree', 'add', '-q', '-b', 'lead-2', wt, 'main');
    const risk = () => leadWorktreeRisk({ dir: wt, projPath: repo, project: 'Proj', branch: 'lead-2' });
    assert.equal(await risk(), '', 'clean and merged');
    // A fix committed on a detached HEAD: lead-2 is merged, its HEAD is not.
    g(wt, 'checkout', '-q', '--detach');
    put(path.join(wt, 'fix.txt'), 'fix\n'); g(wt, 'add', '.'); g(wt, 'commit', '-qm', 'fix on a detached HEAD');
    assert.match(await risk(), /its HEAD has commits not merged into Proj's current branch/);
    g(wt, 'checkout', '-q', 'lead-2');
    put(path.join(wt, 'node_modules', 'x.js'), 'x\n');
    assert.equal(await risk(), '', 'back on its merged branch');
    // removalRisk: a .git file pointing nowhere counts outside package folders only.
    put(path.join(wt, 'node_modules', 'pkg', '.git'), 'gitdir: /Users/someone/x/.git\n');
    assert.equal(await removalRisk(wt), '');
    if (process.platform === 'win32') {
      // A Windows path pointing nowhere may be a drive not connected, even in a package folder.
      put(path.join(wt, 'node_modules', 'b3', '.git'), 'gitdir: Z:\\gone\\.git\\worktrees\\b3\n');
      assert.match(await removalRisk(wt), /another worktree or repository is inside it/);
      fs.rmSync(path.join(wt, 'node_modules', 'b3'), { recursive: true });
    }
    put(path.join(wt, 'vendor', 'b2', '.git'), 'gitdir: Z:\\gone\\.git\\worktrees\\b2\n');
    assert.match(await removalRisk(wt), /another worktree or repository is inside it/);
    fs.rmSync(path.join(wt, 'vendor'), { recursive: true });
    // A Mac or Linux path pointing nowhere counts too outside a package or extension folder.
    put(path.join(wt, 'vendor', 'b4', '.git'), 'gitdir: /Volumes/gone/repo/.git/worktrees/b4\n');
    assert.match(await removalRisk(wt), /another worktree or repository is inside it/);
    fs.rmSync(path.join(wt, 'vendor'), { recursive: true });
    put(path.join(root, 'shared', 'k.txt'), 'k\n');
    link(path.join(root, 'shared'), path.join(wt, 'node_modules', 'shared'));
    assert.match(await risk(), /holds a link to .*shared, outside it/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('the app keeps its open panes\' folders in state/live-folders.json for the deck commands (#2726)', () => {
  const data = tempRoot('wtlive-');
  try {
    const on = {};
    const app = { on: (ev, fn) => { on[ev] = fn; } };
    let live = ['D:\\x\\pane'];
    registerWorktreeSweep({ app, SMOKE: false, DEMO: false, DECK: data, projects: () => [], liveFolders: () => live, cleanOn: false });
    assert.deepEqual(liveFolders(data), ['D:\\x\\pane']);
    on['before-quit']();
    live = [];
    assert.deepEqual(liveFolders(data), [], 'none once the app quits');
    registerWorktreeSweep({ app, SMOKE: true, DEMO: false, DECK: path.join(data, 'smoke'), projects: () => [], liveFolders: () => ['x'] });
    assert.ok(!fs.existsSync(path.join(data, 'smoke')), 'a smoke run writes nothing');
  } finally {
    fs.rmSync(data, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('deck worktrees: lists every project\'s worktrees and leaves open panes\' folders alone (#2726)', () => {
  const root = tempRoot('wtsweep4-');
  const data = path.join(root, 'deck');
  const deckCmd = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', 'deck.mjs');
  try {
    fs.mkdirSync(path.join(root, 'none'));
    const repo = makeRepo(root);
    const a = path.join(repo, '.worktrees', 'a'), b = path.join(repo, '.worktrees', 'b');
    g(repo, 'worktree', 'add', '-q', '-b', 'a', a, 'main');
    g(repo, 'worktree', 'add', '-q', '-b', 'b', b, 'main');
    put(path.join(data, 'projects.json'), JSON.stringify({ projects: [{ name: 'Proj', path: repo }], scanRoots: [path.join(root, 'none')] }));
    saveLiveFolders(data, [b]);
    const run = (...args) => execFileSync(process.execPath, [deckCmd, '--data', data, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const out = run('worktrees');
    const line = p => out.split('\n').find(l => l.includes(` ${p}`)) || '';
    assert.match(line(b), /^ {2}keep {4}.*open in an FocusShell pane/, out);
    assert.match(line(a), /^ {2}keep {4}/, out);
    assert.doesNotMatch(line(a), /open in an FocusShell pane/);
    assert.ok(fs.existsSync(a) && fs.existsSync(b), 'a listing removes nothing');
    assert.throws(() => run('worktrees', '--bogus'), /worktrees takes only --clean/);
    const failed = (...args) => { try { run(...args); } catch (e) { return `${e.stdout || ''}${e.stderr || ''}`; } assert.fail(`deck ${args.join(' ')} should have refused`); };
    if (!CLEAN_ON) {
      assert.match(failed('worktrees', '--clean'), /removing worktrees is switched off/);
      assert.match(failed('worktree-remove', a), /removing worktrees is switched off/);
      assert.ok(fs.existsSync(a), 'nothing removed while removing is off');
    } else {
      // A lead removes its own: no day of idling needed. Its branch stays: no remote holds it.
      assert.match(run('worktree-remove', a), /^Removed .*[\\/]a; its branch a stays/);
      assert.ok(!fs.existsSync(a));
      assert.match(failed('worktree-remove', b), /^Kept .*[\\/]b: open in an FocusShell pane/);
      assert.match(failed('worktree-remove', b, 'extra'), /worktree-remove takes one folder/);
      // The full clean: b is open in a pane, so nothing goes; the report is saved.
      assert.match(run('worktrees', '--clean'), /^Worktrees on .*: 0 worktrees removed, 1 kept/);
      assert.ok(fs.existsSync(b));
      assert.ok(fs.existsSync(path.join(data, 'state', 'worktree-sweep.txt')), 'the report is saved');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});
