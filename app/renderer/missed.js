// Maybe missed (#367): a quiet button beside "Waiting on you" above each CTO pane, counting the
// questions and results in the CTO's replies the owner seems to have skipped. It opens a board
// laid out like the whiteboard, one card per item with why it was flagged. A card answers the
// CTO (ANSWER <Project> #<n> when the item names one), or is marked "Seen, not needed" or put
// off for two hours with "Later". Nothing on Waiting on you is ever shown here.
import { visibleItems, waitingItems } from '../lib/missed.js';
import { linkedText } from './textlinks.js';
import { parseTasks, parseAsk } from '../lib/tasks.js';
import { voiceInto, voiceDone } from './voice.js';
import { tldr, gist, askOf } from '../lib/tldr.js';
import { tldrFold } from './whiteboard.js';

// The title of the task an item names, for its TLDR line (#1000).
const titleOf = it => (it.project && it.n ? (parseTasks((ctxOf.tasksMd() || {})[it.project] || '').find(t => t.n === it.n) || {}).text : null) || null;

const lists = new Map(); // CTO id -> the cards it shows now
let modal = null, cur = null, ctxOf = null;

// c: { h, icon, deck, toast, openMd, tasksMd(), prompts(mgr), mgrName(mgr), talk(project, n, text), tell(mgr, line),
//      ctos() -> the CTO sessions running, onChange() -> redraw the page (the Board's column) }
export function setupMissed(c) { ctxOf = c; }
export const missedCount = id => (lists.get(id) || []).length;
// Every CTO's cards, for the Board's Maybe missed column: [{ ...item, mgr }].
export const allMissed = () => [...lists].flatMap(([mgr, list]) => list.map(it => ({ ...it, mgr })));
const boardTyping = () => [...document.querySelectorAll('.bcol .wbcard.miss')].some(c => c.classList.contains('listen') || [...c.querySelectorAll('textarea')].some(b => b.value.trim()));
export const missedOpen = () => !!modal;
export function closeMissed() { if (modal) { modal.remove(); modal = null; cur = null; } }

export function missedButton(id) {
  const { h, icon } = ctxOf, n = missedCount(id);
  return h('button', { class: 'wbbtn missbtn' + (n ? '' : ' zero'), 'data-miss': id, title: 'Maybe missed: questions and results in the CTO\'s replies you may have skipped', onclick: () => openMissed(id) },
    icon('eye'), h('span', {}, 'Missed'), h('b', {}, String(n)));
}

// Checks every CTO pane on screen again: its log, then what is already on Waiting on you.
let checking = null;
export function refreshMissed() {
  if (!ctxOf) return Promise.resolve();
  if (!checking) checking = check().finally(() => { checking = null; });
  return checking;
}
async function check() {
  const ids = [...new Set([...ctxOf.ctos(), ...[...document.querySelectorAll('.missbtn')].map(b => b.dataset.miss)])];
  const was = allMissed().map(x => x.key).join();
  for (const id of [...lists.keys()]) if (!ids.includes(id)) lists.delete(id);
  for (const id of ids) {
    let r;
    try { r = await ctxOf.deck.missedList(id); } catch { continue; }
    const tasksMd = ctxOf.tasksMd();
    const prompts = ctxOf.prompts(id).map(w => ({ project: w.project, question: [w.what, w.prompt && w.prompt.question, w.words && JSON.stringify(w.words)].filter(Boolean).join(' ') }));
    lists.set(id, visibleItems(r.items || [], { state: r.state || {}, tasksMd, waiting: waitingItems(tasksMd, prompts) }));
  }
  counts();
  if (modal && !typing()) draw();
  if (allMissed().map(x => x.key).join() !== was && !boardTyping()) ctxOf.onChange();
}
function counts() {
  document.querySelectorAll('.missbtn').forEach(b => { const n = missedCount(b.dataset.miss); b.lastChild.textContent = String(n); b.classList.toggle('zero', !n); });
}

const typing = () => !!modal && (!!modal.querySelector('.wbcard.listen') || [...modal.querySelectorAll('textarea')].some(b => b.value.trim()));

export function openMissed(id) {
  closeMissed();
  cur = id;
  const { h } = ctxOf;
  modal = h('div', { class: 'wbshade', onpointerdown: e => { if (e.target === modal && !typing()) closeMissed(); } });
  document.body.append(modal);
  draw();
}

addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !modal || modal.querySelector('.wbcard.listen')) return;
  e.preventDefault(); closeMissed();
}, true);

function draw() {
  const { h, icon } = ctxOf, items = lists.get(cur) || [];
  const groups = new Map();
  for (const it of items) { const p = it.project || 'Other'; if (!groups.has(p)) groups.set(p, []); groups.get(p).push(it); }
  const body = items.length
    ? h('div', { class: 'wbcols' }, [...groups].map(([p, list]) => h('section', { class: 'wbproj' },
      h('h3', {}, p, h('span', {}, String(list.length))), list.map(it => missedCard(it, cur, draw)))))
    : h('div', { class: 'wbempty' }, 'Nothing looks missed.');
  modal.replaceChildren(h('div', { class: 'wbox missbox', role: 'dialog', 'aria-label': 'Maybe missed' },
    h('header', {}, h('h2', {}, 'Maybe missed', h('span', { class: 'wbn' }, String(items.length))), h('span', { class: 'wbfor' }, ctxOf.mgrName(cur)),
      items.length ? h('button', { class: 'btn msseenall', title: 'Mark every card "Seen, not needed"', onclick: () => seenAll(cur) }, icon('check'), 'Seen all') : null,
      h('button', { class: 'btn ghost', title: 'Close (Esc)', onclick: closeMissed }, icon('x'))),
    h('div', { class: 'wbbody' }, body)));
}

