// The AI helper (#154): a sparkle button beside every add field opens a chat with Haiku
// that keeps a draft of the item. The owner edits the draft and presses Add; Cancel or
// Escape saves nothing and leaves the field as it was.
import { h, icon, toast } from './dom.js';
import { voiceInto } from './voice.js';
import { KINDS, draftText, textDraft } from '../lib/helper.js';

let modal = null, cur = null; // cur: { kind, project, field, onAdd, session, edited, busy }

export const helperOpen = () => !!modal;
export function closeHelper() { if (modal) { modal.remove(); modal = null; cur = null; } }

// opts: { kind: task|idea|note|pnote, project, field: the add field's input, onAdd(draft) -> Promise }
export function helperButton(opts) {
  return h('button', { class: 'btn ghost aihelp', title: 'Refine with AI', onclick: () => openHelper(opts) }, icon('spark'));
}

addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !modal) return;
  e.preventDefault(); e.stopPropagation(); closeHelper();
}, true);

// Ctrl+Shift+Space with the helper open: voice typing into its message box.
export function talkIntoHelper() {
  if (!modal) return false;
  const box = modal.querySelector('.aisay');
  box.focus(); box.setSelectionRange(box.value.length, box.value.length);
  voiceInto(box); // the bar closes again when the box is left (#415)
  return true;
}

export function openHelper(opts) {
  closeHelper();
  const project = opts.project || 'Me', k = KINDS[opts.kind] || KINDS.task;
  cur = { ...opts, project, session: null, edited: false, busy: false };
  const chat = h('div', { class: 'aichat' });
  const say = h('textarea', { class: 'aisay', rows: 2, placeholder: 'Say what you have in mind, then Enter', onkeydown: e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  } });
  const draft = h('textarea', { class: 'aidraft', rows: 5, placeholder: 'The draft shows here: a title on the first line, its description below', oninput: () => { cur.edited = true; } });
  const add = h('button', { class: 'btn primary', onclick: () => doAdd() }, 'Add');
  modal = h('div', { class: 'wbshade aishade', onpointerdown: e => { if (e.target === modal && !draft.value.trim()) closeHelper(); } },
    h('div', { class: 'aibox' },
      h('header', {}, h('h2', {}, icon('spark'), k.label(project)),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn ghost', title: 'Close without adding', onclick: closeHelper }, icon('x'))),
      chat,
      h('div', { class: 'aiin' }, say, h('button', { class: 'btn', onclick: () => send() }, 'Send')),
      h('div', { class: 'ailab' }, 'Draft'),
      draft,
      h('footer', {}, h('button', { class: 'btn ghost', onclick: closeHelper }, 'Cancel'), add)));
  document.body.append(modal);

  const bubble = (who, text, extra) => { chat.append(h('div', { class: `aib ${who}` }, text, extra || null)); chat.scrollTop = chat.scrollHeight; };
  const setDraft = d => { draft.value = draftText(d); cur.edited = false; };

  async function send() {
    const text = say.value.trim();
    if (!text || cur.busy) return;
    say.value = ''; bubble('me', text);
    cur.busy = true; say.disabled = true;
    const dots = h('div', { class: 'aib ai typing' }, h('span'), h('span'), h('span'));
    chat.append(dots); chat.scrollTop = chat.scrollHeight;
    const mine = cur;
    let r;
    try { r = await window.deck.helperTurn({ kind: mine.kind, project: mine.project, text, session: mine.session }); }
    catch (e) { r = { error: String(e.message || e) }; }
    if (cur !== mine) return; // closed while waiting
    dots.remove(); cur.busy = false; say.disabled = false; say.focus();
    if (r.session) cur.session = r.session;
    if (r.error) { bubble('err', r.error); return; }
    // A draft the owner has edited is never overwritten: the new one waits behind a link.
    if (r.draft && cur.edited && draft.value.trim()) {
      const d = r.draft;
      bubble('ai', r.reply || 'Here is a new draft.', h('button', { class: 'ailink', onclick: () => setDraft(d) }, 'Use this draft'));
    } else {
      if (r.draft) setDraft(r.draft);
      if (r.reply) bubble('ai', r.reply);
    }
  }

  async function doAdd() {
    const d = textDraft(draft.value);
    if (!d) { toast('The draft is empty', true); return; }
    const mine = cur;
    add.disabled = true;
    try { await mine.onAdd(d); }
    catch (e) { add.disabled = false; toast(`Could not add: ${e.message || e}`, true); return; }
    if (mine.field) mine.field.value = '';
    closeHelper();
  }

  // What is already typed in the field is the first message, sent at once.
  const seed = opts.field && opts.field.value.trim();
  if (seed) { say.value = seed; send(); } else say.focus();
}
