// FocusShell main process: owns the Claude Code sessions (pseudo-terminals) and the
// files they share; the window only draws them.
import { guardWindow } from './window-guard.js'; // first: it guards every IPC handler registered after it
import { app, BrowserWindow, ipcMain, dialog, shell, Notification, clipboard, ClipboardItem, powerMonitor, desktopCapturer, screen } from 'electron';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseProjects, trustedPaths, isTrusted, mergeProjects, withProjectModel } from './lib/projects.js';
import { waitingFor, plainText } from './lib/prompts.js';
import { trustQuestion, trustKeys, joined, JOIN_GRACE_MS, TRUST_WATCH_MS } from './lib/joined.js';
import { missingTools } from './lib/requirements.js';
import { nextShared } from './lib/counter.js';
import { leadArgs, managerArgs, pmArgs, withModel, cleanEnv, renderLeadPrompt, renderGroupPrompt, secondOf, secondLeadNote, submits, working, owns, sessionName, demoArgs, withoutRemote, ownSetupSettings, withSettings, DEMO_NOTE, keepShell, shellTitle, nameProblem, spawnArgs } from './lib/sessions.js';
import { normalizeGroups, findGroup, managerFor, groupOfMgr, isMgr } from './lib/groups.js';
import { addTaskLine, addNoteLine, newAlerts, holdAlerts, dueAlerts, seenAlerts, parseTasks } from './lib/tasks.js';
import { laterToasts, usingApp, shouldToast } from './lib/toasts.js';
import { encodeProjectDir, lastConversation } from './lib/history.js';
import { normalizeSettings, modelFor, upgradeSettings } from './lib/settings.js';
import { isPersonal, personalArgs, seedPersonal } from './lib/personal.js';
import { dueReminders, setSomeday, setSchedule } from './lib/me.js';
import { registerMeFiles, resetSmokeMe } from './me-files.js';
import { registerHelper } from './helper.js';
import { registerCatchup } from './catchup.js';
import { registerSetupCheck } from './setup-check.js';
import { voiceBar } from './lib/voicebar.js';
import { registerUpdater } from './updater.js';
import { updatesOn } from './lib/update.js';
import { registerProjectPage } from './project-page.js';
import { registerCodeWeb } from './code-web.js';
import { registerMissed, noteTyping } from './missed.js';
import { registerStatus } from './lead-status.js';
import { registerRequests } from './requests.js';
import { registerGlobalTalk } from './global-talk.js';
import { registerCommits } from './commits.js';
import { registerPlugins } from './plugins-host.js';
import { pluginServices } from './plugin-services.js';
import { update } from './lib/boardio.js';
import { activeHelpers } from './lib/tavern/helpers.js';
import { sessionBoard, periodBoard, periodStart } from './lib/tavern/tokens.js';
import { tasksDone } from './lib/tavern/tally.js';
import { fiveHour } from './lib/tavern/usage.js';
import { keepPid, releasePid } from './lib/pidfile.js';
import { copyRoom } from './build/copy-room.mjs';

const require = createRequire(import.meta.url);
const pty = require('node-pty');

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
// Where FocusShell keeps its data (tasks, briefs, notes, the manager's folder). The
// installed app lives in Program Files, so it cannot use its own parent folder.
// Order: FOCUSSHELL_HOME, then deckRoot in the user-data config.json, then the
// development layout (this repo), then user data.
// --demo (#135): a second copy beside the real one, on the demo's data folder and its own
// user-data folder, so window state, config and VS Code storage are never shared.
const DEMO = process.argv.includes('--demo');
const DEMO_HOME = path.resolve(process.env.FOCUSSHELL_HOME || path.join(path.parse(APP_DIR).root, 'FocusShellDemo', 'deck'));
const APP_NAME = DEMO ? 'FocusShell Demo' : 'FocusShell';
if (DEMO) app.setPath('userData', path.join(path.dirname(DEMO_HOME), 'userdata'));
function resolveDeck() {
  if (DEMO) return DEMO_HOME;
  if (process.env.FOCUSSHELL_HOME) return path.resolve(process.env.FOCUSSHELL_HOME);
  try {
    const c = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8'));
    if (c && c.deckRoot) return path.resolve(c.deckRoot);
  } catch { /* no config yet */ }
  if (!app.isPackaged) return path.resolve(APP_DIR, '..');
  return path.join(app.getPath('userData'), 'deck');
}
const DECK = resolveDeck();

// A fresh data folder gets the lead prompt, the manager's rules and the backlog skill
// from the installer's resources. Existing files are never overwritten.
function seedDeck() {
  if (!app.isPackaged) return;
  const seed = path.join(process.resourcesPath, 'seed');
  const copy = (from, to) => {
    if (!fs.existsSync(from)) return;
    if (fs.statSync(from).isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      for (const f of fs.readdirSync(from)) copy(path.join(from, f), path.join(to, f));
    } else if (!fs.existsSync(to)) {
      fs.copyFileSync(from, to);
    }
  };
  copy(seed, DECK);
}
// The CTO (once called the manager) runs in its own folder so the repo root's CLAUDE.md can
// be for developers; the folder keeps its old name. The PM has a folder of its own.
const MANAGER_DIR = path.join(DECK, 'manager');
const PM_DIR = path.join(DECK, 'pm');
const P = {
  projects: path.join(DECK, 'projects.json'),
  tasks: path.join(DECK, 'tasks'),
  notes: path.join(DECK, 'notes.md'),
  projectNotes: path.join(DECK, 'notes'),
  briefs: path.join(DECK, 'briefs'),
  leadTemplate: path.join(DECK, 'lead-prompt.md'),
  state: path.join(DECK, 'state'),
  prompts: path.join(DECK, 'state', 'prompts'),
  requests: path.join(DECK, 'state', 'requests'),
  worktrees: path.join(DECK, 'state', 'worktrees'),
  ui: path.join(DECK, 'state', 'ui.json'),
  groups: path.join(DECK, 'groups.json'),
  groupTemplate: path.join(MANAGER_DIR, 'group-prompt.md'),
  recent: path.join(DECK, 'state', 'recent.json'),
  settings: path.join(DECK, 'state', 'settings.json'),
  reminders: path.join(DECK, 'state', 'reminders.json'),
  pid: path.join(DECK, 'state', 'app.pid'),
  smoke: path.join(DECK, 'state', 'smoke'),
};
// --try: the smoke test's fake sessions and no saved state, but the window stays open, so
// a branch can be tried beside the real FocusShell without two sessions sharing a name.
const TRY = process.argv.includes('--try');
const SMOKE = TRY || process.argv.includes('--smoke');
// The smoke run's window is never shown: it paints and is captured while hidden, so it
// neither covers the owner's screen nor takes focus (#171). A --try window shows as usual.
// FOCUSSHELL_HIDDEN=1 keeps a test build's window off the owner's screen too (#1088's update test).
const HIDDEN = (SMOKE && !TRY) || process.env.FOCUSSHELL_HIDDEN === '1';
// Smoke and try runs share the real app's data folder, so they once watched its
// state/requests too and raced it for the CTO's open and close requests: a request a test
// run took never reached the real app (#185). They watch a folder of their own.
if (SMOKE) P.requests = path.join(P.smoke, 'requests');
// A try run keeps its window state (the Board's filters) in a file of
// its own, so a restarted try run comes back as it was and the real ui.json is never touched (#300).
if (TRY) P.ui = path.join(P.smoke, 'try-ui.json');
// A smoke run that fails, in this process or the page, must not leave a window or Electron's
// error dialog behind (#187): it writes the error to state/smoke/error.txt and stderr and
// exits with code 1. One that has not finished after twelve minutes fails the same way (the
// 60 s talk-key hold of #1003 made ten too tight).
// FOCUSSHELL_SMOKE_THROW=main|page forces a failure, to check this.
function smokeFail(where, e) {
  const text = `${new Date().toISOString()} smoke run failed in ${where}: ${(e && e.stack) || e}\n`;
  try { fs.mkdirSync(P.smoke, { recursive: true }); fs.appendFileSync(path.join(P.smoke, 'error.txt'), text); } catch { /* still exit */ }
  try { process.stderr.write(text); } catch { /* still exit */ }
  try { stopCodeWeb(); } catch { /* not started */ }
  app.exit(1);
}
if (HIDDEN) {
  try { fs.rmSync(path.join(P.smoke, 'error.txt'), { force: true }); } catch { /* none */ }
  process.on('uncaughtException', e => smokeFail('the main process', e));
  process.on('unhandledRejection', e => smokeFail('the main process', e));
  setTimeout(() => smokeFail('the run', 'it did not finish within twelve minutes'), 12 * 60000).unref();
  if (process.env.FOCUSSHELL_SMOKE_THROW === 'main') setTimeout(() => { throw new Error('forced main process error (FOCUSSHELL_SMOKE_THROW=main)'); }, 8000);
}
// Page capture fails with the GPU compositor on some setups; software is fine for screenshots.
if (SMOKE) app.disableHardwareAcceleration();
// Ideas and saved sketches (#130). A smoke or try run keeps its own under state/smoke.
const ME_DATA = SMOKE ? path.join(P.smoke, 'data') : DECK;
P.ideas = path.join(ME_DATA, 'ideas');
P.sketches = path.join(ME_DATA, 'sketches');
const BUFFER_MAX = 400_000;

