// The owner's whiteboard (#52): a button beside a CTO pane opens a modal with one card per
// item waiting on the owner in that CTO's projects. Each card answers in place: a click on
// an option, typing, or the mic. The mic uses Windows voice typing, like a card's box, and
// waits for Send (#414). Answers go to the CTO as "ANSWER <Project> #<n>: ...", the same as
// from an opened card.
import { whiteboardCards, cardCount, cardQuestion, scrollAnchor } from '../lib/whiteboard.js';
import { cardLinks } from '../lib/links.js';
import { linkChips, linkedText } from './textlinks.js';
import { voiceInto, voiceDone } from './voice.js';
import { cardView } from '../lib/cardview.js';
import { summaryKey, summaryInput, readMarkdown } from '../lib/cardsummary.js';
import { parseTasks } from '../lib/tasks.js';
import { pasteShots, withShots } from './pasteshots.js';
import { VOICE_NAME } from '../lib/platform.js';

// Plain summaries (#1521), made in the background by Haiku: key (lib/cardsummary.js) -> Markdown.
const sums = new Map();
export function setupSummaries(deck) {
  deck.cardSummaries().then(m => { for (const [k, v] of Object.entries(m || {})) sums.set(k, v); refreshWhiteboard(); }).catch(() => {});
  deck.onCardSummary(({ key, md }) => { sums.set(key, md); refreshWhiteboard(); });
}
// Every card waiting on the owner, so its summary is made before Waiting is opened.
export function wantSummaries(deck, tasksMd, skip = []) {
  const list = [];
  for (const [project, md] of Object.entries(tasksMd || {})) {
    if (skip.includes(project)) continue;
    for (const t of parseTasks(md)) if (t.mark === '?' && !t.forOwner) { const key = summaryKey(project, t); if (!sums.has(key)) list.push({ key, input: summaryInput(project, t) }); }
  }
  if (list.length) deck.wantSummaries(list);
}
const mdView = (h, md) => readMarkdown(md).map(b => {
  const runs = rs => rs.map(r => (r.b ? h('b', {}, r.text) : r.text));
  return b.ul ? h('ul', {}, b.ul.map(li => h('li', {}, runs(li)))) : h('p', {}, runs(b.p));
});

// A card opens with its TLDR (#1000); the full text sits behind "more". [line, folded part]
export function tldrFold(h, line, kids) {
  const more = h('div', { class: 'wbmore', hidden: true }, kids.filter(Boolean));
  const btn = h('button', { class: 'wbmorebtn', onclick: e => { e.stopPropagation(); more.hidden = !more.hidden; btn.textContent = more.hidden ? 'more' : 'less'; } }, 'more');
  return [h('div', { class: 'wbtldr' }, h('span', {}, line), btn), more];
}

let modal = null, cur = null; // cur: the ctx the whiteboard was opened with
const sent = new Map();       // "<Project>#<n>" -> { q, text }: what was sent to which question, for this run of the app
let undo = null;              // the card just removed (#1168): { key, project, n, timer }
const built = new Map();      // "<Project>#<n>" -> { sig, el }: a card kept as it is while it has not changed (#1734)

export const whiteboardOpen = () => !!modal;
export function closeWhiteboard() { if (modal) { modal.remove(); modal = null; cur = null; } if (undo) { clearTimeout(undo.timer); undo = null; } built.clear(); }
export const waitingCount = (tasksMd, groups, mgr, skip, hidden) => cardCount(whiteboardCards(tasksMd, groups, mgr, skip, hidden));

// ctx: { h, icon, deck, mgr, title, data() -> { tasksMd, groups, skip, hidden }, talk(project, n, text) -> bool, open(project, task),
//        prompts() -> leads of this CTO stopped on a prompt, promptCard(lead) -> its card (#152),
//        setHidden(map) -> keeps the cards removed from Waiting (#1168) }
export function openWhiteboard(ctx) {
  closeWhiteboard();
  cur = ctx;
  modal = ctx.h('div', { class: 'wbshade', onpointerdown: e => { if (e.target === modal && !typing()) closeWhiteboard(); } });
  document.body.append(modal);
  draw();
}
// A redraw keeps the owner's place (#1734), so it may run while they type, though not while
// voice typing writes into a card.
export function refreshWhiteboard() { if (modal && !modal.querySelector('.wbcard.listen')) draw(); }
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

