// FocusShell window: Home dashboard, session tabs, snap layouts, voice.
import { parseTasks, projectState, optionsOf, parseNotes, splitTaskNotes } from '../lib/tasks.js';
import { LAYOUTS, SINGLE_WITH_MANAGER, slotCount, autoLayout, splitWith } from '../lib/layouts.js';
import * as T from './terminal.js';
import * as C from './code.js';
import { renderProject } from './project.js';
import { touchRecent, recentList, lastSession } from '../lib/presets.js';
import { MAIN, PM, mgrId, isMgr, groupOfMgr, groupOf, managerFor, findGroup, normalizeGroups, mainViewFor, addToGroup, removeFromGroup, deleteGroup, renameGroup, suggestName, movesInto, groupName, viewFor, tabTargets, tabMenu } from '../lib/groups.js';
import { groupsSection } from './groups.js';
import { openTask, closeTask, openCard, refreshTask, talkIntoCard } from './task-detail.js';
import { openWhiteboard, closeWhiteboard, refreshWhiteboard, talkIntoWhiteboard, waitingCount, whiteboardOpen } from './whiteboard.js';
import { talkIntoHelper, helperOpen } from './helper.js';
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
import { secondId, secondOf, sessionName } from '../lib/sessions.js';
import { paneColour } from '../lib/projects.js';
import { demoRobots } from '../lib/tavern/agents.js';
import { h, icon, toast } from './dom.js';
import { smoke } from './smoke.js';
import { openSketch } from './sketch.js';
import { openTabMenu } from './tabmenu.js';
import { renderMe } from './me.js';
import { waitingWatch } from './waiting.js';
import { showMissing } from './requirements.js';
import { setupMissed, missedButton, refreshMissed, closeMissed } from './missed.js';
import { ctoRequests } from './cto-requests.js';
import { setupStatus, statusButton } from './status.js';
import { leadTask } from '../lib/status.js';
import { setupFocusLog, focusLog } from './focuslog.js';
import { miniTree, dragGutter } from './layout-ui.js';
import { typeLine, deliver } from './cto-line.js';
import { catchUp } from './catchup.js';
import { openSearch, searchKey } from './search.js';
import { tavernButton, setTavernOn } from './tavern/tavern.js';
import { startNav, noteSoon, navKey } from './nav.js';

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
const showSecond = new Set(); // projects whose pane shows the second lead
const secondWt = new Map();   // project -> whether its second lead has a worktree

const proj = n => projects.find(p => p.name === n);
const tasksOf = n => parseTasks(tasksMd[n] || '');
const isActive = id => Date.now() - (lastOutput.get(id) || 0) < 3000;
const curMgr = () => mgrId(ctx);
const mgrName = id => id === MAIN ? 'CTO' : `${groupOfMgr(id)} CTO`;

function stateOf(id) {
  if (T.isExited(id)) return 'ended';
  if (waitingOn.has(id)) return 'needs';
  if (isMgr(id) || id === PM || secondOf(id)) return isActive(id) ? 'working' : 'idle';
  const s = projectState(tasksOf(id));
  return s === 'idle' && isActive(id) ? 'working' : s;
}
function labelOf(id) {
  if (T.isExited(id)) return 'Session ended';
  if (isMgr(id)) return ''; // #383: room in the CTO pane's header for its buttons
  if (id === PM) return 'talk here';
  if (waitingOn.has(id)) return 'Waiting on your approval';
  if (secondOf(id)) return isActive(id) ? 'Busy' : 'Idle';
  const ts = tasksOf(id);
  const pick = m => ts.find(t => t.mark === m);
  const q = pick('?'), b = pick('!'), w = pick('~');
  if (q) return `Needs you on #${q.n}`;
  if (b) return `Blocked on #${b.n}`;
  if (w) return `Working on #${w.n}`;
  if (!started.has(id)) return 'No session';
  return isActive(id) ? 'Busy' : 'Idle';
}
const dot = id => h('span', { class: 'st-dot ' + stateOf(id) + (isActive(id) ? ' active' : ''), 'data-dot': id });

