// Ctrl+K search (#233): a box over the window that finds any board item, open or done, in
// every project and Me, as you type. Arrow keys move, Enter opens the item, Esc closes.
// Ctrl+K opens it anywhere except inside a Claude pane, where Ctrl+K belongs to Claude Code;
// Ctrl+Shift+K opens it from anywhere, panes included. Results come in sections, Done last
// and cut to five until asked (#235); each row carries its project, status, tags, priority and
// version, and the detail line that matched.
import { h } from './dom.js';
import { parseTasks, itemTags } from '../lib/tasks.js';
import { planOf } from '../lib/plan.js';
import { searchIndex, searchItems, searchSections, matchedDetail } from '../lib/search.js';

const MARK = { '~': ['p', 'In progress'], '?': ['q', 'Needs you'], '!': ['b', 'Blocked'], x: ['x', 'Done'], ' ': ['', 'Open'] };
const DONE_CAP = 5;
// A steady colour per project name, so the same project always wears the same chip.
const hue = name => [...name].reduce((a, ch) => (a * 31 + ch.codePointAt(0)) % 360, 7);
export const searchKey = e => e.ctrlKey && !e.altKey && e.code === 'KeyK';

let box = null, index = null, indexOf = null;

// The words typed, bolded where they begin a word of the title.
function marked(text, typed) {
  const want = typed.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  if (!want.length) return text;
  return text.split(/([\p{L}\p{N}]+)/u).map(part => {
    const w = want.find(x => part.toLowerCase().startsWith(x));
    return w ? [h('b', {}, part.slice(0, w.length)), part.slice(w.length)] : part;
  });
}

export function closeSearch() { if (box) { box.remove(); box = null; } }

// c: { tasksMd: { project: board Markdown }, open(project, task) }
export function openSearch(c) {
  if (box) { box.querySelector('input').select(); return; }
  // The index is made once per board change, not per keystroke.
  if (indexOf !== c.tasksMd) {
    indexOf = c.tasksMd;
    index = searchIndex(Object.entries(c.tasksMd).flatMap(([project, md]) => parseTasks(md || '').map(task => ({ project, task }))));
  }
  let rows = [], sel = 0, doneAll = false;
  const input = h('input', { type: 'text', placeholder: 'Search every item', spellcheck: 'false' });
  const list = h('div', { class: 'sr-list' });
  const pick = i => {
    const r = rows[i]; if (!r) return;
    if (r.more) { doneAll = true; draw(); mark(); return; }
    closeSearch(); c.open(r.e.project, r.e.task);
  };
  const row = (r, i, kids) => h('div', { class: 'sr-row' + (r.more ? ' more' : '') + (i === sel ? ' on' : ''), onpointerdown: ev => { ev.preventDefault(); pick(i); }, onpointermove: () => { if (sel !== i) { sel = i; mark(); } } }, kids);
  const item = (e, i) => {
    const [cls, word] = MARK[e.task.mark] || MARK[' '];
    // Inside For you, which kind of ask it is: a decision, a block, or the owner's own to-do.
    const ask = e.task.mark === '?' ? 'needs you' : e.task.mark === '!' ? 'blocked' : e.task.forOwner && e.task.mark !== 'x' ? 'your to-do' : '';
    const { priority, version } = planOf(e.task), detail = matchedDetail(e, input.value);
    return row(rows[i], i, [
      h('span', { class: 'sr-mark ' + cls, title: word }),
      h('div', { class: 'sr-main' },
        h('div', { class: 'sr-line' },
          h('span', { class: 'sr-title' }, marked(e.task.text, input.value)),
          h('span', { class: 'sr-badges' },
            itemTags(e.task).map(x => h('span', { class: 'tag itag' }, x)),
            priority ? h('span', { class: 'sr-badge' }, 'P' + priority) : null,
            version ? h('span', { class: 'sr-badge' }, version) : null,
            ask ? h('span', { class: 'sr-badge ' + cls }, ask) : null)),
        detail ? h('div', { class: 'sr-detail' }, marked(detail, input.value)) : null),
      h('span', { class: 'sr-proj', style: `--h:${hue(e.project)}` }, e.project),
      h('span', { class: 'sr-num' }, '#' + e.task.n)]);
  };
  const draw = () => {
    const secs = searchSections(searchItems(index, input.value, 60));
    rows = []; const kids = [];
    for (const s of secs) {
      const cut = s.key === 'done' && !doneAll && s.items.length > DONE_CAP + 1;
      const shown = cut ? s.items.slice(0, DONE_CAP) : s.items;
      kids.push(h('div', { class: 'sr-sec' }, s.label, h('small', {}, s.items.length)));
      for (const e of shown) { rows.push({ e }); kids.push(item(e, rows.length - 1)); }
      if (cut) { rows.push({ more: true }); kids.push(row(rows.at(-1), rows.length - 1, `Show ${s.items.length - DONE_CAP} more done`)); }
    }
    sel = Math.min(sel, Math.max(0, rows.length - 1));
    list.replaceChildren(...(rows.length ? kids : [h('div', { class: 'sr-none' }, input.value.trim() ? 'No item matches' : 'No open items')]));
  };
  const mark = () => list.querySelectorAll('.sr-row').forEach((r, i) => { r.classList.toggle('on', i === sel); if (i === sel) r.scrollIntoView({ block: 'nearest' }); });
  input.addEventListener('input', () => { sel = 0; doneAll = false; draw(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (rows.length) { sel = (sel + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length; mark(); } }
    else if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSearch(); }
  });
  box = h('div', { class: 'sr-back', onpointerdown: e => { if (e.target === box) closeSearch(); } },
    h('div', { class: 'sr-box' }, input, list));
  document.body.append(box);
  draw();
  input.focus();
}
