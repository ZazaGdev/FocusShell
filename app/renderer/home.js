// Home as a full-window dashboard of panels: the board in the middle, Me running the full
// height on its right (#130, #167); the owner's checks sit in the board's columns (#160). The gutter drags to resize;
// every panel fills Home; Self hides to a tab on the right edge (#190). Sizes are remembered.
import { groupMe, dueOf, dueLabel, isSomeday, repeatOf, repeatLabel, TODO_SORTS } from '../lib/me.js';
import { parseTasks, historyLabel, itemTags } from '../lib/tasks.js';
import { sketchesOf } from '../lib/sketches.js';
import './tip.js';
import { helperButton } from './helper.js';
import { noteText } from '../lib/helper.js';

export const ME = 'Me';
export const LAYOUT_DEFAULT = { cm: 340 }; // Me width
let somedayOpen = false;      // Someday unfolded, here and on the Me page, for this run
let doneAll = false;          // Done shows every item, not only the first five, for this run

// Done (#219): the first five, then "Show all (N)" so no done item is out of reach.
// Shared by Home's Me panel and the Me page.
export function doneGroup({ h, list, card, rerender }) {
  const more = list.length > 5 ? h('button', { class: 'ptool', onclick: () => { doneAll = !doneAll; rerender(); } }, doneAll ? 'Show fewer' : `Show all (${list.length})`) : null;
  return [h('div', { class: 'daygrp' }, 'Done', list.length ? h('small', {}, list.length) : null, more), (doneAll ? list : list.slice(0, 5)).map(card)];
}

// Someday (#170): good to do, not now. Folded under To do with its count; open, it lists
// its items. Shared by Home's Me panel and the Me page.
export function somedayGroup({ h, list, card, rerender }) {
  const head = h('button', { class: 'daygrp sdhead', title: somedayOpen ? 'Fold Someday' : 'Show Someday: good to do, not now', onclick: () => { somedayOpen = !somedayOpen; rerender(); } },
    somedayOpen ? '▾ ' : '▸ ', 'Someday', list.length ? h('small', {}, list.length) : null);
  return somedayOpen ? [head, list.map(card)] : [head];
}
// The Someday checkbox beside a to-do add field: ticked, Enter adds the item to Someday
// (and unfolds it so the item shows). add(text, someday) does the adding.
export function somedayAdd(h, input, add) {
  const box = h('input', { type: 'checkbox' });
  input.onkeydown = e => {
    if (e.key !== 'Enter' || !input.value.trim()) return;
    const v = input.value.trim(), some = box.checked;
    input.value = ''; box.checked = false;
    if (some) somedayOpen = true;
    add(v, some);
  };
  return h('label', { class: 'sdcheck', title: 'Add to Someday: good to do, not now' }, box, 'Someday');
}
// The labelled Done button on an open to-do row (#168).
export const doneButton = (h, onclick) => h('button', { class: 'btn medone', title: 'Mark this to-do done', onclick }, 'Done');
// A Self item's time and repeat (#198): a date, a time, and repeat every N days or weeks.
// due and rep are the item's, if any; read() gives what setSchedule takes.
export function whenFields(h, due, rep) {
  const pad = x => String(x).padStart(2, '0');
  const day = h('input', { type: 'date', title: 'Due date', value: due ? due.day : '' });
  const time = h('input', { type: 'time', title: 'Time (optional)', value: due && due.timed ? `${pad(due.date.getHours())}:${pad(due.date.getMinutes())}` : '' });
  const every = h('input', { type: 'number', min: '1', class: 'wnum', title: 'How many days or weeks', value: String(rep ? rep.every : 1) });
  const unit = h('select', { title: 'Repeat' }, ['none', 'day', 'week'].map(u => h('option', { value: u, selected: (rep ? rep.unit : 'none') === u }, u === 'none' ? 'no repeat' : `${u}s`)));
  return { el: h('span', { class: 'whenf' }, day, time, h('span', { class: 'wlab' }, 'repeat every'), every, unit),
    read: () => ({ day: day.value, time: time.value, every: unit.value === 'none' ? 0 : Math.max(1, Number(every.value) || 1), unit: unit.value }) };
}
// The To do order (#204): a small picker in the group's heading.
export const sortPick = (h, value, onChange) => h('select', { class: 'tdsort', title: 'Order of To do', onchange: e => onChange(e.target.value) },
  Object.entries(TODO_SORTS).map(([v, t]) => h('option', { value: v, selected: v === (value || 'newest') }, t)));