// The app starts empty, so the last set of tabs is kept as "Last session" rather than reopened.
function saveUi() {
  const snap = openTabs.length ? { openTabs, layoutId } : prevSession && { openTabs: prevSession.projects, layoutId: prevSession.layoutId };
  deck.saveUi({ view, single, splitSet, layoutId, groupViews, mainView, homeLayout, lastSession: snap || null });
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
// A project's second lead shows in the same pane, switched from the pane header. Closing
// it also removes its worktree, if it had one and its work is merged; the note says how.
async function openSecond(name, worktree) {
  if (!openTabs.includes(name)) await openTab(name, false);
  secondWt.set(name, worktree);
  if (!(await ensureSession(secondId(name), { worktree }))) return;
  showSecond.add(name); render();
}
async function closeSecond(name) {
  const id = secondId(name), note = await deck.kill(id);
  started.delete(id); T.dispose(id); showSecond.delete(name); secondWt.delete(name); paneModel.delete(id);
  if (note) toast(note, /kept/i.test(note));
  render();
  return note;
}
async function closeTab(name, ask = true) {
  const two = started.has(secondId(name));
  if (ask && started.has(name) && !T.isExited(name) && !confirm(`End the ${name} session${two ? 's (both leads)' : ''}?`)) return;
  if (two) await closeSecond(name);
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
  await ensureSession(id, { ...(secondOf(id) ? { worktree: secondWt.get(secondOf(id)) } : {}), orFresh: !!resumeId }, resumeId || undefined); render();
}

// ---------- groups ----------
// Opening a group starts its manager and brings back its split. From Home every member
// opens; from its tab only the members already open show, unless none are.
async function openGroup(name, all = true, catchup = false) {
  const g = findGroup(groups, name);
  if (!g || !(await ensureSession(mgrId(g.name)))) return;
  const members = g.projects.filter(p => proj(p));
  if (all || !members.some(p => openTabs.includes(p))) for (const n of members) await openTab(n, false);
  const v = viewFor({ ...g, projects: members.filter(p => openTabs.includes(p)) }, groupViews[g.name]);
  ctx = g.name;
  if (v.shown.length) { splitSet = v.shown; layoutId = v.layoutId; view = 'split'; } else { view = 'single'; single = mgrId(g.name); }
  render();
  if (catchup) catchUpOn(members.filter(p => openTabs.includes(p)));
}
// Open and catch up (#1025): each lead, and its CTO, get the recap.
const catchUpOn = names => catchUp({ deck, toast, settings, mgrOf: p => managerFor(groups, p), running: id => started.has(id) && !T.isExited(id) }, names);
async function closeGroup(name, ask = true) {
  const id = mgrId(name);
  if (ask && started.has(id) && !T.isExited(id) && !confirm(`End the ${name} CTO? Its project sessions stay open.`)) return;
  await deck.kill(id); started.delete(id); T.dispose(id);
  if (ctx === name) { ctx = null; view = 'home'; }
  render();
}
// The projects on screen, which Save what is open keeps and New group starts with ticked (#1024).
const onScreen = () => (view === 'split' ? splitSet : openTabs.filter(n => !groupOf(groups, n))).filter(n => isCode(n));
// A new group of picks; false when it was not made. With split, the split on screen is its view.
function newGroup(raw, picks, split) {
  const name = groupName(raw);
  if (!name) { toast('Give the group a name: letters, digits, - or _', true); return false; }
  if (findGroup(groups, name)) { toast(`There is already a group called ${findGroup(groups, name).name}`, true); return false; }
  if (!picks.length) { toast('Pick at least one project', true); return false; }
  const moves = movesInto(groups, name, picks);
  if (moves.length && !confirm(`This moves ${moves.map(m => `${m.project} (from ${m.from})`).join(', ')} into ${name}. Continue?`)) return false;
  saveGroups(addToGroup(groups, name, picks));
  // The main CTO's split, when its projects are all in the group, becomes the group's split.
  if (split && !ctx && splitSet.length >= 2 && splitSet.every(n => picks.includes(n))) groupViews[name] = { shown: [...splitSet], layoutId };
  return true;
}
function saveOpen() {
  const picks = onScreen();
  if (!picks.length) { toast('Open a project first: Save what is open keeps the projects on screen', true); return; }
  const name = suggestName(groups, picks);
  if (newGroup(name, picks, true)) { toast(`Saved group ${name}: click its name to rename it`); render(); }
}
// A group's CTO is named after it, so a running one is closed before the group is renamed.
function renameGroupTo(from, to) {
  const n = groupName(to);
  if (!n || n === from) return;
  if (started.has(mgrId(from)) && !T.isExited(mgrId(from))) { toast(`Close the ${from} CTO first: its session is named after the group`, true); return; }
  if (findGroup(groups, n) && findGroup(groups, n).name !== from) { toast(`There is already a group called ${findGroup(groups, n).name}`, true); return; }
  saveGroups(renameGroup(groups, from, n));
  if (groupViews[from]) { groupViews[n] = groupViews[from]; delete groupViews[from]; }
  if (ctx === from) ctx = n;
  render();
}
function joinGroup(name, n) {
  const from = groupOf(groups, n);
  if (from === name) return true;
  if (from && !confirm(`Move ${n} from group ${from} to ${name}? Only one CTO works on a project.`)) return false;
  saveGroups(addToGroup(groups, name, [n])); toast(`${n} is now in group ${name}`);
  return true;
}
function leaveGroup(name, n) {
  saveGroups(removeFromGroup(groups, name, n));
  if (ctx === name && view === 'split' && splitSet.includes(n)) {
    splitSet = splitSet.filter(v => v !== n);
    if (!splitSet.length) { view = 'single'; single = mgrId(name); } else layoutId = autoLayout(splitSet.length);
  }
  render();
}
// Right-click a project tab: it, or every tab in its split, goes into a group (#104).
function tabMenuAt(e, n) {
  e.preventDefault();
  const picks = tabTargets(view, splitSet, n);
  openTabMenu(e.currentTarget, picks, { h, ...tabMenu(groups, picks),
    onNew: raw => groupTabs(raw, picks, true), onAdd: g => groupTabs(g, picks, false),
    onLeave: g => { for (const p of picks) if (groupOf(groups, p) === g) leaveGroup(g, p); } });
}
function groupTabs(raw, picks, fresh) {
  const name = groupName(raw);
  if (!name) { toast('Give the group a name: letters, digits, - or _', true); return false; }
  if (fresh && findGroup(groups, name)) { toast(`There is already a group called ${findGroup(groups, name).name}`, true); return false; }
  const moves = movesInto(groups, name, picks);
  if (moves.length && !confirm(`This moves ${moves.map(m => `${m.project} (from ${m.from})`).join(', ')} into ${name}. Continue?`)) return false;
  saveGroups(addToGroup(groups, name, picks));
  const g = findGroup(groups, name).name, v = groupViews[g];
  if (v) groupViews[g] = { ...v, shown: splitWith(v.shown || [], picks) };
  toast(`${picks.join(', ')} ${picks.length > 1 ? 'are' : 'is'} now in group ${g}`);
  openGroup(g, false);
  return true;
}
async function removeGroup(name) {
  if (!confirm(`Delete group ${name}? Its projects go back to the main CTO.`)) return;
  if (started.has(mgrId(name))) await closeGroup(name, false);
  saveGroups(deleteGroup(groups, name)); delete groupViews[name];
  render();
}

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
  updateLive(); refreshWhiteboard(); wbCounts();
  // An open card follows its task and its notes, so the CTO's reply shows without reopening.
  const c = openCard(), fresh = c && tasksOf(c.project).find(t => t.n === c.n);
  if (fresh) refreshTask(fresh);
});
const { waitingOn, waitingLeads, leadCard, checkPromptAlerts, setWords } = waitingWatch({
  deck, started, groups: () => groups, hasProjects: () => projects.length > 0, mgrName, openTab, updateLive, showPrompts,
});
function showPrompts() { redrawPage(); refreshWhiteboard(); wbCounts(); }
deck.onNavProject(name => { if (proj(name)) openProjectPage(name); });
deck.onNavMe(() => { revealMe(); view = 'me'; render(); });
const { openRequest, closeRequest } = ctoRequests({
  deck, started, paneModel, showSecond, proj, tasksOf, isActive, openTab, openSecond, closeTab, closeSecond, render,
  get projects() { return projects; }, set projects(v) { projects = v; }, get openTabs() { return openTabs; }, get groups() { return groups; }, get groupViews() { return groupViews; },
  get view() { return view; }, set view(v) { view = v; }, get single() { return single; }, get ctx() { return ctx; }, set ctx(v) { ctx = v; },
  get splitSet() { return splitSet; }, set splitSet(v) { splitSet = v; }, set layoutId(v) { layoutId = v; }, get openError() { return openError; }, set openError(v) { openError = v; },
});

