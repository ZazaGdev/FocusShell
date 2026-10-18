// The owner's whiteboard (#52): a button beside a CTO pane opens a modal with one card per
// item waiting on the owner in that CTO's projects. Each card answers in place: a click on
// an option, typing, or the mic. The mic uses Windows voice typing, like a card's box, and
// waits for Send (#414). Answers go to the CTO as "ANSWER <Project> #<n>: ...", the same as
// from an opened card.
import { whiteboardCards, cardCount } from '../lib/whiteboard.js';
import { cardLinks } from '../lib/links.js';
import { linkChips, linkedText } from './textlinks.js';
import { voiceInto, voiceDone } from './voice.js';
import { tldr } from '../lib/tldr.js';

// A card opens with its TLDR (#1000); the full text sits behind "more". [line, folded part]
export function tldrFold(h, line, kids) {
  const more = h('div', { class: 'wbmore', hidden: true }, kids.filter(Boolean));
  const btn = h('button', { class: 'wbmorebtn', onclick: e => { e.stopPropagation(); more.hidden = !more.hidden; btn.textContent = more.hidden ? 'more' : 'less'; } }, 'more');
  return [h('div', { class: 'wbtldr' }, h('span', {}, line), btn), more];
}

let modal = null, cur = null; // cur: the ctx the whiteboard was opened with
const sent = new Map();       // "<Project>#<n>" -> { q, text }: what was sent to which question, for this run of the app

export const whiteboardOpen = () => !!modal;
export function closeWhiteboard() { if (modal) { modal.remove(); modal = null; cur = null; } }
export const waitingCount = (tasksMd, groups, mgr, skip) => cardCount(whiteboardCards(tasksMd, groups, mgr, skip));

// ctx: { h, icon, deck, mgr, title, data() -> { tasksMd, groups, skip }, talk(project, n, text) -> bool, open(project, task),
//        prompts() -> leads of this CTO stopped on a prompt, promptCard(lead) -> its card (#152) }
export function openWhiteboard(ctx) {
  closeWhiteboard();
  cur = ctx;
  modal = ctx.h('div', { class: 'wbshade', onpointerdown: e => { if (e.target === modal && !typing()) closeWhiteboard(); } });
  document.body.append(modal);
  draw();
}
export function refreshWhiteboard() { if (modal && !typing()) draw(); }
const typing = () => !!modal && (!!modal.querySelector('.wbcard.listen') || [...modal.querySelectorAll('textarea')].some(b => b.value.trim()));

addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !modal) return;
  if (modal.querySelector('.wbcard.listen')) return; // Escape belongs to voice typing then
  e.preventDefault(); closeWhiteboard();
}, true);

// Ctrl+Shift+Space with the whiteboard open: talk into the card being typed in, else the first.
export function talkIntoWhiteboard() {
  if (!modal) return false;
  const card = (document.activeElement && document.activeElement.closest('.wbcard')) || modal.querySelector('.wbcard:not(.sent)');
  if (card) card.listen();
  return true;
}

function draw() {
  const { h, icon, mgr, title } = cur, { tasksMd, groups, skip } = cur.data();
  const boards = whiteboardCards(tasksMd, groups, mgr, skip), asks = cur.prompts ? cur.prompts() : [];
  for (const w of asks) if (!boards.some(b => b.project === w.project)) boards.unshift({ project: w.project, cards: [] });
  const asksOf = p => asks.filter(w => w.project === p), n = cardCount(boards) + asks.length;
  const body = n
    ? h('div', { class: 'wbcols' }, boards.map(b => h('section', { class: 'wbproj' },
      h('h3', {}, b.project, h('span', {}, String(asksOf(b.project).length + b.cards.length))),
      asksOf(b.project).map(cur.promptCard), b.cards.map(c => card(b.project, c)))))
    : h('div', { class: 'wbempty' }, 'Nothing is waiting on you.');
  modal.replaceChildren(h('div', { class: 'wbox', role: 'dialog', 'aria-label': 'Waiting on you' },
    h('header', {}, h('h2', {}, 'Waiting on you', h('span', { class: 'wbn' }, String(n))), h('span', { class: 'wbfor' }, title),
      h('span', { class: 'wbhint' }, 'Pick an option, type, or press the mic and talk, then Send.'),
      h('button', { class: 'btn ghost', title: 'Close (Esc)', onclick: closeWhiteboard }, icon('x'))),
    h('div', { class: 'wbbody' }, body)));
}

