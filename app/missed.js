// Maybe missed (#367): the IPC behind the button above each CTO pane. It reads that CTO pane's
// own Claude Code log, knows when the owner started typing in the pane and which links they
// clicked there, asks Haiku only about matches the word rules cannot settle, and keeps what the
// owner marked (Seen, Later, answered) in state/missed.json. Kept out of main.js.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { encodeProjectDir, lastConversation } from './lib/history.js';
import { sessionName } from './lib/sessions.js';
import { helperCommand } from './lib/helper.js';
import { conversation, maybeMissed, LATER_MS } from './lib/missed.js';
import { arrived } from './lib/ctoline.js';

const JUDGE_PROMPT = `You decide whether a chat message from a person responds to an earlier item an assistant wrote to them.
The item is a question, a request for a decision, or a result the assistant delivered (a file, a report, a link).
"Responds" means the message answers the question, picks an option, refers to the result, or says it has been seen or done.
A message about something else does not respond, even if it shares a word.
Reply with exactly one word: yes or no.`;
const JUDGE_AT_ONCE = 3; // Haiku calls per check, at most; the rest wait for the next check

// d: { ipcMain, P, SMOKE, DEMO, demoClaude, sessions, cleanEnv }
export function registerMissed(d) {
  const { ipcMain, P, SMOKE, DEMO, demoClaude, sessions, cleanEnv } = d;
  const stateFile = path.join(P.state, SMOKE ? path.join('smoke', 'missed.json') : 'missed.json');
  const work = path.join(P.state, 'missed-work');
  const projectsDir = DEMO ? path.join(demoClaude, 'projects') : path.join(os.homedir(), '.claude', 'projects');
  let state = null, fakeLog = '';
  const load = () => {
    if (state) return state;
    try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { state = {}; }
    for (const k of ['seen', 'answered', 'later', 'judged']) if (!state[k] || typeof state[k] !== 'object') state[k] = {};
    return state;
  };
  const save = () => { try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(state)); } catch { /* next time */ } };

  // The pane's own conversation: the log in its folder written since it started, named after it.
  const logOf = new Map();
  function logFile(id, s) {
    const dir = path.join(projectsDir, encodeProjectDir(s.cwd));
    const known = logOf.get(id);
    let files = [];
    try { files = fs.readdirSync(dir).filter(n => n.endsWith('.jsonl')).map(n => ({ n, mtime: fs.statSync(path.join(dir, n)).mtimeMs })).filter(f => f.mtime >= s.startedAt - 1000); } catch { return null; }
    if (known && files.some(f => f.n === known)) return path.join(dir, known);
    const conv = lastConversation(files.map(f => ({ id: f.n.slice(0, -6), mtime: f.mtime, text: head(path.join(dir, f.n), 256 * 1024) })), sessionName(id, DEMO ? 'demo-' : ''));
    if (!conv) return null;
    logOf.set(id, `${conv}.jsonl`);
    return path.join(dir, `${conv}.jsonl`);
  }
  // Only the end of a long log is read: replies older than a day are not looked at anyway.
  function tail(file, bytes = 4 * 1024 * 1024) {
    const size = fs.statSync(file).size, fd = fs.openSync(file, 'r');
    try {
      const b = Buffer.alloc(Math.min(size, bytes));
      fs.readSync(fd, b, 0, b.length, size - b.length);
      const s = b.toString('utf8');
      return size > bytes ? s.slice(s.indexOf('\n') + 1) : s;
    } finally { fs.closeSync(fd); }
  }

  let judging = false;
  async function judge(list) {
    if (judging || !list.length) return;
    judging = true;
    try {
      fs.mkdirSync(work, { recursive: true });
      const promptFile = path.join(work, 'judge-prompt.txt');
      fs.writeFileSync(promptFile, JUDGE_PROMPT);
      for (const u of list.slice(0, JUDGE_AT_ONCE)) {
        const out = await run(helperCommand({ promptFile, model: 'haiku' }), `Item: ${u.item}\n\nMessage: ${u.message}`);
        let said = null;
        try { const o = JSON.parse(out); if (!o.is_error) said = /\byes\b/i.test(String(o.result)) ? true : /\bno\b/i.test(String(o.result)) ? false : null; } catch { /* not judged */ }
        if (said !== null) { load().judged[u.key] = said; save(); }
      }
    } finally { judging = false; }
  }
  function run(cmd, text) {
    return new Promise(res => {
      let out = '';
      const env = { ...cleanEnv(process.env), MAX_THINKING_TOKENS: '0' };
      const c = spawn('cmd.exe', ['/d', '/s', '/c', cmd], { cwd: work, env, windowsHide: true, windowsVerbatimArguments: true });
      const timer = setTimeout(() => { try { execFileSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* gone */ } }, 60000);
      c.stdout.on('data', b => { out += b; });
      c.on('error', () => { clearTimeout(timer); res(''); });
      c.on('close', () => { clearTimeout(timer); res(out); });
      c.stdin.end(text);
    });
  }

  // The flagged items for a CTO pane, with the owner's marks, before the renderer drops what is
  // on Waiting on you. Unsure matches go to Haiku in the background and show on a later check.
  // Whether a line FocusShell typed into a CTO pane reached its Claude (#1029). A smoke or try
  // run has no Claude, so its lines count as arrived.
  ipcMain.handle('missed:arrived', (_e, id, text, since) => {
    if (SMOKE) return true;
    const s = sessions.get(id);
    const file = s && logFile(id, s);
    if (!file) return false;
    try { return arrived(tail(file, 1024 * 1024), text, since); } catch { return false; }
  });
  ipcMain.handle('missed:list', (_e, id) => {
    const s = sessions.get(id);
    if (!s) return { items: [], state: load() };
    let log = '';
    if (SMOKE) log = id === 'cto' ? fakeLog : '';
    else { const f = logFile(id, s); if (!f) return { items: [], state: load() }; try { log = tail(f); } catch { return { items: [], state: load() }; } }
    const st = load();
    const r = maybeMissed(conversation(log), { typing: s.inputStarts || [], opened: s.opened || [], judged: st.judged });
    if (SMOKE) { for (const u of r.unsure) st.judged[u.key] = false; }
    else judge(r.unsure);
    return { items: r.items, state: st };
  });
  ipcMain.handle('missed:mark', (_e, key, how) => {
    const st = load(), k = String(key);
    if (how === 'later') st.later[k] = Date.now() + LATER_MS;
    else if (how === 'seen' || how === 'answered') st[how][k] = Date.now();
    else return false;
    save();
    return true;
  });
  ipcMain.on('missed:opened', (_e, id, p) => {
    const s = sessions.get(id);
    if (!s || typeof p !== 'string') return;
    (s.opened = s.opened || []).push(p);
    if (s.opened.length > 200) s.opened.shift();
  });
  // The smoke run's stand-in for a CTO log.
  if (SMOKE) ipcMain.handle('missed:fake', (_e, text, typing) => {
    fakeLog = String(text || '');
    for (const s of sessions.values()) if (Array.isArray(typing)) s.inputStarts = typing;
    return true;
  });
}

function head(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try { const b = Buffer.alloc(bytes); return b.toString('utf8', 0, fs.readSync(fd, b, 0, bytes, 0)); } finally { fs.closeSync(fd); }
}

// Times the owner started typing in a pane: a key after 3 s of none starts a new burst. Focus
// reports the terminal sends on its own are not typing.
export function noteTyping(s, data) {
  if (/^(\x1b\[[IO])+$/.test(String(data))) return;
  const now = Date.now();
  if (!s.lastKey || now - s.lastKey > 3000) {
    (s.inputStarts = s.inputStarts || []).push(now);
    if (s.inputStarts.length > 300) s.inputStarts.shift();
  }
  s.lastKey = now;
}