// ---------- voice ----------
const talkKey = e => e.ctrlKey && e.shiftKey && e.code === 'Space';
const pmKey = e => e.ctrlKey && e.shiftKey && e.code === 'KeyP';
// Ctrl+K stays with Claude Code inside a pane; Ctrl+Shift+K opens the search from there (#233).
T.setKeyFilter(e => !talkKey(e) && !pmKey(e) && !(searchKey(e) && e.shiftKey) && !navKey(e));
addEventListener('keydown', e => {
  if (!searchKey(e) || (!e.shiftKey && e.target.closest && e.target.closest('.xterm'))) return;
  e.preventDefault(); e.stopPropagation();
  if (!e.repeat) openSearch({ tasksMd, open: showTask });
}, true);
// Ctrl+Shift+P shows or hides the PM over the coding view; Escape hides it unless a
// terminal has the keyboard (Escape means something to Claude Code there).
function togglePm() { if (!settings.runPm) return; pmOpen = !pmOpen; render(); if (pmOpen) T.focus(PM); }
addEventListener('keydown', e => {
  if (pmKey(e) && (view === 'single' || view === 'split')) { e.preventDefault(); togglePm(); }
  else if (e.key === 'Escape' && pmOpen && (view === 'single' || view === 'split') && !e.target.closest('.xterm')) { pmOpen = false; render(); }
}, true);
T.setLinkFailHandler(p => toast(`Can't find ${p}`, true));
T.setFileOpener(openFile);
addEventListener('keydown', e => {
  if (!talkKey(e)) return;
  e.preventDefault();
  // With a card open, the voice goes into the card's box instead of the CTO's terminal. The
  // key's repeats while it is held start nothing more: each start presses Win+H, which toggles
  // the voice typing bar, and a held key left it open (#1083).
  if (e.repeat && (helperOpen() || whiteboardOpen() || openCard())) return;
  if (talkIntoHelper()) return;
  if (talkIntoWhiteboard()) return;
  if (openCard()) { talkIntoCard(); return; }
  if (voiceMode === 'tap' && e.repeat) return;
  talkAt = Date.now();
  // Tap mode: the first press starts the dictation and the next one ends it (#1018).
  if (voiceMode === 'tap') tapSince = tapSince ? 0 : talkAt;
  const to = view === 'home' || view === 'project' ? MAIN : curMgr();
  T.typed(to, ' '); deck.write(to, ' ');
}, true);
// Claude Code's own dictation, Space held inside a pane, is talking too (#1018): its repeats
// keep it going like the talk key's. Enter in a pane ends a tapped dictation.
addEventListener('keydown', e => {
  if (!e.target.closest || !e.target.closest('.xterm')) return;
  if (e.code === 'Space' && e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey) talkAt = Date.now();
  else if (e.key === 'Enter' || e.key === 'Escape') tapSince = 0;
}, true);
// The talk key's last press: held, it repeats every few tens of ms (#1003's focus log). A tapped
// dictation counts until the second tap, for two minutes at most.
let talkAt = 0, tapSince = 0;
const TAP_MAX = 2 * 60 * 1000;
const talking = () => Date.now() - talkAt < 400 || (tapSince > 0 && Date.now() - tapSince < TAP_MAX);
// The same key from another app talks to the main CTO (#253); its Space presses count as typing.
// There, letting go sends it (#415); inside the app the words wait in the prompt for the owner.
deck.onTalkGlobal(id => T.typed(id, ' '));
deck.onTalkSent(id => toast(`Sent to the ${mgrName(id)}`));