// Cards added or removed around the one being read never move it or take its focus (#1734): the
// card at the top of the view (or being typed in) stays where it was, and the Answer box keeps
// focus, caret and text.
function draw() {
  const place = placeOf();
  const used = new Set();
  build(used);
  for (const k of [...built.keys()]) if (!used.has(k)) built.delete(k);
  restorePlace(place);
}
function placeOf() {
  const body = modal.querySelector('.wbbody');
  if (!body) return null;
  const view = body.getBoundingClientRect(), act = document.activeElement;
  const box = act && act.tagName === 'TEXTAREA' && modal.contains(act) ? act : null;
  const focusKey = box ? box.closest('[data-key]')?.dataset.key : null;
  const rows = [...body.querySelectorAll('[data-key]')].map(el => { const r = el.getBoundingClientRect(); return { key: el.dataset.key, top: r.top - view.top, bottom: r.bottom - view.top }; });
  return { scrollTop: body.scrollTop, anchor: scrollAnchor(rows, view.height, focusKey), focusKey, sel: box ? [box.selectionStart, box.selectionEnd, box.selectionDirection] : null };
}
function restorePlace(place) {
  const body = modal && modal.querySelector('.wbbody');
  if (!place || !body) return;
  const at = key => [...body.querySelectorAll('[data-key]')].find(el => el.dataset.key === key);
  const el = place.anchor && at(place.anchor.key);
  body.scrollTop = place.scrollTop;
  if (el) body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top - place.anchor.offset;
  const box = place.focusKey && at(place.focusKey)?.querySelector('textarea');
  if (box && document.activeElement !== box) { box.focus({ preventScroll: true }); box.setSelectionRange(...place.sel); }
}

function build(used) {
  const { h, icon, mgr, title } = cur, { tasksMd, groups, skip, hidden } = cur.data();
  const card = (project, c) => { used.add(`${project}#${c.task.n}`); return cardOnce(project, c); };
  const boards = whiteboardCards(tasksMd, groups, mgr, skip, hidden), asks = cur.prompts ? cur.prompts() : [];
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
    h('div', { class: 'wbbody' }, body),
    undo ? h('div', { class: 'wbundo', role: 'status' }, `Removed ${undo.project} #${undo.n} from Waiting. It stays on its board.`,
      h('button', { class: 'btn', onclick: restore }, 'Undo')) : null));
}

// A card removed from Waiting (#1168) only leaves this list; its task stays as it is on its board.
// Undo stays for a few seconds.
function remove(project, n, q) {
  const key = `${project}#${n}`, { hidden } = cur.data();
  if (undo) clearTimeout(undo.timer);
  cur.setHidden({ ...(hidden || {}), [key]: q });
  undo = { key, project, n, timer: setTimeout(() => { undo = null; if (modal) draw(); }, 6000) };
  draw();
}
function restore() {
  if (!undo) return;
  const { hidden } = cur.data(), next = { ...(hidden || {}) };
  delete next[undo.key];
  clearTimeout(undo.timer); undo = null;
  cur.setHidden(next);
  draw();
}

const ageOf = date => {
  if (!date) return '';
  const days = Math.floor((Date.now() - new Date(date + 'T00:00:00')) / 864e5);
  return days <= 0 ? 'today' : days === 1 ? '1 day' : `${days} days`;
};

// A card that has not changed since the last draw is the same element, with what was typed in it;
// a changed one is built again and keeps the typed text.
function cardOnce(project, c) {
  const key = `${project}#${c.task.n}`, old = built.get(key);
  const sig = JSON.stringify([c.task, c.ask, sums.get(summaryKey(project, c.task)) || '', sent.get(key) || null]);
  if (old && old.sig === sig) return old.el;
  const el = card(project, c), typed = old && old.el.querySelector('textarea')?.value, box = el.querySelector('textarea');
  if (typed && box && !box.value) box.value = typed;
  if (old && el.shots) el.shots.adopt(old.el.shots);
  built.set(key, { sig, el });
  return el;
}

