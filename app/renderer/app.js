// FocusShell window: Home dashboard, session tabs, snap layouts, voice.
import { parseTasks, optionsOf, parseNotes, splitTaskNotes } from '../lib/tasks.js';
import { LAYOUTS, SINGLE_WITH_MANAGER, slotCount, autoLayout } from '../lib/layouts.js';
import * as T from './terminal.js';
import * as C from './code.js';
import { renderProject } from './project.js';
import { touchRecent, recentList, lastSession } from '../lib/presets.js';
import { MAIN, PM, mgrId, isMgr, groupOfMgr, groupOf, managerFor, findGroup, normalizeGroups, renameGroup, suggestName, groupName, viewFor } from '../lib/groups.js';
import { groupsSection } from './groups.js';
import { groupActions } from './group-actions.js';
import { windowKeys } from './keys.js';
import { titleBar } from './tabs.js';
import { panes } from './panes.js';
import { openTask, closeTask, openCard, refreshTask } from './task-detail.js';
import { openWhiteboard, closeWhiteboard, refreshWhiteboard, waitingCount, setupSummaries, wantSummaries } from './whiteboard.js';
import { boardSection, ownerKind, isTest } from './board.js';
import { renderDash, revealMe, ME } from './home.js';
import { renderSide, renderPmDrawer } from './sidebar.js';
import { renderSettings } from './settings.js';
import { applyPrefs } from './prefs.js';
import { emptyBoard } from './connect.js';
import { setupWizard, resetSetup } from './setup.js';
import { openTour, TOUR } from './tour.js';
import { setupUpdates, checkUpdates, updateInfo } from './update.js';
import { startPlugins, pluginSection } from './plugins.js';
import { normalizeSettings } from '../lib/settings.js';
import { extraId, extraOf, projectOf, nextLead, EXTRA_LEADS, MAX_LEADS, sessionName } from '../lib/sessions.js';
import { demoRobots } from '../lib/tavern/agents.js';
import { h, icon, toast } from './dom.js';
import { smoke } from './smoke.js';
import { renderMe } from './me.js';
import { waitingWatch } from './waiting.js';
import { showMissing } from './requirements.js';
import { setupMissed, refreshMissed, closeMissed } from './missed.js';
import { ctoRequests } from './cto-requests.js';
import { setupStatus } from './status.js';
import { leadTask, leadDot } from '../lib/status.js';
import { setupFocusLog, focusLog } from './focuslog.js';
import { miniTree } from './layout-ui.js';
import { typeLine, deliver, drafting } from './cto-line.js';
import { tavernButton, setTavernOn } from './tavern/tavern.js';
import { startNav, noteSoon } from './nav.js';

const deck = window.deck;

// ---------- state ----------
let projects = [];            // [{name, path, trusted}]
let tasksMd = {};             // name -> markdown
let notesMd = '';
let ideasMd = '';              // ideas/Me.md, the Me page's ideas deck (#130)
let voiceMode = 'hold';
let openTabs = [];            // project names with a tab
let view = 'home', single = null, splitSet = [], layoutId = 'm-2x2', focused = null;
const started = new Set();    // session ids started in this run
let groups = [];              // [{name, projects}] from groups.json; a project is in one group at most
let groupViews = {};          // group -> {shown, layoutId}, its remembered split
let mainView = null;          // the main CTO's remembered split of two or more projects (#176)
let ctx = null;               // group whose manager is on screen, or null for the main manager
let recent = {};              // project -> last opened (ms)
let settings = normalizeSettings(null); // preferences from the Settings page
let pmOpen = false;           // the PM slid over the coding view
let prevSession = null;       // what was open last time, offered on Home
let currentProject = null;    // project whose page is showing (view 'project')
let projectDetails = null;
let projectPrs = null;          // { prs } or { error } for the open project page
let showDone = false;
let smokeHold = {};            // boards a smoke run keeps in memory (#315, #319)
let smokePick;                 // the folder a smoke run connects from the empty Board, with no dialog (#1061)
const collapsed = new Set();  // project panes folded down to their title bar in a split
const lastOutput = new Map(); // id -> ms
const showLead = new Map();   // project -> which of its leads (2 to 5) its pane shows; none: the first
const leadWt = new Map();     // extra lead session id -> whether it has its own worktree
let leadSplits = {};          // project -> lead numbers its pane shows side by side when it is alone on screen (#1554)

const proj = n => projects.find(p => p.name === n);
const tasksOf = n => parseTasks(tasksMd[n] || '');
const isActive = id => Date.now() - (lastOutput.get(id) || 0) < 3000;
const curMgr = () => mgrId(ctx);
const mgrName = id => id === MAIN ? 'CTO' : `${groupOfMgr(id)} CTO`;

// A lead's dot says what its own pane is doing, never what its board holds (#1756).
const dotOf = id => leadDot({ exited: T.isExited(id), prompt: waitingOn.get(id), asked: askedOn.get(id), active: isActive(id) });
function stateOf(id) {
  if (isMgr(id) || id === PM) return T.isExited(id) ? 'ended' : isActive(id) ? 'working' : 'idle';
  return dotOf(id).state;
}
const tipOf = id => (isMgr(id) || id === PM ? '' : dotOf(id).tip);
function labelOf(id) {
  if (T.isExited(id)) return 'Session ended';
  if (isMgr(id)) return ''; // #383: room in the CTO pane's header for its buttons
  if (id === PM) return 'talk here';
  if (waitingOn.has(id)) return 'Waiting on your approval';
  if (askedOn.has(id) && !isActive(id)) return 'Waiting on your answer';
  if (extraOf(id)) return isActive(id) ? 'Busy' : 'Idle';
  const ts = tasksOf(id);
  const pick = m => ts.find(t => t.mark === m);
  const b = pick('!'), w = pick('~');
  if (b) return `Blocked on #${b.n}`;
  if (w) return `Working on #${w.n}`;
  if (!started.has(id)) return 'No session';
  return isActive(id) ? 'Busy' : 'Idle';
}
const dot = id => h('span', { class: 'st-dot ' + stateOf(id) + (isActive(id) ? ' active' : ''), 'data-dot': id, title: tipOf(id) });

