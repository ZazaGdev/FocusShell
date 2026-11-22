// A lead stopped on a prompt in its own pane, answered from FocusShell (#152): the card shows
// what Claude asks, the prompt's own options as buttons and a box for words. A click types
// the answer into that lead's pane, so the answer is the owner's own; the CTO never answers.
import { answerKeys, livePrompt, samePrompt } from '../lib/prompts.js';
import * as T from './terminal.js';
import { icon, toast } from './dom.js';
import { ctoLine } from '../lib/ownerwords.js';
import { startWords, wordsState, cancelWords, cardFor, queueLabel } from './words-type.js';

// The X on every lead card (#1278), as on a board card in Waiting (#1168).
const dropBtn = (h, label, onclick) => h('button', { class: 'wbdrop', title: label, 'aria-label': label, onclick }, icon('x'));

const drafts = new Map(); // session id -> words typed in its card, kept across redraws
let typingIn = null;      // the session id whose card box has the cursor

// A lead needs the owner's own words in its pane (#228): the card shows the exact words and
// the lead they go to. Only a click on its first button types them, by the request's id, so
// what is typed is what the card shows; Decline types nothing, and so does its X (#1278), which
// counts as Decline. tellCto(line) tells the CTO.
// After the click (#2991) the card stays, with a line saying where the words are (waiting for
// the lead's pane to be clear, typing, checking its log); Decline and X still work while they
// wait. Every end is said in a toast and to the CTO, never silently.
export function wordsCard(h, r, deck, openPane, tellCto) {
  const el = h('article', { class: 'pcard words', 'data-words': r.id, 'data-lead': r.lead });
  const run = wordsState(r.id), phase = run ? run.phase : r.state || null;
  if (phase === 'held') el.classList.add('queued');
  const act = async approve => {
    el.classList.add('sent');
    el.querySelectorAll('button').forEach(b => { b.disabled = true; });
    if (!approve) {
      cancelWords(r.id);
      const res = await deck.wordsDecline(r.id);
      if (res && res.cto) { tellCto(r.project, res.cto); return; }
      cancelWords(r.id, false);
      el.classList.remove('sent');
      toast(res && res.outcome === 'busy' ? `Your words are already being typed into ${r.lead}, so they cannot be declined now.`
        : `${r.lead}'s request was no longer waiting, so there was nothing to decline.`, true);
      return;
    }
    const res = await deck.wordsApprove(r.id);
    if (res && res.session) { startWords(deck, r, res.session, tellCto); return; }
    // The main process no longer holds it (expired, answered, or the app restarted): said, not silent.
    const outcome = res && res.outcome !== 'gone' ? res.outcome : 'not delivered: the app no longer held this request (expired, already answered, or the app restarted)';
    tellCto(r.project, res && res.cto ? res.cto : ctoLine(r, outcome));
    toast(`Not delivered to ${r.lead}: ${outcome.replace(/^not delivered: /, '')}`, true);
  };
  const held = !phase || phase === 'held', drop = dropBtn(h, `Decline and remove ${r.lead}'s request`, () => act(false));
  drop.disabled = !held;
  drop.setAttribute('data-decline', '');
  el.append(
    h('div', { class: 'pmeta' }, h('span', { class: 'kind decide' }, 'Your words'), h('span', { class: 'plead' }, r.lead),
      h('button', { class: 'btn ghost', onclick: () => openPane(r.project) }, 'Open pane'), drop),
    r.why ? h('div', { class: 'pask' }, r.why) : null,
    h('div', { class: 'pnote' }, `Typed into ${r.lead}'s pane, exactly:`),
    h('pre', { class: 'pdetail pwordsbox' }, r.words),
    phase ? h('div', { class: 'pnote pstate' }, (run && run.say) || `Waiting to be typed into ${r.lead}`) : null,
    // Once clicked (#3015) the row says where the words are, with a Cancel while they only wait.
    phase
      ? h('div', { class: 'popts' },
        h('span', { class: 'pqueue' }, queueLabel(phase, r.lead)),
        h('button', { class: 'btn', 'data-decline': '', disabled: !held, onclick: () => act(false) }, 'Cancel'))
      : h('div', { class: 'popts' },
        h('button', { class: 'btn primary', onclick: () => act(true) }, `Type it into ${r.lead}`),
        h('button', { class: 'btn', 'data-decline': '', onclick: () => act(false) }, 'Decline')));
  if (phase) cardFor(r.id, el);
  return el;
}

// w: { id, lead, project, what, prompt }; deck writes to the pane; openPane(project) shows it;
// hide(w) takes the card off Waiting until the lead stops on another prompt (#1278).
export function promptCard(h, w, deck, openPane, hide) {
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
    // Marked as the owner's typing (#2991), so a held words card waits QUIET after this answer
    // instead of slipping in between its keys.
    for (const k of keys) { T.typed(w.id, k); deck.write(w.id, k); await new Promise(r => setTimeout(r, k === '\x1b' ? 600 : 250)); }
  };
  const head = h('div', { class: 'pmeta' }, h('span', { class: 'kind decide' }, p && p.kind === 'question' ? 'Question' : 'Approve'),
    h('span', { class: 'plead' }, w.lead),
    h('button', { class: 'btn ghost', onclick: () => openPane(w.project) }, 'Open pane'),
    hide ? dropBtn(h, `Remove from Waiting (${w.lead} stays stopped until it is answered in its pane)`, () => hide(w)) : null);
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
