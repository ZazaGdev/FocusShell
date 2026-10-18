// The start-up card for what FocusShell needs and did not find on this PC (#390): Claude Code
// and Node.js, each with why and a link to install it. Shown once per start until closed.
import { h, icon } from './dom.js';

export function showMissing(list) {
  document.getElementById('reqcard')?.remove();
  if (!list || !list.length) return null;
  const close = () => card.remove();
  const card = h('div', { id: 'reqcard', class: 'reqcard', role: 'alert' },
    h('div', { class: 'rq-head' }, h('b', {}, 'FocusShell cannot start its sessions yet'),
      h('button', { class: 'btn ghost rq-x', title: 'Close', onclick: close }, icon('x'))),
    h('p', { class: 'rq-sub' }, 'Install what is missing, then restart FocusShell.'),
    list.map(m => h('div', { class: 'rq-row' },
      h('div', { class: 'rq-txt' }, h('b', {}, `${m.name} not found`), h('span', {}, m.why)),
      h('button', { class: 'btn primary', onclick: () => deck.openPath(m.url) }, `Get ${m.name}`))));
  document.body.append(card);
  return card;
}