// ---------- popovers ----------
function closePops() { document.querySelectorAll('.pop').forEach(p => p.classList.remove('open')); }
function togglePop(id, before) {
  return e => { e.stopPropagation(); const p = document.getElementById(id), was = p.classList.contains('open'); closePops(); if (!was) { before && before(); p.classList.add('open'); } };
}
document.addEventListener('click', e => { if (!e.target.closest('.wrap')) closePops(); });

function renderPicker() {
  const g = document.getElementById('lgrid'); g.replaceChildren();
  for (const id of Object.keys(LAYOUTS)) {
    const L = LAYOUTS[id];
    g.append(h('button', { class: 'lopt' + (view === 'split' && id === layoutId ? ' sel' : ''), title: id, onclick: () => {
      layoutId = id;
      if (splitSet.length < 1) splitSet = openTabs.slice(0, slotCount(L.tree));
      view = 'split'; closePops(); render();
    } }, miniTree(L.tree)));
  }
}
function renderNewMenu() {
  const m = document.getElementById('newmenu'); m.replaceChildren();
  const avail = projects.filter(p => !openTabs.includes(p.name));
  m.append(h('button', { class: 'mitem', title: 'Pick one folder or several on this PC; each folder\'s name becomes a project name', onclick: async () => {
    closePops();
    const r = await deck.addProject();
    if (r.error) toast(r.error, true);
    if (!r.ok) return;
    projects = await deck.projectList();
    if (r.added.length) toast(`Added ${r.added.join(', ')}`);
    // One folder opens at once, as before; several land in the + menu and on the Board.
    if (r.names.length === 1) openTab(r.names[0]); else render();
  } }, 'Add project folders...'));
  if (!avail.length) m.append(h('div', { class: 'empty-note' }, 'Every project is open.'));
  for (const p of avail) {
    // FocusShell answers Claude Code's trust question itself (#1113), so no folder needs a note (#1119).
    m.append(h('button', { class: 'mitem', title: p.path, onclick: () => { closePops(); openTab(p.name); } }, p.name));
  }
}

