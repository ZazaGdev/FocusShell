// Open and catch up (#1025): the IPC that writes one project's recap. It gathers the project's
// board, its git log and its lead's sessions since yesterday, has one headless model turn write
// the recap, and saves it to state/catchup/<Project>-<YYYY-MM-DD-HHMM>.md for the lead and the
// CTO to read. Smoke and try runs write a canned recap, no Claude. Kept out of main.js.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { runTurn } from './helper.js';
import { helperCommand } from './lib/helper.js';
import { encodeProjectDir } from './lib/history.js';
import { boardDigest, sessionDigest, catchupInput, SYSTEM, yesterday, dayOf } from './lib/catchup.js';

const SAFE = /^[\w.-]+$/;

// d: { ipcMain, P, SMOKE, read, cleanEnv, projectList }
export function registerCatchup({ ipcMain, P, SMOKE, read, cleanEnv, projectList }) {
  const dir = path.join(P.state, SMOKE ? path.join('smoke', 'catchup') : 'catchup'), work = path.join(P.state, 'helper', 'work');

  function gitLog(folder, since) {
    try {
      return execFileSync('git', ['-C', folder, 'log', `--since=${dayOf(since)} 00:00`, '--date=format:%m-%d %H:%M', '--pretty=%h %ad %s', '-n', '40'],
        { encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim();
    } catch { return ''; }
  }
  // The lead's session logs written since yesterday: its own conversations in the project folder.
  function sessions(folder, project, since) {
    const logs = path.join(os.homedir(), '.claude', 'projects', encodeProjectDir(folder));
    let files = [];
    try { files = fs.readdirSync(logs).filter(n => n.endsWith('.jsonl')).map(n => ({ f: path.join(logs, n), m: fs.statSync(path.join(logs, n)).mtimeMs })); } catch { return ''; }
    const tag = `"customTitle":${JSON.stringify(`lead-${project}`)}`;
    const mine = files.filter(x => x.m >= since.getTime()).sort((a, b) => a.m - b.m).filter(x => {
      try { return fs.readFileSync(x.f, 'utf8').includes(tag); } catch { return false; }
    }).slice(-2);
    return mine.map(x => sessionDigest(fs.readFileSync(x.f, 'utf8'), since.getTime(), 4000)).filter(Boolean).join('\n');
  }

  // Resolves { file } with the recap's path, or { error }.
  ipcMain.handle('catchup:make', async (_e, project, model) => {
    project = String(project || '');
    if (!SAFE.test(project)) return { error: 'Unknown project.' };
    const p = projectList().find(x => x.name === project);
    if (!p) return { error: `${project} is not a project.` };
    const now = new Date(), since = yesterday(now);
    const stamp = `${dayOf(now)}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const file = path.join(dir, `${project}-${stamp}.md`);
    fs.mkdirSync(dir, { recursive: true });
    const board = boardDigest(read(path.join(P.tasks, `${project}.md`)), since);
    if (SMOKE) {
      fs.writeFileSync(file, `# ${project}: catch up\n\n**Where it stands**\n${board}\n\n(smoke run: written without Claude)\n`);
      return { file };
    }
    const text = catchupInput({ project, board, git: gitLog(p.path, since), sessions: sessions(p.path, project, since) });
    fs.mkdirSync(work, { recursive: true });
    const promptFile = path.join(P.state, 'helper', `prompt-${crypto.randomUUID()}.txt`);
    fs.writeFileSync(promptFile, SYSTEM);
    try {
      const r = await runTurn(helperCommand({ promptFile, model: model || 'haiku' }), text, {
        cwd: work, env: { ...cleanEnv(process.env), MAX_THINKING_TOKENS: '0' }, timeout: 120000, slow: 'The recap took over two minutes and was stopped.' });
      if (r.error) return { error: r.error };
      let o;
      try { o = JSON.parse(r.out); } catch { return { error: `Claude did not answer: ${(r.err || r.out).trim().split(/\r?\n/).pop() || 'no output'}` }; }
      if (o.is_error || !String(o.result || '').trim()) return { error: `Claude: ${String(o.result || o.subtype || 'no recap').slice(0, 200)}` };
      fs.writeFileSync(file, `# ${project}: catch up, ${dayOf(now)}\n\n${String(o.result).trim()}\n`);
      return { file };
    } finally { try { fs.unlinkSync(promptFile); } catch { /* best effort */ } }
  });
}
