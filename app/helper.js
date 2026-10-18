// The AI helper (#154): one turn per message through headless Claude Code (Haiku unless
// Settings picks another model), and
// adding the finished draft as a task or idea with its detail lines. Kept out of main.js.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { parseTasks } from './lib/tasks.js';
import { nextShared } from './lib/counter.js';
import { systemPrompt, parseReply, addItem, helperCommand } from './lib/helper.js';
import { modelFor } from './lib/settings.js';

const SAFE = /^[^\\/:*?"<>|.][^\\/:*?"<>|]*$/;
const TIMEOUT = 60000;

// One headless Claude turn: cmd (from helperCommand) through cmd.exe, text on stdin. Resolves
// { out, err }, or { error } when it could not start or ran past timeout (then it is killed).
// Also the recorder's claude service (#369).
export function runTurn(cmd, text, { cwd, env, timeout, slow }) {
  return new Promise(res => {
    let out = '', err = '', done = false;
    const c = spawn('cmd.exe', ['/d', '/s', '/c', cmd], { cwd, env, windowsHide: true, windowsVerbatimArguments: true });
    const finish = r => { if (!done) { done = true; clearTimeout(timer); res(r); } };
    const timer = setTimeout(() => {
      try { execFileSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* gone */ }
      finish({ error: slow || 'Claude took too long and was stopped.' });
    }, timeout);
    c.stdout.on('data', b => { out += b; });
    c.stderr.on('data', b => { err += b; });
    c.on('error', e => finish({ error: `Could not start Claude: ${e.message}` }));
    c.on('close', () => finish({ out, err }));
    c.stdin.end(text);
  });
}

// d: { ipcMain, read, readData, today, cleanEnv, projectList, smoke, P: { tasks, ideas, state } }
export function registerHelper(d) {
  const { ipcMain, read, readData, today, cleanEnv, projectList, smoke, P, board } = d;
  const dir = path.join(P.state, 'helper'), work = path.join(dir, 'work');
  const taskFile = project => path.join(P.tasks, `${project}.md`), ideasFile = path.join(P.ideas, 'Me.md');
  const openTitles = md => parseTasks(md).filter(t => t.mark !== 'x').map(t => `#${t.n} ${t.text}`);

  // What the helper knows: the open items it could duplicate, and the project's CLAUDE.md
  // (or README.md when there is none). Me items get the Me board, or the ideas deck.
  function context(kind, project) {
    if (project === 'Me') return { open: openTitles(read(kind === 'idea' ? ideasFile : taskFile('Me'))), doc: null };
    const p = projectList().find(x => x.name === project);
    let doc = null;
    for (const name of ['CLAUDE.md', 'README.md']) {
      const text = p ? read(path.join(p.path, name)) : '';
      if (text.trim()) { doc = { name, text }; break; }
    }
    return { open: openTitles(read(taskFile(project))), doc };
  }

  // No thinking: with it Haiku spent 25 to 45 seconds on a first turn, without it about 4.
  const run = (cmd, text) => runTurn(cmd, text, { cwd: work, env: { ...cleanEnv(process.env), MAX_THINKING_TOKENS: '0' },
    timeout: TIMEOUT, slow: 'The helper took over a minute and was stopped.' });

  ipcMain.handle('helper:turn', async (_e, { kind, project, text, session }) => {
    project = String(project || 'Me');
    if (!SAFE.test(project)) return { error: 'Unknown project.' };
    // Smoke and try runs: a canned answer, no Claude.
    if (smoke) return { session: '00000000-0000-4000-8000-000000000000', reply: 'Which month is the trip?',
      draft: { title: String(text).replace(/\s+/g, ' ').trim().slice(0, 80) || 'New idea', lines: ['Smoke test draft, no Claude involved.'] } };
    fs.mkdirSync(work, { recursive: true });
    let promptFile = null;
    if (!session) {
      promptFile = path.join(dir, `prompt-${crypto.randomUUID()}.txt`);
      fs.writeFileSync(promptFile, systemPrompt({ kind, project, ...context(kind, project) }));
    }
    let s = {}; try { s = JSON.parse(read(P.settings, '{}')); } catch { /* defaults */ }
    const r = await run(helperCommand({ promptFile, session, model: modelFor(s, 'helper') }), String(text));
    if (promptFile) try { fs.unlinkSync(promptFile); } catch { /* best effort */ }
    if (r.error) return { error: r.error };
    let o;
    try { o = JSON.parse(r.out); } catch {
      const why = (r.err || r.out).trim().split(/\r?\n/).pop();
      return { error: why ? `Claude did not answer: ${why}` : 'Claude did not answer.' };
    }
    if (o.is_error) return { error: `Claude: ${String(o.result || o.subtype || 'error').slice(0, 300)}`, session: o.session_id };
    return { session: o.session_id, ...parseReply(o.result) };
  });

  // Add: a task (a project's, or a Me to-do) or an idea, the lines as its detail lines.
  ipcMain.handle('helper:add', (_e, { kind, project, draft }) => {
    if (!draft || !String(draft.title || '').trim()) return readData();
    const f = kind === 'idea' ? ideasFile : SAFE.test(String(project)) ? taskFile(String(project)) : null;
    if (!f) return readData();
    const head = kind === 'idea' ? '# Me ideas' : `# ${project} tasks`;
    board(f, md => addItem(md, draft, 'user', today(), kind === 'idea' ? undefined : nextShared(path.dirname(f), f, md)).md, head);
    return readData();
  });
}
