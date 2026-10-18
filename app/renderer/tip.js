// Quick tooltips: any element with data-tip shows a small dark label under it after a
// short pause, kept inside the window. Used where a button is an icon only.
const DELAY = 300;
let el = null, timer = null, over = null;

function hide() { clearTimeout(timer); timer = null; over = null; if (el) el.remove(); el = null; }
function show(target) {
  if (!target.isConnected) return;
  el = document.createElement('div');
  el.className = 'qtip';
  el.textContent = target.dataset.tip;
  document.body.append(el);
  const r = target.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  const left = Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2));
  const top = r.bottom + 6 + h > innerHeight ? r.top - h - 6 : r.bottom + 6;
  el.style.left = `${left}px`; el.style.top = `${top}px`;
}
document.addEventListener('mouseover', e => {
  const t = e.target.closest && e.target.closest('[data-tip]');
  if (t === over) return;
  hide();
  if (!t) return;
  over = t; timer = setTimeout(() => show(t), DELAY);
});
document.addEventListener('pointerdown', hide, true);
addEventListener('blur', hide);
