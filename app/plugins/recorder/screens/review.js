// The recorder's review screen (#369, layout A): the cards in a grid like Waiting on you. Each
// card: kind, project, title, due on reminders, screenshots (each removable), the description
// with the mic, what was said, Drop and Accept (or Accept and send to CTO). Drawn only from the
// state the main side sends; every button sends an event and the main side decides.
import { clock } from '../lib/transcript.js';

const KINDS = { task: 'Task', note: 'Note', reminder: 'Reminder' };
const KIND_COLOUR = { task: 'var(--accent)', note: 'var(--muted)', reminder: 'var(--warn)' };
const EDIT_MS = 400;

// What decides the screen's shape: a change here redraws it, a change to text only does not,
// so typing (by hand or by voice) keeps its place.
export function shapeOf(st) {
  const s = st.session;
  if (!s) return 'none';
  return JSON.stringify([s.id, s.state, s.step, s.error, (st.projects || []).length, s.rev || 0, st.brainstormId || null,
    (s.cards || []).map(c => [c.id, c.status, c.kind, c.project, c.due, c.mergeInto, c.shots, c.placed, c.mark])]);
}

// A brainstorm's mark on a card (stage 4), with Undo where there is something to undo.
const MARKS = { rewritten: 'Rewritten', merged: 'Merged', dropped: 'Dropped', added: 'Added', unchanged: 'Unchanged' };
function markOf(ui, c, busy) {
  if (!c.mark) return null;
  const { h } = ui;
  return h('span', { class: `recmark m-${c.mark}` }, MARKS[c.mark] || c.mark,
    c.mark === 'unchanged' ? null : h('button', { class: 'reclink', disabled: busy, title: c.mark === 'added' ? 'Take this card away' : 'Back to how it was before the brainstorm',
      onclick: () => ui.invoke('undo', c.id) }, 'Undo'));
}

// a: { ui, st, shots (a Map of path to data URL, filled as they load), busy }
export function reviewScreen(a) {
  const { ui, st } = a, { h } = ui, s = st.session, busy = s.state === 'sending';
  const cards = s.cards || [];
  if (!cards.length) {
    return h('div', { class: 'recwrap' }, h('p', { class: 'sub' }, 'Nothing in the talk turned into a card. Open the transcript to check what was heard.'));
  }
  const open = cards.filter(c => c.status === 'open');
  return h('div', { class: 'recwrap recreview' + (busy ? ' busy' : '') },
    s.error ? h('p', { class: 'plugerr' }, `Not every card reached its board: ${s.error}. Accept again to retry the rest.`) : null,
    busy ? h('p', { class: 'sub' }, 'Putting the cards on their boards...') : null,
    h('div', { class: 'recgrid' }, [...open, ...cards.filter(c => c.status !== 'open')].map(c => {
      const el = cardOf(a, c);
      el.dataset.card = c.id;
      return el;
    })));
}

