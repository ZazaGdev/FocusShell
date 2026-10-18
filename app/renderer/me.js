// The Me page (#130): the owner's own project, never sent to a lead. Three columns: Me's
// to-dos, reminders and notes on the left, the ideas deck in the middle, and the shelf of
// saved sketches on the right. Drag a sketch onto a to-do, idea or note to attach it.
import { parseTasks, itemTags, hasTag } from '../lib/tasks.js';
import { groupMe, dueOf, isSomeday } from '../lib/me.js';
import { parseIdeas, allTags, nextState } from '../lib/ideas.js';
import { ideaDesc, tagPicker, ideaTalk, keepFocus } from './ideacard.js';
import { sketchesOf, sketchName, notesWithSketches, usesOf } from '../lib/sketches.js';
import { openSavedSketch } from './sketch.js';
import { linkedText } from './textlinks.js';
import { helperButton } from './helper.js';
import { noteText } from '../lib/helper.js';
import { ME, somedayGroup, doneGroup, somedayAdd, moveButton, doneButton, whenFields, whenLabel, sortPick, hist, tagBadges, tagChips } from './home.js';

const DRAG = 'text/x-focusshell-sketch';
let shelf = [], shelfSig = null; // Me's saved boards, newest first
let tagFilter = null, openIdea = null, whenOpen = false, meTag = null;

async function loadShelf(c) {
  const list = await c.deck.sketchList(ME);
  const sig = JSON.stringify(list.map(x => [x.rel, x.mtime]));
  if (sig === shelfSig) return;
  shelf = list; shelfSig = sig; c.rerender();
}
export const shelfOf = () => shelf;
// Back and forward (#301) keep the page's filters and opened idea with each step.
export const meView = () => ({ tagFilter, openIdea, meTag });
export function setMeView(v) { ({ tagFilter = null, openIdea = null, meTag = null } = v || {}); }