let win = null;
let quitting = false;
const sessions = new Map(); // id -> { pty, buffer, alive }

const read = (f, d = '') => { try { return fs.readFileSync(f, 'utf8'); } catch { return d; } };
// Every board write takes the lock the deck command takes, re-reads and writes whole (#225).
const BOARD_LOCK = () => path.join(P.state, 'board.lock');
const board = (f, fn, empty = '') => update(BOARD_LOCK(), f, fn, empty);
const today = () => new Date().toISOString().slice(0, 10);
const nowStamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };

// projects.json settings plus every folder under its scanRoots (default: the deck's parent).
// The folders projects are listed from: scanRoots in projects.json (Settings' "Projects
// folder", #346), else the data folder's parent, except for an installed app whose data
// sits in its user-data folder: that one lists nothing until a folder is chosen.
let smokeConnected = null; // a smoke run's connected projects (#1061), never written to projects.json
let smokeModels = null;    // a smoke run's project models (#1115): entries -> entries with them
function projectRoots(cfg = parseProjects(read(P.projects, '{"projects":[]}'))) {
  if (cfg.scanRoots && cfg.scanRoots.length) return cfg.scanRoots;
  // The Demo starts as an installed app does (#1058), not with its own folder's contents.
  const inUserData = DEMO || !path.relative(app.getPath('userData'), DECK).startsWith('..');
  return inUserData ? [] : [path.dirname(DECK)];
}
function loadProjects() {
  const cfg = parseProjects(read(P.projects, '{"projects":[]}'));
  if (SMOKE && smokeConnected) cfg.projects = smokeConnected;
  if (SMOKE && smokeModels) cfg.projects = smokeModels(cfg.projects);
  const roots = projectRoots(cfg);
  const folders = [];
  for (const root of roots) {
    try {
      for (const d of fs.readdirSync(root, { withFileTypes: true })) {
        if (d.isDirectory() && !d.name.startsWith('.')) folders.push({ name: d.name, path: path.join(root, d.name) });
      }
    } catch { /* root missing */ }
  }
  const real = p => { try { return fs.realpathSync.native(p); } catch { return p; } };
  cfg.projects = mergeProjects(cfg.projects, folders, MANAGER_DIR, real);
  return cfg;
}
function loadTrusted() { try { return trustedPaths(read(path.join(os.homedir(), '.claude.json'), '{}')); } catch { return []; } }
function voiceMode() {
  try {
    // The Demo's sessions use its own Claude folder, so its voice mode is read there (#222).
    const s = JSON.parse(read(path.join(DEMO ? DEMO_CLAUDE : path.join(os.homedir(), '.claude'), 'settings.json'), '{}'));
    return (s.voice && s.voice.mode) || 'hold';
  } catch { return 'hold'; }
}

// ---------- sessions ----------
function readGroups() { try { return normalizeGroups(JSON.parse(read(P.groups, '[]').replace(/^﻿/, ''))); } catch { return []; } }

// With the PM off in Settings (#172), every CTO starts with manager/no-pm.md added to its
// rules, so it knows it keeps the board itself.
function noPmRules() {
  let s = {}; try { s = JSON.parse(read(P.settings, '{}')); } catch { /* defaults */ }
  return normalizeSettings(s).runPm ? '' : read(path.join(MANAGER_DIR, 'no-pm.md'));
}

// The CTO's and PM's rules name places as <data> and <projects> (#346); this note, added to
// their prompt, says where those are on this PC. Then the owner's own rules for that
// session, if any: state/rules-cto.md or state/rules-pm.md, kept out of git.
function placeRules(who) {
  const where = `# Where FocusShell is on this PC\n\nIn your rules and skills, \`<data>\` is FocusShell's data folder, \`${DECK}\`, and \`<projects>\` is the folder projects are listed from, \`${projectRoots().join('`, `')}\`.`;
  const own = read(path.join(P.state, `rules-${who}.md`)).trim();
  return own ? `${where}\n\n${own}` : where;
}
// The CTOs' and PM's session setting that keeps the developer guide out of them (#349).
const ownSettingsFile = () => promptFileFor('own-setup-settings', JSON.stringify(ownSetupSettings(DECK), null, 2), '.json');
function promptFileFor(name, text, ext = '.md') {
  fs.mkdirSync(P.prompts, { recursive: true });
  const f = path.join(P.prompts, `${name}${ext}`);
  fs.writeFileSync(f, text);
  return f;
}

// The recorder's brainstorm sessions (#369 stage 4): brainstorm-cto in manager/, brainstorm-pm
// in pm/, each with that agent's own rules and setup plus the prompt the plugin wrote, and its
// recording's folder added so it can write the proposal there.
const brainstorms = new Map(); // id: { who, promptFile, addDir }
const brainstormService = {
  start(who, prompt, addDir) {
    const id = `brainstorm-${who === 'pm' ? 'pm' : 'cto'}`;
    this.end(id);
    brainstorms.set(id, { who: who === 'pm' ? 'pm' : 'cto', addDir, promptFile: promptFileFor(id, `${placeRules(who === 'pm' ? 'pm' : 'cto')}\n\n${prompt}`) });
    const r = openSession(id, null, {});
    if (!r.ok) { brainstorms.delete(id); throw new Error(r.error || 'the session did not start'); }
    return id;
  },
  end(id) {
    const s = sessions.get(id);
    if (s && s.alive) try { s.pty.kill(); } catch { /* gone */ }
    sessions.delete(id);
    brainstorms.delete(id);
  },
  alive: id => { const s = sessions.get(id); return !!(s && claudeOn(s)); },
};

function sessionSpec(id, resumeId, opts = {}) {
  if (brainstorms.has(id)) {
    const b = brainstorms.get(id);
    return { cwd: b.who === 'pm' ? PM_DIR : MANAGER_DIR, args: withSettings([...managerArgs(id, b.promptFile), '--add-dir', b.addDir], ownSettingsFile()) };
  }
  if (id === 'cto') {
    const extra = noPmRules();
    return { cwd: MANAGER_DIR, args: withSettings(managerArgs('cto', promptFileFor('cto', placeRules('cto') + (extra ? `\n\n${extra}` : '')), resumeId), ownSettingsFile()) };
  }
  if (id === 'pm') return { cwd: PM_DIR, args: withSettings(pmArgs(resumeId, promptFileFor('pm', placeRules('pm'))), ownSettingsFile()) };
  // A group's CTO shares the CTO's folder and rules, plus its group rules.
  const group = groupOfMgr(id);
  if (group) {
    const g = findGroup(readGroups(), group);
    if (!g) throw new Error(`Unknown group ${group}`);
    if (!fs.existsSync(P.groupTemplate)) throw new Error(`Missing ${P.groupTemplate}`);
    const extra = noPmRules();
    const promptFile = promptFileFor(`cto-${g.name}`, placeRules('cto') + '\n\n' + renderGroupPrompt(read(P.groupTemplate), g.name, P.groups) + (extra ? `\n\n${extra}` : ''));
    return { cwd: MANAGER_DIR, args: withSettings(managerArgs(`cto-${g.name}`, promptFile, resumeId), ownSettingsFile()) };
  }
  // A project's second lead shares its task file; it works in the project folder or,
  // when asked, in its own git worktree.
  const second = secondOf(id), name = second || id;
  const proj = loadProjects().projects.find(p => p.name === name);
  if (!proj) throw new Error(`Unknown project ${name}`);
  if (nameProblem(name)) throw new Error(nameProblem(name)); // #388
  // Personal (#177): its own CLAUDE.md is its rules, no lead prompt or task file; its folder
  // is filled from the personal/ template the first time it opens.
  if (isPersonal(proj)) {
    if (second) throw new Error(`${name} has no second lead`);
    fs.mkdirSync(proj.path, { recursive: true });
    seedPersonal(path.join(DECK, 'personal'), proj.path);
    return { cwd: proj.path, args: personalArgs(name, resumeId) };
  }
  fs.mkdirSync(P.prompts, { recursive: true });
  fs.mkdirSync(P.tasks, { recursive: true });
  const taskFile = path.join(P.tasks, `${name}.md`);
  if (!fs.existsSync(taskFile)) fs.writeFileSync(taskFile, `# ${name} tasks\n`);
  let prompt = renderLeadPrompt(read(P.leadTemplate), name, taskFile, proj.test, (DEMO ? 'demo-' : '') + managerFor(readGroups(), name), path.join(DECK, 'deck.mjs'));
  const worktree = second && opts.worktree ? addWorktree(proj) : null;
  if (second) prompt += secondLeadNote(name, worktree && { main: proj.path });
  const lead = second ? `${name}-2` : name;
  const promptFile = path.join(P.prompts, `lead-${lead}.md`);
  fs.writeFileSync(promptFile, prompt);
  return { cwd: worktree || proj.path, args: leadArgs(lead, promptFile, second ? null : resumeId), worktree: worktree && proj };
}

