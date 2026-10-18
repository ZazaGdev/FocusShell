// Shared screen pieces for plugins (#369). Every plugin screen is built from these, so plugin
// screens look and behave alike and change in one place. They draw what they are given and
// call back; none of them reads or writes a file or a board. Classes are Waiting on you's.
import { voiceInto, voiceDone } from './voice.js';

const QUIET_MS = 1600; // voice typing: this long without a change ends the dictation

// The open layers (modals and confirm dialogs), the last one on top. Only the top layer answers
// Escape, and it swallows the key, so one Escape closes one layer and reaches nothing under it.
const layers = [];

function layer(onEscape) {
  const l = { onKey: e => {
    if (e.key !== 'Escape' || layers[layers.length - 1] !== l) return;
    e.preventDefault(); e.stopImmediatePropagation();
    onEscape();
  } };
  layers.push(l);
  addEventListener('keydown', l.onKey, true);
  return () => { removeEventListener('keydown', l.onKey, true); const i = layers.indexOf(l); if (i >= 0) layers.splice(i, 1); };
}

// The kit a plugin's ui gets, with h, icon and deck bound. It remembers the modals it opened,
// so closeAll() can shut them when the plugin is switched off.
export function kitFor(h, icon, deck) {
  const open = new Set();
  return {
    modal: o => {
      const m = modal(h, icon, { ...o, onClose: () => { open.delete(m); if (o.onClose) o.onClose(); } });
      open.add(m);
      return m;
    },
    closeAll: () => { for (const m of [...open]) m.close(); },
    card: o => card(h, o),
    talkBox: o => talkBox(h, icon, deck, o),
    confirm: o => confirm(h, o),
    splitButton: o => splitButton(h, o),
    buttonRow: buttons => buttonRow(h, buttons),
  };
}

// A row of buttons, right aligned, like a dialog's.
export function buttonRow(h, buttons) {
  return h('div', { class: 'plugrow' }, ...buttons);
}

// A full-window modal like Waiting on you. o: { title, count, sub, actions: [elements], body, onClose }
// Returns { el, setBody(node), close() }. Escape and a click on the shade close it, unless a
// text field in it is being dictated into.
export function modal(h, icon, o) {
  const body = h('div', { class: 'wbbody' }, o.body || null);
  const before = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true; drop(); shade.remove();
    if (before && before.isConnected && before.focus) try { before.focus(); } catch { /* gone */ }
    if (o.onClose) o.onClose();
  };
  const drop = layer(() => { if (!shade.querySelector('.listen')) close(); });
  const shade = h('div', { class: 'wbshade plugmodal', onpointerdown: e => { if (e.target === shade && !shade.querySelector('.listen')) close(); } },
    h('div', { class: 'wbox', role: 'dialog', 'aria-label': o.title },
      h('header', {},
        h('h2', {}, o.title, o.count != null ? h('span', { class: 'wbn' }, String(o.count)) : null),
        o.sub ? h('span', { class: 'wbfor' }, o.sub) : null,
        h('span', { class: 'plugacts' }, ...(o.actions || [])),
        h('button', { class: 'iconbtn closex', title: 'Close', 'aria-label': 'Close', onclick: close }, icon('x'))),
      body));
  document.body.append(shade);
  const x = shade.querySelector('.closex');
  if (x) x.focus();
  return { el: shade, setBody: node => body.replaceChildren(node), close };
}

// A card like Waiting on you's. o: { accent (a CSS colour), meta: [nodes], children: [nodes] }
export function card(h, o) {
  const el = h('article', { class: 'wbcard plugcard' },
    h('div', { class: 'wbmeta' }, ...(o.meta || [])), ...(o.children || []));
  if (o.accent) el.style.borderTopColor = o.accent;
  return el;
}

// The text area with a mic, Waiting on you's way: the mic starts Windows voice typing into it,
// and o.onQuiet runs once the dictation has been quiet for a moment. o: { value, placeholder,
// rows, onInput(text), onQuiet(text) }. Returns { el, box, value() }.
export function talkBox(h, icon, deck, o) {
  let timer = null;
  const wrap = h('div', { class: 'tdtalk' });
  const stop = () => { clearTimeout(timer); timer = null; if (wrap.classList.contains('listen')) voiceDone(); wrap.classList.remove('listen'); };
  const box = h('textarea', { class: 'tdsay', rows: o.rows || 3, placeholder: o.placeholder || '',
    onblur: stop,
    oninput: () => {
      if (o.onInput) o.onInput(box.value);
      if (!wrap.classList.contains('listen')) return;
      clearTimeout(timer);
      timer = setTimeout(() => { stop(); if (o.onQuiet) o.onQuiet(box.value); }, QUIET_MS);
    },
    onkeydown: e => { if (['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) stop(); } });
  box.value = o.value || '';
  const mic = h('button', { class: 'mic', title: 'Talk: Windows voice typing writes here', 'aria-label': 'Talk', onclick: () => {
    box.focus(); box.setSelectionRange(box.value.length, box.value.length);
    wrap.classList.add('listen');
    voiceInto(box); // the bar closes again when the box is left (#415)
  } }, icon('mic'));
  wrap.append(box, mic);
  return { el: wrap, box, value: () => box.value };
}

// An "are you sure" dialog over everything. o: { title, text, ok, danger, extra (a node) }.
// Resolves true on OK, false on Cancel, Escape or a click outside.
export function confirm(h, o) {
  return new Promise(res => {
    const done = v => { drop(); shade.remove(); res(v); };
    const drop = layer(() => done(false));
    const shade = h('div', { class: 'wbshade plugconfirm', onpointerdown: e => { if (e.target === shade) done(false); } },
      h('div', { class: 'plugdialog', role: 'dialog', 'aria-label': o.title },
        h('h3', {}, o.title), o.text ? h('p', {}, o.text) : null, o.extra || null,
        h('div', { class: 'plugrow' },
          h('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'),
          h('button', { class: 'btn ' + (o.danger ? 'danger' : 'primary'), onclick: () => done(true) }, o.ok || 'OK'))));
    document.body.append(shade);
  });
}

// Two buttons joined: o: { main: { label, onClick }, second: { label, onClick }, primary }.
export function splitButton(h, o) {
  const cls = 'btn' + (o.primary === false ? '' : ' primary');
  return h('span', { class: 'plugsplit' },
    h('button', { class: cls, onclick: o.main.onClick }, o.main.label),
    h('button', { class: cls + ' second', onclick: o.second.onClick }, o.second.label));
}