// The app starts empty, so the last set of tabs is kept as "Last session" rather than reopened.
function saveUi() {
  const snap = openTabs.length ? { openTabs, layoutId } : prevSession && { openTabs: prevSession.projects, layoutId: prevSession.layoutId };
  deck.saveUi({ view, single, splitSet, layoutId, groupViews, mainView, homeLayout, leadSplits, lastSession: snap || null });
}
function saveGroups(next) { groups = next; deck.saveGroups(groups); }
function saveSettings(next) { settings = normalizeSettings(next); deck.saveSettings(settings); if (!settings.showMissed) closeMissed(); setTavernOn(settings.showTavern); applyPrefs(settings, T.refitAll); render(); }

// ---------- sessions ----------
let openError = ''; // why the last ensureSession failed, for the CTO's open request (#185)
// A model the CTO named when it opened a pane (#202), kept for that pane's Restart; it goes
// when the pane closes and is never saved.
const paneModel = new Map();
async function ensureSession(id, opts, resumeId) {
  if (started.has(id) && !T.isExited(id)) return true;
  const r = await deck.open(id, resumeId, paneModel.has(id) ? { ...opts, model: paneModel.get(id) } : opts);
  if (!r.ok) { openError = r.error; toast(r.error, true); return false; }
  started.add(id);
  return true;
}
async function openTab(name, show = true) {
  if (!(await ensureSession(name))) return;
  if (!openTabs.includes(name)) openTabs.push(name);
  recent = touchRecent(recent, name, Date.now()); deck.saveRecent(recent);
  if (show) { view = 'single'; single = name; }
  render();
}
// A project's extra leads (2 to 5, #1485) show in the same pane, switched from the pane header.
// Closing one also removes its worktree, if it had one and its work is merged; the note says how.
const extrasOf = name => EXTRA_LEADS.filter(n => started.has(extraId(name, n)));
// The session a project's pane shows: the lead picked in its header, else the first.
const shownLead = name => { const n = showLead.get(name); return n && started.has(extraId(name, n)) ? extraId(name, n) : name; };
const showN = (name, n) => { if (n > 1) showLead.set(name, n); else showLead.delete(name); };
// The leads a pane shows side by side (#1554): its saved split, only while the project is alone
// on screen and two or more of those leads run; otherwise null and the pane shows one lead.
function splitLeads(name) {
  const ids = (leadSplits[name] || []).map(n => (n === 1 ? name : extraId(name, n))).filter(id => started.has(id));
  return view === 'single' && single === name && ids.length >= 2 ? ids : null;
}
async function openExtra(name, n, worktree, show = true) {
  n = n || nextLead(k => started.has(extraId(name, k)));
  if (!n) { toast(`${name} already runs ${MAX_LEADS} leads, the most a project can have`, true); return; }
  if (!openTabs.includes(name)) await openTab(name, false);
  const id = extraId(name, n);
  leadWt.set(id, worktree);
  if (!(await ensureSession(id, { worktree }))) return;
  if (show) showLead.set(name, n);
  render();
}
async function closeExtra(name, n) {
  const id = extraId(name, n), note = await deck.kill(id);
  started.delete(id); T.dispose(id); leadWt.delete(id); paneModel.delete(id);
  if (showLead.get(name) === n) showLead.delete(name);
  if (leadSplits[name]) { const rest = leadSplits[name].filter(k => k !== n); if (rest.length > 1) leadSplits[name] = rest; else delete leadSplits[name]; }
  if (note) toast(note, /kept/i.test(note));
  render();
  return note;
}
async function closeTab(name, ask = true) {
  const extras = extrasOf(name);
  if (ask && started.has(name) && !T.isExited(name) && !confirm(`End the ${name} session${extras.length ? `s (all ${extras.length + 1} leads)` : ''}?`)) return;
  for (const n of extras) await closeExtra(name, n);
  await deck.kill(name);
  started.delete(name); T.dispose(name); C.closeCode(name); paneModel.delete(name);
  openTabs = openTabs.filter(v => v !== name);
  splitSet = splitSet.filter(v => v !== name);
  if ((view === 'single' && single === name) || (view === 'split' && !splitSet.length)) view = 'home';
  else if (view === 'split') layoutId = autoLayout(splitSet.length);
  render();
}
// Restart picks the pane's last conversation up again, or starts fresh if that fails (#197).
async function restart(id) {
  const resumeId = await deck.lastConversation(id);
  await deck.kill(id); started.delete(id); T.reset(id);
  await ensureSession(id, { ...(extraOf(id) ? { worktree: leadWt.get(id) } : {}), orFresh: !!resumeId }, resumeId || undefined); render();
}

// ---------- the parts split out of this file (#1785) ----------
// They read and set this file's state through S; the functions they call join it before boot.
const S = { deck, started, collapsed,
  get projects() { return projects; }, set projects(v) { projects = v; }, get tasksMd() { return tasksMd; }, get voiceMode() { return voiceMode; },
  get openTabs() { return openTabs; }, get view() { return view; }, set view(v) { view = v; }, get single() { return single; }, set single(v) { single = v; },
  get splitSet() { return splitSet; }, set splitSet(v) { splitSet = v; }, get layoutId() { return layoutId; }, set layoutId(v) { layoutId = v; },
  get focused() { return focused; }, set focused(v) { focused = v; }, get groups() { return groups; }, get groupViews() { return groupViews; },
  get mainView() { return mainView; }, get ctx() { return ctx; }, set ctx(v) { ctx = v; }, get settings() { return settings; },
  get pmOpen() { return pmOpen; }, set pmOpen(v) { pmOpen = v; }, get leadSplits() { return leadSplits; },
};

// ---------- groups ----------
const groupActs = groupActions(S);
const { openGroup, catchUpOn, onScreen, newGroup, saveOpen, renameGroupTo, joinGroup, leaveGroup, removeGroup } = groupActs;

deck.onData(({ id, data }) => { lastOutput.set(id, Date.now()); T.write(id, data); });
// Claude exiting leaves its shell open to type in (#353); a claude typed there brings the pane back.
deck.onExit(({ id, shell }) => { T.markExited(id, true, !!shell); render(); });
// A session that has not joined messaging a minute after opening (#1113): the CTO cannot
// list or reach it, so the user is told, with Reopen.
deck.onNotJoined(({ id }) => toast(`${labelOf(id)} has not connected to the others, so the CTO cannot reach it. Check its pane for a question; if there is none, reopen it.`, true,
  { label: 'Reopen', run: () => restart(id) }));
