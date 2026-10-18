// Back and forward (#301): each step is the whole view of a moment (the page, tabs and split,
// the opened item, VS Code beside a lead, the filters and every scrolled list), restored as it
// was. The mouse's side buttons and Alt+Left / Alt+Right step through them. A step is added on
// a page or tab switch or an item opened or closed; scrolling and filters update the step.
import { navHistory } from '../lib/navhistory.js';
import { openCard, closeTask } from './task-detail.js';
import * as C from './code.js';
import { meView, setMeView } from './me.js';

const hist = navHistory(keyOf);
let S = null, restoring = 0, gen = 0, timer = null, presses = 0; // restoring: the step coming back now, 0 when none

function keyOf(s) {
  return [s.view, s.view === 'single' ? s.single : '', s.view === 'split' ? s.splitSet.join(',') : '', s.ctx || '',
    s.view === 'project' ? s.currentProject : '', s.view === 'home' ? s.boardFocus || '' : '', s.task ? `${s.task.project}#${s.task.n}` : ''].join('|');
}
const shownOf = s => (s.view === 'single' ? [s.single] : s.view === 'split' ? s.splitSet : []);

// Each scrolled element under the page, by a path of tag, first class and place among its like.
function pathOf(el, root) {
  const parts = [];
  for (let e = el; e && e !== root; e = e.parentElement) {
    const cls = e.classList[0] || '', like = [...(e.parentElement?.children || [])].filter(x => x.tagName === e.tagName && (x.classList[0] || '') === cls);
    parts.unshift(`${e.tagName}.${cls}:${like.indexOf(e)}`);
  }
  return parts.join('>');
}
function scrollsOf() {
  const root = document.getElementById('home');
  if (!root || root.style.display === 'none') return [];
  return [root, ...root.querySelectorAll('*')].filter(e => e.scrollTop || e.scrollLeft).map(e => [pathOf(e, root), e.scrollTop, e.scrollLeft]);
}
function applyScrolls(list) {
  const root = document.getElementById('home'), all = [root, ...root.querySelectorAll('*')];
  for (const [p, top, left] of list) {
    const e = all.find(x => pathOf(x, root) === p);
    if (e) { e.scrollTop = top; e.scrollLeft = left; }
  }
}

function snapshot() {
  const s = S.get(), shown = shownOf(s);
  return { ...s, task: openCard(), code: shown.filter(n => C.isOpen(n)), me: meView(), scrolls: scrollsOf() };
}

// The view now, a moment after whatever changed it.
export function noteView() { if (S && !restoring) hist.note(snapshot()); }
export const noteSoon = () => { clearTimeout(timer); timer = setTimeout(noteView, 150); };

async function restore(s) {
  const run = restoring = ++gen;
  for (const n of shownOf(s)) {
    if (s.code.includes(n) && !C.isOpen(n)) C.openCode(n, S.deck, S.render);
    else if (!s.code.includes(n) && C.isOpen(n)) C.closeCode(n);
  }
  setMeView(s.me);
  S.set(s);
  const t = s.task && S.tasksOf(s.task.project).find(x => x.n === s.task.n);
  if (t) { const o = openCard(); if (!o || o.project !== s.task.project || o.n !== s.task.n) S.showTask(s.task.project, t); } else closeTask();
  // A project page fills in after it loads, so its lists are scrolled again once it has.
  for (const wait of [0, 400, 1200]) {
    await new Promise(r => setTimeout(r, wait));
    if (run !== restoring) return;
    applyScrolls(s.scrolls);
  }
  restoring = 0;
  noteView();
}

// One step back (-1) or forward (1); a step showing a tab closed since is skipped.
export function go(dir) {
  if (!S) return false;
  if (!restoring) noteView();
  restoring = 0;
  const step = dir < 0 ? hist.back(s => shownOf(s).every(S.isOpenTab)) : hist.forward(s => shownOf(s).every(S.isOpenTab));
  if (step) restore(step);
  return !!step;
}
export const navKey = e => e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight');

// s: { get, set, render, deck, tasksOf, showTask, isOpenTab } from app.js.
export function startNav(s) {
  S = s;
  addEventListener('keydown', e => {
    if (!navKey(e)) return;
    e.preventDefault(); e.stopPropagation();
    go(e.key === 'ArrowLeft' ? -1 : 1);
  }, true);
  // The side buttons (#322) reach the page as mouse buttons 3 and 4, and Windows' back and
  // forward app command seldom follows. Caught first, so a terminal pane never gets them; the
  // pointer's release steps, as a stopped press sends no mouseup. An app command just after
  // the same press is not a second step.
  let pressed = 0;
  for (const ev of ['mousedown', 'mouseup', 'auxclick', 'pointerdown', 'pointerup']) addEventListener(ev, e => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault(); e.stopImmediatePropagation();
    presses++;
    if (ev === 'pointerup') { pressed = Date.now(); go(e.button === 3 ? -1 : 1); }
  }, true);
  S.deck.onNavGo(dir => { if (Date.now() - pressed > 500) go(dir); });
  for (const ev of ['click', 'change', 'input', 'keyup', 'scroll']) document.addEventListener(ev, noteSoon, true);
  // The owner's own scroll or click while a step comes back keeps what they did.
  for (const ev of ['wheel', 'mousedown']) document.addEventListener(ev, e => { if (e.button !== 3 && e.button !== 4) restoring = 0; }, true);
}
export const navForSmoke = () => ({ hist, go, snapshot, get presses() { return presses; } });