// ---------- tabs ----------
function renderTabs() {
  const t = document.getElementById('tabs'); t.replaceChildren();
  // Me (#130) is always first: the owner's own page, never a lead.
  t.append(h('div', { class: 'tab me' + (view === 'me' ? ' active' : ''), title: 'Self: your to-dos, ideas and sketches', onclick: () => { view = 'me'; render(); } }, h('span', { class: 'st-dot me' }), h('span', { class: 'nm' }, 'Self')));
  t.append(h('div', { class: 'tab home board' + (view === 'home' || view === 'project' ? ' active' : ''), title: 'Board: every project\'s work and what needs you', onclick: () => { view = 'home'; render(); } }, icon('board'), h('span', { class: 'nm' }, 'Board')));
  // CTO brings back its last split of two or more projects (#176), else the CTO alone; a
  // group's tab brings back that group's split.
  t.append(h('div', { class: 'tab mgr' + (view === 'single' && single === MAIN ? ' active' : ''), title: 'CTO (projects in no group)',
    onclick: () => {
      ctx = null;
      const v = mainViewFor(mainView, n => openTabs.includes(n) && !groupOf(groups, n));
      if (v) { splitSet = v.shown; layoutId = v.layoutId; view = 'split'; } else { view = 'single'; single = MAIN; }
      render();
    } },
    dot(MAIN), h('span', { class: 'nm' }, 'CTO')));
  const projTab = (n, inGroup) => {
    const inSplit = view === 'split' && splitSet.includes(n);
    const active = (view === 'single' && single === n) || inSplit;
    const x = h('span', { class: 'x', title: 'End session' }, icon('x'));
    // How many of the project's sessions run (#124): its lead and its second lead; shown from 2 (#158).
    const runs = [n, secondId(n)].filter(id => started.has(id) && !T.isExited(id)).length;
    const tc = runs > 1 ? h('span', { class: 'tc', title: `${runs} terminal${runs > 1 ? 's' : ''} running` }, String(runs)) : null;
    const cb = h('span', { class: 'cb' + (C.isOpen(n) ? ' on' : ''), title: C.isOpen(n) && active ? 'Close VS Code' : 'Open VS Code beside the lead' }, icon('code'));
    return h('div', { class: 'tab' + (active ? ' active' : '') + (inSplit ? ' insplit' : '') + (inGroup ? ' ingrp' : ''), title: 'Click to open, Ctrl+click to add to a split', onclick: e => {
      if (x.contains(e.target)) { closeTab(n); return; }
      // The </> button opens VS Code beside this lead, showing the project if it is not on screen.
      if (cb.contains(e.target)) { if (C.isOpen(n) && active) C.closeCode(n); else { if (!active) { view = 'single'; single = n; } C.openCode(n, deck, render); } render(); return; }
      if (e.ctrlKey || e.metaKey) { toggleInSplit(n); return; }
      view = 'single'; single = n; render();
    }, oncontextmenu: e => tabMenuAt(e, n) }, dot(n), h('span', { class: 'pn' }, n), tc, cb, x);
  };
  for (const n of openTabs.filter(n => !groupOf(groups, n))) t.append(projTab(n, false));
  for (const g of groups) {
    const id = mgrId(g.name), members = openTabs.filter(n => g.projects.includes(n));
    if (!started.has(id) && !members.length) continue;
    const active = ctx === g.name && (view === 'split' || (view === 'single' && single === id));
    const x = h('span', { class: 'x', title: `End the ${g.name} CTO` }, icon('x'));
    t.append(h('div', { class: 'tab grp' + (active ? ' active' : ''), title: `Group ${g.name}: its CTO and its split`, onclick: e => {
      if (x.contains(e.target)) { closeGroup(g.name); return; }
      openGroup(g.name, false);
    } }, started.has(id) ? dot(id) : h('span', { class: 'st-dot idle' }), h('span', { class: 'nm' }, g.name), started.has(id) ? x : null));
    for (const n of members) t.append(projTab(n, true));
  }
}
// Ctrl+click: a split holds one manager's projects. In a group, a project from outside
// joins the group (moving out of another one, after asking); outside groups, a grouped
// project is refused so two managers never share it.
function toggleInSplit(n) {
  if (view === 'home' || view === 'project') ctx = groupOf(groups, n);
  if (view === 'single') ctx = isMgr(single) ? groupOfMgr(single) : groupOf(groups, single);
  const g = groupOf(groups, n);
  if (!ctx && g) { toast(`${n} is in group ${g}. Open that group to put it in a split.`, true); return; }
  if (ctx && g !== ctx && !joinGroup(ctx, n)) return;
  if (view !== 'split') { splitSet = view === 'single' && !isMgr(single) ? [single] : []; view = 'split'; }
  splitSet = splitSet.includes(n) ? splitSet.filter(v => v !== n) : [...splitSet, n];
  if (!splitSet.length) { if (ctx) { view = 'single'; single = mgrId(ctx); } else view = 'home'; }
  else layoutId = autoLayout(splitSet.length);
  render();
}