deck.onBack(({ id }) => { T.markExited(id, false); render(); });
deck.onDataChanged(async d => {
  if (d.projectsChanged) projects = await deck.projectList();
  if (d.groups) groups = normalizeGroups(d.groups);
  // A smoke run holds its own boards for the leads it tests, whatever the real files do meanwhile.
  tasksMd = { ...d.tasks, ...smokeHold }; notesMd = d.notes; ideasMd = d.ideas ?? ideasMd;
  if (d.groups) render(); else redrawPage();
  updateLive(); refreshWhiteboard(); wbCounts(); wantSummaries(deck, tasksMd, [ME]);
  // An open card follows its task and its notes, so the CTO's reply shows without reopening.
  const c = openCard(), fresh = c && tasksOf(c.project).find(t => t.n === c.n);
  if (fresh) refreshTask(fresh);
});
const { waitingOn, askedOn, waitingLeads, leadCard, checkPromptAlerts, setWords } = waitingWatch({
  deck, started, groups: () => groups, hasProjects: () => projects.length > 0, mgrName, openTab, updateLive, showPrompts,
  outputAt: id => lastOutput.get(id) || 0,
});
function showPrompts() { redrawPage(); refreshWhiteboard(); wbCounts(); }
deck.onNavProject(name => { if (proj(name)) openProjectPage(name); });
deck.onNavMe(() => { revealMe(); view = 'me'; render(); });
const { openRequest, openExtraRequest, closeRequest } = ctoRequests({
  deck, started, paneModel, showLead, extrasOf, proj, tasksOf, isActive, openTab, openExtra, closeTab, closeExtra, render,
  get projects() { return projects; }, set projects(v) { projects = v; }, get openTabs() { return openTabs; }, get groups() { return groups; }, get groupViews() { return groupViews; },
  get view() { return view; }, set view(v) { view = v; }, get single() { return single; }, get ctx() { return ctx; }, set ctx(v) { ctx = v; },
  get splitSet() { return splitSet; }, set splitSet(v) { splitSet = v; }, set layoutId(v) { layoutId = v; }, get openError() { return openError; }, set openError(v) { openError = v; },
});

// ---------- voice and keys, title bar, panes ----------
const { togglePm, talking } = windowKeys(S);
const bar = titleBar(S);
const { togglePop, renderPicker, renderNewMenu, renderTabs } = bar;
const { buildTree } = panes(S);

// ---------- project page ----------
function openProjectPage(name) {
  deck.seenAlert(name);
  view = 'project'; currentProject = name; projectDetails = null; projectPrs = null; showDone = false;
  render();
  loadProjectDetails(name);
}
async function loadProjectDetails(name) {
  const d = await deck.projectDetails(name);
  if (view === 'project' && currentProject === name) { projectDetails = d; renderProjectPage(); }
  // Pull requests come from the GitHub CLI, which is slower; the card fills in after.
  if (d && d.git) {
    const prs = await deck.projectPrs(name);
    if (view === 'project' && currentProject === name) { projectPrs = prs; renderProjectPage(); }
  }
}
function renderProjectPage() {
  renderProject(document.getElementById('home'), {
    h, icon, toast, deck,
    details: projectDetails,
    prs: projectPrs,
    tasksMd: tasksMd[currentProject] || '',
    isOpen: openTabs.includes(currentProject),
    openSession: n => openTab(n),
    resume: resumeSession,
    back: () => { view = 'home'; render(); },
    refresh: async () => { const d = await deck.readData(); tasksMd = d.tasks; renderProjectPage(); },
    rerender: renderProjectPage,
    openTask: t => showTask(currentProject, t),
    showDone, setShowDone: v => { showDone = v; renderProjectPage(); },
  });
}
async function resumeSession(name, sessionId) {
  if (started.has(name) && !T.isExited(name)) {
    if (!confirm(`End the running ${name} session and resume the older one?`)) return;
  }
  await deck.kill(name); started.delete(name); T.dispose(name);
  const r = await deck.open(name, sessionId);
  if (!r.ok) { toast(r.error, true); return; }
  started.add(name);
  if (!openTabs.includes(name)) openTabs.push(name);
  view = 'single'; single = name; render();
}

// ---------- Home: groups, last session, recent ----------
// Last session reopens every tab; the projects in no group go on screen with the main
// manager, since grouped ones belong to their group's manager.
async function openLastSession(p, catchup = false) {
  const names = p.projects.filter(n => proj(n));
  for (const n of names) await openTab(n, false);
  if (catchup) catchUpOn(names.filter(n => openTabs.includes(n)));
  const loose = names.filter(n => openTabs.includes(n) && !groupOf(groups, n));
  ctx = null;
  if (!loose.length) { view = 'home'; render(); return; }
  if (loose.length === 1) { view = 'single'; single = loose[0]; render(); return; }
  splitSet = loose.slice(0, 4);
  const L = LAYOUTS[p.layoutId];
  layoutId = L && L.mgr && slotCount(L.tree) >= splitSet.length ? p.layoutId : autoLayout(splitSet.length);
  view = 'split'; render();
}
// Personal (#177), the owner's private agent, opens from its own tab and is left out of the
// code-project board and Recent.
const isCode = n => (proj(n) || {}).kind !== 'personal';
function startSection() {
  const rec = recentList(recent, 8, n => !!proj(n) && isCode(n) && !openTabs.includes(n));
  return [
    ...groupsSection({
      h, icon, miniTree, groups, projects, groupViews, prevSession,
      running: g => started.has(mgrId(g)) && !T.isExited(mgrId(g)),
      layoutOf: (g, v) => LAYOUTS[viewFor(g, v).layoutId] || LAYOUTS[autoLayout(g.projects.length)],
      lastLayout: p => LAYOUTS[p.layoutId] || LAYOUTS[autoLayout(p.projects.length)],
      openGroup, removeGroup, openLastSession, saveOpen, renameGroup: renameGroupTo,
      onScreen: onScreen(), codeProjects: projects.filter(p => isCode(p.name)).map(p => p.name), suggestName: ps => suggestName(groups, ps),
      createGroup: (raw, picks) => { const ok = newGroup(raw, picks, false); if (ok) { toast(`Made group ${groupName(raw)} with ${picks.join(', ')}`); render(); } return ok; },
      rerender: () => render(),
      addProject: (g, n) => { if (joinGroup(g, n)) render(); },
      removeProject: leaveGroup,
    }),
    rec.length ? [h('h2', {}, 'Recent'), h('div', { class: 'chips' }, rec.map(n => h('button', { class: 'chip', onclick: () => openTab(n) }, h('span', { class: 'st-dot idle' }), n)))] : null,
  ];
}

