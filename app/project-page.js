// The project page's IPC: a project's details (git, briefs, sessions, readme), its pull
// requests, a task's extra files, and the task and note edits made there. Kept out of main.js.
import { execFile } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isTrusted } from './lib/projects.js';
import { addNoteLine, setMark, setTaskText, parseTasks, relatedFiles } from './lib/tasks.js';
import { encodeProjectDir, summarizeSession } from './lib/history.js';
import { readmeSummary } from './lib/readme.js';
import { pushAllowed } from './lib/pushperm.js';
import { rollRepeat } from './lib/me.js';
import { parsePlan, setPlan, setTaskKey, PLAN_KEYS } from './lib/plan.js';

// d: { ipcMain, P, DECK, read, readData, board, nowStamp, loadProjects, loadTrusted, findProject }
export function registerProjectPage(d) {
  const { ipcMain, P, DECK, read, readData, board, nowStamp, loadProjects, loadTrusted, findProject } = d;
  function git(cwd, args) {
    return new Promise(res => execFile('git', ['-C', cwd, ...args], { timeout: 5000, windowsHide: true },
      (err, out) => res(err ? null : String(out))));
  }

  // Reads a session file line by line. Large files are only read for their first 2 MB,
  // which is enough for the title; the end time then comes from the file's change time.
  async function readSession(file, id) {
    const st = fs.statSync(file);
    const cap = 2 * 1024 * 1024;
    const lines = [];
    const rl = readline.createInterface({ input: fs.createReadStream(file, { end: Math.min(st.size, cap) - 1 }) });
    for await (const l of rl) lines.push(l);
    const s = summarizeSession(lines, id);
    s.end = st.mtime.toISOString();
    s.partial = st.size > cap;
    return s;
  }

  async function projectSessions(folder) {
    const dir = path.join(os.homedir(), '.claude', 'projects', encodeProjectDir(folder));
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')); } catch { return []; }
    const newest = files.map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(0, 25);
    const out = [];
    for (const { f } of newest) { try { out.push(await readSession(path.join(dir, f), f.slice(0, -6))); } catch { /* unreadable */ } }
    return out;
  }

  // "Push without asking": git push rules in a project's own .claude/settings.local.json.
  const localSettings = p => path.join(p.path, '.claude', 'settings.local.json');
  // A task's screenshot (#369, "> Screenshot:" lines) as a data URL, since the page's CSP loads
  // no files. Only PNGs inside FocusShell's state folder, where the recorder keeps them.
  ipcMain.handle('image:read', (_e, p) => {
    const f = path.resolve(String(p || '')), root = path.resolve(P.state) + path.sep;
    if (!f.toLowerCase().startsWith(root.toLowerCase()) || !/\.png$/i.test(f)) return null;
    try { return 'data:image/png;base64,' + fs.readFileSync(f).toString('base64'); } catch { return null; }
  });
  ipcMain.handle('push:list',() => loadProjects().projects.filter(p => pushAllowed(read(localSettings(p)))).map(p => p.name));
  ipcMain.handle('project:details', async (_e, name) => {
    const p = findProject(name);
    if (!p) return null;
    const [branch, status, log] = await Promise.all([
      git(p.path, ['rev-parse', '--abbrev-ref', 'HEAD']),
      git(p.path, ['status', '--porcelain']),
      git(p.path, ['log', '-8', '--pretty=format:%h%x09%ar%x09%s']),
    ]);
    let briefs = [];
    try {
      const dir = path.join(P.briefs, name);
      briefs = fs.readdirSync(dir).filter(f => /^\d+\.md$/.test(f))
        .map(f => ({ n: Number(f.slice(0, -3)), text: read(path.join(dir, f)) })).sort((a, b) => b.n - a.n);
    } catch { /* none yet */ }
    return {
      name: p.name, path: p.path, trusted: isTrusted(p.path, loadTrusted()),
      tasks: read(path.join(P.tasks, `${name}.md`)),
      notes: read(path.join(P.projectNotes, `${name}.md`)),
      git: branch == null ? null : {
        branch: branch.trim(),
        changed: status ? status.split(/\r?\n/).filter(Boolean).length : 0,
        log: (log || '').split(/\r?\n/).filter(Boolean).map(l => { const [hash, when, ...s] = l.split('\t'); return { hash, when, subject: s.join('\t') }; }),
      },
      briefs,
      sessions: await projectSessions(p.path),
      readme: projectReadme(p.path),
    };
  });
  ipcMain.handle('tasks:mark', (_e, { project, n, mark }) => {
    // A repeating Self item ticked done stays open on its next date (#198).
    board(path.join(P.tasks, `${project}.md`), md => {
      const t = project === 'Me' && mark === 'x' ? parseTasks(md).find(x => x.n === n) : null;
      return (t && rollRepeat(md, t)) || setMark(md, n, mark, nowStamp());
    });
    return readData();
  });
  // Version or priority of one task (#23), and a project's plan lines.
  ipcMain.handle('tasks:key', (_e, { project, n, key, value }) => {
    if (![...PLAN_KEYS, 'Tags'].includes(key)) return readData();
    board(path.join(P.tasks, `${project}.md`), md => setTaskKey(md, n, key, value));
    return readData();
  });
  ipcMain.handle('tasks:plan', (_e, { project, plan }) => {
    board(path.join(P.tasks, `${project}.md`), md => setPlan(md, plan), `# ${project} tasks`);
    return readData();
  });
  ipcMain.handle('project:note', (_e, { project, text }) => {
    const f = path.join(P.projectNotes, `${project}.md`);
    board(f, md => addNoteLine(md, text, nowStamp()), `# ${project} notes`);
    return read(f);
  });
  function projectReadme(folder) {
    let file = null;
    try { file = fs.readdirSync(folder).find(f => /^readme(\.md|\.markdown|\.txt)?$/i.test(f)); } catch { /* unreadable */ }
    if (!file) return null;
    const full = path.join(folder, file);
    return { file: full, summary: readmeSummary(read(full)) };
  }

  // Open pull requests through the GitHub CLI, which is already signed in on this machine.
  // Slow, so the page asks for it separately.
  ipcMain.handle('project:prs', async (_e, name) => {
    const p = findProject(name);
    if (!p) return { error: 'Unknown project' };
    const out = await new Promise(res => execFile('gh', ['pr', 'list', '--state', 'open', '--limit', '10', '--json', 'number,title,url,isDraft,updatedAt,author'],
      { cwd: p.path, timeout: 10000, windowsHide: true }, (err, stdout, stderr) => res({ err, stdout: String(stdout || ''), stderr: String(stderr || '') })));
    if (out.err) {
      const why = /no git remotes|not a git repository|none of the git remotes/i.test(out.stderr) ? 'Not on GitHub.'
        : /ENOENT/.test(String(out.err.code || out.err.message)) ? 'GitHub CLI (gh) is not installed.' : 'Could not read pull requests.';
      return { error: why };
    }
    try { return { prs: JSON.parse(out.stdout || '[]') }; } catch { return { error: 'Could not read pull requests.' }; }
  });
  // What a task's detail panel shows besides its lines: its brief, its project notes and the
  // Markdown files related to it (see relatedFiles), as full paths that exist on disk.
  ipcMain.handle('task:extra', (_e, { project, n }) => {
    const safe = /^[^\\/:*?"<>|]+$/.test(String(project)) && /^\d+$/.test(String(n));
    if (!safe) return { brief: '', notes: '', files: [], plan: parsePlan('') };
    return { brief: read(path.join(P.briefs, project, `${n}.md`)), notes: read(path.join(P.projectNotes, `${project}.md`)), files: taskFiles(project, Number(n)), plan: parsePlan(read(path.join(P.tasks, `${project}.md`))) };
  });
  function taskFiles(project, n) {
    const tasks = parseTasks(read(path.join(P.tasks, `${project}.md`)));
    const t = tasks.find(x => x.n === n);
    if (!t) return [];
    const { paths, after } = relatedFiles(t, tasks);
    const p = findProject(project), out = [];
    const add = f => { if (!out.includes(f) && fs.existsSync(f) && fs.statSync(f).isFile()) out.push(f); };
    for (const x of paths) {
      if (/^[A-Za-z]:[\\/]/.test(x)) add(path.normalize(x));
      else {
        if (p) add(path.join(p.path, x));
        add(path.join(DECK, x));
      }
    }
    for (const k of [n, ...after]) add(path.join(P.briefs, project, `${k}.md`));
    return out;
  }
  ipcMain.handle('tasks:text', (_e, { project, n, text }) => {
    board(path.join(P.tasks, `${project}.md`), md => setTaskText(md, n, text));
    return readData();
  });
}