// A row's due label, with the rhythm when it repeats.
export function whenLabel(h, icon, t) {
  const due = dueOf(t), rep = repeatOf(t);
  if (!due) return null;
  return h('small', {}, dueLabel(due), rep ? h('span', { class: 'rep', title: `Repeats ${repeatLabel(rep)}` }, icon('repeat'), repeatLabel(rep)) : null);
}
// An item's added and closed dates (#219), small under its title on every board's cards.
export const hist = (h, t) => { const s = historyLabel(t); return s ? h('div', { class: 'bhist' }, s) : null; };
// An item's tags as badges (#224).
export const tagBadges = (h, t) => itemTags(t).map(x => h('span', { class: 'tag itag' }, x));
// The tag filter (#224): one tag at a time, from Settings; none picked shows everything.
export const tagChips = (h, tags, on, set) => tags.length ? h('span', { class: 'btags', title: 'Show only items with this tag' },
  tags.map(x => h('button', { class: 'chip' + (on === x ? ' on' : ''), onclick: () => set(on === x ? null : x) }, x))) : null;
// The small move button on a to-do row: down to Someday, or up to To do.
export const moveButton = (h, t, isSome, set) => h('button', { class: 'memove', title: isSome ? 'Move up to To do' : 'Move down to Someday: good to do, not now',
  onclick: () => set(t.n, !isSome) }, isSome ? '↑ To do' : '↓ Someday');
let maxed = null;             // the panel filling Home, for this run
let reveal = false;           // a reminder asked for Self, so a hidden Self comes back