// ---------- home ----------
// Board items open in a panel with their full details; edits there redraw the board.
function showTask(project, t) {
  deck.seenAlert(project, t.n);
  openTask({ h, icon, deck, toast, project, task: t, openMd: f => openFile(null, f, project), tags: settings.tags, talk: (text, isAnswer) => talkCard(project, t.n, text, isAnswer), onChange: async () => {
    const d = await deck.readData(); tasksMd = d.tasks;
    redrawPage();
  } });
  // An item opened is a Back/Forward step, however it was opened (#326).
  noteSoon();
}
function renderMePage() {
  renderMe({ h, icon, deck, toast, openMd, root: document.getElementById('home'), tags: settings.tags, meMd: tasksMd[ME] || '', notesMd, ideasMd, tasksMd, showTask, rerender: renderMePage, toCto: ideaToCto, addTag: t => saveSettings({ ...settings, tags: [...settings.tags, t] }),
    todoWidth: (homeLayout || {}).meTodo, setTodoWidth: w => { homeLayout = { ...(homeLayout || {}), meTodo: w }; saveUi(); },
    todoSort: (homeLayout || {}).meSort, setTodoSort: v => { homeLayout = { ...(homeLayout || {}), meSort: v }; saveUi(); renderMePage(); },
    sketchesHidden: !!(homeLayout || {}).meNoSketches, setSketchesHidden: v => { homeLayout = { ...(homeLayout || {}), meNoSketches: v }; saveUi(); renderMePage(); },
    apply: async pr => { const d = await pr; tasksMd = d.tasks; notesMd = d.notes; ideasMd = d.ideas; if (view === 'me') renderMePage(); } });
}
// A Markdown file opens in the VS Code pane of the project it belongs to (#69), beside that
// project's lead; a file in no project opens in the normal VS Code window.
// A file opens in a built-in Code pane, never the VS Code app (#126). Clicked in a lead's
// pane, it opens beside that lead with the lead's folder (a second lead's worktree) as the
// workspace; otherwise beside the project that holds it. A file in no project (#292) opens
// beside the project whose item linked it, else the project last on screen, else the first open one.
async function openFile(id, file, from) {
  const lead = id && !isMgr(id) && id !== PM ? projectOf(id) : null;
  const name = (lead && proj(lead) ? lead : null) || (await deck.projectForFile(file)) || (from && from !== ME && proj(from) ? from : null)
    || (single && proj(single) ? single : null) || openTabs.find(n => proj(n)) || null;
  // A file the Code pane cannot open shows selected in File Explorer instead (#207).
  if (!name) return deck.openPath(file);
  if (!openTabs.includes(name)) await openTab(name, false);
  if (!openTabs.includes(name)) return deck.openPath(file);
  view = 'single'; single = name; C.openCode(name, deck, render, file, lead === name ? id : null); render();
  return true;
}
const openMd = file => openFile(null, file);
// An opened card talks to its project's CTO: "ANSWER <Project> #<n>: ..." for a card that
// needs the owner, "NOTE <Project> #<n>: ..." for any other. The CTO replies on the card.
function talkCard(project, n, text, isAnswer) {
  const m = managerFor(groups, project);
  if (!started.has(m) || T.isExited(m)) { toast(m === MAIN ? 'The CTO session has ended. Restart it on its tab.' : `The ${mgrName(m)} is not running. Open group ${groupOfMgr(m)} first.`, true); return false; }
  toCto(m, `${isAnswer ? 'ANSWER' : 'NOTE'} ${project} #${n}: ${text}`, `Sent to the ${mgrName(m)} about ${project} #${n}`);
  return true;
}
// A line from a card click waits while the owner is writing in the CTO's prompt (#243).
// "Sent" shows only once it went with its Enter (#1340); one left in the prompt says so.
const LEFT = 'Not sent: the line is still in the CTO\'s prompt. Press Enter there, or clear it.';
const toCto = (m, line, sent) => typeLine(deck, m, line, () => toast(sent), () => toast(LEFT, true))
  .then(r => { if (r === 'held') toast(`${sent.replace(/^Sent/, 'Held')}: sent when your prompt is empty`); });
// An idea from the Me page (#342) goes to the main CTO, since it has no project yet.
async function ideaToCto(line, sent) {
  if (!started.has(MAIN) || T.isExited(MAIN)) { toast('The CTO session has ended. Restart it on its tab.', true); return false; }
  await toCto(MAIN, line, sent);
  return true;
}
// The recorder's line (#1029) is checked in the CTO's log; one that never arrived says so and offers Send again.
async function recordingToCto(line) {
  if (!started.has(MAIN) || T.isExited(MAIN)) { toast('The CTO session has ended. Restart it on its tab.', true); return false; }
  const fail = again => toast('The CTO did not get the recording\'s cards. They are on the boards; send them to the CTO again?', true, { label: 'Send again', run: again });
  const r = await deliver(deck, MAIN, line, fail, () => toast('Sent to the CTO'), () => toast(LEFT, true));
  if (r === 'held') toast('Held for the CTO: sent when your prompt is empty');
  return true;
}
// Answers go to the project's own manager, the one that asked.
function answer(project, n, option) {
  const m = managerFor(groups, project);
  if (!started.has(m) || T.isExited(m)) { toast(m === MAIN ? 'The CTO session has ended. Restart it on its tab.' : `The ${mgrName(m)} is not running. Open group ${groupOfMgr(m)} first.`, true); return; }
  toCto(m, `${project} #${n}: ${option}`, `Sent to the ${mgrName(m)}: ${project} #${n}: ${option}`);
}
// The whiteboard (#52): beside each CTO pane, the items waiting on the owner in its projects.
// Cards the owner removed from Waiting (#1168) are kept in ui.json, { "<Project>#<n>": question }.
const wbHidden = () => (homeLayout || {}).wbHidden || {};
const wbData = () => ({ tasksMd, groups, skip: [ME], hidden: wbHidden() });
const wbButton = id => h('button', { class: 'wbbtn', 'data-wb': id, title: 'Waiting on you: answer every question in one place', onclick: () => openWhiteboard({
  h, icon, deck, toast, openMd, mgr: id, title: mgrName(id), data: wbData, talk: (p, n, text) => talkCard(p, n, text, true), open: showTask,
  prompts: () => waitingLeads(id), promptCard: leadCard,
  setHidden: m => { homeLayout = { ...(homeLayout || {}), wbHidden: m }; saveUi(); wbCounts(); },
}) }, icon('board'), h('span', {}, 'Waiting'), h('b', {}, String(wbCount(id))));
const wbCount = m => waitingCount(tasksMd, groups, m, [ME], wbHidden()) + waitingLeads(m).length;
function wbCounts() { document.querySelectorAll('.wbbtn[data-wb]').forEach(b => { b.lastChild.textContent = String(wbCount(b.dataset.wb)); }); refreshMissed(); }
// Maybe missed (#367): beside Waiting on you, what the owner may have skipped in the CTO's replies.
setupMissed({ h, icon, deck, toast, openMd, tasksMd: () => tasksMd, prompts: m => waitingLeads(m), mgrName,
  ctos: () => [...started].filter(id => isMgr(id) && !T.isExited(id)), onChange: () => { if (view === 'home') renderHome(); },
  talk: (p, n, text) => talkCard(p, n, text, true),
  tell: async (m, line) => { if (!started.has(m) || T.isExited(m)) { toast(`The ${mgrName(m)} is not running.`, true); return false; } await toCto(m, line, `Sent to the ${mgrName(m)}`); return true; } });
