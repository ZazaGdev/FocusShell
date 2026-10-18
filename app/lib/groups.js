// Groups: named sets of projects, each with its own CTO session (`cto-<Group>`) and remembered
// view. A project belongs to at most one group, so no two CTOs ever share a project.
// Projects in no group belong to the main CTO, `cto`. (The CTO was called the manager.)
import { LAYOUTS, slotCount, autoLayout } from './layouts.js';

export const MAIN = 'cto';
export const PM = 'pm';
export const mgrId = group => group ? `cto-${group}` : MAIN;
export const isMgr = id => id === MAIN || String(id).startsWith('cto-');
export const groupOfMgr = id => id && id !== MAIN && isMgr(id) ? id.slice('cto-'.length) : null;

// Group names become session names, so only letters, digits, - and _ (spaces become -).
export function groupName(raw) {
  return String(raw || '').trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9_-]/g, '').replace(/^[-_]+/, '').slice(0, 30);
}

const same = (a, b) => a.toLowerCase() === b.toLowerCase();
export const findGroup = (groups, name) => groups.find(g => same(g.name, String(name || '')));
export const groupOf = (groups, project) => (groups.find(g => g.projects.includes(project)) || {}).name || null;
export const managerFor = (groups, project) => mgrId(groupOf(groups, project));

// Whatever is in groups.json: bad entries dropped, and a project listed in several
// groups stays only in the first, so the one-manager rule holds even after hand edits.
export function normalizeGroups(raw) {
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.groups) ? raw.groups : [];
  const taken = new Set(), out = [];
  for (const g of list) {
    const name = groupName(g && g.name);
    if (!name || findGroup(out, name)) continue;
    const projects = (Array.isArray(g.projects) ? g.projects : []).filter(p => typeof p === 'string' && p && !taken.has(p));
    projects.forEach(p => taken.add(p));
    out.push({ name, projects: [...new Set(projects)] });
  }
  return out;
}

// Projects that would leave another group if they joined `name`.
export function movesInto(groups, name, projects) {
  return projects.map(p => ({ project: p, from: groupOf(groups, p) })).filter(m => m.from && !same(m.from, name));
}

// Adds projects to a group, creating it if needed, and takes them out of any other group.
export function addToGroup(groups, name, projects) {
  const n = groupName(name);
  if (!n) return groups;
  const g = findGroup(groups, n), key = g ? g.name : n;
  const out = groups.map(x => same(x.name, key) ? x : { ...x, projects: x.projects.filter(p => !projects.includes(p)) });
  if (!g) return [...out, { name: n, projects: [...new Set(projects)] }];
  return out.map(x => x === g ? { ...x, projects: [...new Set([...x.projects, ...projects])] } : x);
}

export function removeFromGroup(groups, name, project) {
  return groups.map(g => same(g.name, name) ? { ...g, projects: g.projects.filter(p => p !== project) } : g);
}

export function deleteGroup(groups, name) {
  return groups.filter(g => !same(g.name, name));
}

// A name for a new group made from projects (#1024): the first two, "-plus<N>" for the rest,
// with -2, -3 ... when a group already has it.
export function suggestName(groups, projects) {
  const base = groupName(projects.slice(0, 2).join('-') + (projects.length > 2 ? `-plus${projects.length - 2}` : '')) || 'Group';
  let name = base;
  for (let i = 2; findGroup(groups, name); i++) name = `${base.slice(0, 27)}-${i}`;
  return name;
}

// Renames a group, keeping its projects; unchanged when the name is bad or taken by another.
export function renameGroup(groups, from, to) {
  const n = groupName(to), g = findGroup(groups, from);
  if (!n || !g || (findGroup(groups, n) && !same(n, g.name))) return groups;
  return groups.map(x => x === g ? { ...x, name: n } : x);
}

// The tabs a right-click on project tab `n` acts on: every tab in the split when `n` is
// in it, otherwise `n` alone.
export function tabTargets(view, splitSet, n) {
  return view === 'split' && splitSet.includes(n) ? [...splitSet] : [n];
}

// What the tab menu offers for those tabs: the groups they could all go into, and the
// groups some of them could leave.
export function tabMenu(groups, targets) {
  return {
    add: groups.filter(g => !targets.every(p => g.projects.includes(p))).map(g => g.name),
    leave: groups.filter(g => targets.some(p => g.projects.includes(p))).map(g => g.name),
  };
}

// A group's remembered view, kept to its members and to a layout that fits them.
export function viewFor(group, saved, max = 6) {
  const v = saved || {};
  const kept = (Array.isArray(v.shown) ? v.shown : []).filter(p => group.projects.includes(p));
  const shown = (kept.length ? kept : group.projects).slice(0, max);
  const L = LAYOUTS[v.layoutId];
  const layoutId = L && L.mgr && slotCount(L.tree) >= shown.length ? v.layoutId : autoLayout(shown.length);
  return { shown, layoutId };
}

// The main CTO's remembered split (#176): the CTO plus two or more of its projects. Kept to
// the projects still open and to a layout that fits them; null when fewer than two remain,
// so the CTO shows alone.
export function mainViewFor(saved, isOpen, max = 6) {
  const shown = (saved && Array.isArray(saved.shown) ? saved.shown : []).filter(isOpen).slice(0, max);
  if (shown.length < 2) return null;
  const L = LAYOUTS[saved.layoutId];
  return { shown, layoutId: L && L.mgr && slotCount(L.tree) >= shown.length ? saved.layoutId : autoLayout(shown.length) };
}