// c: { h, icon, root, layout, saveLayout, meMd, notes,
//      board: [nodes], boardMeta, compact, setCompact, boardView: { test, work, tests, set },
//      groups: [nodes], showTask, markDone,
//      addMe, addNote, ownerLabel, rerender }
export function renderDash(c) {
  const { h, root } = c;
  let L = { ...LAYOUT_DEFAULT, ...(c.layout || {}) };
  if (reveal) { reveal = false; if (L.meHidden) { L = { ...L, meHidden: false }; c.saveLayout(L); } }
  const setHidden = v => { c.saveLayout({ ...L, meHidden: v }); c.rerender(); };
  // Panel tools are icons; on/off ones stay highlighted while on.
  const tool = (ic, tip, onclick, on) => h('button', { class: 'ptool ico' + (on ? ' on' : ''), 'data-tip': tip, 'aria-label': tip, onclick }, c.icon(ic));
  // Self hides sideways instead of folding (#190).
  const panel = (id, title, meta, body, extra = []) => {
    const isMax = maxed === id;
    return h('section', { class: 'pp pp-' + id + (isMax ? ' maxed' : ''), style: `grid-area:${id}` },
      h('header', { class: 'phd' }, h('span', { class: 'ptitle' }, title), meta ? h('span', { class: 'pmeta' }, meta) : null,
        h('span', { class: 'ptools' }, extra,
          id === 'me' && !isMax ? tool('sidebar', 'Hide Self to the right edge', () => setHidden(true)) : null,
          tool(isMax ? 'restore' : 'max', isMax ? 'Back to all panels' : 'Fill Home with this panel', () => { maxed = isMax ? null : id; c.rerender(); }))),
      h('div', { class: 'pb' }, body));
  };

  // Me: your own reminders, to-dos and notes; never sent to a lead.
  const g = groupMe(parseTasks(c.meMd || ''), new Date(), L.meSort);
  const meCard = t => {
    const due = dueOf(t), some = isSomeday(t);
    return h('div', { class: 'mecard' + (t.mark === 'x' ? ' done' : ''), onclick: e => { if (!e.target.closest('button')) c.showTask(ME, t); } },
      h('button', { class: 'mecheck' + (t.mark === 'x' ? ' on' : ''), title: t.mark === 'x' ? 'Reopen' : 'Done', onclick: () => c.markDone(ME, t.n, t.mark === 'x' ? ' ' : 'x') }),
      h('div', { class: 'tx' }, t.text, whenLabel(h, c.icon, t), hist(h, t), itemTags(t).length ? h('div', { class: 'ttags' }, tagBadges(h, t)) : null),
      sketchesOf(t).length ? h('span', { class: 'mesk', title: `${sketchesOf(t).length} sketch${sketchesOf(t).length > 1 ? 'es' : ''} attached` }, c.icon('pen')) : null,
      t.mark !== 'x' && (some || !due) ? moveButton(h, t, some, c.setSomeday) : null,
      t.mark !== 'x' ? doneButton(h, () => c.markDone(ME, t.n, 'x')) : null,
      h('span', { class: 'metag ' + (due ? 'rem' : some ? 'some' : 'todo') }, due ? 'reminder' : some ? 'someday' : 'to-do'));
  };
  const grp = (label, list, empty, extra) => [h('div', { class: 'daygrp' }, label, list.length ? h('small', {}, list.length) : null, extra),
    list.length ? list.map(meCard) : empty ? h('div', { class: 'empty-note' }, empty) : null];
  const meInput = h('input', { placeholder: `Add a to-do, then Enter (or ask the ${c.keeper || 'PM'}: "remind me Friday at 9 to ...")` });
  const meSome = somedayAdd(h, meInput, (v, some) => some ? c.addSomeday(v) : c.addMe(v));
  const noteInput = h('input', { placeholder: 'Add a note, then Enter', onkeydown: e => {
    if (e.key === 'Enter' && noteInput.value.trim()) c.addNote(noteInput.value);
  } });
  const me = panel('me', [h('span', { class: 'st-dot me' }), ' Self'], null,
    [grp('Today', g.today, 'Nothing due today.'), grp('Reminders', g.reminders), grp('To do', g.todo, null, sortPick(h, L.meSort, v => { c.saveLayout({ ...L, meSort: v }); c.rerender(); })),
      somedayGroup({ h, list: g.someday, card: meCard, rerender: c.rerender }), doneGroup({ h, list: g.done, card: meCard, rerender: c.rerender }),
      h('div', { class: 'daygrp' }, 'Notes'), h('div', { class: 'note-add' }, noteInput, helperButton({ kind: 'note', project: ME, field: noteInput, onAdd: d => c.addNote(noteText(d)) })),
      c.notes.length ? c.notes.slice(0, 12).map(n => h('div', { class: 'note' }, h('div', { class: 'when' }, n.when), n.text)) : h('div', { class: 'empty-note' }, 'No notes yet.'),
      h('div', { class: 'mefill' }), h('div', { class: 'note-add mead' }, meInput, meSome, helperButton({ kind: 'task', project: ME, field: meInput, onAdd: d => c.addMeDraft(d) }))]);

  // The board: lanes or a project's board, with the compact switch and groups.
  const board = panel('board', 'Board', c.boardMeta, [c.groupsOpen ? h('div', { class: 'gstrip' }, c.groups) : null, c.board],
    [c.boardView ? h('span', { class: 'bview', title: 'Show this board\'s work, or only your checks and tests' },
      h('button', { class: 'ptool' + (c.boardView.test ? '' : ' on'), onclick: () => c.boardView.set(false) }, `work ${c.boardView.work}`),
      h('button', { class: 'ptool' + (c.boardView.test ? ' on' : ''), onclick: () => c.boardView.set(true) }, `tests ${c.boardView.tests}`)) : null,
      tool('groups', c.groupsOpen ? 'Hide groups (groups of projects, each with its own CTO)' : 'Show groups (groups of projects, each with its own CTO)', c.toggleGroups, c.groupsOpen),
      tool('compact', c.compact ? 'Compact is on: one line per board item' : 'Compact: one line per board item', () => c.setCompact(!c.compact), c.compact)]);

  const gut = (area, cls) => h('div', { class: cls, style: `grid-area:${area}` });
  const g2 = gut('g2', 'gut');
  const hidden = L.meHidden && maxed !== 'me';
  const tab = h('button', { class: 'metab', style: 'grid-area:me', title: 'Show Self', 'aria-label': 'Show Self', onclick: () => setHidden(false) },
    h('span', { class: 'st-dot me' }), h('span', {}, 'Self'));
  const dash = h('div', { class: 'dash' + (maxed ? ' hasmax' : '') + (hidden ? ' mehidden' : ''), style: `--cm:${L.cm}px` },
    board, ...(hidden ? [tab] : [g2, me]));
  // Every redraw builds new panels; keep each one's scroll so a drop or a task file
  // written by a session does not jump the board back to the top (#108).
  const scrolls = [...root.querySelectorAll('.pp > .pb')].map(b => [(b.parentElement.className.match(/\bpp-(\w+)/) || [])[1], b.scrollTop, b.scrollLeft]);
  root.replaceChildren(dash);
  for (const [area, top, left] of scrolls) {
    const b = dash.querySelector(`.pp-${area} > .pb`);
    if (b) { b.scrollTop = top; b.scrollLeft = left; }
  }

  // Drag the gutter: Me against the board.
  const drag = (el, onMove) => el.onmousedown = e => {
    e.preventDefault();
    const r = dash.getBoundingClientRect();
    let next = { ...L };
    const move = ev => { next = { ...next, ...onMove(ev, r) }; dash.style.cssText = `--cm:${next.cm}px`; };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); c.saveLayout(next); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  };
  drag(g2, (ev, r) => ({ cm: Math.min(Math.max(260, r.right - ev.clientX - 14), r.width * 0.5) }));
}

// A reminder was clicked: make sure Self is showing (not hidden to the edge, and not
// hidden by another panel filling Home).
export function revealMe() { reveal = true; if (maxed && maxed !== 'me') maxed = null; }