// ---------- panes ----------
function paneEl(id) {
  if (!id) return h('div', { class: 'pane empty' }, h('div', { class: 'ph' }, h('span', { class: 'pn' }, 'Empty slot')), h('div', { class: 'body' }, 'Ctrl+click a tab to fill this slot'));
  const mgr = isMgr(id);
  // A project pane shows its first lead or, switched in the header, its second (term).
  const lead = !mgr && id !== PM, sid = lead ? secondId(id) : null, has2 = !!sid && started.has(sid);
  const term = has2 && showSecond.has(id) ? sid : id;
  const swBtn = (n, s) => h('button', { class: term === s ? 'on' : '', title: `lead-${id}${n === '2' ? '-2' : ''}`, onclick: async e => {
    e.stopPropagation(); if (n === '2') showSecond.add(id); else { showSecond.delete(id); await ensureSession(id); } render();
  } }, dot(s), n);
  const two = !lead ? null : has2 ? h('span', { class: 'leads' }, swBtn('1', id), swBtn('2', sid))
    : h('button', { class: 'two', title: 'Start a second lead on this project', onclick: e => {
      e.stopPropagation();
      e.currentTarget.replaceWith(h('span', { class: 'leads pick' },
        h('button', { title: 'Both leads work in the project folder, on files that do not overlap', onclick: () => openSecond(id, false) }, 'Same folder'),
        h('button', { title: 'The second lead gets its own git worktree, removed when it closes', onclick: () => openSecond(id, true) }, 'Own worktree')));
    } }, '+2');
  const folded = collapsed.has(id);
  const foldBtn = !mgr && view === 'split'
    ? h('button', { class: 'fold', title: folded ? 'Expand' : 'Collapse', onclick: e => { e.stopPropagation(); folded ? collapsed.delete(id) : collapsed.add(id); render(); } }, icon('fold'))
    : null;
  const find = h('button', { class: 'find', title: 'Find in this pane (Ctrl+Shift+F)', onclick: e => { e.stopPropagation(); T.openFind(term); } }, icon('search'));
  const top = h('button', { title: 'Jump to top (Ctrl+Home)', onclick: () => T.jumpToTop(term) }, icon('top'));
  const last = h('button', { title: 'Jump to your last prompt', onclick: () => { if (!T.jumpToLastPrompt(term)) toast('No prompt sent in this pane yet, or it has scrolled out of the history'); } }, icon('lastprompt'));
  const who = mgr ? mgrName(id) : id === PM ? 'the PM' : term === sid ? `lead-${id}-2` : `lead-${id}`;
  const sketch = h('button', { class: 'sketch', title: `Sketch: draw something into ${who}'s prompt`, onclick: () => openSketch(term, who, () => T.focus(term)) }, icon('pen'));
  const end2 = term === sid ? h('button', { title: `End lead-${id}-2`, onclick: () => { if (confirm(`End lead-${id}-2?`)) closeSecond(id); } }, icon('x')) : null;
  // Every project pane opens or closes VS Code beside itself, like the tab's </> button.
  const code = mgr || id === PM ? null : h('button', { class: C.isOpen(id) ? 'on' : '', title: C.isOpen(id) ? 'Close VS Code' : 'Open VS Code beside the lead',
    onclick: () => { if (C.isOpen(id)) C.closeCode(id); else C.openCode(id, deck, render); render(); } }, icon('code'));
  const acts = h('span', { class: 'pa' }, mgr ? wbButton(id) : null, mgr && settings.showMissed ? missedButton(id) : null, mgr ? statusButton(id) : null, foldBtn, find, top, last, code, sketch, end2,
    !mgr && view === 'split' ? h('button', { title: 'Open on its own', onclick: () => { view = 'single'; single = id; render(); } }, icon('popout')) : null,
    !mgr && view === 'split' ? h('button', { title: 'Remove from split', onclick: () => toggleInSplit(id) }, icon('x')) : null);
  const head = h('div', { class: 'ph', ondblclick: () => { if (!mgr) { view = 'single'; single = id; render(); } } },
    dot(term), lead ? h('span', { class: 'pn link', title: `Open the ${id} project page`, onclick: e => { e.stopPropagation(); openProjectPage(id); } }, id)
      : h('span', { class: 'pn' }, mgr ? mgrName(id) : id), two, h('span', { class: 'lbl', 'data-lbl': term }, labelOf(term)), acts);
  const body = h('div', { class: 'body' });
  const el = h('div', { class: 'pane' + (mgr ? ' manager' : '') + (folded ? ' collapsed' : '') + (focused === id ? ' focus' : ''), style: `--pc:${mgr ? 'var(--accent)' : id === PM ? 'var(--me)' : `var(--p${paneColour(id, 8)})`}`, onmousedown: () => {
    focused = id; document.querySelectorAll('.pane').forEach(x => x.classList.remove('focus')); el.classList.add('focus');
  } }, head, body);
  T.mount(term, body);
  if (T.isExited(term) && T.shellLive(term)) body.append(h('div', { class: 'endbar' }, h('span', {}, 'Claude has exited. This pane is a shell now.'), h('button', { class: 'btn primary', onclick: () => restart(term) }, 'Restart')));
  else if (T.isExited(term)) body.append(h('div', { class: 'overlay' }, h('div', {}, h('p', {}, 'This session has ended.'), h('button', { class: 'btn primary', onclick: () => restart(term) }, 'Restart'))));
  if (!lead || folded || !C.isOpen(id)) return el;
  return C.beside(id, el, { h, icon, dragGutter, onClose: () => { C.closeCode(id); render(); }, onExternal: () => deck.openInCode(id),
    onRetry: () => { C.closeCode(id); C.openCode(id, deck, render); render(); } });
}
// Divider positions dragged this run, per layout, panes and split (#189), so a redraw such
// as opening VS Code keeps them instead of going back to the layout's fractions.
const dragged = new Map();
function buildTree(node, names, key = names.join(',')) {
  if (node === 'M') {
    // The context's manager; a group's manager starts here if it is not running yet.
    const m = curMgr();
    if (!started.has(m)) ensureSession(m).then(ok => ok && updateLive());
    return paneEl(m);
  }
  if (typeof node === 'number') return paneEl(names[node]);
  const [dir, kids] = node, wrap = h('div', { class: 'split' + (dir === 'v' ? ' v' : '') });
  const saved = dragged.get(key), fracs = saved && saved.length === kids.length ? saved : kids.map(k => k[1]);
  const cellEls = [];
  // After a drag, each open cell keeps its share of the space the open cells had.
  const remember = () => {
    const open = cellEls.map((c, i) => /folded-/.test(c.className) ? null : i).filter(i => i !== null);
    const px = open.map(i => { const r = cellEls[i].getBoundingClientRect(); return dir === 'v' ? r.height : r.width; });
    const total = px.reduce((a, b) => a + b, 0), share = open.reduce((a, i) => a + fracs[i], 0);
    if (!total) return;
    const next = [...fracs];
    open.forEach((i, j) => { next[i] = px[j] / total * share; });
    dragged.set(key, next);
  };
  kids.forEach(([child], i) => {
    if (i > 0) { const g = h('div', { class: 'gutter' }); dragGutter(g, dir, remember); wrap.append(g); }
    const leaf = typeof child === 'number' ? names[child] : null;
    const fold = leaf && collapsed.has(leaf);
    const cell = h('div', { class: 'cell' + (fold ? ' folded-' + dir : ''), style: fold ? `flex:0 0 ${dir === 'v' ? 31 : 34}px` : `flex:${fracs[i] * 100} 1 0` }, buildTree(child, names, `${key}/${i}`));
    cellEls.push(cell); wrap.append(cell);
  });
  return wrap;
}

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
  const lead = id && !isMgr(id) && id !== PM ? (secondOf(id) || id) : null;
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
const toCto = (m, line, sent) => typeLine(deck, m, line).then(r => toast(r === 'held' ? `${sent.replace(/^Sent/, 'Held')}: sent when your prompt is empty` : sent));
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
  const r = await deliver(deck, MAIN, line, fail);
  toast(r === 'held' ? 'Held for the CTO: sent when your prompt is empty' : 'Sent to the CTO');
  return true;
}
// Answers go to the project's own manager, the one that asked.
function answer(project, n, option) {
  const m = managerFor(groups, project);
  if (!started.has(m) || T.isExited(m)) { toast(m === MAIN ? 'The CTO session has ended. Restart it on its tab.' : `The ${mgrName(m)} is not running. Open group ${groupOfMgr(m)} first.`, true); return; }
  toCto(m, `${project} #${n}: ${option}`, `Sent to the ${mgrName(m)}: ${project} #${n}: ${option}`);
}
// The whiteboard (#52): beside each CTO pane, the items waiting on the owner in its projects.
const wbData = () => ({ tasksMd, groups, skip: [ME] });
const wbButton = id => h('button', { class: 'wbbtn', 'data-wb': id, title: 'Waiting on you: answer every question in one place', onclick: () => openWhiteboard({
  h, icon, deck, toast, openMd, mgr: id, title: mgrName(id), data: wbData, talk: (p, n, text) => talkCard(p, n, text, true), open: showTask,
  prompts: () => waitingLeads(id), promptCard: leadCard,
}) }, icon('board'), h('span', {}, 'Waiting'), h('b', {}, String(wbCount(id))));
const wbCount = m => waitingCount(tasksMd, groups, m, [ME]) + waitingLeads(m).length;
function wbCounts() { document.querySelectorAll('.wbbtn[data-wb]').forEach(b => { b.lastChild.textContent = String(wbCount(b.dataset.wb)); }); refreshMissed(); }
// Maybe missed (#367): beside Waiting on you, what the owner may have skipped in the CTO's replies.
setupMissed({ h, icon, deck, toast, openMd, tasksMd: () => tasksMd, prompts: m => waitingLeads(m), mgrName,
  ctos: () => [...started].filter(id => isMgr(id) && !T.isExited(id)), onChange: () => { if (view === 'home') renderHome(); },
  talk: (p, n, text) => talkCard(p, n, text, true),
  tell: async (m, line) => { if (!started.has(m) || T.isExited(m)) { toast(`The ${mgrName(m)} is not running.`, true); return false; } await toCto(m, line, `Sent to the ${mgrName(m)}`); return true; } });
