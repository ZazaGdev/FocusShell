// Status (#383): a button beside Waiting and Missed above each CTO pane. It opens one row per
// lead open in the app for that CTO: busy or idle, its current task, and where it stopped, the
// line the CTO wrote with `deck status`, with when. Every interval picked in Settings (#1034), if
// a lead started or finished work since the last ask or is busy, the CTO is asked to refresh
// those lines; a busy CTO gets the ask queued.
// Pane output alone does not count (#392): an idle lead's recap or redraw is not work.
import { refreshDue, refreshLine, workStep, sortLeads, leadState, STATE_WORD } from '../lib/status.js';

const asked = new Map(); // CTO id -> when it was last asked to refresh
const work = new Map(); // lead id -> workStep state, sampled every two seconds
let c = null, modal = null, cur = null, st = { leads: {} };

// ctx: { h, icon, deck, mgrName(m), leadsOf(m) -> [{ id, name, busy, prompt (stopped on one), task: { n, text, mark } | null }],
//        ctos() -> the CTO sessions running, lastOutput(id) ms, ask(m, line) types it into the pane,
//        every() -> the refresh interval in ms }
export function setupStatus(ctx) {
  c = ctx;
  setInterval(sample, 2000);
  setInterval(tick, 60000);
}

function sample() {
  const now = Date.now();
  for (const m of c.ctos()) for (const l of c.leadsOf(m)) work.set(l.id, workStep(work.get(l.id), now - (c.lastOutput(l.id) || 0) < 3000, now));
}

export function statusButton(id) {
  return c.h('button', { class: 'wbbtn statbtn', 'data-stat': id, title: 'Status: where each lead stopped', onclick: () => openStatus(id) },
    c.icon('compact'), c.h('span', {}, 'Status'));
}

async function tick() {
  const now = Date.now();
  for (const m of c.ctos()) {
    const leads = c.leadsOf(m);
    if (!leads.length) continue;
    const leadLast = Math.max(0, ...leads.map(l => (work.get(l.id) || {}).changedAt || 0));
    if (!refreshDue({ now, askedAt: asked.get(m) || 0, leadLast, busy: leads.some(l => l.busy), every: c.every() })) continue;
    asked.set(m, now);
    await c.ask(m, refreshLine(leads.map(l => l.name)));
  }
  if (modal) await load();
}

async function load() {
  try { st = (await c.deck.leadStatus()) || { leads: {} }; } catch { /* keep the last */ }
  if (modal) draw();
}

export function closeStatus() { if (modal) { modal.remove(); modal = null; cur = null; } }
export function openStatus(id) {
  closeStatus();
  cur = id;
  modal = c.h('div', { class: 'wbshade', onpointerdown: e => { if (e.target === modal) closeStatus(); } });
  document.body.append(modal);
  draw();
  load();
}
addEventListener('keydown', e => { if (e.key === 'Escape' && modal) { e.preventDefault(); closeStatus(); } });

const ago = t => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

function draw() {
  const { h, icon } = c, leads = sortLeads(c.leadsOf(cur));
  const times = leads.map(l => st.leads[l.name]).filter(Boolean).map(s => s.at);
  // One table (#413): every row shares the columns, A to Z, the state as a badge.
  const row = l => {
    const s = st.leads[l.name], state = leadState(l);
    return h('tr', { 'data-lead': l.name },
      h('td', { class: 'statname' }, l.name),
      h('td', {}, h('span', { class: 'sbadge ' + state }, STATE_WORD[state])),
      h('td', { class: 'stattask', title: l.task ? `#${l.task.n} ${l.task.text}` : '' }, l.task ? `#${l.task.n} ${l.task.text}` : 'no task in progress'),
      h('td', { class: 'statline' }, s ? s.line : 'no line yet'),
      h('td', { class: 'statat' }, s ? ago(s.at) : ''));
  };
  const body = leads.length ? h('table', { class: 'stattable' },
    h('thead', {}, h('tr', {}, ['Lead', 'State', 'Task', 'Where it stopped', 'Updated'].map(x => h('th', {}, x)))),
    h('tbody', {}, leads.map(row))) : h('div', { class: 'wbempty' }, 'No lead is open.');
  modal.replaceChildren(h('div', { class: 'wbox statbox', role: 'dialog', 'aria-label': 'Status' },
    h('header', {}, h('h2', {}, 'Status', h('span', { class: 'wbn' }, String(leads.length))), h('span', { class: 'wbfor' }, c.mgrName(cur)),
      h('span', { class: 'statwhen' }, times.length ? `Last refresh ${ago(Math.max(...times))}` : 'Not refreshed yet'),
      h('button', { class: 'btn ghost', title: 'Close (Esc)', onclick: closeStatus }, icon('x'))),
    h('div', { class: 'wbbody' }, body)));
}