// Seen all (#1033): every card of this CTO, as "Seen, not needed" on each would.
async function seenAll(mgr) {
  const list = lists.get(mgr) || [];
  for (const it of list) await ctxOf.deck.missedMark(it.key, 'seen');
  lists.set(mgr, []);
  counts();
  ctxOf.toast(`Cleared ${list.length} ${list.length === 1 ? 'card' : 'cards'}: they will not come back`);
  if (modal) draw();
  ctxOf.onChange();
}

const ago = t => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

// One card, on the board above a CTO pane or in the Board's column; after() redraws its place.
export function missedCard(it, mgr, after) {
  const { h, icon, deck, toast, openMd } = ctxOf;
  const el = h('article', { class: 'wbcard miss', 'data-key': it.key });
  const linked = (cls, text) => linkedText('div', { class: cls }, text, { openFile: openMd, toast });
  const mark = async (how, note) => {
    await deck.missedMark(it.key, how);
    lists.set(mgr, (lists.get(mgr) || []).filter(x => x.key !== it.key));
    counts();
    if (note) toast(note);
    after();
  };
  const hint = h('div', { class: 'wblisten' });
  const stopListen = () => { if (el.classList.contains('listen')) voiceDone(); el.classList.remove('listen'); hint.replaceChildren(); };
  const say = async text => {
    const s = String(text).replace(/\s+/g, ' ').trim();
    stopListen();
    if (!s) return;
    const short = it.text.length > 80 ? it.text.slice(0, 77) + '...' : it.text;
    const ok = it.project && it.n ? ctxOf.talk(it.project, it.n, s) : await ctxOf.tell(mgr, `About your earlier "${short}": ${s}`);
    if (ok === false) return;
    mark('answered');
  };
  const box = h('textarea', { class: 'tdsay', rows: 2, placeholder: 'Answer…', onkeydown: e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); say(box.value); }
  } });
  // Dictation fills the box and waits for Send or Enter (#414); a second mic click ends listening.
  el.listen = () => {
    if (el.classList.contains('listen')) { stopListen(); box.focus(); return; }
    box.focus();
    el.classList.add('listen');
    hint.replaceChildren('Listening. Press Send when you are done.');
    voiceInto(box);
  };
  const [before, hit, next] = it.ctx || [];
  // At a glance (#1033): a three or four line summary of the item, then its options and the suggestion as
  // chips; a chip answers with that option.
  // A summary longer than the TLDR's ask replaces it, so the question is not shown twice.
  let line = tldr({ project: it.project, n: it.n, title: titleOf(it), ask: it.text });
  const ask = parseAsk(String(it.text || '').replace(/^\s*needs you\b[^:|]{0,30}[:|]\s*/i, ''));
  const short = gist(ask.question);
  let summary = null;
  if (short && short !== askOf(it.text)) {
    const head = it.project && it.n && titleOf(it) ? tldr({ project: it.project, n: it.n, title: titleOf(it), ask: '' }) : '';
    if (head) { line = head; summary = linked('msgist', short); } else line = short;
  }
  const sug = ask.suggest;
  const chips = ask.options.length || sug ? h('div', { class: 'mschips' },
    ask.options.map(o => {
      const isSug = !!sug && (o.key ? sug.toLowerCase().startsWith(o.key) : sug.toLowerCase() === o.text.toLowerCase());
      return h('button', { class: 'mschip' + (isSug ? ' sug' : ''), title: 'Answer with this option', onclick: () => say(o.key ? `${o.key}: ${o.text}` : o.text) },
        o.key ? h('b', {}, o.key) : null, o.text);
    }),
    sug ? h('button', { class: 'mschip sugline', title: 'Go with the suggestion', onclick: () => say(`go with the suggestion: ${sug}`) }, h('b', {}, 'Suggests'), sug) : null) : null;
  el.append(
    h('div', { class: 'wbmeta' }, h('span', { class: 'wbid' }, it.n ? `${it.project ? it.project + ' ' : ''}#${it.n}` : it.kind === 'result' ? 'Result' : 'Question'), h('span', {}, `from the ${ctxOf.mgrName(mgr)}, ${ago(it.at)}`)),
    // The TLDR first (#1000); the full text, Why and the quote behind "more".
    // Its web links and paths open on a click (#1045).
    ...tldrFold(h, linkedText('span', {}, line, { openFile: openMd, toast }), [linked('wbtitle', it.text),
      h('div', { class: 'mswhy' }, h('b', {}, 'Why: '), it.why.join('; ') + '.'),
      h('div', { class: 'msctx' }, before ? h('div', {}, before) : null, h('mark', {}, hit), next ? h('div', {}, next) : null)]),
    ...[summary, chips].filter(Boolean),
    h('div', { class: 'tdtalk' }, box,
      h('button', { class: 'mic', title: 'Talk: Windows voice typing writes here, then press Send', onclick: () => el.listen() }, icon('mic')),
      h('button', { class: 'btn primary', title: 'Send to the CTO (Enter)', onclick: () => say(box.value) }, 'Send')),
    hint,
    h('div', { class: 'msacts' },
      h('button', { class: 'btn', onclick: () => mark('seen', 'Cleared: it will not come back') }, 'Seen, not needed'),
      h('button', { class: 'btn', onclick: () => mark('later', 'Hidden for 2 hours') }, 'Later')));
  return el;
}
