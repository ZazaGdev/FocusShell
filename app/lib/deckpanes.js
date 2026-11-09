// The CTO's pane requests as deck verbs (#2562), so they run on a Mac as well as Windows:
// open-pane, close-pane and ask-owner do what open-pane.ps1, close-pane.ps1 and ask-owner.ps1
// do in the running app, through the same request files in state/requests (requests.js).
// They need the app: without it they say so, as the scripts do for extra leads.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseProjects } from './projects.js';
import { MODELS } from './sessions.js';

export const PANE_USAGE = `  open-pane  <Project> [--lead 2-5] [--worktree] [--model fable|opus|sonnet|haiku]
                                            opens a lead's tab in the running app
  close-pane <Project> [--lead 2-5] [--force]   closes a lead's tab (refused mid-task unless --force)
  ask-owner  <Project> '<exact words>' [--why '<the question>'] [--task <n>] [--lead 2-5] [--wait <seconds>]
                                            a card asking the owner to approve words typed into a lead's pane
  open-file  '<full path>'                  opens a file for the owner as a click on its path does (#2768):
                                            in its project's Code pane beside the lead, nothing typed there`;
export const PANE_VERBS = new Set(['open-pane', 'close-pane', 'ask-owner', 'open-file']);

// argv after the verb: { pos: [...], opt: { lead, worktree, model, force, why, task, wait } }.
export function paneArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--worktree' || a === '--force' || a === '--second') opt[a.slice(2)] = true;
    else if (/^--(lead|model|why|task|wait)$/.test(a)) {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      opt[a.slice(2)] = argv[++i];
    } else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else pos.push(a);
  }
  return { pos, opt };
}

// The lead number asked for: 0 for the first lead, 2 to 5 for an extra one.
export function leadOf(opt) {
  const n = opt.lead !== undefined ? Number(opt.lead) : opt.second ? 2 : 0;
  if (n === 1 || n === 0) return 0;
  if (!Number.isInteger(n) || n < 2 || n > 5) return null;
  return n;
}

// The project's name as the app knows it (case as on disk), from projects.json and the
// folders under its scanRoots (default: the data folder's parent), as Get-DeckConfig reads them.
export function projectNames(data) {
  let cfg = { projects: [] };
  try { cfg = parseProjects(fs.readFileSync(path.join(data, 'projects.json'), 'utf8')); } catch { /* none yet */ }
  const roots = cfg.scanRoots && cfg.scanRoots.length ? cfg.scanRoots : [path.dirname(data)];
  const names = [];
  for (const root of roots) {
    try { for (const d of fs.readdirSync(root, { withFileTypes: true })) if (d.isDirectory() && !d.name.startsWith('.')) names.push(d.name); } catch { /* root missing */ }
  }
  for (const p of cfg.projects || []) if (p && p.name) names.push(p.name);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}
export const findProject = (names, want) => names.find(n => n.toLowerCase() === String(want).toLowerCase()) || null;