setInterval(refreshMissed, 20000);
// Status (#383): beside Missed, where each lead open for that CTO stopped.
const leadsOfMgr = m => [...started].filter(id => !isMgr(id) && id !== PM && !T.isExited(id) && managerFor(groups, id.replace(/:2$/, '')) === m)
  .map(id => ({ id, name: sessionName(id), busy: isActive(id), prompt: waitingOn.has(id), task: leadTask(tasksOf(id.replace(/:2$/, '')), sessionName(id)) }));
setupStatus({ h, icon, deck, mgrName, leadsOf: leadsOfMgr, lastOutput: id => lastOutput.get(id) || 0,
  ctos: () => [...started].filter(id => isMgr(id) && !T.isExited(id)), ask: (m, line) => typeLine(deck, m, line), every: () => settings.statusEvery * 60000 });
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
    h('span', { class: 'it' }, h('span', { class: 'st-dot blocked' }), c('blocked'), ' blocked'),
    h('span', { class: 'spacer' }),
    h('span', { class: 'it talkhint' }, h('kbd', {}, 'Ctrl'), '+', h('kbd', {}, 'Shift'), '+', h('kbd', {}, 'Space'), voiceMode === 'tap' ? ' talk to the CTO' : ' hold to talk to the CTO'));
}
// Cheap refresh of dots and labels, so terminals are never remounted on a timer.
function updateLive() {
  document.querySelectorAll('[data-dot]').forEach(d => { const id = d.dataset.dot; d.className = 'st-dot ' + stateOf(id) + (isActive(id) ? ' active' : ''); });
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
    if (wasSingle !== single || !held) T.focus(showSecond.has(single) && started.has(secondId(single)) ? secondId(single) : single);
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
  tavernHelpers = list.map(x => ({ ...x, project: isMgr(x.parent) || x.parent === PM ? 'All projects' : secondOf(x.parent) || x.parent }));
}, 5000);
// The Demo (#135): set when it starts, so its tavern's robots are a new mix each start (#305).
let demoSeed = 0;
document.getElementById('btnSettings').before(tavernButton({
  h, icon, deck, toast, openPane: openTab, isSmoke: () => smokeRun,
  input: () => ({
    sessions: [...started].filter(id => !T.isExited(id)).map(id => {
      const role = isMgr(id) ? 'cto' : id === PM ? 'pm' : 'lead', project = role === 'lead' ? secondOf(id) || id : null;
      return { id, role, project, name: role === 'cto' ? mgrName(id) : role === 'pm' ? 'PM' : secondOf(id) ? `lead-${project}-2` : `lead-${id}`, state: stateOf(id) };
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
    return { task: mine.find(t => t.mark === '~') || (a.id.startsWith('visit:') ? null : tasksOf(a.project).find(t => t.mark === '~' && !t.who.endsWith('-2'))),
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
      set view(v) { view = v; }, set single(v) { single = v; }, set ctx(v) { ctx = v; },
      set pmOpen(v) { pmOpen = v; }, get splitSet() { return splitSet; }, get openTabs() { return openTabs; }, get groups() { return groups; }, set groups(v) { groups = v; },
      get settings() { return settings; }, set hold(v) { smokeHold = v || {}; }, set smokePick(v) { smokePick = v; }, startSetup, startTour, set settings(v) { settings = v; }, collapsed, saveSettings,
      render, openTab, closeTab, openProjectPage, openRequest, closeRequest, setBoardFocus, openGroup, openMd, openFile, wbCounts, openSecond, closeSecond, proj, tasksOf, showTask, checkPromptAlerts,
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