setInterval(refreshMissed, 20000);
// Status (#383): beside Missed, where each lead open for that CTO stopped.
const leadsOfMgr = m => [...started].filter(id => !isMgr(id) && id !== PM && !T.isExited(id) && managerFor(groups, projectOf(id)) === m)
  .map(id => ({ id, name: sessionName(id), busy: isActive(id), prompt: waitingOn.has(id), task: leadTask(tasksOf(projectOf(id)), sessionName(id)) }));
setupStatus({ h, icon, deck, mgrName, leadsOf: leadsOfMgr, lastOutput: id => lastOutput.get(id) || 0,
  ctos: () => [...started].filter(id => isMgr(id) && !T.isExited(id)), ask: (m, line) => typeLine(deck, m, line), every: () => settings.statusEvery * 60000,
  owner: async m => ({ ago: T.typingIn(m).ago, draft: await drafting(m) }) });
// Send: hands a ready item to its project's CTO, the same as the PM's SEND message.
function send(project, n) {
  const m = managerFor(groups, project);
  if (!started.has(m) || T.isExited(m)) { toast(m === MAIN ? 'The CTO session has ended. Restart it on its tab.' : `The ${mgrName(m)} is not running. Open group ${groupOfMgr(m)} first.`, true); return; }
  toCto(m, `send ${project} #${n}`, `Sent ${project} #${n} to the ${mgrName(m)}`);
}
// A project's board shows its notes and recent commits, loaded when it opens.
let boardFocus = null, boardExtra = null;
// Home's board tab and the For you kind filter, for this run (#160); the ticked projects (#205), the
// priority and tag filters and the sort (#293) are kept in homeLayout.
let boardTab = 'kind', boardKind = 'all';
const setBoard = (k, v) => { homeLayout = { ...(homeLayout || {}), [k]: v }; saveUi(); renderHome(); };
async function setBoardFocus(name) {
  boardFocus = name; boardExtra = null; renderHome();
  document.getElementById('home').scrollTop = 0;
  const pb = document.querySelector('#home .pp-board > .pb'); if (pb) pb.scrollTop = 0; // a different board starts at its top
  if (!name) return;
  const d = await deck.projectDetails(name);
  if (boardFocus !== name || !d) return;
  boardExtra = { notes: splitTaskNotes(parseNotes(d.notes)).general, commits: d.git ? d.git.log : [], git: !!d.git };
  if (view === 'home') renderHome();
}
// Home: a full-window dashboard (the board, Me on its right).
let homeLayout = null, groupsOpen = false;
function renderHome() {
  const home = document.getElementById('home');
  home.classList.add('dashhost');
  if (boardFocus && !proj(boardFocus)) boardFocus = null;
  const code = projects.filter(p => isCode(p.name));
  const allTasks = code.flatMap(p => tasksOf(p.name));
  const kinds = allTasks.map(ownerKind).filter(Boolean);
  // Each project's board remembers whether it shows work or tests; Home has its tabs.
  const bkey = boardFocus || '', testView = settings.testBoards.includes(bkey);
  const open = (boardFocus ? [boardFocus] : code.map(p => p.name)).flatMap(n => tasksOf(n)).filter(t => t.mark !== 'x');
  const boardView = { test: testView, tests: open.filter(isTest).length, work: open.filter(t => !isTest(t)).length,
    set: v => saveSettings({ ...settings, testBoards: v ? [...settings.testBoards, bkey] : settings.testBoards.filter(b => b !== bkey) }) };
  // No project yet, after Skip setup (#1061): the one Connect your projects button.
  const board = !code.length ? emptyBoard(connectOpts()) : boardSection({
    h, icon, projects: code, tasksOf, optionsOf, focus: boardFocus, testView, setFocus: setBoardFocus,
    tab: boardTab, setTab: t => { boardTab = t; renderHome(); }, kind: boardKind, setKind: k => { boardKind = k; renderHome(); },
    only: (homeLayout || {}).boardOnly, setOnly: l => { homeLayout = { ...(homeLayout || {}), boardOnly: l }; saveUi(); renderHome(); }, prios: (homeLayout || {}).boardPrios, setPrios: l => setBoard('boardPrios', l), tags: settings.tags,
    tagFilter: (({ tags = [], mode } = (homeLayout || {}).boardTags || {}) => ({ tags: tags.filter(x => settings.tags.includes(x)), mode }))(), setTagFilter: f => setBoard('boardTags', f),
    sort: (homeLayout || {}).boardSort, setSort: s => setBoard('boardSort', s), prompts: waitingLeads(), promptCard: leadCard, showTask,
    send, answer, compact: settings.boardCompact, keeper: settings.runPm ? 'PM' : 'CTO',
    markDone: async (p, n) => { const d = await deck.setTaskMark(p, n, 'x'); tasksMd = d.tasks; renderHome(); },
    addTask: async (p, text) => { const d = await deck.addTask(p, text); tasksMd = d.tasks; renderHome(); toast(`Added to ${p}`); },
    openTab: n => openTab(n), isOpen: n => openTabs.includes(n), openInCode: n => deck.openInCode(n),
    openProjectPage, labelOf, dot, extra: boardExtra, deck, toast, openMd, rerender: renderHome, tasksMd: n => tasksMd[n] || '',
    apply: async pr => { const d = await pr; tasksMd = d.tasks; renderHome(); },
  });
  renderDash({
    icon,
    h, root: home, layout: homeLayout, saveLayout: l => { homeLayout = l; saveUi(); },
    meMd: tasksMd[ME] || '', notes: parseNotes(notesMd).reverse(),
    board: [board], boardMeta: `${kinds.length + waitingOn.size} waiting on you`, compact: settings.boardCompact, boardView: boardFocus ? boardView : null, keeper: settings.runPm ? 'PM' : 'CTO',
    setCompact: v => saveSettings({ ...settings, boardCompact: v }),
    groupsOpen, toggleGroups: () => { groupsOpen = !groupsOpen; renderHome(); }, groups: startSection(),
    showTask,
    markDone: async (p, n, mark = 'x') => { const d = await deck.setTaskMark(p, n, mark); tasksMd = d.tasks; renderHome(); },
    addMe: async text => { const d = await deck.addTask(ME, text); tasksMd = d.tasks; renderHome(); },
    addMeDraft: async draft => { const d = await deck.helperAdd({ kind: 'task', project: ME, draft }); tasksMd = d.tasks; renderHome(); },
    setSomeday: async (n, on) => { const d = await deck.setSomeday(n, on); tasksMd = d.tasks; renderHome(); },
    addSomeday: async text => { const d = await deck.addSomeday(text); tasksMd = d.tasks; renderHome(); },
    addNote: async text => { const d = await deck.addNote(text); notesMd = d.notes; renderHome(); },
    rerender: renderHome,
  });
}
// New data redraws whichever page is showing.
function redrawPage() { if (view === 'home') renderHome(); if (view === 'project') renderProjectPage(); if (view === 'me') renderMePage(); }

