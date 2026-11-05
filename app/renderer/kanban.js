// A project's board as Kanban (#23): fixed columns that follow the task marks, each sorted
// by priority (1 first). Dropping a card does the real thing: Backlog to To do plans it into
// the current version, back to Backlog takes it out, In progress sends it to the CTO after a few
// seconds to undo, Done marks it done. In progress and Waiting on you are filled by lead
// reports, so their cards stay put (the owner's own open to-dos can still go to Done).
// A Planning tab (planning.js) plans the backlog into versions.
import { parsePlan, planOf, byPriority, currentVersion } from '../lib/plan.js';
import { planningSection } from './planning.js';
import { hist, tagBadges } from './home.js';

export const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const tabOf = new Map(), verOf = new Map(); // per project: tab, version filter
let drag = null, pending = null;

const COLS = [
  ['backlog', 'Backlog', 'idle'],
  ['todo', 'To do', 'idle'],
  ['doing', 'In progress', 'working'],
  ['you', 'Waiting on you', 'needs'],
  ['done', 'Done', 'done'],
];
// Where a task sits on the board; open items in version `cv` are To do.
function colOf(t, cv, ownerKind) {
  if (ownerKind(t)) return 'you';
  if (t.mark === '~') return 'doing';
  if (t.mark === 'x') return 'done';
  return cv && planOf(t).version === cv ? 'todo' : 'backlog';
}
// Which drops are allowed: from where a card is, to where it is dropped.
function canDrop(from, to, t, cv) {
  if (from === to || to === 'you' || (to === 'todo' && !cv)) return false;
  if (from === 'doing' || from === 'done') return false;
  if (from === 'you') return to === 'done' && t.forOwner && t.mark === ' ';
  return true;
}

// The badge shows a task's priority; clicking it steps 1, 2, 3, 4, none.
export function prioBadge(h, t, set) {
  const p = planOf(t).priority;
  return h('button', { class: 'prio' + (p ? ' p' + p : ''), title: 'Priority (click to change)', onclick: e => { e.stopPropagation(); set(p == null ? 1 : p === 4 ? null : p + 1); } }, p ? `P${p}` : 'P');
}

// c: the board's context, plus deck, apply(promise of fresh data), ownerKind, rerender.
export function kanbanSection(c, items) {
  const { h } = c, p = c.focus;
  const md = c.tasksMd(p), plan = parsePlan(md), cv = currentVersion(plan), ver = verOf.get(p) || '';
  const tab = tabOf.get(p) || 'board';
  const setKey = (n, key, value) => c.apply(c.deck.setTaskKey(p, n, key, value));

  const tabs = h('div', { class: 'kbtabs' }, [['board', 'Board'], ['planning', 'Planning']].map(([k, label]) =>
    h('button', { class: tab === k ? 'on' : '', onclick: () => { tabOf.set(p, k); c.rerender(); } }, label)));
  if (tab === 'planning') return [tabs, planningSection(c, items, { plan, setKey })];

  const picker = plan.versions.length ? h('div', { class: 'kbpick' }, h('span', { class: 'kbvers' }, h('span', { class: 'lab' }, 'Version'),
    ['', ...plan.versions.map(v => v.name)].map(v => h('button', { class: 'chip' + (ver === v ? ' on' : ''), onclick: () => { verOf.set(p, v); c.rerender(); } }, v || 'All')))) : null;

  const list = items.map(({ t }) => t).filter(t => !ver || planOf(t).version === ver);
  const card = (t, col) => {
    const pl = planOf(t), kind = c.ownerKind(t);
    return h('div', { class: 'bitem kcard', draggable: 'true', title: 'Open details, or drag to another column',
      ondragstart: e => { drag = { t, from: col }; e.dataTransfer.setData('text/plain', String(t.n)); e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('dragging'); const cols = e.currentTarget.closest('.kcols'); setTimeout(() => cols.classList.add('dragging')); },
      ondragend: e => { drag = null; e.currentTarget.classList.remove('dragging'); document.querySelectorAll('.kcol.drop').forEach(x => x.classList.remove('drop')); document.querySelectorAll('.kcols.dragging').forEach(x => x.classList.remove('dragging')); },
      onclick: e => { if (!e.target.closest('button')) c.showTask(p, t); } },
      h('div', { class: 'btitle' }, t.text), hist(h, t),
      h('div', { class: 'brow' },
        prioBadge(h, t, v => setKey(t.n, 'Priority', v)),
        kind ? h('span', { class: 'kind ' + kind }, { decide: 'Decide', unblock: 'Unblock', test: 'Test', do: 'Do' }[kind]) : null,
        pl.version ? h('span', { class: 'ktag' }, pl.version) : null, tagBadges(h, t),
        h('span', { class: 'bn' }, `#${t.n}`)));
  };

  const drop = async (to, t, from) => {
    if (to === 'todo') return setKey(t.n, 'Version', cv);
    if (to === 'backlog') return setKey(t.n, 'Version', null);
    if (to === 'done') return c.markDone(p, t.n);
    if (to === 'doing') {
      if (from === 'backlog' && cv) await setKey(t.n, 'Version', cv);
      sendLater(c, p, t);
    }
  };
  const cols = h('div', { class: 'kcols' }, COLS.map(([key, name, st]) => {
    const mine = list.filter(t => colOf(t, cv, c.ownerKind) === key).sort(c.sortCmp || byPriority);
    const max = key === 'done' ? 12 : 60;
    const hint = { backlog: cv ? `Open, not in ${cv}` : 'Open', todo: cv ? `Open, in version ${cv}` : 'Add a version on Planning', doing: 'Drop here to send to the CTO', you: 'From lead reports', done: 'Drop here to mark done' }[key];
    return h('section', { class: 'lane kcol', 'data-col': key,
      ondragover: e => { if (drag && canDrop(drag.from, key, drag.t, cv)) { e.preventDefault(); e.currentTarget.classList.add('drop'); } },
      ondragleave: e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drop'); },
      ondrop: e => { e.preventDefault(); e.currentTarget.classList.remove('drop'); if (drag && canDrop(drag.from, key, drag.t, cv)) drop(key, drag.t, drag.from); } },
      h('header', {}, h('span', { class: 'st-dot ' + st }), name, h('small', {}, mine.length)),
      h('div', { class: 'khint' }, hint),
      mine.length ? mine.slice(0, max).map(t => card(t, key)) : h('div', { class: 'empty-note' }, 'Nothing here'),
      mine.length > max ? h('div', { class: 'more' }, `+${mine.length - max} more`) : null);
  }));
  return [tabs, picker, cols];
}

// Dropping on In progress sends the card to the CTO after 4 seconds, unless undone.
function sendLater(c, p, t) {
  if (pending) pending.finish(true);
  let left = 4;
  const label = c.h('span', {}, `Sending ${p} #${t.n} to the CTO in ${left} s`);
  const bar = c.h('div', { class: 'kundo' }, label, c.h('button', { class: 'btn', onclick: () => finish(false) }, 'Undo'));
  const tick = setInterval(() => { left -= 1; if (left <= 0) finish(true); else label.textContent = `Sending ${p} #${t.n} to the CTO in ${left} s`; }, 1000);
  function finish(go) { clearInterval(tick); bar.remove(); pending = null; if (go) c.send(p, t.n); }
  pending = { finish };
  document.body.append(bar);
}
