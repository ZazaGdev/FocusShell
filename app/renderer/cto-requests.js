// The CTO's requests to open and close panes (open-pane.ps1, close-pane.ps1, #185), and the
// layout the opened projects land in.
import * as T from './terminal.js';
import { toast } from './dom.js';
import { autoLayout, splitWith } from '../lib/layouts.js';
import { isMgr, groupOf, findGroup, viewFor } from '../lib/groups.js';
import { secondId } from '../lib/sessions.js';

// c: the app's state as getters and setters (projects, openTabs, groups, groupViews, view,
// single, ctx, splitSet, layoutId, openError) and its actions.
export function ctoRequests(c) {
  const { deck, started, paneModel, showSecond, proj, tasksOf, isActive, openTab, openSecond, closeTab, closeSecond, render } = c;
  // The CTO closes a lead with close-pane.ps1. A lead that is busy or has a task in progress
  // stays open unless the request says force; the answer goes back to the script.
  // With a second lead open, closing the first keeps the tab for the second; -Second closes
  // only the second, whose busy check is only "busy right now", since tasks are shared.
  async function closeRequest({ name, force, second }) {
    const reply = answer => deck.closedAnswer(name, answer, second);
    const p = proj(name) || c.projects.find(x => x.name.toLowerCase() === String(name).toLowerCase());
    const id = p ? p.name : name, sid = secondId(id);
    if (second) {
      if (!started.has(sid)) { reply(`lead-${id}-2 is not open, nothing to close.`); return; }
      if (!force && !T.isExited(sid) && isActive(sid)) { reply(`Not closed: lead-${id}-2 is busy right now. Ask the user, then run again with -Force to close it anyway.`); return; }
      const note = await closeSecond(id);
      reply(`Closed lead-${id}-2.${note ? ' ' + note : ''}`); toast(`Closed ${id} 2 at the CTO's request`);
      return;
    }
    if (!c.openTabs.includes(id) && !started.has(id)) { reply(`lead-${id} is not open, nothing to close.`); return; }
    const doing = tasksOf(id).filter(t => t.mark === '~').map(t => `#${t.n}`);
    const live = started.has(id) && !T.isExited(id);
    if (!force && live && (isActive(id) || doing.length)) {
      reply(`Not closed: lead-${id} is ${isActive(id) ? 'busy right now' : `on ${doing.join(', ')} (in progress)`}. Ask the user, then run again with -Force to close it anyway.`);
      return;
    }
    if (started.has(sid)) { await deck.kill(id); started.delete(id); T.dispose(id); showSecond.add(id); render(); }
    else await closeTab(id, false);
    reply(`Closed lead-${id}${force && (doing.length) ? ` (forced; ${doing.join(', ')} still marked in progress)` : ''}.`);
    toast(`Closed ${id} at the CTO's request`);
  }
  deck.onCloseRequest(closeRequest);
  deck.onOpenSecondRequest(async ({ name, worktree, model }) => {
    const p = proj(name) || c.projects.find(x => x.name.toLowerCase() === String(name).toLowerCase());
    const reply = result => deck.openedAnswer(p ? p.name : name, result, true);
    if (!p) { toast(`The CTO asked for a second lead on unknown project ${name}`, true); reply({ ok: false, error: `unknown project ${name}` }); return; }
    if (started.has(secondId(p.name)) && !T.isExited(secondId(p.name))) { reply({ ok: true, already: true }); return; }
    c.openError = '';
    if (model) paneModel.set(secondId(p.name), model); else paneModel.delete(secondId(p.name));
    await openSecond(p.name, worktree);
    const ok = started.has(secondId(p.name));
    reply(ok ? { ok } : { ok, error: c.openError });
    if (ok) toast(`Opened a second lead on ${p.name}${worktree ? ' in its own worktree' : ''}`);
  });
  // Projects the manager opens go on screen beside the manager pane. Requests arriving
  // close together are gathered into one layout; the four most recent stay visible.
  let openBatch = [], openBatchTimer = null;
  async function openRequest(name, model = '') {
    if (!proj(name)) c.projects = await deck.projectList();
    if (!proj(name)) { toast(`The CTO asked to open unknown project ${name}`, true); deck.openedAnswer(name, { ok: false, error: `unknown project ${name}` }); return; }
    c.openError = '';
    // Already running: the answer says on which model, and nothing restarts (#202).
    const already = started.has(name) && !T.isExited(name);
    if (!already) { if (model) paneModel.set(name, model); else paneModel.delete(name); }
    await openTab(name, false);
    const ok = started.has(name) && c.openTabs.includes(name);
    deck.openedAnswer(name, ok ? { ok, already } : { ok, error: c.openError || `could not start lead-${name}` });
    if (!ok) return;
    toast(`Opened ${name}`);
    openBatch.push(name);
    clearTimeout(openBatchTimer);
    openBatchTimer = setTimeout(() => {
      // A lead closed while the batch waited stays closed, not an ended pane (#159).
      openBatch = openBatch.filter(n => c.openTabs.includes(n));
      if (!openBatch.length) return;
      // Each project lands beside its own manager: the last one's group goes on screen,
      // and any others are added to their group's remembered split.
      const target = groupOf(c.groups, openBatch[openBatch.length - 1]);
      for (const g of new Set(openBatch.map(n => groupOf(c.groups, n)))) {
        if (g === target || !g) continue;
        const v = viewFor(findGroup(c.groups, g), c.groupViews[g]);
        c.groupViews[g] = { ...v, shown: splitWith(v.shown, openBatch.filter(n => groupOf(c.groups, n) === g)) };
      }
      const batch = openBatch.filter(n => groupOf(c.groups, n) === target);
      openBatch = [];
      const here = c.view === 'split' && c.ctx === target;
      const shown = here ? c.splitSet : target ? viewFor(findGroup(c.groups, target), c.groupViews[target]).shown
        : c.view === 'single' && !isMgr(c.single) && !groupOf(c.groups, c.single) ? [c.single] : [];
      c.ctx = target;
      c.splitSet = splitWith(shown.filter(n => c.openTabs.includes(n)), batch);
      c.layoutId = autoLayout(c.splitSet.length); c.view = 'split';
      render();
    }, 1500);
  }
  deck.onOpenRequest(({ name, model }) => openRequest(name, model));
  return { openRequest, closeRequest };
}
