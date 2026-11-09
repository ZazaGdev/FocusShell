// The CTO's requests to open and close panes (open-pane.ps1, close-pane.ps1, #185), and the
// layout the opened projects land in; and a file the owner asked it to open (#2768).
import * as T from './terminal.js';
import { toast } from './dom.js';
import { splitWith } from '../lib/layouts.js';
import { groupOf, findGroup, viewFor } from '../lib/groups.js';
import { extraId } from '../lib/sessions.js';
import { opensInExplorer } from '../lib/links.js';

// c: the app's state as getters and setters (projects, openTabs, groups, groupViews, view,
// single, ctx, splitSet, layoutId, openError) and its actions.
export function ctoRequests(c) {
  const { deck, started, paneModel, showLead, extrasOf, proj, tasksOf, isActive, openTab, openExtra, closeTab, closeExtra, render } = c;
  // The CTO closes a lead with close-pane.ps1. A lead that is busy or has a task in progress
  // stays open unless the request says force; the answer goes back to the script.
  // With extra leads open, closing the first keeps the tab for them; -Lead <n> closes only
  // lead n, whose busy check is only "busy right now", since tasks are shared.
  async function closeRequest({ name, force, n = 1 }) {
    const reply = answer => deck.closedAnswer(name, answer, n);
    const p = proj(name) || c.projects.find(x => x.name.toLowerCase() === String(name).toLowerCase());
    const id = p ? p.name : name;
    if (n > 1) {
      const sid = extraId(id, n), lead = `lead-${id}-${n}`;
      if (!started.has(sid)) { reply(`${lead} is not open, nothing to close.`); return; }
      if (!force && !T.isExited(sid) && isActive(sid)) { reply(`Not closed: ${lead} is busy right now. Ask the user, then run again with -Force to close it anyway.`); return; }
      const note = await closeExtra(id, n);
      reply(`Closed ${lead}.${note ? ' ' + note : ''}`); toast(`Closed ${id} ${n} at the CTO's request`);
      return;
    }
    if (!c.openTabs.includes(id) && !started.has(id)) { reply(`lead-${id} is not open, nothing to close.`); return; }
    const doing = tasksOf(id).filter(t => t.mark === '~').map(t => `#${t.n}`);
    const live = started.has(id) && !T.isExited(id);
    if (!force && live && (isActive(id) || doing.length)) {
      reply(`Not closed: lead-${id} is ${isActive(id) ? 'busy right now' : `on ${doing.join(', ')} (in progress)`}. Ask the user, then run again with -Force to close it anyway.`);
      return;
    }
    const rest = extrasOf(id);
    if (rest.length) { await deck.kill(id); started.delete(id); T.dispose(id); showLead.set(id, rest[0]); render(); }
    else await closeTab(id, false);
    reply(`Closed lead-${id}${force && (doing.length) ? ` (forced; ${doing.join(', ')} still marked in progress)` : ''}.`);
    toast(`Closed ${id} at the CTO's request`);
  }
  deck.onCloseRequest(closeRequest);
  // An extra lead, lead-<Project>-<n> for n 2 to 5 (#1485).
  async function openExtraRequest({ name, n = 2, worktree, model }) {
    const p = proj(name) || c.projects.find(x => x.name.toLowerCase() === String(name).toLowerCase());
    const reply = result => deck.openedAnswer(p ? p.name : name, result, n);
    if (!p) { toast(`The CTO asked for lead ${n} on unknown project ${name}`, true); reply({ ok: false, error: `unknown project ${name}` }); return; }
    const sid = extraId(p.name, n);
    if (started.has(sid) && !T.isExited(sid)) { reply({ ok: true, already: true }); return; }
    c.openError = '';
    if (model) paneModel.set(sid, model); else paneModel.delete(sid);
    // A pane on screen keeps showing the lead the owner is looking at (#1387).
    const onScreen = (c.view === 'single' && c.single === p.name) || (c.view === 'split' && c.splitSet.includes(p.name));
    await openExtra(p.name, n, worktree, !onScreen);
    const ok = started.has(sid);
    reply(ok ? { ok } : { ok, error: c.openError });
    if (ok) toast(`Opened lead ${n} on ${p.name}${worktree ? ' in its own worktree' : ''}`);
  }
  deck.onOpenExtraRequest(openExtraRequest);
  // Projects the CTO opens start in the background (#1387): the tab is added and the lead
  // starts, but the owner's view and keyboard stay where they were. Each project joins its
  // group's remembered split, so opening the group later shows it; the split on screen now
  // is left alone. Requests arriving close together are handled as one batch.
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
      for (const g of new Set(openBatch.map(n => groupOf(c.groups, n)))) {
        if (!g || (c.view === 'split' && c.ctx === g)) continue;
        const v = viewFor(findGroup(c.groups, g), c.groupViews[g]);
        c.groupViews[g] = { ...v, shown: splitWith(v.shown, openBatch.filter(n => groupOf(c.groups, n) === g)) };
      }
      openBatch = [];
    }, 1500);
  }
  deck.onOpenRequest(({ name, model }) => openRequest(name, model));
  // A file the owner asked the CTO to open (deck open-file, #2768) opens exactly as a click on
  // its path in an item does: a text file in the Code pane of its project, beside that project's
  // lead, whose tab opens first if it is closed; a folder or a binary file shown in File
  // Explorer. Nothing is typed into the lead.
  async function fileRequest({ id, file }) {
    const reply = text => deck.fileAnswer(id, text);
    try {
      const f = /^https?:/i.test(file) || opensInExplorer(file) ? null : await deck.fileAt(file);
      if (!f) {
        const shown = !/^https?:/i.test(file) && await deck.openPath(file);
        reply(shown ? `Shown in File Explorer: ${file} (a folder, or a file the Code pane does not open).` : `Failed: there is no file or folder at ${file}.`);
        return;
      }
      const r = await c.openFile(null, f);
      if (typeof r === 'string') { reply(`Opened ${f} in the Code pane of ${r}, beside lead-${r}.`); toast(`Opened ${f.split(/[\\/]/).pop()} for the CTO`); }
      else reply(r ? `Shown in File Explorer: ${f} (no project tab could hold it).` : `Failed: could not open ${f}.`);
    } catch (e) { reply(`Failed: ${e.message}`); }
  }
  deck.onFileRequest(fileRequest);
  return { openRequest, openExtraRequest, closeRequest, fileRequest };
}
