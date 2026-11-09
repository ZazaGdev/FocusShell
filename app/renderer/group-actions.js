// Groups (#1785, from app.js): opening and closing a group's CTO and split, making, renaming and
// deleting groups, and moving projects in and out of them.
import { mgrId, groupOf, managerFor, findGroup, viewFor, addToGroup, removeFromGroup, deleteGroup, renameGroup, suggestName, movesInto, groupName, tabTargets, tabMenu } from '../lib/groups.js';
import { autoLayout, splitWith } from '../lib/layouts.js';
import * as T from './terminal.js';
import { h, toast } from './dom.js';
import { openTabMenu } from './tabmenu.js';
import { catchUp } from './catchup.js';

// a: app.js's shared state and functions (S there), read when each action runs.
export function groupActions(a) {
  // Opening a group starts its manager and brings back its split. From Home every member
  // opens; from its tab only the members already open show, unless none are.
  async function openGroup(name, all = true, catchup = false) {
    const g = findGroup(a.groups, name);
    if (!g || !(await a.ensureSession(mgrId(g.name)))) return;
    const members = g.projects.filter(p => a.proj(p));
    if (all || !members.some(p => a.openTabs.includes(p))) for (const n of members) await a.openTab(n, false);
    const v = viewFor({ ...g, projects: members.filter(p => a.openTabs.includes(p)) }, a.groupViews[g.name]);
    a.ctx = g.name;
    if (v.shown.length) { a.splitSet = v.shown; a.layoutId = v.layoutId; a.view = 'split'; } else { a.view = 'single'; a.single = mgrId(g.name); }
    a.render();
    if (catchup) catchUpOn(members.filter(p => a.openTabs.includes(p)));
  }
  // Open and catch up (#1025): each lead, and its CTO, get the recap.
  const catchUpOn = names => catchUp({ deck: a.deck, toast, settings: a.settings, mgrOf: p => managerFor(a.groups, p), running: id => a.started.has(id) && !T.isExited(id) }, names);
  async function closeGroup(name, ask = true) {
    const id = mgrId(name);
    if (ask && a.started.has(id) && !T.isExited(id) && !confirm(`End the ${name} CTO? Its project sessions stay open.`)) return;
    await a.deck.kill(id); a.started.delete(id); T.dispose(id);
    if (a.ctx === name) { a.ctx = null; a.view = 'home'; }
    a.render();
  }
  // The projects on screen, which Save what is open keeps and New group starts with ticked (#1024).
  const onScreen = () => (a.view === 'split' ? a.splitSet : a.openTabs.filter(n => !groupOf(a.groups, n))).filter(n => a.isCode(n));
  // A new group of picks; false when it was not made. With split, the split on screen is its view.
  function newGroup(raw, picks, split) {
    const name = groupName(raw);
    if (!name) { toast('Give the group a name: letters, digits, - or _', true); return false; }
    if (findGroup(a.groups, name)) { toast(`There is already a group called ${findGroup(a.groups, name).name}`, true); return false; }
    if (!picks.length) { toast('Pick at least one project', true); return false; }
    const moves = movesInto(a.groups, name, picks);
    if (moves.length && !confirm(`This moves ${moves.map(m => `${m.project} (from ${m.from})`).join(', ')} into ${name}. Continue?`)) return false;
    a.saveGroups(addToGroup(a.groups, name, picks));
    // The main CTO's split, when its projects are all in the group, becomes the group's split.
    if (split && !a.ctx && a.splitSet.length >= 2 && a.splitSet.every(n => picks.includes(n))) a.groupViews[name] = { shown: [...a.splitSet], layoutId: a.layoutId };
    return true;
  }
  function saveOpen() {
    const picks = onScreen();
    if (!picks.length) { toast('Open a project first: Save what is open keeps the projects on screen', true); return; }
    const name = suggestName(a.groups, picks);
    if (newGroup(name, picks, true)) { toast(`Saved group ${name}: click its name to rename it`); a.render(); }
  }
  // A group's CTO is named after it, so a running one is closed before the group is renamed.
  function renameGroupTo(from, to) {
    const n = groupName(to);
    if (!n || n === from) return;
    if (a.started.has(mgrId(from)) && !T.isExited(mgrId(from))) { toast(`Close the ${from} CTO first: its session is named after the group`, true); return; }
    if (findGroup(a.groups, n) && findGroup(a.groups, n).name !== from) { toast(`There is already a group called ${findGroup(a.groups, n).name}`, true); return; }
    a.saveGroups(renameGroup(a.groups, from, n));
    if (a.groupViews[from]) { a.groupViews[n] = a.groupViews[from]; delete a.groupViews[from]; }
    if (a.ctx === from) a.ctx = n;
    a.render();
  }
  function joinGroup(name, n) {
    const from = groupOf(a.groups, n);
    if (from === name) return true;
    if (from && !confirm(`Move ${n} from group ${from} to ${name}? Only one CTO works on a project.`)) return false;
    a.saveGroups(addToGroup(a.groups, name, [n])); toast(`${n} is now in group ${name}`);
    return true;
  }
  function leaveGroup(name, n) {
    a.saveGroups(removeFromGroup(a.groups, name, n));
    if (a.ctx === name && a.view === 'split' && a.splitSet.includes(n)) {
      a.splitSet = a.splitSet.filter(v => v !== n);
      if (!a.splitSet.length) { a.view = 'single'; a.single = mgrId(name); } else a.layoutId = autoLayout(a.splitSet.length);
    }
    a.render();
  }
  // Right-click a project tab: it, or every tab in its split, goes into a group (#104).
  function tabMenuAt(e, n) {
    e.preventDefault();
    const picks = tabTargets(a.view, a.splitSet, n);
    openTabMenu(e.currentTarget, picks, { h, ...tabMenu(a.groups, picks),
      onNew: raw => groupTabs(raw, picks, true), onAdd: g => groupTabs(g, picks, false),
      onLeave: g => { for (const p of picks) if (groupOf(a.groups, p) === g) leaveGroup(g, p); } });
  }
  function groupTabs(raw, picks, fresh) {
    const name = groupName(raw);
    if (!name) { toast('Give the group a name: letters, digits, - or _', true); return false; }
    if (fresh && findGroup(a.groups, name)) { toast(`There is already a group called ${findGroup(a.groups, name).name}`, true); return false; }
    const moves = movesInto(a.groups, name, picks);
    if (moves.length && !confirm(`This moves ${moves.map(m => `${m.project} (from ${m.from})`).join(', ')} into ${name}. Continue?`)) return false;
    a.saveGroups(addToGroup(a.groups, name, picks));
    const g = findGroup(a.groups, name).name, v = a.groupViews[g];
    if (v) a.groupViews[g] = { ...v, shown: splitWith(v.shown || [], picks) };
    toast(`${picks.join(', ')} ${picks.length > 1 ? 'are' : 'is'} now in group ${g}`);
    openGroup(g, false);
    return true;
  }
  async function removeGroup(name) {
    if (!confirm(`Delete group ${name}? Its projects go back to the main CTO.`)) return;
    if (a.started.has(mgrId(name))) await closeGroup(name, false);
    a.saveGroups(deleteGroup(a.groups, name)); delete a.groupViews[name];
    a.render();
  }
  return { openGroup, catchUpOn, closeGroup, onScreen, newGroup, saveOpen, renameGroupTo, joinGroup, leaveGroup, tabMenuAt, removeGroup };
}
