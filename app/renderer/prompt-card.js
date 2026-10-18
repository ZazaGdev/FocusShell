// A lead stopped on a prompt in its own pane, answered from FocusShell (#152): the card shows
// what Claude asks, the prompt's own options as buttons and a box for words. A click types
// the answer into that lead's pane, so the answer is the owner's own; the CTO never answers.
import { answerKeys, livePrompt, samePrompt } from '../lib/prompts.js';
import * as T from './terminal.js';

const drafts = new Map(); // session id -> words typed in its card, kept across redraws
let typingIn = null;      // the session id whose card box has the cursor

// A lead needs the owner's own words in its pane (#228): the card shows the exact words and
// the lead they go to. Only a click on its first button types them, by the request's id, so
// what is typed is what the card shows; Decline types nothing. tellCto(line) tells the CTO.
export function wordsCard(h, r, deck, openPane, tellCto) {
  const el = h('article', { class: 'pcard words', 'data-words': r.id });
  const act = async approve => {
    el.classList.add('sent');
    el.querySelectorAll('button').forEach(b => { b.disabled = true; });
    const res = await (approve ? deck.wordsApprove(r.id) : deck.wordsDecline(r.id));
    if (res && res.cto) tellCto(r.project, res.cto);
  };
  el.append(
    h('div', { class: 'pmeta' }, h('span', { class: 'kind decide' }, 'Your words'), h('span', { class: 'plead' }, r.lead),
      h('button', { class: 'btn ghost', title: `Show ${r.lead}'s pane`, onclick: () => openPane(r.project) }, 'Open pane')),
    r.why ? h('div', { class: 'pask' }, r.why) : null,
    h('div', { class: 'pnote' }, `Typed into ${r.lead}'s pane, exactly:`),
    h('pre', { class: 'pdetail pwordsbox' }, r.words),
    h('div', { class: 'popts' },
      h('button', { class: 'btn primary', onclick: () => act(true) }, `Type it into ${r.lead}`),
      h('button', { class: 'btn', onclick: () => act(false) }, 'Decline')));
  return el;
}

// w: { id, lead, project, what, prompt }; deck writes to the pane; openPane(project) shows it.
export function promptCard(h, w, deck, openPane) {
  const p = w.prompt, el = h('article', { class: 'pcard', 'data-session': w.id });
  const go = async choice => {
    const keys = p ? answerKeys(p, choice) : [];
    if (!keys.length) return;
    // The pane is read again first (#388): a click never answers a prompt the card does not show.
    if (!samePrompt(p, livePrompt(await T.screen(w.id)))) {
      if (!el.querySelector('.pchanged')) el.append(h('div', { class: 'pnote pchanged' }, 'The prompt in the pane has changed, so nothing was sent. The card shows the new one in a moment.'));
      return;
    }
    drafts.delete(w.id); if (typingIn === w.id) typingIn = null;
    el.classList.add('sent');
    el.querySelectorAll('button, textarea').forEach(b => { b.disabled = true; });
    for (const k of keys) { deck.write(w.id, k); await new Promise(r => setTimeout(r, k === '\x1b' ? 600 : 250)); }
  };
  const head = h('div', { class: 'pmeta' }, h('span', { class: 'kind decide' }, p && p.kind === 'question' ? 'Question' : 'Approve'),
    h('span', { class: 'plead' }, w.lead),
    h('button', { class: 'btn ghost', title: `Show ${w.lead}'s pane`, onclick: () => openPane(w.project) }, 'Open pane'));
  if (!p) {
    el.append(head, h('div', { class: 'pask' }, w.what), h('div', { class: 'pnote' }, 'Answer it in its pane.'));
    return el;
  }
  const opts = p.options.filter(o => !(p.kind === 'question' && o.n === p.other));
  const box = h('textarea', { rows: 1, placeholder: p.kind === 'question' ? 'Or type your own answer, then Enter' : 'Or tell Claude what to do instead, then Enter',
    oninput: () => drafts.set(w.id, box.value), onfocus: () => { typingIn = w.id; },
    onblur: () => setTimeout(() => { if (box.isConnected && typingIn === w.id) typingIn = null; }),
    onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go({ text: box.value }); } } });
  box.value = drafts.get(w.id) || '';
  el.append(...[head, h('div', { class: 'pask' }, p.ask), p.detail ? h('pre', { class: 'pdetail' }, p.detail) : null,
    h('div', { class: 'popts' }, opts.map(o => h('button', { class: 'btn' + (o.n === 1 ? ' primary' : ''), onclick: () => go({ n: o.n }) }, `${o.n}. ${o.label}`))),
    h('div', { class: 'pwords' }, box, h('button', { class: 'btn', onclick: () => go({ text: box.value }) }, 'Send'))].filter(Boolean));
  // A redraw while typing keeps the cursor in the box.
  if (typingIn === w.id) requestAnimationFrame(() => { if (box.isConnected) { box.focus(); box.selectionStart = box.value.length; } });
  return el;
}