// The pane's model from Settings (#142), read at each start so a change applies next start.
// In the Demo (#135) a session runs as demo-<name>, without Remote Control, and its rules get
// a note saying so, added to the prompt file it already has or as one of its own.
function demoed(spec) {
  if (!DEMO) return spec;
  const args = demoArgs(spec.args), name = args[args.indexOf('-n') + 1] || 'demo-session';
  const i = args.indexOf('--append-system-prompt-file');
  fs.mkdirSync(P.prompts, { recursive: true });
  const file = path.join(P.prompts, `${name}.md`);
  fs.writeFileSync(file, (i >= 0 ? read(args[i + 1]) + '\n\n' : '') + DEMO_NOTE);
  if (i >= 0) args[i + 1] = file; else args.push('--append-system-prompt-file', file);
  return { ...spec, args };
}
// A model named when the pane was opened (#202) comes first, then a lead's project model from
// Settings > Projects (#1115), then FocusShell's own sessions' models.
function modelled(id, spec, named) {
  let s = {}; try { s = JSON.parse(read(P.settings, '{}')); } catch { /* defaults */ }
  const own = isMgr(id) || id === 'pm' ? '' : (findProject(String(id).replace(/:2$/, '')) || {}).model || '';
  const model = named || own || modelFor(s, id), args = normalizeSettings(s).remoteControl ? spec.args : withoutRemote(spec.args);
  return { ...spec, model, args: withModel(args, model) };
}

// The second lead's worktree: state/worktrees/<Project>-2 on branch lead-2, made from the
// project's current branch, or reused while it is still there.
const worktreeDir = proj => path.join(P.worktrees, `${proj.name}-2`);
function gitSync(cwd, args) {
  try { return execFileSync('git', ['-C', cwd, ...args], { windowsHide: true, timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] }).toString(); }
  catch (e) { throw new Error(String(e.stderr || e.message).trim().split('\n').pop()); }
}
function addWorktree(proj) {
  const dir = worktreeDir(proj);
  if (fs.existsSync(path.join(dir, '.git'))) return dir;
  try { gitSync(proj.path, ['rev-parse', '--git-dir']); } catch { throw new Error(`${proj.name} is not a git repository, so it cannot have a worktree.`); }
  let hasBranch = true;
  try { gitSync(proj.path, ['rev-parse', '--verify', '--quiet', 'refs/heads/lead-2']); } catch { hasBranch = false; }
  fs.mkdirSync(P.worktrees, { recursive: true });
  try { gitSync(proj.path, hasBranch ? ['worktree', 'add', dir, 'lead-2'] : ['worktree', 'add', '-b', 'lead-2', dir]); }
  catch (e) { throw new Error(`Could not make the worktree for ${proj.name}: ${e.message}`); }
  return dir;
}
// Once the second lead has ended: remove its worktree and branch when the branch is merged
// into the project's current branch and nothing is left uncommitted. Says what it did.
async function removeWorktree(proj) {
  const dir = worktreeDir(proj);
  if (!fs.existsSync(dir)) return '';
  try {
    if (gitSync(dir, ['status', '--porcelain']).trim()) return `Worktree kept: ${dir} has uncommitted changes.`;
    try { gitSync(proj.path, ['merge-base', '--is-ancestor', 'lead-2', 'HEAD']); }
    catch { return `Worktree kept: branch lead-2 has commits not merged into ${proj.name}'s current branch.`; }
  } catch (e) { return `Worktree kept: ${e.message}`; }
  // Windows holds the folder for a moment after the session's processes end.
  for (let i = 0; ; i++) {
    try { gitSync(proj.path, ['worktree', 'remove', dir]); gitSync(proj.path, ['branch', '-d', 'lead-2']); return 'Worktree and branch lead-2 removed.'; }
    catch (e) { if (i === 5) return `Worktree kept: could not remove it (${e.message}).`; await new Promise(r => setTimeout(r, 1000)); }
  }
}

// Claude running in a pane: its shell alive and Claude not exited from it (#353).
const claudeOn = s => s.alive && !s.ended;

function openSession(id, resumeId, opts) {
  const existing = sessions.get(id);
  if (existing && claudeOn(existing)) return { ok: true, buffer: existing.buffer };
  // Claude ended there but its shell lives on: that shell makes way for the new session.
  if (existing && existing.alive) { try { existing.pty.kill(); } catch { /* gone */ } }
  let spec;
  // In the smoke run a resume always fails at once, so Restart's fresh fallback is exercised.
  try { spec = SMOKE ? { cwd: DECK, args: resumeId ? ['/c', 'echo No conversation found & exit /b 1'] : ['/k', `echo ${sessionName(id)} (smoke test, no Claude session)`] } : demoed(modelled(id, sessionSpec(id, resumeId, opts), opts.model)); }
  catch (e) { return { ok: false, error: e.message }; }
  let line;
  try { line = spawnArgs(keepShell(spec.args)); } catch (e) { return { ok: false, error: e.message }; }
  const p = pty.spawn('cmd.exe', line, {
    name: 'xterm-256color', cols: 120, rows: 30, cwd: spec.cwd, env: DEMO ? { ...cleanEnv(process.env), CLAUDE_CONFIG_DIR: DEMO_CLAUDE } : cleanEnv(process.env), useConpty: true,
    // The ConPTY built into Windows drops mouse input, so Claude Code's screen could not
    // be scrolled with the wheel. node-pty ships the newer one Windows Terminal uses.
    useConptyDll: true,
  });
  // A resumed session already holds a conversation, so it counts as used from the start.
  const s = { pty: p, buffer: '', total: 0, typedAt: 0, waiting: null, alive: true, lastOutput: 0, cwd: spec.cwd, worktree: spec.worktree || null, used: !!resumeId, resumeId, startedAt: Date.now(), model: SMOKE ? opts.model || '' : spec.model || '' };
  sessions.set(id, s);
  p.onData(data => {
    if (!owns(sessions, id, s)) return;
    const title = shellTitle(s.buffer.slice(-200) + data);
    s.buffer = (s.buffer + data).slice(-BUFFER_MAX);
    s.total += data.length;
    s.lastOutput = Date.now();
    if (!s.used && working(s.buffer.slice(-data.length - 200))) s.used = true;
    send('session:data', { id, data });
    // Claude Code's first-run "trust this folder" question (#1113): a session waits on it before
    // it joins messaging, so the CTO could not reach it. Connecting a project means trusting it,
    // and FocusShell's own folders are its own: answered Yes here, once, soon after opening.
    if (!SMOKE && !s.trustDone && Date.now() - s.startedAt < TRUST_WATCH_MS && trustQuestion(plainText(s.buffer.slice(-4000)))) {
      // The question draws in pieces: read which choice is highlighted once it has settled.
      s.trustDone = true;
      setTimeout(() => {
        const keys = trustKeys(plainText(s.buffer.slice(-4000)));
        if (keys && owns(sessions, id, s) && s.alive) p.write(keys); else s.trustDone = false;
      }, 600);
    }
    // Claude exited and cmd has the pane back (#353); a claude typed at that prompt is Claude back.
    if (title === 'ended' && !s.ended) claudeEnded(true);
    else if (title === 'back' && s.ended) { s.ended = false; send('session:back', { id }); }
  });
  // Restart resumes the pane's last conversation (#197); a resume that dies at once
  // (the conversation is gone or unreadable) starts a fresh session instead.
  const claudeEnded = shell => {
    s.ended = true;
    if (opts.orFresh && Date.now() - s.startedAt < 15000) {
      opts = { ...opts, orFresh: false };
      if (openSession(id, null, opts).ok) {
        send('session:data', { id, data: '\r\n[FocusShell] Could not resume the last conversation, so a fresh session started.\r\n' });
        return;
      }
    }
    send('session:exit', { id, shell });
  };
  p.onExit(() => {
    s.alive = false;
    if (!owns(sessions, id, s)) return;
    if (s.ended) send('session:exit', { id, shell: false }); else claudeEnded(false);
  });
  return { ok: true, buffer: '' };
}

