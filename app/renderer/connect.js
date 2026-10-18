// "Connect your projects" (#1061): one button, a folder dialog where several project folders
// are picked at once, each becoming a project. Shown on a Board with no projects (after Skip
// setup) and as the setup's second step (bare: the step says it in its own words).
// c: { h, icon, deck, toast, given() the folders a smoke run connects, refresh() reloads the
//      project list, redraws and resolves the number of projects, has: projects connected }
import { art } from './art.js';

export function emptyBoard(c) {
  const { h, icon, deck, toast } = c;
  const connect = async () => {
    const r = await deck.addProject(c.given ? c.given() : undefined);
    if (r.error) toast(r.error, true);
    if (!r.ok) return;
    await c.refresh();
    if (r.added.length) toast(`Connected ${r.added.length === 1 ? r.added[0] : `${r.added.length} projects`}`);
  };
  return h('div', { class: 'bempty' + (c.bare ? ' bare' : '') },
    c.bare ? null : art('connect'),
    c.bare ? null : h('p', {}, 'Connect your projects to fill the Board.'),
    h('div', { class: 'bempty-acts' },
      h('button', { class: 'btn primary', 'data-act': 'connect', title: 'Select one project folder or several at once: each becomes a project', onclick: connect },
        icon('plus'), c.has ? 'Connect more' : 'Connect your projects')));
}