function card(project, { task: t, ask }) {
  const { h, icon, deck } = cur, key = `${project}#${t.n}`;
  const el = h('article', { class: 'wbcard', 'data-key': key }), add = (...kids) => el.append(...kids.filter(Boolean));
  const head = h('div', { class: 'wbmeta' }, h('span', { class: 'wbid' }, `#${t.n}`), h('span', { class: 'wbage' }, ageOf(t.date)),
    h('a', { href: '#', class: 'wbopen', title: 'Open the full card', onclick: e => { e.preventDefault(); const o = cur.open; closeWhiteboard(); o(project, t); } }, 'Open'),
    h('button', { class: 'wbdrop', title: 'Remove from Waiting (it stays on its board)', 'aria-label': `Remove ${project} #${t.n} from Waiting`, onclick: () => remove(project, t.n, q) }, icon('x')));
  // Web links and paths in the card's text open on a click (#1045).
  const lopts = { openFile: cur.openMd, toast: cur.toast, before: closeWhiteboard };
  const linked = (tag, cls, text) => linkedText(tag, cls ? { class: cls } : {}, text, lopts);
  const q = cardQuestion(t, ask), question = q === t.text ? null : linked('p', 'wbq', q);
  // The links and files the question is about (#416), under it.
  const links = linkChips(cardLinks(t), lopts);
  if (sent.has(key) && sent.get(key).q === q) {
    el.classList.add('sent');
    add(head, linked('div', 'wbtitle', t.text), question, h('div', { class: 'wbsent' }, `Sent: ${sent.get(key).text}`, h('small', {}, 'Waiting for the CTO')));
    return el;
  }

  const hint = h('div', { class: 'wblisten' });
  const stopListen = () => { if (el.classList.contains('listen')) voiceDone(); el.classList.remove('listen'); hint.replaceChildren(); };
  const say = async text => {
    let s = String(text).replace(/\s+/g, ' ').trim();
    stopListen();
    if (!s && !shots.has()) return;
    if (shots.has()) s = withShots(s, await shots.take());
    if (!s || !cur || !cur.talk(project, t.n, s)) return;
    shots.clear();
    deck.addProjectNote(project, `#${t.n} You: ${s}`);
    sent.set(key, { q, text: s });
    el.replaceWith(cardOnce(project, { task: t, ask }));
  };
  const box = h('textarea', { class: 'tdsay', rows: 2, placeholder: 'Answer…', onkeydown: e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); say(box.value); }
  } });
  const shots = el.shots = pasteShots(h, icon, deck, box);
  // Dictation fills the box and waits (#414): nothing goes until Send or Enter, however long a
  // pause. A second click on the mic ends listening, without sending.
  el.listen = () => {
    if (el.classList.contains('listen')) { stopListen(); box.focus(); return; }
    box.focus(); box.setSelectionRange(box.value.length, box.value.length);
    el.classList.add('listen');
    hint.replaceChildren('Listening. Press Send when you are done.');
    voiceInto(box);
  };
  // Design A (#1521): the ask as a bold headline (or Haiku's plain summary of the card), options
  // as chips that fill the answer box, files and proof as small chips, the rest under details.
  const v = cardView(t, ask), md = sums.get(summaryKey(project, t));
  const fill = text => { box.value = text; box.focus(); box.setSelectionRange(text.length, text.length); };
  const chip = (label, text, sugd) => h('button', { class: 'wcopt' + (sugd ? ' sug' : ''), title: sugd ? 'Suggested. Puts it in the answer box' : 'Puts it in the answer box', onclick: () => fill(text) },
    label, sugd ? h('small', {}, '★ suggested') : null);
  const opts = v.options.length ? h('div', { class: 'wcopts' }, v.options.map(o => chip(o.key ? `${o.key}) ${o.text}` : o.text, o.key ? `${o.key}: ${o.text}` : o.text, o.suggested)))
    : v.suggestion ? h('div', { class: 'wcopts' }, chip(`Go with: ${v.suggestion}`, `go with the suggestion: ${v.suggestion}`, true)) : null;
  const proof = [v.tests ? h('span', { class: 'wcbadge' + (/^pass/i.test(v.tests) ? ' pass' : /^fail/i.test(v.tests) ? ' fail' : '') }, `tests ${v.tests}`) : null,
    ...v.commits.map(c => h('span', { class: 'wcbadge', title: 'Commit' }, c))].filter(Boolean);
  const detail = [md ? linked('p', 'wcsub', v.headline) : null, v.context ? linked('p', 'wcsub', v.context) : null,
    ...v.groups.map(g => h('div', { class: 'wcgroup' }, g.label ? h('b', {}, g.label) : null, h('ul', {}, g.items.map(i => linked('li', '', i)))))].filter(Boolean);
  const more = detail.length ? h('details', { class: 'wcdetails' }, h('summary', {}, 'details'), detail) : null;
  add(head, linked('div', 'wctitle', t.text),
    md ? h('div', { class: 'wcsum' }, mdView(h, md)) : linked('div', 'wchead', v.headline),
    v.words ? h('div', { class: 'wcwords', title: 'The exact words the lead needs typed in its pane' }, v.words) : null,
    opts, v.why ? h('p', { class: 'wcwhy' }, `★ ${v.why}`) : null,
    links || proof.length ? h('div', { class: 'wcchips' }, links, ...proof) : null, more,
    h('div', { class: 'tdtalk' }, box,
      h('button', { class: 'mic', title: `Talk: ${VOICE_NAME} writes here, then press Send`, onclick: () => el.listen() }, icon('mic')),
      h('button', { class: 'btn primary', title: 'Send to the CTO (Enter)', onclick: () => say(box.value) }, 'Send')),
    shots.strip, hint);
  return el;
}