// ---------- status bar + live updates ----------
function renderStatus() {
  const s = document.getElementById('status'); s.replaceChildren();
  const ids = openTabs;
  const c = st => ids.filter(id => stateOf(id) === st).length;
  s.append(h('span', { class: 'it' }, h('b', {}, ids.length), ' project sessions'),
    h('span', { class: 'it' }, h('span', { class: 'st-dot working' }), c('working'), ' working'),
    h('span', { class: 'it' }, h('span', { class: 'st-dot needs' }), c('needs'), ' need you'),
    h('span', { class: 'spacer' }),
    h('span', { class: 'it talkhint' }, h('kbd', {}, 'Ctrl'), '+', h('kbd', {}, 'Shift'), '+', h('kbd', {}, 'Space'), voiceMode === 'tap' ? ' talk to the CTO' : ' hold to talk to the CTO'));
}
// Cheap refresh of dots and labels, so terminals are never remounted on a timer.
function updateLive() {
  document.querySelectorAll('[data-dot]').forEach(d => { const id = d.dataset.dot; d.className = 'st-dot ' + stateOf(id) + (isActive(id) ? ' active' : ''); d.dataset.tip = tipOf(id); });
  document.querySelectorAll('[data-lbl]').forEach(l => { l.textContent = labelOf(l.dataset.lbl); });
  renderStatus();
}
setInterval(updateLive, 1000);

// Settings lists the projects marked "Push without asking", read from their own folders.
let pushed = null, roots = null;
function showSettings(reload = true) {
  renderSettings(document.getElementById('home'), { h, settings, save: saveSettings, pluginSection, demo: !!demoSeed, back: () => { view = 'home'; render(); }, pushed, projects: projects.map(p => p.name), roots,
    replayTour: () => startTour(), update: updateInfo(), checkUpdates,
    projectRows: projects.filter(p => isCode(p.name)), redraw: () => showSettings(false),
    // A project's model (#1115) is saved for its next start; an open lead can restart on it now.
    setProjectModel: async (n, m) => {
      await deck.setProjectModel(n, m); await reloadProjects(); showSettings();
      const word = m ? m[0].toUpperCase() + m.slice(1) : 'Claude\'s default model';
      const open = started.has(n) && !T.isExited(n);
      toast(open ? `${n} will use ${word} from its next start. Restart its session now to switch.` : `${n} will use ${word} from its next start.`, false,
        open ? { label: 'Restart now', later: 'Later', run: () => restart(n) } : undefined);
    },
    connect: emptyBoard({ ...connectOpts(), has: true, bare: true, refresh: async () => { await reloadProjects(); showSettings(); return projects.length; } }),
    removeProject: async n => { await deck.removeProject(n); await reloadProjects(); showSettings(); } });
  if (reload) deck.pushList().then(l => { pushed = l; if (view === 'settings') showSettings(false); });
  // roots: { projects connected one by one, roots an older setup lists every folder of } (#1061)
  if (reload) deck.connectedProjects().then(r => { roots = r; if (view === 'settings') showSettings(false); });
}
async function reloadProjects() { projects = await deck.projectList(); roots = null; }

// ---------- render ----------
// The pane the last render showed on its own, so a redraw of the same view leaves the
// keyboard where the owner put it (#361).
let shownSingle = null;
// While the owner holds the talk key, a redraw waits until they let go: rebuilding the panes
// moves them in the page, which takes the keyboard away mid-dictation (#1003).
let renderLater = null;
function render() {
  if (talking()) {
    renderLater = renderLater || setInterval(() => { if (!talking()) { clearInterval(renderLater); renderLater = null; render(); } }, 150);
    return;
  }
  const giveBack = T.holdFocus();
  try { draw(giveBack.id); } finally { giveBack(); }
}
// First run (#1061): with no project connected and setup neither finished nor skipped, the
// window is the setup wizard under a slim title bar (Settings, and the Demo's buttons); the CTO
// starts when the wizard ends.
const noProjects = () => !projects.some(p => isCode(p.name));
let setupActive = false;       // decided at start: no project and setup never finished or skipped
const inSetup = () => setupActive;
const connectOpts = () => ({ h, icon, deck, toast, given: () => smokePick,
  refresh: async () => { await reloadProjects(); render(); return projects.length; } });
