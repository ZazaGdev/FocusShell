// How full each pane's context window is (#3016), for the page's watch that asks a full pane to
// stop at a safe point and reopens it fresh. Read from the pane's own Claude Code log (the rules
// are in lib/context.js), the owner's status line mirror, and, for a pane the page has asked,
// how its turn stands and the background subagents it still runs. Read-only. Kept out of main.js.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { encodeProjectDir, runningSubagents } from './lib/history.js';
import { isMgr } from './lib/groups.js';
import { extraOf } from './lib/sessions.js';
import { conversationFinder, subagentMetas } from './background.js';
import { inScope, tailEntries, tokensOf, lastTurn, turnState, windowOf, askAt, mirrorPercent, percentOf, TAIL, LONG_TAIL, LARGE } from './lib/context.js';

// The last bytes of a file, and whether that starts mid-file.
function tail(file, size, bytes) {
  const from = Math.max(0, size - bytes), b = Buffer.alloc(size - from);
  const fd = fs.openSync(file, 'r');
  try { return [b.toString('utf8', 0, fs.readSync(fd, b, 0, b.length, from)), from > 0]; } finally { fs.closeSync(fd); }
}
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

// d: { ipcMain, SMOKE, DEMO, demoClaude, sessions, live(s) -> whether Claude runs in that pane,
//      personal() -> the Personal projects' names, brainstorm(id) -> whether id is a brainstorm session }
export function registerContext(d) {
  const { ipcMain, SMOKE, DEMO, demoClaude, sessions, live } = d;
  const claudeDir = DEMO ? demoClaude : path.join(os.homedir(), '.claude');
  const projectsDir = path.join(claudeDir, 'projects');
  const usageDir = path.join(os.homedir(), '.claude', 'usage'); // the owner's status line mirror, never in Demo mode
  const conversationOf = conversationFinder(projectsDir, DEMO);
  const logs = new Map(); // log file -> { mtime, size, tokens, last }, so an unchanged log is not read again
  const finished = new Map(); // subagents folder -> its finished meta files (background.js subagentMetas)
  const fakes = new Map(); // smoke and try runs: pane id -> { percent, ready, endedAt, subagents }
  const override = () => process.env.FOCUSSHELL_CONTEXT_AT;

  // The last 1 MB of the log, or the last 8 MB once when no reply with usage is in that.
  function readLog(file, used) {
    let st;
    try { st = fs.statSync(file); } catch { return null; }
    used.add(file);
    const had = logs.get(file);
    if (had && had.mtime === st.mtimeMs && had.size === st.size) return had;
    let entries;
    try {
      entries = tailEntries(...tail(file, st.size, TAIL));
      if (tokensOf(entries) == null && st.size > TAIL) entries = tailEntries(...tail(file, st.size, LONG_TAIL));
    } catch { return null; }
    const got = { mtime: st.mtimeMs, size: st.size, birth: st.birthtimeMs, tokens: tokensOf(entries), last: lastTurn(entries) };
    logs.set(file, got);
    return got;
  }

  // One pane: endedAt and ready only once the page has asked it (askedAt), else null; subagents
  // also for a CTO not asked (its day ask waits on them), null when its conversation is not known.
  function paneContext(id, s, askedAt, now, defaultModel, used) {
    const conv = s.cwd ? conversationOf(id, s, now) : null;
    const dir = conv ? path.join(projectsDir, encodeProjectDir(s.cwd)) : null;
    const log = conv ? readLog(path.join(dir, `${conv}.jsonl`), used) : null;
    // A session that ends writes to its log once more, so a pane just reopened fresh finds its old
    // conversation, written since it started, until its new log appears seconds later. A log born
    // before the pane started is not its own, unless the pane resumed it: look again next round.
    const old = log && log.birth > 0 && log.birth < s.startedAt - 1000 && conv !== s.resumeId;
    if (old) conversationOf.forget(id);
    const tokens = log && !old ? log.tokens : null;
    const window = windowOf({ model: s.model, defaultModel: s.model ? '' : defaultModel(), tokens });
    const mirror = conv && !old && !DEMO ? mirrorPercent(readJson(path.join(usageDir, `${conv}.json`)), conv, now) : null;
    // since: when this conversation began (its log's birth; a resumed one keeps its old birth, so a
    // resumed CTO is due for the day too, #3073); idleAt: when its last turn ended.
    const out = { percent: percentOf({ tokens, window, mirror }), askAt: askAt(window, override(), isMgr(id) || !!extraOf(id)), endedAt: null, ready: null, subagents: null,
      since: log && !old && log.birth > 0 ? log.birth : null, idleAt: log && !old && log.last ? log.last.endedAt : null };
    if (old || !(askedAt || isMgr(id))) return out;
    if (askedAt) Object.assign(out, turnState(log && log.last, askedAt));
    if (conv) {
      const sub = path.join(dir, conv, 'subagents'), ended = finished.get(sub) || new Map();
      finished.set(sub, ended);
      out.subagents = runningSubagents(subagentMetas(sub, ended));
    }
    return out;
  }

  // A smoke run's fake for one pane, read as a real one is.
  const fakeContext = (f, askedAt) => ({
    percent: typeof f.percent === 'number' ? f.percent : null, askAt: typeof f.askAt === 'number' ? f.askAt : askAt(LARGE, override()),
    endedAt: askedAt ? f.endedAt || null : null, ready: askedAt ? f.ready || null : null,
    subagents: askedAt ? f.subagents || 0 : typeof f.subagents === 'number' ? f.subagents : null,
    since: f.since || null, idleAt: f.idleAt || null,
  });

  // asks: { pane id: when the page asked it to stop (ms) }. Answers { pane id: { percent, askAt,
  // endedAt, ready, subagents, since, idleAt } } for every pane in scope that Claude runs in.
  ipcMain.handle('session:context', (_e, asks) => {
    const asked = asks && typeof asks === 'object' ? asks : {}, out = {}, now = Date.now(), used = new Set();
    const personal = d.personal();
    let model;
    const defaultModel = () => {
      if (model === undefined) { const c = readJson(path.join(claudeDir, 'settings.json')); model = c && typeof c.model === 'string' ? c.model : ''; }
      return model;
    };
    for (const [id, s] of sessions) {
      if (!live(s) || !inScope(id, { personal, brainstorm: d.brainstorm(id) })) { conversationOf.forget(id); continue; }
      const askedAt = Number(asked[id]) > 0 ? Number(asked[id]) : null;
      if (SMOKE) { if (fakes.has(id)) out[id] = fakeContext(fakes.get(id), askedAt); continue; }
      out[id] = paneContext(id, s, askedAt, now, defaultModel, used);
    }
    conversationOf.keepOnly(sessions);
    for (const f of logs.keys()) if (!used.has(f)) logs.delete(f);
    return out;
  });
  // The smoke run's fakes: (id, { percent, ready, endedAt, subagents, since, idleAt }), or (id, null) to drop one.
  if (SMOKE) ipcMain.handle('smoke:context', (_e, id, fake) => {
    if (fake && typeof fake === 'object') fakes.set(String(id), fake); else fakes.delete(String(id));
    return true;
  });
}