function cardOf(a, c) {
  const { ui, st } = a, { h } = ui, busy = st.session.state === 'sending';
  const meta = [h('span', { class: 'reckind' }, KINDS[c.kind] || c.kind), h('span', { class: 'recat' }, clock(c.at || 0)), markOf(ui, c, busy)].filter(Boolean);
  if (c.status === 'accepted') {
    const where = c.placed && c.placed.n != null ? `${c.placed.board} #${c.placed.n}` : `${(c.placed && c.placed.board) || c.project} notes`;
    return ui.kit.card({ accent: 'var(--ok)', meta, children: [h('div', { class: 'wbtitle' }, c.title), h('p', { class: 'sub' }, `On ${where}`)] });
  }
  if (c.status === 'dropped') {
    // Dropped by the brainstorm, its mark's Undo brings it back; dropped by hand, Bring back.
    const el = ui.kit.card({ meta, children: [h('div', { class: 'wbtitle' }, c.title),
      c.mark ? null : h('div', { class: 'plugrow' }, h('button', { class: 'btn', disabled: busy, onclick: () => ui.invoke('restore', c.id) }, 'Bring back'))].filter(Boolean) });
    el.classList.add('recdropped');
    return el;
  }

  // Text is sent a moment after typing stops, and at once when the field is left.
  let timer = null, patch = {};
  const flush = () => { clearTimeout(timer); timer = null; if (Object.keys(patch).length) { const p = patch; patch = {}; ui.invoke('edit', c.id, p); } };
  const later = (k, v) => { patch[k] = v; clearTimeout(timer); timer = setTimeout(flush, EDIT_MS); };
  const set = (k, v) => ui.invoke('edit', c.id, { [k]: v });

  const kind = h('select', { class: 'inp recsel', disabled: busy, title: 'Kind', onchange: e => set('kind', e.target.value) },
    Object.entries(KINDS).map(([k, label]) => h('option', { value: k, selected: k === c.kind }, label)));
  const names = ['Me', ...(st.projects || []).filter(p => p !== 'Me')];
  if (!names.includes(c.project)) names.push(c.project);
  const project = h('select', { class: 'inp recsel', disabled: busy || c.kind === 'reminder', title: c.kind === 'reminder' ? 'Reminders go on Me' : 'Which board it goes on',
    onchange: e => set('project', e.target.value) }, names.map(p => h('option', { value: p, selected: p === c.project }, p)));
  const title = h('input', { class: 'inp rectitle', value: c.title, disabled: busy, 'aria-label': 'Title', oninput: e => later('title', e.target.value), onblur: flush });
  const due = c.kind !== 'reminder' ? null : h('label', { class: 'recdue' }, 'Due',
    h('input', { class: 'inp', type: 'datetime-local', disabled: busy, value: (c.due || '').replace(' ', 'T'),
      onchange: e => set('due', String(e.target.value || '').replace('T', ' ')) }));
  const merge = c.mergeInto == null ? null : h('p', { class: 'recmerge' }, `Adds to ${c.project} #${c.mergeInto}: ${c.mergeTitle}. `,
    h('a', { href: '#', onclick: e => { e.preventDefault(); if (!busy) set('mergeInto', null); } }, 'Make it a new item'));
  const shots = (c.shots || []).length ? h('div', { class: 'recshots' }, c.shots.map(p => shotOf(a, c, p))) : null;
  const talk = ui.kit.talkBox({ value: c.description, rows: 4, placeholder: 'What it is, where, and what done looks like',
    onInput: v => later('description', v), onQuiet: () => flush() });
  talk.box.addEventListener('blur', flush);
  talk.box.disabled = busy;
  const said = c.quote ? h('p', { class: 'recsaid' }, h('span', {}, `Said at ${clock(c.at || 0)}: `), `"${c.quote}"`) : null;
  const accept = (cto) => { flush(); return a.accept([c.id], cto); };
  const acts = h('div', { class: 'plugrow' },
    h('button', { class: 'btn ghost', disabled: busy, onclick: () => { flush(); ui.invoke('drop', c.id); } }, 'Drop'),
    c.project === 'Me'
      ? h('button', { class: 'btn primary', disabled: busy, onclick: () => accept(false) }, 'Accept')
      : ui.kit.splitButton({ main: { label: 'Accept', onClick: () => accept(false) }, second: { label: 'and send to CTO', onClick: () => accept(true) } }));
  if (busy) for (const b of acts.querySelectorAll('button')) b.disabled = true;
  return ui.kit.card({ accent: KIND_COLOUR[c.kind], meta: [...meta, kind, project],
    children: [title, due, merge, shots, h('div', { class: 'tdlab' }, 'Description'), talk.el, said, acts].filter(Boolean) });
}

// A screenshot thumbnail, loaded once: a click shows it large, the x takes it off the card.
function shotOf(a, c, p) {
  const { ui } = a, { h } = ui, busy = a.st.session.state === 'sending';
  const img = h('img', { alt: `Screenshot at ${p.split(/[\\/]/).pop()}` });
  const show = url => { img.src = url; };
  if (a.shots.has(p)) show(a.shots.get(p));
  else ui.invoke('shot', p).then(url => { if (url) { a.shots.set(p, url); show(url); } });
  return h('figure', { class: 'recshot' },
    h('button', { class: 'recthumb', title: 'Show it large', onclick: () => a.zoom(p) }, img),
    h('button', { class: 'iconbtn recshotx', title: 'Take this screenshot off', 'aria-label': 'Take this screenshot off', disabled: busy,
      onclick: () => ui.invoke('dropShot', c.id, p) }, ui.icon('x')));
}
