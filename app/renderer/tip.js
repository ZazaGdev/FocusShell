// The app's one tooltip (#1035): a small inverted label with an arrow, shown DELAY (2 s, #2987)
// after the pointer rests on an element with data-tip, or after keyboard focus lands on it. h()
// turns every title into data-tip; an element given a plain title some other way is converted
// the moment it is hovered or focused, so the browser's own tooltip never shows. The Sketch
// board (Excalidraw) keeps its own titles. lib/tip.js has the placement rules.
import { DELAY, GAP, splitTip, placeTip } from '../lib/tip.js';

let el = null, timer = null, over = null, watch = null;

// A plain title becomes data-tip, and names the element for screen readers when it has no text.
export function adoptTitle(node) {
  const t = node.getAttribute('title');
  node.removeAttribute('title');
  if (!t) return;
  node.dataset.tip = t;
  if (!node.hasAttribute('aria-label') && !node.textContent.trim()) node.setAttribute('aria-label', t);
}
function targetOf(node) {
  if (!node || !node.closest) return null;
  const t = node.closest('[data-tip],[title]');
  if (!t || t.closest('.excalidraw')) return null;
  if (t.hasAttribute('title')) adoptTitle(t);
  return t.dataset.tip ? t : null;
}

function hide() {
  clearTimeout(timer); timer = null;
  if (watch) watch.disconnect(); watch = null;
  if (el) el.remove();
  el = null; over = null;
}
function fill(target) {
  const { label, key } = splitTip(target.dataset.tip);
  el.replaceChildren(label);
  if (key) { const k = document.createElement('kbd'); k.textContent = key; el.append(k); }
  const a = document.createElement('span'); a.className = 'qtip-arr'; el.append(a);
  const r = target.getBoundingClientRect();
  const p = placeTip(r, { w: el.offsetWidth, h: el.offsetHeight }, { w: innerWidth, h: innerHeight }, GAP);
  el.classList.toggle('below', p.below); el.classList.toggle('above', !p.below);
  el.style.left = `${p.left}px`; el.style.top = `${p.top}px`;
  a.style.left = `${p.arrow}px`;
}
function show(target) {
  timer = null;
  if (!target.isConnected || !target.dataset.tip) { over = null; return; }
  el = document.createElement('div');
  el.className = 'qtip';
  el.setAttribute('role', 'tooltip');
  document.body.append(el);
  fill(target);
  requestAnimationFrame(() => el && el.classList.add('on'));
  // A label that changes while it is shown (a status dot, a toggled button) updates in place.
  watch = new MutationObserver(() => {
    if (target.hasAttribute('title')) adoptTitle(target);
    if (!target.isConnected || !target.dataset.tip) hide(); else if (el) fill(target);
  });
  watch.observe(target, { attributes: true, attributeFilter: ['data-tip', 'title'] });
}
function arm(target) {
  if (target === over) return;
  hide();
  over = target;
  // Always DELAY, even right after another tip (#2987); data-tip-delay (ms) can only lengthen it.
  timer = setTimeout(() => show(target), Math.max(DELAY, Number(target.dataset.tipDelay) || 0));
}

document.addEventListener('mouseover', e => {
  const t = targetOf(e.target);
  if (t) arm(t);
  else if (over && !over.contains(e.target)) hide();
});
document.addEventListener('focusin', e => {
  const t = targetOf(e.target);
  if (t && e.target.matches(':focus-visible')) arm(t);
});
document.addEventListener('focusout', () => { if (over && !over.matches(':hover')) hide(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && el) hide(); }, true);
document.addEventListener('pointerdown', hide, true);
document.addEventListener('wheel', hide, { passive: true, capture: true });
addEventListener('scroll', hide, true);
addEventListener('blur', hide);