ipcMain.handle('session:open', (_e, id, resumeId, opts) => openSession(id, resumeId, opts || {}));

// A session not joined to messaging a minute after it opened (#1113): stuck on some other
// question, or failed. The window says so on that pane with a Reopen button, once.
function checkJoined() {
  if (SMOKE) return;
  const dir = path.join(DEMO ? DEMO_CLAUDE : path.join(os.homedir(), '.claude'), 'sessions');
  let files;
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => { try { return JSON.parse(read(path.join(dir, f), 'null')); } catch { return null; } }); } catch { return; }
  for (const [id, s] of sessions) {
    if (s.joined || s.notJoinedTold || !claudeOn(s) || Date.now() - s.startedAt < JOIN_GRACE_MS) continue;
    const r = joined(files, (DEMO ? 'demo-' : '') + sessionName(id), s.startedAt);
    if (r === true) s.joined = true;
    else if (r === false) { s.notJoinedTold = true; send('session:notjoined', { id }); }
  }
}
setInterval(checkJoined, 10000);
// The conversation an ended pane last ran (#197): the newest session file in its folder,
// written since it started, under its name; else the one it was resumed from.
ipcMain.handle('session:last', (_e, id) => {
  const s = sessions.get(id);
  if (!s) return null;
  const dir = path.join(os.homedir(), '.claude', 'projects', encodeProjectDir(s.cwd));
  const files = [];
  try {
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.jsonl'))) {
      const file = path.join(dir, f), mtime = fs.statSync(file).mtimeMs;
      if (mtime >= s.startedAt - 1000) files.push({ id: f.slice(0, -6), mtime, text: head(file, 256 * 1024) });
    }
  } catch { /* no session files yet */ }
  return lastConversation(files, sessionName(id, DEMO ? 'demo-' : '')) || s.resumeId || null;
});
function head(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try { const b = Buffer.alloc(bytes); return b.toString('utf8', 0, fs.readSync(fd, b, 0, bytes, 0)); } finally { fs.closeSync(fd); }
}
ipcMain.on('session:write', (_e, { id, data }) => { const s = sessions.get(id); if (s && s.alive) { if (submits(data)) s.used = true; s.typedAt = s.total; noteTyping(s, data); s.pty.write(data); } });
// A Sketch (#94) lands in the prompt the way a pasted screenshot does: the PNG goes on the
// clipboard and Claude Code's image-paste key (Alt+V on Windows) attaches it as [Image #n].
// Nothing is submitted.
ipcMain.handle('sketch:paste', async (_e, { id, png }) => {
  const s = sessions.get(id);
  if (!s || !s.alive) return false;
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
  s.pty.write('\x1bv');
  return true;
});
// What a paste into a pane would bring (#352), asked synchronously while a key is handled:
// the clipboard's text, else whether it holds an image (Claude Code attaches those on Alt+V).
// Electron's clipboard is the promise-based one here; a sync reply can still be set once read.
ipcMain.on('clipboard:kind', async e => {
  let text = '', image = false;
  try { text = String(await clipboard.readText() || ''); if (!text) image = await clipboard.has('image/png'); } catch { /* unreadable */ }
  e.returnValue = text ? { kind: 'text', text } : { kind: image ? 'image' : 'none' };
});
ipcMain.on('session:resize', (_e, { id, cols, rows }) => {
  const s = sessions.get(id);
  if (s && s.alive && cols > 1 && rows > 1) { try { s.pty.resize(cols, rows); } catch { /* exited */ } }
});
// Ending a second lead that had a worktree also cleans the worktree up; the answer says how.
ipcMain.handle('session:kill', async (_e, id) => {
  const s = sessions.get(id);
  if (s && s.alive) {
    const ended = new Promise(r => { s.pty.onExit(r); setTimeout(r, 3000); });
    s.pty.kill();
    if (s.worktree) await ended;
  }
  sessions.delete(id);
  return s && s.worktree ? removeWorktree(s.worktree) : '';
});
// A lead that went quiet on a permission dialog or a question in its own pane (#119): the
// page checks the lead's screen, then marks it, asks for a notification and tells the lead's
// CTO (#191). Only the output since the owner last typed in that pane counts.
setInterval(() => {
  for (const [id, s] of sessions) {
    if (isMgr(id) || id === 'pm' || brainstorms.has(id)) continue; // a brainstorm is in front of the owner already
    // A new prompt counts once output has stopped; a seen one stays until it leaves the screen.
    const look = claudeOn(s) && (s.waiting || Date.now() - s.lastOutput > 2000);
    const what = look ? waitingFor(s.buffer.slice(-Math.min(s.total - s.typedAt, 4000))) : null;
    if (what === s.waiting) continue;
    s.waiting = what;
    send('session:waiting', { id, what });
  }
}, 1000);
// The page found the prompt live on the lead's screen. Its card shows at once; a Windows toast
// only if the lead still waits on that same prompt five minutes later, and only once (#320).
const waitToasts = laterToasts();
// The owner is in FocusShell now (#320): a toast that comes due then is dropped, the card is in front of them.
const using = () => !!win && usingApp({ focused: win.isFocused(), minimized: win.isMinimized(), idleSecs: powerMonitor.getSystemIdleTime() });
ipcMain.on('session:notify-waiting', (_e, { id, what }) => {
  const s = sessions.get(id);
  if (!s || !s.alive || s.waiting !== what) return;
  waitToasts.hold(`wait:${id}:${what}`, { id, what });
  if (win && !win.isFocused()) win.flashFrame(true);
});
setInterval(() => {
  const due = waitToasts.due(Date.now(), a => { const s = sessions.get(a.id); return !!s && s.alive && s.waiting === a.what; });
  if (!due.length || SMOKE || !Notification.isSupported() || !shouldToast('alert', using())) return;
  for (const { id, what } of due) {
    const n = new Notification({ title: `lead-${id.replace(/:2$/, '-2')} is waiting on you`, body: what, icon: path.join(APP_DIR, 'build', 'icon.png') });
    n.on('click', () => { if (win) { win.show(); win.focus(); send('nav:project', id.replace(/:2$/, '')); } });
    n.show();
  }
}, 15000);
ipcMain.handle('session:states', () => Object.fromEntries([...sessions].map(([id, s]) => [id, { alive: claudeOn(s), lastOutput: s.lastOutput, model: s.model }])));
// The tavern's helpers (#240): subagents the live panes run right now, read from Claude's
// transcript folders (file names and times only).
ipcMain.handle('tavern:helpers', () => activeHelpers([...sessions].filter(([, s]) => claudeOn(s)).map(([id, s]) => ({ id, cwd: s.cwd, startedAt: s.startedAt })),
  path.join(DEMO ? DEMO_CLAUDE : path.join(os.homedir(), '.claude'), 'projects')));
