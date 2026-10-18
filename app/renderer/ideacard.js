// An opened idea on the Me page (#343): its description as one card you click to edit, a
// tag picker that filters the tags and makes new ones, and the box that talks to the CTO
// the way an opened to-do does. The Me page redraws whenever any board file changes, so
// what is typed here lives in drafts and the focused field gets its focus back (keepFocus).
import { ideaLine } from '../lib/ideas.js';
import { voiceInto } from './voice.js';

const drafts = new Map(); // data-keep key -> text typed and not yet saved or sent
let editing = null;       // the idea whose description is open for editing
let hl = 0;               // the highlighted row of the open tag menu

const kept = (h, tag, key, attrs, fallback) => {
  const el = h(tag, { ...attrs, 'data-keep': key });
  el.value = drafts.has(key) ? drafts.get(key) : fallback;
  el.addEventListener('input', () => drafts.set(key, el.value));
  return el;
};

// Called around a redraw: before, what has focus; after, focus and caret put back.
export function keepFocus() {
  const a = document.activeElement, key = a && a.dataset && a.dataset.keep;
  const sel = key ? [a.selectionStart, a.selectionEnd] : null;
  return root => {
    const el = key && root.querySelector(`[data-keep="${key}"]`);
    if (!el) return;
    el.focus();
    try { el.setSelectionRange(sel[0], sel[1]); } catch { /* not a text field */ }
  };
}

// c: the Me page's context; i: the parsed idea; linked: text with clickable paths.
export function ideaDesc(c, i, linked) {
  const { h, deck } = c, key = `desc-${i.n}`, text = i.about.join('\n');
  if (editing !== i.n) {
    return h('div', { class: 'idesc', title: 'Click to edit the description', onclick: e => {
      if (e.target.closest('a, button')) return;
      editing = i.n; drafts.set(key, text); c.rerender();
      requestAnimationFrame(() => { const t = document.querySelector(`[data-keep="${key}"]`); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } });
    } }, i.about.length ? i.about.map(d => linked('p', {}, d)) : h('p', { class: 'muted' }, 'Click to write a description'));
  }
  const done = () => { editing = null; drafts.delete(key); };
  const save = () => { const v = drafts.get(key); done(); if (v != null && v !== text) c.apply(deck.ideaAbout(i.n, v)); else c.rerender(); };
  const ta = kept(h, 'textarea', key, { class: 'idesc edit', rows: Math.max(3, i.about.length + 1), placeholder: 'Describe the idea; one line per point', title: 'Ctrl+Enter or click away saves, Esc cancels', onkeydown: e => {
    if (e.key === 'Escape') { e.stopPropagation(); done(); c.rerender(); }
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); save(); }
  } }, text);
  // Leaving the box saves it; a redraw that replaced the box is not leaving it.
  ta.addEventListener('blur', () => setTimeout(() => { if (ta.isConnected && editing === i.n) save(); }, 0));
  return ta;
}

// offer: every tag to pick from (Settings' and the ideas'); addTag(tag) puts a new one in Settings.
export function tagPicker(c, i, offer) {
  const { h, deck } = c, key = `tags-${i.n}`, low = s => s.toLowerCase();
  const setTags = list => { drafts.delete(key); hl = 0; c.apply(deck.ideaTags(i.n, list)); };
  const pick = tag => {
    if (!offer.some(t => low(t) === low(tag))) c.addTag(tag);
    setTags([...i.tags, tag]);
  };
  const q = (drafts.get(key) || '').trim();
  const rows = offer.filter(t => !i.tags.includes(low(t)) && low(t).includes(low(q)));
  const items = [...rows.map(t => ({ tag: t, label: t })), ...(q && !offer.some(t => low(t) === low(q)) && !i.tags.includes(low(q)) ? [{ tag: q, label: `Create "${q}"`, isNew: true }] : [])];
  if (hl >= items.length) hl = 0;
  const input = kept(h, 'input', key, { class: 'tpin', placeholder: i.tags.length ? 'Add a tag' : 'Add a tag: type to find or create one', onkeydown: e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hl = (hl + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(items.length, 1); c.rerender(); }
    if (e.key === 'Enter' && items[hl]) { e.preventDefault(); pick(items[hl].tag); }
    if (e.key === 'Backspace' && !input.value && i.tags.length) setTags(i.tags.slice(0, -1));
    if (e.key === 'Escape') { e.stopPropagation(); input.blur(); }
  } }, '');
  input.addEventListener('input', () => { hl = 0; c.rerender(); });
  return h('div', { class: 'tagpick' },
    i.tags.map(t => h('span', { class: 'tag' }, t, h('button', { class: 'tagx', title: `Take the tag ${t} off`, onclick: () => setTags(i.tags.filter(x => x !== t)) }, '×'))),
    input,
    h('div', { class: 'tpmenu' }, items.length ? items.map((it, k) => h('button', { class: 'tpitem' + (k === hl ? ' on' : '') + (it.isNew ? ' new' : ''),
      onmousedown: e => { e.preventDefault(); pick(it.tag); } }, it.label)) : h('div', { class: 'tpnone' }, q ? 'Already on this idea' : 'No more tags; type to create one')));
}

// The to-do's "Tell the CTO" box: Send types the idea's IDEA line, with anything written
// here, into the CTO's prompt and marks the idea as sent.
export function ideaTalk(c, i) {
  const { h, deck, icon } = c, key = `say-${i.n}`;
  const send = async () => {
    const said = drafts.get(key) || '';
    if (!(await c.toCto(ideaLine(i, said), `Sent idea #${i.n} to the CTO`))) return;
    drafts.delete(key); box.value = '';
    c.apply(deck.ideaSent(i.n));
  };
  const box = kept(h, 'textarea', key, { class: 'tdsay', rows: 2, placeholder: `Tell the CTO about idea #${i.n}…`, onkeydown: e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  } }, '');
  return h('div', { class: 'tdtalk' }, box,
    h('button', { class: 'mic', 'data-tip': 'Talk: Windows voice typing writes into this box, then press Send', onclick: () => { box.focus(); voiceInto(box); } }, icon('mic')),
    h('button', { class: 'btn primary', title: i.sent ? `Sent ${i.sent}; send it again (Enter)` : 'Send to the CTO (Enter)', onclick: send }, 'Send'));
}