// c: { h, icon, deck, toast, openMd, root, meMd, notesMd, ideasMd, tasksMd, showTask, apply, rerender, toCto, addTag, todoWidth, setTodoWidth, todoSort, setTodoSort, sketchesHidden, setSketchesHidden }
// where apply(promise) takes the data the main process returns and redraws.
export function renderMe(c) {
  const { h, icon, deck } = c;
  // Paths and web links in notes and ideas are clickable (#207).
  const linked = (tag, attrs, text) => linkedText(tag, attrs, text, { openFile: c.openMd, toast: c.toast });
  const open = rel => openSavedSketch({ rel, project: ME, name: sketchName(rel), onSaved: () => loadShelf(c) });
  // A board on a card: click to open it, x to take it off that card.
  const badge = (rel, item) => h('span', { class: 'skb' },
    h('button', { title: `Open the sketch "${sketchName(rel)}"`, onclick: e => { e.stopPropagation(); open(rel); } }, icon('pen'), sketchName(rel)),
    h('button', { class: 'skx', title: 'Take this sketch off', onclick: e => { e.stopPropagation(); c.apply(deck.sketchDetach(item, rel)); } }, icon('x')));
  const dropOn = (el, item) => {
    el.ondragover = e => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); el.classList.add('skdrop'); } };
    el.ondragleave = () => el.classList.remove('skdrop');
    el.ondrop = e => { e.preventDefault(); el.classList.remove('skdrop'); const rel = e.dataTransfer.getData(DRAG); if (rel) c.apply(deck.sketchAttach(item, rel)); };
    return el;
  };
  const input = (placeholder, onEnter) => {
    const i = h('input', { placeholder, onkeydown: e => { if (e.key === 'Enter' && i.value.trim()) { const v = i.value.trim(); i.value = ''; onEnter(v); } } });
    return i;
  };

  // Left: to-dos and reminders, then notes.
  // A tag picked above the to-dos (#224) shows only the items carrying it.
  if (meTag && !(c.tags || []).includes(meTag)) meTag = null;
  const g = groupMe(parseTasks(c.meMd || '').filter(t => !meTag || hasTag(t, meTag)), new Date(), c.todoSort);
  const todo = t => {
    const due = dueOf(t), some = isSomeday(t);
    return dropOn(h('div', { class: 'mecard' + (t.mark === 'x' ? ' done' : ''), onclick: e => { if (!e.target.closest('button')) c.showTask(ME, t); } },
      h('button', { class: 'mecheck' + (t.mark === 'x' ? ' on' : ''), title: t.mark === 'x' ? 'Reopen' : 'Done', onclick: () => c.apply(deck.setTaskMark(ME, t.n, t.mark === 'x' ? ' ' : 'x')) }),
      h('div', { class: 'tx' }, t.text, whenLabel(h, icon, t), hist(h, t), itemTags(t).length ? h('div', { class: 'ttags' }, tagBadges(h, t)) : null,
        sketchesOf(t).length ? h('div', { class: 'skbs' }, sketchesOf(t).map(r => badge(r, { kind: 'task', project: ME, n: t.n }))) : null),
      t.mark !== 'x' && (some || !due) ? moveButton(h, t, some, (n, on) => c.apply(deck.setSomeday(n, on))) : null,
      t.mark !== 'x' ? doneButton(h, () => c.apply(deck.setTaskMark(ME, t.n, 'x'))) : null), { kind: 'task', project: ME, n: t.n });
  };
  const grp = (label, list, empty, extra) => [h('div', { class: 'daygrp' }, label, list.length ? h('small', {}, list.length) : null, extra),
    list.length ? list.map(todo) : empty ? h('div', { class: 'empty-note' }, empty) : null];
  // Adding with a time (#198): the clock opens date, time and repeat for the next to-do.
  const todoIn = h('input', { placeholder: 'Add a to-do, then Enter' });
  const when = whenFields(h);
  const whenRow = h('div', { class: 'note-add whenrow', hidden: !whenOpen }, when.el);
  const clock = h('button', { class: 'iconbtn' + (whenOpen ? ' on' : ''), title: 'Give it a date, time or repeat', onclick: () => { whenOpen = !whenOpen; c.rerender(); } }, icon('clock'));
  const todoSome = somedayAdd(h, todoIn, (v, some) => {
    const w = when.read();
    if (!some && w.day) { whenOpen = false; return c.apply(deck.addTimed(v, w)); }
    return c.apply(some ? deck.addSomeday(v) : deck.addTask(ME, v));
  });
  const noteIn = input('Add a note, then Enter', v => c.apply(deck.addNote(v)));
  const notes = notesWithSketches(c.notesMd || '').reverse().slice(0, 15);
  const left = h('div', { class: 'mecol mel' },
    h('div', { class: 'note-add' }, todoIn, clock, todoSome, helperButton({ kind: 'task', project: ME, field: todoIn, onAdd: d => c.apply(deck.helperAdd({ kind: 'task', project: ME, draft: d })) })), whenRow,
    tagChips(h, c.tags || [], meTag, v => { meTag = v; c.rerender(); }),
    grp('Today', g.today, 'Nothing due today.'), grp('Reminders', g.reminders), grp('To do', g.todo, null, sortPick(h, c.todoSort, c.setTodoSort)),
    somedayGroup({ h, list: g.someday, card: todo, rerender: c.rerender }), doneGroup({ h, list: g.done, card: todo, rerender: c.rerender }),
    h('div', { class: 'daygrp' }, 'Notes'), h('div', { class: 'note-add' }, noteIn, helperButton({ kind: 'note', project: ME, field: noteIn, onAdd: d => c.apply(deck.addNote(noteText(d))) })),
    notes.length ? notes.map(n => dropOn(h('div', { class: 'note' }, h('div', { class: 'when' }, n.when), linked('span', {}, n.text),
      n.sketches.length ? h('div', { class: 'skbs' }, n.sketches.map(r => badge(r, { kind: 'note', when: n.when, text: n.text }))) : null), { kind: 'note', when: n.when, text: n.text }))
      : h('div', { class: 'empty-note' }, 'No notes yet.'));

  // Middle: the ideas deck.
  const ideas = parseIdeas(c.ideasMd || ''), tags = allTags(ideas);
  // The tag picker offers Settings' tags and the ones already on ideas, each once (#343).
  const tagOffer = [...c.tags || [], ...tags].filter((t, k, a) => a.findIndex(x => x.toLowerCase() === t.toLowerCase()) === k);
  if (tagFilter && !tags.includes(tagFilter)) tagFilter = null;
  const shown = tagFilter ? ideas.filter(i => i.tags.includes(tagFilter)) : ideas;
  const ideaIn = input('New idea, then Enter', v => c.apply(deck.ideaAdd(v)));
  const card = i => {
    const item = { kind: 'task', project: 'ideas', n: i.n }, isOpen = openIdea === i.n;
    const state = i.state === 'became'
      ? h('span', { class: 'tag ok', title: 'This idea became a to-do' }, `became ${i.became.replace(/^Me #/, 'Self #')}`)
      : h('button', { class: 'tag st', title: 'Click for the next state: new, growing, parked', onclick: () => c.apply(deck.ideaState(i.n, nextState(i.state))) }, i.state);
    // Opened (#343): the description card, the tag picker, the box to the CTO, then the actions.
    const more = !isOpen ? null : h('div', { class: 'imore' },
      ideaDesc(c, i, linked), tagPicker(c, i, tagOffer), ideaTalk(c, i),
      h('div', { class: 'iacts' },
        i.state === 'became' ? null : h('button', { class: 'btn', title: 'Put this idea on Self as a to-do', onclick: () => c.apply(deck.ideaToTask(i.n)) }, 'Make it a to-do'),
        h('button', { class: 'btn ghost', onclick: () => { if (confirm(`Drop the idea "${i.text}"?`)) c.apply(deck.ideaMark(i.n, 'x')); } }, 'Drop')));
    return dropOn(h('div', { class: 'idea st-' + i.state + (isOpen ? ' open' : ''), onclick: e => {
      if (e.target.closest('button, input, textarea, a, .idesc, .tagpick')) return;
      openIdea = isOpen ? null : i.n; c.rerender();
    } }, linked('div', { class: 't' }, i.text), !isOpen && i.about[0] ? linked('div', { class: 'd' }, i.about[0]) : null, more,
      h('div', { class: 'f' }, isOpen ? null : i.tags.map(t => h('span', { class: 'tag' }, t)), state,
        i.sent ? h('span', { class: 'tag ok', title: "This idea was typed into the CTO's prompt" }, `sent to CTO ${i.sent}`) : null, sketchesOf(i).map(r => badge(r, item)))), item);
  };
  const filter = h('span', { class: 'itags' }, tags.length ? [null, ...tags].map(t => h('button', { class: 'ptool' + (tagFilter === t ? ' on' : ''), onclick: () => { tagFilter = t; c.rerender(); } }, t || 'all')) : null);
  const mid = h('div', { class: 'mecol mem' },
    h('div', { class: 'melab' }, 'Ideas', h('small', {}, String(ideas.length)), filter),
    h('div', { class: 'note-add' }, ideaIn, helperButton({ kind: 'idea', project: ME, field: ideaIn, onAdd: d => c.apply(deck.helperAdd({ kind: 'idea', project: ME, draft: d })) })),
    shown.length ? h('div', { class: 'deck' }, shown.map(card)) : h('div', { class: 'empty-note' }, tagFilter ? `No ideas tagged ${tagFilter}.` : 'No ideas yet.'));

  // Right: the shelf of saved sketches.
  const data = { tasks: c.tasksMd, ideas: c.ideasMd, notes: c.notesMd };
  // New sketch (#147) opens the board at once, named after today ("-2", "-3" when taken); rename it in the board.
  const newSketch = () => openSavedSketch({ project: ME, name: `Sketch ${new Date().toLocaleDateString('sv')}`, onSaved: () => loadShelf(c) });
  const right = h('div', { class: 'mecol mer' },
    h('div', { class: 'melab' }, 'Sketches', h('small', {}, String(shelf.length))),
    h('div', { class: 'note-add' }, h('button', { class: 'btn', title: 'Draw a new sketch', onclick: newSketch }, icon('pen'), 'New sketch')),
    shelf.length ? h('div', { class: 'shelf' }, shelf.map(s => {
      const uses = usesOf(s.rel, data);
      return h('div', { class: 'shelfit', draggable: 'true', title: 'Click to open. Drag onto a to-do, idea or note to attach it.',
        ondragstart: e => { e.dataTransfer.setData(DRAG, s.rel); e.dataTransfer.effectAllowed = 'link'; }, onclick: e => { if (!e.target.closest('button')) open(s.rel); } },
        s.preview ? h('img', { src: s.preview, alt: '' }) : h('div', { class: 'noprev' }, icon('pen')),
        h('div', { class: 'nm' }, sketchName(s.rel), h('small', {}, uses.length ? 'on ' + uses.map(u => u.label).join(', ') : 'not attached')),
        h('button', { class: 'skdel', title: 'Delete this sketch', onclick: () => {
          if (confirm(`Delete the sketch "${sketchName(s.rel)}"?${uses.length ? ` It comes off ${uses.map(u => u.label).join(', ')}.` : ''}`)) c.apply(deck.sketchDelete(s.rel)).then(() => loadShelf(c));
        } }, icon('x')));
    })) : h('div', { class: 'empty-note' }, 'No sketches yet.'));

  const head = h('header', { class: 'mehd' }, h('span', { class: 'ttl' }, h('span', { class: 'st-dot me' }), 'Self'),
    h('span', { class: 'spacer' }),
    [h('button', { class: 'btn idea-btn', onclick: () => ideaIn.focus() }, '+ Idea'),
      h('button', { class: 'btn', onclick: newSketch }, '+ Sketch'),
      h('button', { class: 'btn', onclick: () => todoIn.focus() }, '+ To-do'),
      // Shows and hides the Sketches column (#396); the Ideas take its room, remembered in ui.json.
      h('button', { class: 'iconbtn sktoggle' + (c.sketchesHidden ? '' : ' on'), title: c.sketchesHidden ? 'Show the sketches' : 'Hide the sketches', onclick: () => c.setSketchesHidden(!c.sketchesHidden) }, icon('sidebar'))]);

  // A redraw keeps each column's scroll, as Home does (#108).
  const scrolls = [...c.root.querySelectorAll('.mecol')].map(x => x.scrollTop);
  // The To do column is as wide as the owner dragged its edge (#203), remembered in ui.json.
  const gut = h('div', { class: 'megut', title: 'Drag to resize' });
  const cols = h('div', { class: 'mecols' + (c.sketchesHidden ? ' nosk' : ''), style: `--mel:${c.todoWidth || 380}px` }, left, gut, mid, c.sketchesHidden ? null : right);
  gut.onmousedown = e => {
    e.preventDefault();
    const r = cols.getBoundingClientRect();
    let w = c.todoWidth || 380;
    const move = ev => { w = Math.round(Math.min(Math.max(280, ev.clientX - r.left), r.width * 0.6)); cols.style.setProperty('--mel', `${w}px`); };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); c.setTodoWidth(w); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  };
  const page = h('section', { class: 'mepage' }, head, cols);
  const refocus = keepFocus();
  c.root.replaceChildren(page);
  refocus(page);
  page.querySelectorAll('.mecol').forEach((x, i) => { x.scrollTop = scrolls[i] || 0; });
  loadShelf(c);
}