// The chalkboard's token board (#246): the live panes' own conversations, read from the logs.
const paneName = id => (id === 'cto' ? 'CTO' : id.startsWith('cto-') ? `CTO ${id.slice(4)}` : id === 'pm' ? 'PM' : `lead-${id.replace(/:2$/, '-2')}`);
// Real numbers (#288), but in Demo mode only from the demo's own Claude folder, so no real
// project name reaches the recorded video (#314).
const claudeProjects = () => path.join(DEMO ? DEMO_CLAUDE : path.join(os.homedir(), '.claude'), 'projects');
ipcMain.handle('tavern:tokens', () => sessionBoard(claudeProjects(),
    [...sessions].filter(([, s]) => claudeOn(s)).map(([id, s]) => ({ id, name: paneName(id), kind: id === 'pm' ? 'PM' : id.startsWith('cto') ? 'CTO' : 'lead', cwd: s.cwd, startedAt: s.startedAt }))));
// The chalkboard's other tabs (#285): tokens today or this week by agent, the demo's own logs in
// Demo mode (#314); tasks marked done on the boards. Its Commits tab asks commits:today (commits.js).
ipcMain.handle('tavern:period', (_e, period) => periodBoard(claudeProjects(), periodStart(period)));
ipcMain.handle('tavern:tasksDone', () => tasksDone(readData().tasks));

// The tap barrels (#279): the 5-hour allowance the status line last wrote; the owner's own, Demo mode too.
ipcMain.handle('tavern:usage', () => fiveHour(path.join(os.homedir(), '.claude', 'usage')));

// The longest of these Windows paths that exists, for links whose path contains spaces.
ipcMain.handle('path:longest', (_e, list) => {
  const ok = (Array.isArray(list) ? list : []).filter(p => typeof p === 'string' && /^[A-Za-z]:[\\/]/.test(p));
  return [...ok].reverse().find(p => { try { return fs.existsSync(path.normalize(p)); } catch { return false; } }) || null;
});

// Bare file names from a pane, each resolved against the pane's folder and the folders
// named in its recent output: the full path when exactly one existing file matches, else null.
ipcMain.handle('path:names', (_e, { id, names, hints }) => {
  const s = sessions.get(id), dirs = [];
  for (const h of [s && s.cwd, ...(Array.isArray(hints) ? hints : [])]) {
    if (typeof h !== 'string' || !/^[A-Za-z]:[\\/]/.test(h)) continue;
    try { const p = path.normalize(h); dirs.push(fs.statSync(p).isDirectory() ? p : path.dirname(p)); } catch { /* not on disk */ }
  }
  return (Array.isArray(names) ? names : []).map(n => {
    if (typeof n !== 'string' || /[\\/]/.test(n)) return null;
    const found = new Map();
    for (const d of dirs) {
      const f = path.join(d, n);
      try { if (fs.statSync(f).isFile()) found.set(f.toLowerCase(), f); } catch { /* not here */ }
    }
    return found.size === 1 ? [...found.values()][0] : null;
  });
});

