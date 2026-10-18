// The chalkboard's token board (#272): a chalkboard-style leaderboard of the tokens each Claude
// agent session has used, ranked by fresh tokens (input + output + cache writes), cache reads
// shown small beside each. Tabs (#285) add tokens today and this week, tasks done and commits.
// It refreshes the open tab every ten seconds and closes on Escape or a click outside the board.
// sources gives each tab's rows: { now, today, week, tasks, commits } -> Promise<rows>; a tab
// without one is left out. The demo page fetches its server's /api/..., the app asks its main
// process (#246). The scene draws the hover glow.
import { h } from '../art/dom.js';

const fmt = n => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const FRESH = 'Fresh tokens: input + output + cache writes; cache reads small.';
const tokens = r => [fmt(r.fresh), `read ${fmt(r.cacheRead)}`];
const TABS = [
  { key: 'now', label: 'Now', title: 'Tokens by agent', note: `Sessions running now, since each started. ${FRESH}`, empty: 'No agent sessions running.', cells: tokens },
  { key: 'today', label: 'Today', title: 'Tokens today', note: `Every agent since midnight, its helpers apart. ${FRESH}`, empty: 'No tokens used yet today.', cells: tokens },
  { key: 'week', label: 'This week', title: 'Tokens this week', note: `Every agent since Monday, its helpers apart. ${FRESH}`, empty: 'No tokens used yet this week.', cells: tokens },
  { key: 'tasks', label: 'Tasks done', title: 'Tasks done today', note: 'Items marked done on each project\'s board today; this week\'s small.', empty: 'No tasks done yet this week.', cells: r => [String(r.today), `week ${r.week}`] },
  { key: 'commits', label: 'Commits', title: 'Commits today', note: 'Every project, every branch, since midnight.', empty: 'No commits yet today.', cells: r => [String(r.count), ''] },
];
let board = null, timer = null;

export function closeBoard() { if (!board) return; board.remove(); board = null; clearInterval(timer); }
addEventListener('keydown', e => { if (e.key === 'Escape' && board) { e.stopPropagation(); closeBoard(); } }, true);
export const boardOpen = () => !!board;

export function openBoard(sources) {
  if (board) return;
  if (typeof sources === 'function') sources = { now: sources };
  const tabs = TABS.filter(t => sources[t.key]);
  const list = h('ol', {}), title = h('h2', {}), note = h('p', {});
  let tab = tabs[0], asked = 0;
  async function fill() {
    const mine = ++asked, t = tab;
    let all;
    try { all = await sources[t.key](); } catch { if (mine === asked) list.replaceChildren(h('li', { class: 'msg' }, 'The logs could not be read.')); return; }
    if (mine !== asked) return;   // another tab was picked meanwhile
    if (!all || !all.length) { list.replaceChildren(h('li', { class: 'msg' }, t.empty)); return; }
    list.replaceChildren(...all.map((r, i) => {
      const [big, small] = t.cells(r);
      return h('li', { class: r.kind || 'project' }, h('span', { class: 'rank' }, `${i + 1}.`), h('span', { class: 'who' }, r.who),
        h('span', { class: 'fresh' }, big), h('small', {}, small));
    }));
  }
  const buttons = tabs.map(t => { const b = h('button', { class: 'chalktab', role: 'tab' }, t.label); b.addEventListener('click', () => show(t)); return b; });
  function show(t) {
    tab = t;
    buttons.forEach((b, i) => { b.classList.toggle('on', tabs[i] === t); b.setAttribute('aria-selected', String(tabs[i] === t)); });
    title.textContent = t.title; note.textContent = t.note;
    list.replaceChildren(h('li', { class: 'msg' }, 'Reading...'));
    fill();
  }
  const panel = h('div', { class: 'chalk', role: 'dialog', 'aria-label': 'Chalkboard' },
    tabs.length > 1 ? h('div', { class: 'chalktabs', role: 'tablist' }, buttons) : null,
    title, note, list, h('p', { class: 'hint' }, 'Esc or click outside to close'));
  board = h('div', { class: 'chalkshade' }, panel);
  board.addEventListener('click', e => { if (e.target === board) closeBoard(); });
  document.body.append(board);
  show(tab);
  timer = setInterval(fill, 10000);
}