// Whether the app named in state/app.pid is running.
export function appRunning(data, alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }) {
  let pid = '';
  try { pid = fs.readFileSync(path.join(data, 'state', 'app.pid'), 'utf8').trim(); } catch { return false; }
  return /^\d+$/.test(pid) && alive(Number(pid));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Waits up to tries * 200 ms for file, then returns its trimmed text and removes it.
async function answer(file, tries) {
  for (let i = 0; i < tries; i++) {
    await sleep(200);
    if (fs.existsSync(file)) {
      const a = fs.readFileSync(file, 'utf8').trim();
      try { fs.unlinkSync(file); } catch { /* taken */ }
      return a;
    }
  }
  return null;
}
const rm = f => { try { fs.unlinkSync(f); } catch { /* not there */ } };

// One pane verb. Resolves { out, code }: the lines to print and the exit code. requests and
// names stand in for the data folder's requests folder and project list (the smoke run has its own).
export async function runPane(verb, argv, { data, running = appRunning, tries = null, requests = null, names: known = null } = {}) {
  const { pos, opt } = paneArgs(argv);
  const req = requests || path.join(data, 'state', 'requests');
  const projectNames_ = () => known || projectNames(data);
  const n = leadOf(opt);
  if (verb === 'open-pane') {
    const want = pos[0];
    if (!want) throw new Error('open-pane needs a project');
    if (n === null) return { out: `Refused: a project runs at most five leads, lead-${want} and lead-${want}-2 to lead-${want}-5. --lead takes 2 to 5; close one of them first to free its number.`, code: 1 };
    if (opt.worktree && !n) return { out: 'Refused: --worktree is for an extra lead only. Add --lead 2 to 5.', code: 1 };
    const model = opt.model ? String(opt.model).toLowerCase() : '';
    if (model && !MODELS.includes(model)) return { out: `Refused: --model takes ${MODELS.join(', ')}.`, code: 1 };
    const names = projectNames_(), name = findProject(names, want);
    if (!name) return { out: `Unknown project '${want}'. Known: ${names.join(', ')}. Add it to projects.json first.`, code: 1 };
    if (!running(data)) return { out: 'The FocusShell app is not running. Start it, then ask again.', code: 1 };
    const kind = n ? `open${n}` : 'open', lead = n ? `lead-${name}-${n}` : `lead-${name}`;
    const body = [n ? (opt.worktree ? 'worktree' : 'same') : name, ...(model ? [`model=${model}`] : [])].join('\n');
    const out = path.join(req, `${kind}-${name}.out`);
    fs.mkdirSync(req, { recursive: true });
    const lines = [];
    // The app answers "Started ..." or "Failed: ..." in <kind>-<Project>.out once the session has
    // run a few seconds (#185). No answer within 30 seconds: ask once more, then give up.
    for (let attempt = 1; attempt <= 2; attempt++) {
      rm(out);
      fs.writeFileSync(path.join(req, `${kind}-${name}.req`), body + '\n');
      const a = await answer(out, tries || 150);
      if (a !== null) {
        const where = n ? (opt.worktree ? ` It works in its own worktree (state${path.sep}worktrees${path.sep}${name}-${n}, branch lead-${n}).` : ' It works in the project folder.') : '';
        if (a.startsWith('Started')) return { out: [...lines, `${a}${where} It shows in ListAgents within about 20 seconds.`].join('\n'), code: 0 };
        return { out: [...lines, a].join('\n'), code: a.startsWith('Already open') ? 0 : 1 };
      }
      if (attempt === 1) lines.push('The FocusShell app did not answer within 30 seconds; asking again.');
    }
    return { out: [...lines, `Failed: the FocusShell app did not answer the request to open ${lead}, twice. It may be busy or stuck; tell the user to check the FocusShell window.`].join('\n'), code: 1 };
  }
  if (verb === 'close-pane') {
    const want = pos[0];
    if (!want) throw new Error('close-pane needs a project');
    const name = findProject(projectNames_(), want) || want;
    if (n === null) return { out: `Refused: a project runs at most five leads, lead-${name} and lead-${name}-2 to lead-${name}-5, so there is no lead ${opt.lead} to close. --lead takes 2 to 5.`, code: 1 };
    const kind = n ? `close${n}` : 'close', lead = n ? `lead-${name}-${n}` : `lead-${name}`;
    if (!running(data)) return { out: `The FocusShell app is not running, so there is no ${lead} tab to close.`, code: 1 };
    fs.mkdirSync(req, { recursive: true });
    const out = path.join(req, `${kind}-${name}.out`);
    rm(out);
    fs.writeFileSync(path.join(req, `${kind}-${name}.req`), (opt.force ? 'force' : '') + '\n');
    // Removing a worktree takes longer than closing a tab.
    const t = tries || (n ? 100 : 50);
    const a = await answer(out, t);
    if (a === null) return { out: `Asked the FocusShell app to close ${lead}, but it did not answer within ${t / 5} seconds.`, code: 1 };
    return { out: a, code: a.startsWith('Closed') ? 0 : 1 };
  }
  if (verb === 'ask-owner') {
    const [project, words] = pos;
    if (!project || words === undefined) throw new Error("ask-owner needs a project and the words: ask-owner <Project> '<exact words>'");
    if (n === null) return { out: 'Failed: --lead takes 2 to 5 (a project runs at most five leads).', code: 1 };
    if (!running(data)) return { out: "Failed: the FocusShell app is not running, so there is no card to show. Ask the owner to type the words in the lead's pane.", code: 1 };
    if (/[\r\n]/.test(words)) return { out: 'Failed: the words must be one line.', code: 1 };
    fs.mkdirSync(req, { recursive: true });
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const body = JSON.stringify({ project, task: Number(opt.task) || 0, words, why: opt.why || '', n: Math.max(n, 1), created: Date.now() });
    // Written whole, then renamed, so the app never reads half a request.
    const tmp = path.join(req, `words-${id}.tmp`);
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, path.join(req, `words-${id}.req`));
    const lead = n ? `lead-${project}-${n}` : `lead-${project}`;
    const lines = [`Asked: a card for ${lead} shows the words; nothing is typed until the owner clicks. Request ${id}.`];
    const wait = Number(opt.wait) || 0;
    if (wait > 0) {
      const a = await answer(path.join(req, `words-${id}.out`), tries || wait * 5);
      lines.push(a !== null ? `Answer: ${a}` : `No answer yet after ${wait} seconds; the card stays until the owner clicks or a day passes.`);
    }
    return { out: lines.join('\n'), code: 0 };
  }
  if (verb === 'open-file') {
    // The owner asked the CTO to open or show a file (#2768). The window opens it as a click on
    // its path does: a text file in the Code pane of the project that holds it, beside that
    // project's lead (opening its tab first), a folder or a binary file shown in File Explorer.
    // Nothing is typed into any pane, and nothing is run.
    const file = pos[0];
    if (!file || pos.length > 1) throw new Error("open-file needs one full path, in single quotes: open-file '<full path>'");
    if (!/^[a-zA-Z]:[\\/]|^\\\\|^\//.test(file)) return { out: `Refused: '${file}' is not a full path. Give the whole path, such as D:\\Projects\\App\\docs\\plan.md.`, code: 1 };
    if (!fs.existsSync(file)) return { out: `Failed: there is no file or folder at ${file}.`, code: 1 };
    if (!running(data)) return { out: `The FocusShell app is not running, so there is no Code pane to open it in. Give the owner the path instead: ${file}`, code: 1 };
    fs.mkdirSync(req, { recursive: true });
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const tmp = path.join(req, `file-${id}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify({ file }));
    fs.renameSync(tmp, path.join(req, `file-${id}.req`));
    // Opening a project's tab first starts its lead, which takes a few seconds.
    const t = tries || 150;
    const a = await answer(path.join(req, `file-${id}.out`), t);
    if (a === null) return { out: `Asked the FocusShell app to open ${file}, but it did not answer within ${t / 5} seconds. Give the owner the path instead.`, code: 1 };
    return { out: a, code: a.startsWith('Failed') ? 1 : 0 };
  }
  throw new Error(`unknown verb "${verb}"`);
}