// Clicked links: folders open in Explorer, files are shown selected in their folder,
// web links open in the browser. Only http(s) goes to the browser.
// Voice on a card: Windows' own voice typing (Win+H) types into the box that has the cursor.
// One PowerShell stays open and presses Win+H for each line it is sent, so only the first
// use pays for starting it.
const VOICE_PS = `Add-Type -Namespace FocusShell -Name Keys -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);'
while ($null -ne [Console]::In.ReadLine()) {
  [FocusShell.Keys]::keybd_event(0x5B, 0, 0, [UIntPtr]::Zero); [FocusShell.Keys]::keybd_event(0x48, 0, 0, [UIntPtr]::Zero)
  [FocusShell.Keys]::keybd_event(0x48, 0, 2, [UIntPtr]::Zero); [FocusShell.Keys]::keybd_event(0x5B, 0, 2, [UIntPtr]::Zero)
}`;
let voicePs = null;
const bar = voiceBar(); // pressed only when it changes the bar (#1083)
const winH = () => {
  if (!voicePs || voicePs.exitCode !== null) {
    voicePs = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(VOICE_PS, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    voicePs.on('error', () => { voicePs = null; });
  }
  try { voicePs.stdin.write('go\n'); return true; } catch { return false; }
};
ipcMain.handle('voice:type', () => { if (SMOKE) return true; if (bar.open() && !winH()) bar.close(); return bar.isOpen; });
// The card's dictation is over (sent, or the mic clicked again): Win+H once more closes the
// voice typing bar this app opened, so it does not sit on screen afterwards (#415).
// The focus log (#1003): one line each time a pane loses the keyboard, while the switch is on.
ipcMain.on('focus:log', (_e, line) => { try { fs.appendFileSync(path.join(SMOKE ? P.smoke : P.state, 'focus-log.txt'), String(line).slice(0, 2000) + '\n'); } catch { /* best effort */ } });
ipcMain.handle('voice:stop', () => { if (SMOKE || !bar.close()) return false; return winH(); });
// A bar still open when FocusShell quits or its page reloads would otherwise outlive the box
// that opened it and greet the owner at the next start (#1015): close it first.
const voiceClose = () => { if (bar.close()) winH(); };
app.on('will-quit', () => {
  // With a last Win+H queued, ending its input lets the PowerShell press it and exit by itself.
  if (voicePs) try { if (bar.isOpen) { voiceClose(); voicePs.stdin.end(); } else voicePs.kill(); } catch { /* gone */ }
  try { plugins.stopAll(); } catch { /* quitting */ }
});

ipcMain.handle('open:path', async (_e, target) => {
  const t = String(target || '').trim();
  if (/^https?:\/\//i.test(t)) { await shell.openExternal(t); return true; }
  if (!/^[A-Za-z]:[\\/]/.test(t)) return false;
  const p = path.normalize(t);
  try {
    if (fs.statSync(p).isDirectory()) { return (await shell.openPath(p)) === ''; }
    if (SMOKE) { console.log(`smoke: shown in Explorer ${p}`); return true; }
    shell.showItemInFolder(p); return true;
  } catch {
    const parent = path.dirname(p);
    if (parent !== p && fs.existsSync(parent)) { return (await shell.openPath(parent)) === ''; }
    return false;
  }
});

// ---------- project page ----------
function findProject(name) { return loadProjects().projects.find(p => p.name === name); }

registerProjectPage({ ipcMain, P, DECK, read, readData, board, nowStamp, loadProjects, loadTrusted, findProject });

const { stopCodeWeb } = registerCodeWeb({ ipcMain, app, shell, P, SMOKE, sessions, findProject, loadProjects });
registerStatus({ ipcMain, P, SMOKE });
registerMissed({ ipcMain, P, SMOKE, DEMO, demoClaude: path.join(path.dirname(DEMO_HOME), 'claude'), sessions, cleanEnv });

// ---------- shared files ----------
function readData() {
  const tasks = {};
  try { for (const f of fs.readdirSync(P.tasks)) if (f.endsWith('.md')) tasks[f.slice(0, -3)] = read(path.join(P.tasks, f)); } catch { /* none yet */ }
  return { tasks, notes: read(P.notes), ideas: read(path.join(P.ideas, 'Me.md')) };
}
registerMeFiles({ ipcMain, read, readData, today, P, board });
registerHelper({ ipcMain, read, readData, today, cleanEnv, projectList, smoke: SMOKE, P, board });
registerCatchup({ ipcMain, P, SMOKE, read, cleanEnv, projectList });
registerSetupCheck({ ipcMain, SMOKE, env: () => (DEMO ? { ...cleanEnv(process.env), CLAUDE_CONFIG_DIR: DEMO_CLAUDE } : cleanEnv(process.env)) });
// In-app updates (#1088): the installed app only.
registerUpdater({ app, ipcMain, send: (ch, v) => send(ch, v), on: updatesOn({ packaged: app.isPackaged, smoke: SMOKE, tryRun: TRY, demo: DEMO }), smoke: SMOKE,
  log: line => { try { fs.appendFileSync(path.join(P.state, 'update-log.txt'), `${nowStamp()} ${line}\n`); } catch { /* best effort */ } } });
registerCommits({ ipcMain, SMOKE, projectList });
// Plugins (#369): built-in features switched on in Settings; plugins-host.js owns them.
// The hidden smoke run fakes what a plugin records and runs (fake), unless
// FOCUSSHELL_RECORDER_REAL=1 asks for the real thing; smoke and try runs take no global keys
// unless FOCUSSHELL_PLUGIN_KEYS=1.
const plugins = registerPlugins({ ipcMain, P, SMOKE, send, services: pluginServices({ desktopCapturer, screen, data: path.dirname(P.ideas),
  lock: BOARD_LOCK(), projectList, cleanEnv, work: path.join(P.state, 'helper', 'work'), brainstorm: brainstormService }),
  fake: HIDDEN && process.env.FOCUSSHELL_RECORDER_REAL !== '1', keys: !SMOKE || process.env.FOCUSSHELL_PLUGIN_KEYS === '1' });
// Read fresh each time, so a project added to projects.json or the projects folder needs no restart.
function projectList() {
  const trusted = loadTrusted();
  return loadProjects().projects.map(p => ({ name: p.name, path: p.path, kind: p.kind, model: p.model || '', trusted: isTrusted(p.path, trusted) }));
}
ipcMain.handle('projects:list', () => projectList());
// "Connect your projects" (#1061): the folder dialog picks one project folder or several at
// once; each folder's name becomes a project name. Resolves { ok, names: every project
// picked, added: the new ones, error }. A smoke run is handed the folders, with no dialog,
// and keeps what it connects in memory, never in projects.json.
const readCfg = () => { try { return JSON.parse(read(P.projects, '{"projects":[]}').replace(/^﻿/, '')); } catch { return { projects: [] }; } };
function writeConnected(list) {
  if (SMOKE) { smokeConnected = list; return; }
  fs.writeFileSync(P.projects, JSON.stringify({ ...readCfg(), projects: list }, null, 2) + '\n');
}
const connected = () => (SMOKE && smokeConnected ? smokeConnected : readCfg().projects || []);
ipcMain.handle('projects:add', async (_e, given) => {
  let dirs = SMOKE && Array.isArray(given) ? given.map(String) : null;
  if (!dirs) {
    const r = await dialog.showOpenDialog(win, { title: 'Connect your projects: select one project folder or several', properties: ['openDirectory', 'multiSelections'] });
    if (r.canceled || !r.filePaths.length) return { ok: false };
    dirs = r.filePaths;
  }
  const real = p => { try { return fs.realpathSync.native(p).toLowerCase(); } catch { return String(p).toLowerCase(); } };
  const known = loadProjects().projects, list = [...connected()];
  const names = [], added = [], clash = [];
  for (const dir of dirs) {
    const name = path.basename(dir), same = [...known, ...list].find(p => p.name.toLowerCase() === name.toLowerCase());
    if (same) { if (real(same.path) === real(dir)) names.push(same.name); else clash.push(`${name} (already at ${same.path})`); continue; }
    list.push({ name, path: dir, test: '' });
    names.push(name); added.push(name);
  }
  if (added.length) writeConnected(list);
  return { ok: names.length > 0, names, added, error: clash.length ? `A project with that name exists: ${clash.join(', ')}` : '' };
});
// Settings' Projects (#1061): the projects connected one by one, which can be removed, and the
// projects folders an older setup lists every folder of (kept working, no longer offered).
// An entry for a folder inside one of those projects folders only holds its settings (a test
// command): it is listed from the folder, so it is not offered for removal.
ipcMain.handle('projects:connected', () => {
  const roots = projectRoots(), norm = p => path.resolve(String(p)).toLowerCase();
  const inRoot = p => roots.some(r => norm(path.dirname(p.path || '')) === norm(r));
  return { projects: connected().filter(p => p.path && !inRoot(p)).map(p => ({ name: p.name, path: p.path })), roots };
});
ipcMain.handle('projects:remove', (_e, name) => { writeConnected(connected().filter(p => p.name !== String(name))); return true; });
// A project's Claude model (#1115): saved in its projects.json entry and used each time its
// lead starts. A smoke run keeps it in memory.
ipcMain.handle('projects:setModel', (_e, name, model) => {
  const p = findProject(String(name));
  if (!p) return false;
  if (SMOKE) { const prev = smokeModels; smokeModels = list => withProjectModel(prev ? prev(list) : list, p, String(model || '')); return true; }
  const cfg = readCfg();
  fs.writeFileSync(P.projects, JSON.stringify({ ...cfg, projects: withProjectModel(cfg.projects || [], p, String(model || '')) }, null, 2) + '\n');
  return true;
});
ipcMain.handle('deck:init', () => {
  const cfg = loadProjects(), trusted = loadTrusted();
  let ui = null; try { ui = JSON.parse(read(P.ui)); } catch { /* first run */ }
  const json = (f, d) => { try { return JSON.parse(read(f)) ?? d; } catch { return d; } };
  return {
    smoke: SMOKE && !TRY, tryRun: TRY, demo: DEMO, voiceMode: voiceMode(), ui, focusLog: SMOKE || process.env.FOCUSSHELL_FOCUSLOG === '1',
    groups: readGroups(), recent: json(P.recent, {}), settings: normalizeSettings(json(P.settings, {})),
    projects: cfg.projects.map(p => ({ name: p.name, path: p.path, kind: p.kind, trusted: isTrusted(p.path, trusted) })),
    data: readData(),
    missing: SMOKE ? [] : missingTools(), // smoke and try runs start fake sessions, no Claude or node
  };
});
ipcMain.handle('data:read', () => readData());
ipcMain.handle('tasks:add', (_e, { project, text }) => {
  const f = path.join(P.tasks, `${project}.md`);
  board(f, md => addTaskLine(md, text, 'user', today(), nextShared(P.tasks, f, md)), `# ${project} tasks`);
  return readData();
});
// Someday on Me (#170): move an open to-do there and back, or add one straight into it.
ipcMain.handle('me:someday', (_e, { n, on }) => {
  board(path.join(P.tasks, 'Me.md'), md => setSomeday(md, n, !!on));
  return readData();
});
// A Self item's time and repeat (#198), set from the Self page or the opened item; adding with
// a time sets it on the new item.
ipcMain.handle('me:schedule', (_e, { n, when }) => {
  board(path.join(P.tasks, 'Me.md'), md => setSchedule(md, n, when || {}));
  return readData();
});
ipcMain.handle('me:addTimed', (_e, { text, when }) => {
  const f = path.join(P.tasks, 'Me.md');
  board(f, old => {
    const n = nextShared(P.tasks, f, old), md = addTaskLine(old, text, 'user', today(), n);
    return setSchedule(md, n, when || {});
  }, '# Me tasks');
  return readData();
});
ipcMain.handle('me:addSomeday', (_e, text) => {
  const f = path.join(P.tasks, 'Me.md');
  board(f, old => {
    const n = nextShared(P.tasks, f, old), md = addTaskLine(old, text, 'user', today(), n);
    return setSomeday(md, n, true);
  }, '# Me tasks');
  return readData();
});
ipcMain.handle('notes:add', (_e, text) => { board(P.notes, md => addNoteLine(md, text, nowStamp()), '# Notes'); return readData(); });
ipcMain.on('groups:save', (_e, list) => { if (SMOKE) return; try { fs.writeFileSync(P.groups, JSON.stringify({ groups: normalizeGroups(list) }, null, 2) + '\n'); } catch { /* best effort */ } });
ipcMain.on('settings:save', (_e, s) => {
  const next = normalizeSettings(s);
  try { plugins.apply(next); } catch { /* the settings file is still written */ } // a smoke run keeps its settings in memory, but its plugins still follow them
  if (SMOKE) return;
  try { fs.mkdirSync(P.state, { recursive: true }); fs.writeFileSync(P.settings, JSON.stringify(next, null, 2)); } catch { /* best effort */ }
});
ipcMain.on('recent:save', (_e, recent) => { if (SMOKE) return; try { fs.writeFileSync(P.recent, JSON.stringify(recent, null, 2)); } catch { /* best effort */ } });
ipcMain.on('ui:save', (_e, ui) => { if (SMOKE && !TRY) return; try { fs.mkdirSync(path.dirname(P.ui), { recursive: true }); fs.writeFileSync(P.ui, JSON.stringify(ui, null, 2)); } catch { /* best effort */ } });

// A task that starts needing the user raises a Windows notification and flashes the
// taskbar button; clicking the notification opens that project's page.
// Me reminders: a Windows notification when an item's "Due:" time comes. Keys already
// notified are kept in state/reminders.json, so one that came due while the app was closed
// notifies once on the next start. Clicking it opens Home, where Me is.
function checkReminders() {
  if (SMOKE || !Notification.isSupported()) return;
  let seen = [];
  try { seen = JSON.parse(read(P.reminders, '[]')); } catch { /* start fresh */ }
  if (!Array.isArray(seen)) seen = [];
  const due = dueReminders(parseTasks(read(path.join(P.tasks, 'Me.md'))), new Date(), seen);
  if (!due.length) return;
  for (const r of due.slice(0, 3)) {
    const n = new Notification({ title: 'Reminder', body: r.text.slice(0, 200), icon: path.join(APP_DIR, 'build', 'icon.png') });
    n.on('click', () => { if (win) { win.show(); win.focus(); send('nav:me'); } });
    n.show();
  }
  if (win && !win.isFocused()) win.flashFrame(true);
  try { fs.writeFileSync(P.reminders, JSON.stringify([...seen, ...due.map(r => r.key)].slice(-500))); } catch { /* try again next time */ }
}

let alertSnapshot = null, pendingAlerts = {};
function notifyNewAlerts(data) {
  const { alerts, snapshot } = newAlerts(alertSnapshot, data.tasks);
  alertSnapshot = snapshot;
  pendingAlerts = holdAlerts(pendingAlerts, alerts, snapshot, Date.now());
}
ipcMain.on('alerts:seen', (_e, { project, n }) => { pendingAlerts = seenAlerts(pendingAlerts, project, n); });
setInterval(() => {
  const { due, pending } = dueAlerts(pendingAlerts, Date.now());
  pendingAlerts = pending;
  if (!due.length || SMOKE || !Notification.isSupported() || !shouldToast('alert', using())) return;
  for (const a of due.slice(0, 3)) {
    const n = new Notification({
      title: `${a.project} ${a.mark === '?' ? 'needs you' : 'is blocked'}`,
      body: `#${a.n} ${a.result || a.text}`.slice(0, 200),
      icon: path.join(APP_DIR, 'build', 'icon.png'),
    });
    n.on('click', () => { if (win) { win.show(); win.focus(); send('nav:project', a.project); } });
    n.show();
  }
  if (win && !win.isFocused()) win.flashFrame(true);
}, 15000);

let dataTimer = null;
function watchData() {
  notifyNewAlerts(readData());
  const bump = () => { clearTimeout(dataTimer); dataTimer = setTimeout(() => { const d = readData(); notifyNewAlerts(d); send('data:changed', d); }, 150); };
  fs.mkdirSync(P.tasks, { recursive: true });
  if (!fs.existsSync(P.notes)) fs.writeFileSync(P.notes, '# Notes\n');
  fs.watch(P.tasks, bump);
  fs.watch(P.notes, bump);
  // Card notes, where the CTO replies to what the owner said on a card.
  fs.mkdirSync(P.projectNotes, { recursive: true });
  fs.watch(P.projectNotes, bump);
  fs.mkdirSync(P.ideas, { recursive: true }); fs.mkdirSync(P.sketches, { recursive: true });
  fs.watch(P.ideas, bump); fs.watch(P.sketches, { recursive: true }, bump);
  // projects.json and groups.json may be replaced rather than edited, so watch their folder.
  let projTimer = null;
  fs.watch(DECK, (_ev, f) => {
    if (f !== 'projects.json' && f !== 'groups.json') return;
    clearTimeout(projTimer);
    projTimer = setTimeout(() => send('data:changed', { ...readData(), projectsChanged: true, groups: readGroups() }), 150);
  });
}

const { watchRequests } = registerRequests({ ipcMain, P, SMOKE, APP_DIR, read, send, sessions, win: () => win, using });

// ---------- smoke screenshots ----------
ipcMain.handle('smoke:shot', async (_e, name) => {
  fs.mkdirSync(P.smoke, { recursive: true });
  // Capture is flaky with Chromium's compositor on this machine; retry a few times.
  for (let i = 0; i < 5; i++) {
    try {
      if (!HIDDEN) { win.show(); win.focus(); }
      // A hidden page paints only while captured, so the first capture can hold an old
      // frame: a throwaway one wakes it, the second is current.
      if (HIDDEN) { await win.webContents.capturePage(undefined, { stayHidden: true }); await new Promise(res => setTimeout(res, 300)); }
      const img = await win.webContents.capturePage(undefined, { stayHidden: HIDDEN });
      fs.writeFileSync(path.join(P.smoke, `${name}.png`), img.toPNG());
      return true;
    } catch { await new Promise(res => setTimeout(res, 700)); }
  }
  return false;
});
ipcMain.on('smoke:done', () => { quitting = true; app.quit(); });
ipcMain.on('smoke:fail', (_e, msg) => { if (HIDDEN) smokeFail('the page', msg); });
// A side button pressed and let go at x,y as Chromium's own input (#322), not an event made in the page.
ipcMain.handle('smoke:mouse', async (_e, button, x, y) => {
  if (!HIDDEN) return false;
  const dbg = win.webContents.debugger, at = { x, y, button, clickCount: 1, buttons: 0 };
  await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await dbg.sendCommand('Input.dispatchMouseEvent', { ...at, type: 'mousePressed', buttons: button === 'back' ? 8 : 16 });
  await dbg.sendCommand('Input.dispatchMouseEvent', { ...at, type: 'mouseReleased' });
  return true;
});
// A trusted Ctrl+V into the focused pane (#352): the key, then the browser's paste command, as a real press.
ipcMain.handle('smoke:ctrlv', async () => {
  if (!HIDDEN) return false;
  const dbg = win.webContents.debugger, key = { key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 2 };
  await dbg.sendCommand('Input.dispatchKeyEvent', { ...key, type: 'rawKeyDown', commands: ['paste'] });
  await dbg.sendCommand('Input.dispatchKeyEvent', { ...key, type: 'keyUp' });
  return true;
});
ipcMain.handle('smoke:throw', () => (HIDDEN ? process.env.FOCUSSHELL_SMOKE_THROW || '' : ''));

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 900, minWidth: 900, minHeight: 560,
    backgroundColor: '#0e0e10', title: APP_NAME, autoHideMenuBar: true, show: !HIDDEN,
    icon: path.join(APP_DIR, 'build', 'icon.ico'),
    webPreferences: { preload: path.join(APP_DIR, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true, backgroundThrottling: !HIDDEN },
  });
  win.removeMenu();
  guardWindow(win);
  if (HIDDEN) win.webContents.on('render-process-gone', (_e, d) => smokeFail('the page', `the page process ended (${d.reason}, exit code ${d.exitCode})`));
  // The taskbar right-click menu takes its name and icon from the running exe, which is
  // electron.exe ("Electron") when started from the source folder. Relaunch details
  // override both, and pinning then relaunches FocusShell rather than bare Electron.
  if (process.platform === 'win32') {
    win.setAppDetails({
      appId: DEMO ? 'FocusShell.Demo' : 'FocusShell',
      appIconPath: path.join(APP_DIR, 'build', 'icon.ico'),
      appIconIndex: 0,
      relaunchCommand: (app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${APP_DIR}"`) + (DEMO ? ' --demo' : ''),
      relaunchDisplayName: APP_NAME,
    });
  }
  if (DEMO) win.on('page-title-updated', e => e.preventDefault());
  // The mouse's back and forward buttons (#301) reach the window as app commands on Windows.
  win.on('app-command', (_e, cmd) => { if (cmd === 'browser-backward' || cmd === 'browser-forward') send('nav:go', cmd === 'browser-backward' ? -1 : 1); });
  // The hidden smoke page acts as if focused, so the clipboard works without taking focus.
  if (HIDDEN) {
    try { win.webContents.debugger.attach('1.3'); } catch { /* attached already */ }
    win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  }
  // A smoke run's own lines from the page ("smoke: ...") go to state/smoke/log.txt, to read after.
  if (SMOKE) {
    try { fs.mkdirSync(P.smoke, { recursive: true }); fs.writeFileSync(path.join(P.smoke, 'log.txt'), ''); } catch { /* none */ }
    // A check that failed (console.error) is marked FAILED, so a run can be read for failures.
    win.webContents.on('console-message', (...a) => {
      const m = a[0] && a[0].message !== undefined ? a[0].message : a[2], level = a[0] && a[0].level !== undefined ? a[0].level : a[1];
      if (/^smoke:/.test(String(m))) try { fs.appendFileSync(path.join(P.smoke, 'log.txt'), `${level === 'error' || level === 3 ? 'FAILED ' : ''}${m}\n`); } catch { /* none */ }
    });
  }
  win.webContents.on('did-start-loading', voiceClose);
  win.loadFile(path.join(APP_DIR, 'renderer', 'index.html'));
  win.on('close', e => {
    if (quitting || SMOKE) return;
    // Sessions nobody has used yet end without asking; there is nothing in them to lose.
    const live = [...sessions.values()].filter(s => claudeOn(s) && s.used).length;
    if (!live) return;
    const r = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['Close and end sessions', 'Cancel'], defaultId: 1, cancelId: 1,
      title: APP_NAME, message: `${live} session${live > 1 ? 's are' : ' is'} still running.`,
      detail: 'Closing FocusShell ends them. Task lists and notes are kept.',
    });
    if (r === 1) e.preventDefault(); else quitting = true;
  });
}