let setupShown = false;
function startSetup() { setupActive = true; setupShown = false; resetSetup(); render(); }
function drawSetup(home) {
  home.style.display = 'block'; document.getElementById('stage').style.display = 'none';
  home.classList.remove('dashhost', 'dashhost2');
  if (setupShown && home.querySelector('.setup')) return; // the wizard redraws itself
  setupShown = true;
  setupWizard(home, { ...connectOpts(), refresh: async () => { await reloadProjects(); return projects.length; },
    names: () => projects.filter(p => isCode(p.name)).map(p => p.name),
    done: async () => {
      setupShown = false; setupActive = false;
      saveSettings({ ...settings, setupDone: true });
      if (!started.has(MAIN)) await ensureSession(MAIN);
      if (settings.runPm && !started.has(PM)) await ensureSession(PM);
      view = 'home'; render();
      // The walkthrough follows, once (#1036).
      if (!settings.tourDone) setTimeout(startTour, 600);
    } });
}
// The walkthrough (#1036) on the Board; finishing or skipping it marks it done for good.
function startTour() {
  if (view !== 'home') { view = 'home'; render(); }
  requestAnimationFrame(() => openTour({ h, steps: TOUR, onEnd: () => { if (!settings.tourDone) saveSettings({ ...settings, tourDone: true }); } }));
}
function draw(held) {
  const wasSingle = shownSingle; shownSingle = null;
  const home = document.getElementById('home'), stage = document.getElementById('stage');
  document.body.classList.toggle('startonly', inSetup());
  if (inSetup() && view !== 'settings') { closeTask(); drawSetup(home); return; }
  if (setupShown) { setupShown = false; resetSetup(); }
  renderTabs(); renderPicker(); renderStatus(); requestAnimationFrame(C.place); noteSoon();
  if (ctx && view === 'split' && findGroup(groups, ctx)) groupViews[ctx] = { shown: [...splitSet], layoutId };
  else if (!ctx && view === 'split' && splitSet.length >= 2) mainView = { shown: [...splitSet], layoutId };
  saveUi();
  // Board: the CTO above the PM in the sidebar. Self and project pages (#331): the
  // CTO alone. Coding view: the PM slides over the right edge.
  // Without the PM (#172) the CTO has the sidebar to itself and there is no drawer.
  renderSide({ h, el: document.getElementById('side'), home, show: ['home', 'me', 'project'].includes(view), settings, save: saveSettings, mount: T.mount, dot, refit: T.refitAll,
    sessions: [{ id: MAIN, name: 'CTO', fold: 'foldCto' },
      ...(settings.runPm && view === 'home' ? [{ id: PM, name: 'PM', fold: 'foldPm' }] : [])] });
  renderPmDrawer({ h, el: document.getElementById('pmdock'), show: settings.runPm && (view === 'single' || view === 'split'), open: pmOpen, toggle: togglePm, mount: T.mount, dot, label: labelOf(PM) });
  if (view === 'home') { home.style.display = 'block'; stage.style.display = 'none'; renderHome(); requestAnimationFrame(() => T.refitAll()); return; }
  if (view !== 'home') home.classList.remove('dashhost');
  if (view === 'settings') { home.style.display = 'block'; stage.style.display = 'none'; closeTask(); showSettings(); return; }
  if (view === 'project') { home.style.display = 'block'; stage.style.display = 'none'; renderProjectPage(); requestAnimationFrame(() => T.refitAll()); return; }
  if (view === 'me') { home.style.display = 'block'; stage.style.display = 'none'; renderMePage(); requestAnimationFrame(() => T.refitAll()); return; }
  closeTask();
  home.style.display = 'none'; stage.style.display = 'flex'; stage.replaceChildren();
  if (view === 'single') {
    // A project on its own sits beside its own manager.
    ctx = isMgr(single) ? groupOfMgr(single) : groupOf(groups, single);
    const tree = isMgr(single) ? 'M' : SINGLE_WITH_MANAGER;
    stage.append(tree === 'M' ? buildTree('M', []) : buildTree(tree, [single], `single:${single}`));
    focused = single;
    if (wasSingle !== single || !held) T.focus(shownLead(single));
    shownSingle = single;
  } else {
    stage.append(buildTree(LAYOUTS[layoutId].tree, splitSet, `${layoutId}:${splitSet.join(',')}`));
  }
  requestAnimationFrame(() => { T.refitAll(); setTimeout(T.refitAll, 150); });
}

// Back and forward (#301): this file's part of each step, and putting one back.
const BOARD_KEYS = ['boardOnly', 'boardPrios', 'boardTags', 'boardSort'];
startNav({ deck, render, tasksOf, showTask,
  isOpenTab: n => openTabs.includes(n) || ((isMgr(n) || n === PM) && started.has(n)),
  get: () => ({ view, single, splitSet: [...splitSet], layoutId, ctx, currentProject, boardFocus, showDone, boardTab, boardKind, pmOpen,
    collapsed: [...collapsed], board: Object.fromEntries(BOARD_KEYS.map(k => [k, (homeLayout || {})[k]])) }),
  set: s => {
    const was = { currentProject, boardFocus, details: projectDetails };
    ({ view, single, layoutId, ctx, currentProject, showDone, boardTab, boardKind, pmOpen } = s);
    splitSet = [...s.splitSet]; collapsed.clear(); s.collapsed.forEach(n => collapsed.add(n));
    homeLayout = { ...(homeLayout || {}), ...s.board };
    if (s.boardFocus !== was.boardFocus) { boardFocus = s.boardFocus; boardExtra = null; }
    if (view === 'project' && (currentProject !== was.currentProject || !was.details)) { projectDetails = null; projectPrs = null; }
    render();
    if (view === 'project' && !projectDetails) loadProjectDetails(currentProject);
    if (view === 'home' && boardFocus && !boardExtra) setBoardFocus(boardFocus);
  } });

Object.assign(S, groupActs, bar, { ensureSession, proj, openTab, render, saveGroups, isCode, showTask, openFile, curMgr, mgrName, dot, labelOf, closeTab,
  extrasOf, shownLead, splitLeads, showN, openExtra, closeExtra, wbButton, openProjectPage, restart, updateLive });

// ---------- boot ----------
document.getElementById('btnNew').append(icon('plus'));
document.getElementById('btnLayout').append(icon('layout'), 'Layout');
document.getElementById('btnSettings').append(icon('gear'), 'Settings');
document.getElementById('btnSettings').onclick = () => { view = 'settings'; render(); };
// In-app updates (#1088): "Update ready" before Settings once a new version has downloaded.
setupUpdates({ h, icon, bar: document.getElementById('btnSettings'), onChange: () => { if (view === 'settings') showSettings(false); } });
// Plugins (#369): their title bar buttons go before Settings; Settings redraws as they change.
// The Plugins button (#377) lists them and switches them on and off.
startPlugins({ h, icon, deck, toast, bar: document.getElementById('btnSettings'), onChange: () => { if (view === 'settings') showSettings(false); },
  settings: () => settings, save: saveSettings,
  cto: line => recordingToCto(line),
  terminal: { mount: T.mount, focus: T.focus, dispose: T.dispose, type: (id, line) => typeLine(deck, id, line) } });
