// The Planning tab of a project's board (#23): open items not yet in a version on the left,
// versions on the right. Dragging a card onto a version plans it; dragging it back to the
// left unplans it. Also where the versions are kept. Only open items move here; work a lead
// has stays where it is.
import { planOf, byPriority } from '../lib/plan.js';
import { prioBadge } from './kanban.js';

let drag = null;

// ctx: { plan, setKey } from the board.
export function planningSection(c, items, ctx) {
  const { h } = c, p = c.focus, { plan, setKey } = ctx;
  const savePlan = next => c.apply(c.deck.setPlan(p, next));
  const tasks = items.map(({ t }) => t).filter(t => !c.ownerKind(t) || t.mark === '~');
  const doneVers = new Set(plan.versions.filter(v => v.state === 'done').map(v => v.name));

  const isLoose = t => {
    if (t.mark !== ' ') return false;
    const pl = planOf(t);
    return !pl.version || doneVers.has(pl.version);
  };
  const row = t => h('div', { class: 'prow', draggable: t.mark === ' ' ? 'true' : null, title: t.mark === ' ' ? 'Drag to plan it' : 'A lead has it',
    ondragstart: e => { drag = t; e.dataTransfer.setData('text/plain', String(t.n)); },
    ondragend: () => { drag = null; document.querySelectorAll('.drop').forEach(x => x.classList.remove('drop')); },
    onclick: e => { if (!e.target.closest('button')) c.showTask(p, t); } },
    prioBadge(h, t, v => setKey(t.n, 'Priority', v)),
    h('span', { class: 'pt' + (t.mark === 'x' ? ' done' : '') }, t.text),
    t.mark === '~' ? h('span', { class: 'ktag' }, 'in progress') : null,
    h('span', { class: 'bn' }, `#${t.n}`));
  // A box that takes drops: onDrop(task) plans it there.
  const target = (cls, onDrop, ...kids) => h('div', { class: cls,
    ondragover: e => { if (drag) { e.preventDefault(); e.currentTarget.classList.add('drop'); } },
    ondragleave: e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drop'); },
    ondrop: e => { e.preventDefault(); e.currentTarget.classList.remove('drop'); if (drag) onDrop(drag); } }, ...kids);

  const loose = tasks.filter(isLoose).sort(byPriority);
  const left = target('lane pcol', t => setKey(t.n, 'Version', null),
    h('header', {}, 'Not in a version', h('small', {}, `${loose.length}, by priority`)),
    loose.length ? loose.map(row) : h('div', { class: 'empty-note' }, 'Everything open is planned'));

  const order = { current: 0, '': 1, done: 2 };
  let boxes = [...plan.versions].sort((a, b) => order[a.state] - order[b.state]).map(v => {
    const its = tasks.filter(t => planOf(t).version === v.name).sort(byPriority);
    const setState = state => savePlan({ ...plan, versions: plan.versions.map(x => x.name === v.name ? { ...x, state } : state === 'current' && x.state === 'current' ? { ...x, state: '' } : x) });
    return target('pbox' + (v.state === 'current' ? ' cur' : v.state === 'done' ? ' old' : ''), t => setKey(t.n, 'Version', v.name),
      h('header', {}, v.state === 'current' ? h('span', { class: 'ptag' }, 'CURRENT') : null, h('b', {}, v.name),
        v.state === 'done' ? h('span', { class: 'pd' }, 'done') : null,
        h('small', {}, `${its.length} item${its.length === 1 ? '' : 's'}, ${its.filter(t => t.mark === 'x').length} done`),
        v.state !== 'current' ? h('button', { class: 'btn ghost', onclick: () => setState('current') }, 'Make current') : null,
        v.state !== 'done' ? h('button', { class: 'btn ghost', onclick: () => setState('done') }, 'Mark done') : h('button', { class: 'btn ghost', onclick: () => setState('') }, 'Reopen')),
      v.state === 'done' ? null : its.map(row));
  });
  const add = h('input', { placeholder: 'New version, such as 0.6, then Enter', onkeydown: e => {
    const name = add.value.trim().replace(/:/g, '');
    if (e.key !== 'Enter' || !name || plan.versions.some(v => v.name === name)) return;
    savePlan({ ...plan, versions: [...plan.versions, { name, state: plan.versions.some(v => v.state === 'current') ? '' : 'current' }] });
  } });
  boxes = [...boxes, h('div', { class: 'note-add' }, add)];
  if (!plan.versions.length) boxes.unshift(h('div', { class: 'empty-note' }, 'No versions yet. Add one below.'));

  return h('div', { class: 'pgrid' }, left, h('div', { class: 'pboxes' }, boxes));
}
