// Right-click on a project tab (#104): put that tab, or every tab in the split it is in,
// into a new or existing group, or take it out of its group.
// c: { h, add: [group], leave: [group], onNew(name) -> bool, onAdd(group), onLeave(group) }
let open = null;

export function closeTabMenu() {
  if (!open) return;
  open.remove(); open = null;
  removeEventListener('mousedown', outside, true); removeEventListener('keydown', esc, true);
}
const outside = e => { if (open && !open.contains(e.target)) closeTabMenu(); };
const esc = e => { if (e.key === 'Escape') closeTabMenu(); };

export function openTabMenu(tab, targets, c) {
  const { h } = c;
  closeTabMenu();
  const what = targets.length > 1 ? `these ${targets.length} tabs` : 'this tab';
  const item = (label, onclick, cls) => h('button', { class: 'tmi' + (cls ? ' ' + cls : ''), onclick }, label);
  const nameBox = () => {
    const input = h('input', { placeholder: 'Group name', onkeydown: e => {
      if (e.key === 'Enter' && c.onNew(input.value)) closeTabMenu();
    } });
    open.replaceChildren(input, h('p', {}, `New group for ${targets.join(', ')}. Enter to make it, Esc to cancel.`));
    input.focus();
  };
  open = h('div', { class: 'tabmenu' },
    h('div', { class: 'tml' }, targets.join(', ')),
    item(`New group with ${what}…`, nameBox, 'new'),
    c.add.map(g => item(`Add to ${g}`, () => { closeTabMenu(); c.onAdd(g); })),
    c.leave.length ? h('hr') : null,
    c.leave.map(g => item(`Take out of ${g}`, () => { closeTabMenu(); c.onLeave(g); })));
  const r = tab.getBoundingClientRect();
  open.style.left = `${Math.max(4, Math.min(r.left, innerWidth - 270))}px`; open.style.top = `${r.bottom + 2}px`;
  document.body.append(open);
  addEventListener('mousedown', outside, true); addEventListener('keydown', esc, true);
}