// Notifications go out under the ID 'FocusShell', which the Start Menu FocusShell shortcut
// carries, so Windows names their sender FocusShell (#191). Electron keeps a Start Menu
// "<exe product name>.lnk" with the process ID and rewrites it when it does not match:
// the dev electron.exe is renamed FocusShell (build/name-electron.cjs) and install.ps1
// writes that shortcut the way Electron expects, so it is left alone and there is no
// "Electron.lnk" to take the taskbar icon (#150). The demo's window keeps its own taskbar
// ID; its process uses this one too, or its notifications would rewrite the shortcut.
app.setAppUserModelId('FocusShell');

// The demo's sessions use their own Claude folder (#135): none of the owner's global rules,
// memory, plugins or status line, and a sign-in of their own the first time.
const DEMO_CLAUDE = path.join(path.dirname(DEMO_HOME), 'claude');
ipcMain.handle('demo:reset', async () => {
  if (!DEMO) return false;
  const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Reset', 'Cancel'], defaultId: 1, cancelId: 1, title: APP_NAME,
    message: 'Reset the demo?', detail: 'Ends every demo session and stops the demo apps, wipes the demo boards and toy projects and builds them fresh, then opens the demo again. The demo\'s Claude sign-in stays.' });
  if (r.response !== 0) return false;
  const script = path.join(APP_DIR, '..', 'demo', 'make-demo.mjs');
  spawn('node', [script, '--root', path.dirname(DEMO_HOME), '--reset', '--no-shortcut', '--wait-pid', String(process.pid), '--start', '--electron', process.execPath, '--app', APP_DIR],
    { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  stopCodeWeb();
  for (const s of sessions.values()) if (s.alive) { try { s.pty.kill(); } catch { /* gone */ } }
  app.exit(0);
  return true;
});