document.getElementById('btnNew').onclick = togglePop('newmenu', renderNewMenu);
// The Pixel Tavern (#240): every live session a guest; questions answered the way their cards answer.
let tavernHelpers = [], smokeRun = false;
setInterval(async () => {
  const list = await deck.tavernHelpers().catch(() => []);
  tavernHelpers = list.map(x => ({ ...x, project: isMgr(x.parent) || x.parent === PM ? 'All projects' : projectOf(x.parent) }));
}, 5000);
// The Demo (#135): set when it starts, so its tavern's robots are a new mix each start (#305).
let demoSeed = 0;
document.getElementById('btnSettings').before(tavernButton({
  h, icon, deck, toast, openPane: openTab, isSmoke: () => smokeRun,
  input: () => ({
    sessions: [...started].filter(id => !T.isExited(id)).map(id => {
      const role = isMgr(id) ? 'cto' : id === PM ? 'pm' : 'lead', project = role === 'lead' ? projectOf(id) : null;
      return { id, role, project, name: role === 'cto' ? mgrName(id) : role === 'pm' ? 'PM' : sessionName(id), state: stateOf(id) };
    }),
    prompts: waitingLeads().map(w => ({ id: w.id, session: w.words ? w.project : w.id, what: w.words ? (w.words.why || w.words.words || 'Your words, please') : w.what })),
    tasksMd, helpers: tavernHelpers, picks: settings.tavernLooks, skip: [ME],
    // The Demo's leads wear the project robots, a new mix each start (#305); else the owner's own (#358).
    robots: demoSeed ? demoRobots((projects || []).map(p => p.name), demoSeed) : settings.tavernRobots,
  }),
  leadCard: id => { const w = waitingLeads().find(x => x.id === id); return w ? leadCard(w) : null; },
  task: (p, n) => tasksOf(p).find(t => t.n === n),
  talkItem: (p, n, text) => talkCard(p, n, text, true),
  ctoOf: p => managerFor(groups, p),
  // A lead's task in progress and its last reported item (#277): by its name on the board.
  workOf: a => {
    if (a.role !== 'lead' || !a.project) return {};
    const mine = tasksOf(a.project).filter(t => t.who === a.name);
    return { task: mine.find(t => t.mark === '~') || (a.id.startsWith('visit:') ? null : tasksOf(a.project).find(t => t.mark === '~' && !/-[2-5]$/.test(t.who))),
      report: [...mine].reverse().find(t => t.result) };
  },
}));
document.getElementById('btnLayout').onclick = togglePop('layouts');

(async () => {
  const init = await deck.init();
  if (init.demo) demoSeed = Date.now();
  // The demo (#135) gets a Reset button that wipes and rebuilds its made-up content.
  if (init.demo) document.getElementById('btnSettings').before(h('button', { class: 'iconbtn', 'data-start': 'keep', title: 'Wipe the demo and start it as a new install', onclick: () => deck.demoReset() }, 'Reset demo'),
    // Stage 2 of a recording (#1058): the boards filled on top of what the first run made.
    h('button', { class: 'iconbtn', 'data-start': 'keep', title: 'Add the four demo projects and their boards, keeping what is there', onclick: async () => {
      const err = await deck.demoFill(); toast(err ? `Fill demo boards failed: ${err}` : 'Demo boards filled');
    } }, 'Fill demo boards'));
  projects = init.projects; tasksMd = init.data.tasks; notesMd = init.data.notes; ideasMd = init.data.ideas || ''; voiceMode = init.voiceMode;
  setupFocusLog(init.focusLog, { talking });
  setupSummaries(deck); wantSummaries(deck, tasksMd, [ME]);
  setWords(await deck.wordsList());
  showMissing(init.missing);
  // During the first-run setup the CTO waits for it to end (#1061).
  settings = normalizeSettings(init.settings);
  setupActive = !init.smoke && noProjects() && !settings.setupDone;
  if (!inSetup() || init.smoke) {
    await ensureSession(MAIN);
    if (normalizeSettings(init.settings).runPm || init.smoke) await ensureSession(PM);
  }
  smokeRun = !!init.smoke;
  // A try run's VS Code keeps its storage in memory too: the real FocusShell holds the saved one (#300).
  if (init.tryRun) C.setPartition('vscode-try');
  if (init.smoke) {
    C.setPartition('vscode-smoke');
    await smoke({
      get projects() { return projects; }, set projects(v) { projects = v; }, get tasksMd() { return tasksMd; }, set tasksMd(v) { tasksMd = v; },
      set prevSession(v) { prevSession = v; }, set splitSet(v) { splitSet = v; }, set layoutId(v) { layoutId = v; }, get layoutId() { return layoutId; },
      get view() { return view; }, set view(v) { view = v; }, get single() { return single; }, set single(v) { single = v; }, set ctx(v) { ctx = v; }, started, showLead,
      set pmOpen(v) { pmOpen = v; }, get splitSet() { return splitSet; }, get openTabs() { return openTabs; }, get groups() { return groups; }, set groups(v) { groups = v; },
      get settings() { return settings; }, set hold(v) { smokeHold = v || {}; }, set smokePick(v) { smokePick = v; }, startSetup, startTour, set settings(v) { settings = v; }, collapsed, saveSettings,
      render, openTab, closeTab, openProjectPage, openRequest, openExtraRequest, closeRequest, setBoardFocus, openGroup, openMd, openFile, wbCounts, openExtra, closeExtra, proj, tasksOf, showTask, checkPromptAlerts,
      focusLog, toCto, redrawPage, restart,
    }).catch(e => deck.smokeFail((e && e.stack) || e));
    return;
  }
  // Start empty: only the CTO and the PM (when on) run. Last time's tabs are offered, not reopened.
  const ui = init.ui || {};
  groups = normalizeGroups(init.groups);
  groupViews = ui.groupViews && typeof ui.groupViews === 'object' ? ui.groupViews : {};
  mainView = ui.mainView && typeof ui.mainView === 'object' ? ui.mainView : null;
  homeLayout = ui.homeLayout && typeof ui.homeLayout === 'object' ? ui.homeLayout : null;
  leadSplits = ui.leadSplits && typeof ui.leadSplits === 'object' ? ui.leadSplits : {};
  recent = init.recent && typeof init.recent === 'object' ? init.recent : {};
  settings = normalizeSettings(init.settings);
  if (settings.pmStartFolded) settings.pmFolded = true;
  applyPrefs(settings, T.refitAll);
  setTavernOn(settings.showTavern);
  prevSession = lastSession(ui.lastSession || ui);
  layoutId = LAYOUTS[ui.layoutId] ? ui.layoutId : 'm-2x2';
  view = 'home';
  render();
})();