const ageOf = date => {
  if (!date) return '';
  const days = Math.floor((Date.now() - new Date(date + 'T00:00:00')) / 864e5);
  return days <= 0 ? 'today' : days === 1 ? '1 day' : `${days} days`;
};

function card(project, { task: t, ask }) {
  const { h, icon, deck } = cur, key = `${project}#${t.n}`;
  const el = h('article', { class: 'wbcard' }), add = (...kids) => el.append(...kids.filter(Boolean));
  const head = h('div', { class: 'wbmeta' }, h('span', { class: 'wbid' }, `#${t.n}`), h('span', { class: 'wbage' }, ageOf(t.date)),
    h('a', { href: '#', class: 'wbopen', title: 'Open the full card', onclick: e => { e.preventDefault(); const o = cur.open; closeWhiteboard(); o(project, t); } }, 'Open'));
  // Web links and paths in the card's text open on a click (#1045).
  const lopts = { openFile: cur.openMd, toast: cur.toast, before: closeWhiteboard };
  const linked = (tag, cls, text) => linkedText(tag, cls ? { class: cls } : {}, text, lopts);
  const q = (ask && ask.question) || t.text, question = q === t.text ? null : linked('p', 'wbq', q);
  // The links and files the question is about (#416), under it.
  const links = linkChips(cardLinks(t), lopts);
  if (sent.has(key) && sent.get(key).q === q) {
    el.classList.add('sent');
    add(head, linked('div', 'wbtitle', t.text), question, h('div', { class: 'wbsent' }, `Sent: ${sent.get(key).text}`, h('small', {}, 'Waiting for the CTO')));
    return el;
  }

  const hint = h('div', { class: 'wblisten' });
  const stopListen = () => { if (el.classList.contains('listen')) voiceDone(); el.classList.remove('listen'); hint.replaceChildren(); };
  const say = text => {
    const s = String(text).replace(/\s+/g, ' ').trim();
    stopListen();
    if (!s || !cur || !cur.talk(project, t.n, s)) return;
    deck.addProjectNote(project, `#${t.n} You: ${s}`);
    sent.set(key, { q, text: s });
    el.replaceWith(card(project, { task: t, ask }));
  };
  const box = h('textarea', { class: 'tdsay', rows: 2, placeholder: 'Answer…', onkeydown: e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); say(box.value); }
  } });
  // Dictation fills the box and waits (#414): nothing goes until Send or Enter, however long a
  // pause. A second click on the mic ends listening, without sending.
  el.listen = () => {
    if (el.classList.contains('listen')) { stopListen(); box.focus(); return; }
    box.focus(); box.setSelectionRange(box.value.length, box.value.length);
    el.classList.add('listen');
    hint.replaceChildren('Listening. Press Send when you are done.');
    voiceInto(box);
  };
  const sug = ask && ask.suggest;
  const opts = !ask ? null : ask.options.length
    ? h('div', { class: 'tdopts' }, ask.options.map(o => {
      const isSug = !!sug && (o.key ? sug.toLowerCase().startsWith(o.key) : sug.toLowerCase() === o.text.toLowerCase());
      return h('button', { class: 'tdopt' + (isSug ? ' sug' : ''), onclick: () => say(o.key ? `${o.key}: ${o.text}` : o.text) },
        o.key ? h('span', { class: 'l' }, o.key) : null, h('span', {}, o.text, isSug ? h('small', {}, 'CTO suggests') : null));
    }))
    : sug ? h('div', { class: 'tdopts' }, h('button', { class: 'tdopt sug', onclick: () => say(`go with the suggestion: ${sug}`) }, h('span', {}, `Go with the suggestion: ${sug}`))) : null;
  add(head, ...tldrFold(h, linked('span', '', tldr({ project, n: t.n, title: t.text, ask: q })), [linked('div', 'wbtitle', t.text), question]), links, opts,
    h('div', { class: 'tdtalk' }, box,
      h('button', { class: 'mic', title: 'Talk: Windows voice typing writes here, then press Send', onclick: () => el.listen() }, icon('mic')),
      h('button', { class: 'btn primary', title: 'Send to the CTO (Enter)', onclick: () => say(box.value) }, 'Send')),
    hint);
  return el;
}