// Fill demo boards (#1058): the four projects and their boards, on top of what is there. The
// watchers show them as they land.
ipcMain.handle('demo:fill', () => new Promise(resolve => {
  if (!DEMO) return resolve('');
  execFile('node', [path.join(APP_DIR, '..', 'demo', 'make-demo.mjs'), '--root', path.dirname(DEMO_HOME), '--fill'], { windowsHide: true, timeout: 60000 },
    (err, _out, errOut) => resolve(err ? String(errOut || err.message).trim() || 'failed' : ''));
}));

app.whenReady().then(() => {
  if (DEMO) {
    const why = !fs.existsSync(DEMO_HOME) ? `The demo is not built yet. In ${path.join(APP_DIR, '..')}, run:\n\nnode demo/make-demo.mjs`
      : '';
    if (why) { dialog.showErrorBox(APP_NAME, why); app.exit(0); return; }
  }
  fs.mkdirSync(DECK, { recursive: true });
  seedDeck();
  if (!SMOKE && !DEMO) installBacklogSkill();
  fs.mkdirSync(P.state, { recursive: true });
  if (!SMOKE) {
    fs.writeFileSync(P.pid, String(process.pid));
    // Gone while this instance runs (another instance on this data folder quit): put it back,
    // or the pane scripts think the app is closed (#1074).
    setInterval(() => keepPid(P.pid, process.pid), 10000);
  }
  if (SMOKE && !TRY) resetSmokeMe(P);
  // A file in a folder with a space, for the smoke run's link check (#350).
  if (SMOKE && !TRY) { const d = path.join(P.smoke, 'with space', 'media'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'map-1080x1350.mp4'), ''); }
  // A video editor's project file, for the binary link check (#317).
  if (SMOKE && !TRY) fs.writeFileSync(path.join(P.smoke, 'intro-rough-2.editbay'), '');
  if (!SMOKE && !DEMO) keepOldSettings();
  // Plugins start here, not at load: a global shortcut can only be taken once the app is ready.
  {
    let saved = {};
    if (!SMOKE) try { saved = JSON.parse(read(P.settings, '{}')); } catch { /* defaults */ }
    plugins.apply(normalizeSettings(saved));
  }
  watchData();
  watchRequests();
  setTimeout(checkReminders, 5000);
  setInterval(checkReminders, 30000);
  if (!SMOKE) { writeDeckLauncher(); if (!DEMO) { setTimeout(backupBoards, 10 * 60000); setInterval(backupBoards, 60 * 60000); } }
  // The tavern room's code and art, fresh from the tavern folder in development (#246).
  if (!app.isPackaged) try { copyRoom(); } catch (e) { console.error('tavern room copy:', e.message); }
  createWindow();
  if (!SMOKE && !DEMO) registerGlobalTalk({ app, sessions, send, voiceMode })(win);
});

// Leads and other sessions find their task file through the global backlog skill. It names
// the data folder as <data>; the copy in ~/.claude/skills says where it is on this PC (#346).
function installBacklogSkill() {
  const text = read(path.join(DECK, 'skill', 'backlog', 'SKILL.md'), null);
  if (!text) return;
  const dir = path.join(os.homedir(), '.claude', 'skills', 'backlog'), f = path.join(dir, 'SKILL.md');
  const next = text.split('<data>').join(DECK);
  try { if (read(f, null) !== next) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, next); } } catch (e) { console.error('backlog skill:', e.message); }
}

// An existing settings file keeps Remote Control and the backup push on (#346); written
// before any session starts, so the CTO and PM start the way they always did.
function keepOldSettings() {
  let raw = null; try { raw = JSON.parse(read(P.settings, 'null')); } catch { return; }
  const next = upgradeSettings(raw);
  if (next) try { fs.writeFileSync(P.settings, JSON.stringify(next, null, 2)); } catch (e) { console.error('settings upgrade:', e.message); }
}

// The deck command (#225): sessions run `node <data folder>/deck.mjs <verb> ...`. The data
// folder gets a two-line launcher pointing at this app's own copy, rewritten when it moved.
const DECK_SCRIPT = path.join(APP_DIR, 'deck.mjs');
function writeDeckLauncher() {
  const text = `// Written by FocusShell (#225): the deck command for this data folder. Run: node deck.mjs help\n`
    + `process.env.FOCUSSHELL_DATA = ${JSON.stringify(DECK)};\nawait import(${JSON.stringify(pathToFileURL(DECK_SCRIPT).href)});\n`;
  const f = path.join(DECK, 'deck.mjs');
  try { if (read(f, null) !== text) fs.writeFileSync(f, text); } catch (e) { console.error('deck launcher:', e.message); }
}
// The board files are committed once an hour (and pushed when Settings says so, #346), as
// their backup. Run as its own process, so a slow push never holds up the window.
function backupBoards() {
  let s = {}; try { s = JSON.parse(read(P.settings, '{}')); } catch { /* defaults */ }
  execFile(process.execPath, [DECK_SCRIPT, '--data', DECK, 'backup', ...(normalizeSettings(s).backupPush ? ['--push'] : [])], { env: { ...cleanEnv(process.env), ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, timeout: 120000 },
    (err, out, errOut) => { if (err) console.error('board backup:', String(errOut || err.message).trim()); });
}
app.on('before-quit', () => { stopCodeWeb(); for (const s of sessions.values()) if (s.alive) { try { s.pty.kill(); } catch { /* gone */ } } });
app.on('window-all-closed', () => { if (!SMOKE) releasePid(P.pid, process.pid); app.quit(); });
