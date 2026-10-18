// Layout pieces with no state of their own: a layout's thumbnail and a draggable divider.
import { h } from './dom.js';

export function miniTree(node) {
  if (node === 'M') return h('i', { class: 'm' });
  if (typeof node === 'number') return h('i');
  const [dir, kids] = node;
  const d = h('div', { style: `display:grid;gap:3px;height:100%;${dir === 'h' ? 'grid-template-columns' : 'grid-template-rows'}:${kids.map(([, f]) => f + 'fr').join(' ')}` });
  kids.forEach(([c]) => d.append(miniTree(c)));
  return d;
}
// While a divider is dragged, a clear cover lies over the window, VS Code's page included,
// or that page would take the moves and the release and leave the divider stuck (#189).
export function dragGutter(g, dir, onDone) {
  g.onmousedown = e => {
    e.preventDefault(); g.classList.add('drag');
    const shield = h('div', { class: 'dragshield', style: `cursor:${dir === 'h' ? 'col-resize' : 'row-resize'}` });
    document.body.append(shield);
    const a = g.previousElementSibling, b = g.nextElementSibling, horiz = dir === 'h';
    const size = el => { const r = el.getBoundingClientRect(); return horiz ? r.width : r.height; };
    // Every open cell in this split switches to its current size in pixels, so moving one
    // divider only trades space between its two neighbours and never squashes the others.
    const cells = [...g.parentElement.children].filter(c => c.classList.contains('cell') && !/folded-/.test(c.className));
    const sizes = cells.map(size);
    cells.forEach((c, i) => { c.style.flex = `${sizes[i]} 1 0`; });
    const start = horiz ? e.clientX : e.clientY, sa = size(a), sb = size(b), MIN = 120;
    const move = ev => {
      const d = Math.min(Math.max((horiz ? ev.clientX : ev.clientY) - start, MIN - sa), sb - MIN);
      if (cells.includes(a)) a.style.flex = `${sa + d} 1 0`;
      if (cells.includes(b)) b.style.flex = `${sb - d} 1 0`;
    };
    document.body.style.cursor = horiz ? 'col-resize' : 'row-resize';
    const up = () => {
      g.classList.remove('drag'); shield.remove(); document.body.style.cursor = '';
      removeEventListener('mousemove', move); removeEventListener('mouseup', up);
      if (onDone) onDone();
    };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  };
}
