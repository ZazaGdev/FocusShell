// The title bar (#1785, from app.js): its popovers (the layout picker and the + menu), the tabs,
// and Ctrl+click putting a project in a split.
import { LAYOUTS, slotCount, autoLayout } from '../lib/layouts.js';
import { MAIN, mgrId, isMgr, groupOfMgr, groupOf, mainViewFor } from '../lib/groups.js';
import { extraId, EXTRA_LEADS } from '../lib/sessions.js';
import * as T from './terminal.js';
import * as C from './code.js';
import { h, icon, toast } from './dom.js';
import { miniTree } from './layout-ui.js';
import { MOD_NAME } from '../lib/platform.js';

// a: app.js's shared state and functions (S there), read when each is drawn or clicked.
export function titleBar(a) {
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
      g.append(h('button', { class: 'lopt' + (a.view === 'split' && id === a.layoutId ? ' sel' : ''), title: id, onclick: () => {
        a.layoutId = id;
        if (a.splitSet.length < 1) a.splitSet = a.openTabs.slice(0, slotCount(L.tree));
        a.view = 'split'; closePops(); a.render();
      } }, miniTree(L.tree)));
    }
  }
  function renderNewMenu() {
    const m = document.getElementById('newmenu'); m.replaceChildren();
    const avail = a.projects.filter(p => !a.openTabs.includes(p.name));
    m.append(h('button', { class: 'mitem', title: 'Pick one folder or several on this PC; each folder\'s name becomes a project name', onclick: async () => {
      closePops();
      const r = await a.deck.addProject();
      if (r.error) toast(r.error, true);
      if (!r.ok) return;
      a.projects = await a.deck.projectList();
      if (r.added.length) toast(`Added ${r.added.join(', ')}`);
      // One folder opens at once, as before; several land in the + menu and on the Board.
      if (r.names.length === 1) a.openTab(r.names[0]); else a.render();
    } }, 'Add project folders...'));
    if (!avail.length) m.append(h('div', { class: 'empty-note' }, 'Every project is open.'));
    for (const p of avail) {
      // FocusShell answers Claude Code's trust question itself (#1113), so no folder needs a note (#1119).
      m.append(h('button', { class: 'mitem', title: p.path, onclick: () => { closePops(); a.openTab(p.name); } }, p.name));
    }
  }

  // ---------- tabs ----------
  function renderTabs() {
    const t = document.getElementById('tabs'); t.replaceChildren();
    // Me (#130) is always first: the owner's own page, never a lead.
    t.append(h('div', { class: 'tab me' + (a.view === 'me' ? ' active' : ''), title: 'Self: your to-dos, ideas and sketches', onclick: () => { a.view = 'me'; a.render(); } }, h('span', { class: 'st-dot me' }), h('span', { class: 'nm' }, 'Self')));
    t.append(h('div', { class: 'tab home board' + (a.view === 'home' || a.view === 'project' ? ' active' : ''), title: 'Board: every project\'s work and what needs you', onclick: () => { a.view = 'home'; a.render(); } }, icon('board'), h('span', { class: 'nm' }, 'Board')));
    // CTO brings back its last split of two or more projects (#176), else the CTO alone; a
    // group's tab brings back that group's split.
    t.append(h('div', { class: 'tab mgr' + (a.view === 'single' && a.single === MAIN ? ' active' : ''), title: 'CTO (projects in no group)',
      onclick: () => {
        a.ctx = null;
        const v = mainViewFor(a.mainView, n => a.openTabs.includes(n) && !groupOf(a.groups, n));
        if (v) { a.splitSet = v.shown; a.layoutId = v.layoutId; a.view = 'split'; } else { a.view = 'single'; a.single = MAIN; }
        a.render();
      } },
      a.dot(MAIN), h('span', { class: 'nm' }, 'CTO')));
    const projTab = (n, inGroup) => {
      const inSplit = a.view === 'split' && a.splitSet.includes(n);
      const active = (a.view === 'single' && a.single === n) || inSplit;
      const x = h('span', { class: 'x', title: 'End session' }, icon('x'));
      // How many of the project's sessions run (#124): its lead and its extra leads; shown from 2 (#158).
      const runs = [n, ...EXTRA_LEADS.map(k => extraId(n, k))].filter(id => a.started.has(id) && !T.isExited(id)).length;
      const tc = runs > 1 ? h('span', { class: 'tc', title: `${runs} terminal${runs > 1 ? 's' : ''} running` }, String(runs)) : null;
      const cb = h('span', { class: 'cb' + (C.isOpen(n) ? ' on' : ''), title: C.isOpen(n) && active ? 'Close VS Code' : 'Open VS Code beside the lead' }, icon('code'));
      return h('div', { class: 'tab' + (active ? ' active' : '') + (inSplit ? ' insplit' : '') + (inGroup ? ' ingrp' : ''), title: `Click to open, ${MOD_NAME}+click to add to a split`, 'data-tip-delay': 1000, onclick: e => {
        if (x.contains(e.target)) { a.closeTab(n); return; }
        // The </> button opens VS Code beside this lead, showing the project if it is not on screen.
        if (cb.contains(e.target)) { if (C.isOpen(n) && active) C.closeCode(n); else { if (!active) { a.view = 'single'; a.single = n; } C.openCode(n, a.deck, a.render); } a.render(); return; }
        if (e.ctrlKey || e.metaKey) { toggleInSplit(n); return; }
        a.view = 'single'; a.single = n; a.render();
      }, oncontextmenu: e => a.tabMenuAt(e, n) }, a.dot(n), h('span', { class: 'pn' }, n), tc, cb, x);
    };
    for (const n of a.openTabs.filter(n => !groupOf(a.groups, n))) t.append(projTab(n, false));
    for (const g of a.groups) {
      const id = mgrId(g.name), members = a.openTabs.filter(n => g.projects.includes(n));
      if (!a.started.has(id) && !members.length) continue;
      const active = a.ctx === g.name && (a.view === 'split' || (a.view === 'single' && a.single === id));
      const x = h('span', { class: 'x', title: `End the ${g.name} CTO` }, icon('x'));
      t.append(h('div', { class: 'tab grp' + (active ? ' active' : ''), title: `Group ${g.name}: its CTO and its split`, onclick: e => {
        if (x.contains(e.target)) { a.closeGroup(g.name); return; }
        a.openGroup(g.name, false);
      } }, a.started.has(id) ? a.dot(id) : h('span', { class: 'st-dot idle' }), h('span', { class: 'nm' }, g.name), a.started.has(id) ? x : null));
      for (const n of members) t.append(projTab(n, true));
    }
  }
  // Ctrl+click: a split holds one manager's projects. In a group, a project from outside
  // joins the group (moving out of another one, after asking); outside groups, a grouped
  // project is refused so two managers never share it.
  function toggleInSplit(n) {
    if (a.view === 'home' || a.view === 'project') a.ctx = groupOf(a.groups, n);
    if (a.view === 'single') a.ctx = isMgr(a.single) ? groupOfMgr(a.single) : groupOf(a.groups, a.single);
    const g = groupOf(a.groups, n);
    if (!a.ctx && g) { toast(`${n} is in group ${g}. Open that group to put it in a split.`, true); return; }
    if (a.ctx && g !== a.ctx && !a.joinGroup(a.ctx, n)) return;
    if (a.view !== 'split') { a.splitSet = a.view === 'single' && !isMgr(a.single) ? [a.single] : []; a.view = 'split'; }
    a.splitSet = a.splitSet.includes(n) ? a.splitSet.filter(v => v !== n) : [...a.splitSet, n];
    if (!a.splitSet.length) { if (a.ctx) { a.view = 'single'; a.single = mgrId(a.ctx); } else a.view = 'home'; }
    else a.layoutId = autoLayout(a.splitSet.length);
    a.render();
  }
  return { closePops, togglePop, renderPicker, renderNewMenu, renderTabs, toggleInSplit };
}
