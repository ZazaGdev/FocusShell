// The Home sidebar: the CTO above the PM (side by side when docked at the bottom), with a
// draggable divider; each half folds to its title bar. The sidebar docks left, right or
// bottom, floats over the board, or folds to a thin strip; Settings holds the same choices.
// In the coding view the PM slides over the right edge instead (renderPmDrawer).

const DOCK_ICON = {
  left: 'M4 5h16v14H4zM9 5v14', right: 'M4 5h16v14H4zM15 5v14', bottom: 'M4 5h16v14H4zM4 14h16',
  float: 'M4 5h16v14H4zM11 10h7v6h-7z',
};
const TITLES = { left: 'Dock on the left', right: 'Dock on the right', bottom: 'Dock at the bottom', float: 'Float over the board' };
const STRIP = 30, HEAD = 31;
let floatPos = null; // where a floating sidebar was dragged to, for this run

function svg(d) {
  const ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'i');
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); s.append(p); return s;
}

// c: { h, el, home, show, settings, save, mount, dot, refit,
//      sessions: [{ id, name, sub, fold: 'foldCto' | 'foldPm' }] }
export function renderSide(c) {
  const { h, el, home, settings: s } = c;
  el.sideCtx = c; // the buttons save onto the newest settings, kept or rebuilt
  // Nothing about the sidebar changed: only its status dots are redrawn. Rebuilding it would
  // move the CTO pane in the page, which takes the keyboard away from it for a moment, even
  // in the middle of hold-to-talk (#1003).
  const sig = JSON.stringify([c.show, s.pmDock, s.pmFolded, s.pmSize, s.sideSplit, floatPos, c.sessions.map(x => [x.id, x.name, x.sub || '', !!s[x.fold]])]);
  const mounted = c.sessions.every(x => s[x.fold] || el.querySelector(`[data-pane="${x.id}"]`));
  if (c.show && !s.pmFolded && sig === el.dataset.sig && mounted) {
    for (const x of c.sessions) el.querySelector(`.ph[data-sess="${x.id}"] > .st-dot`)?.replaceWith(c.dot(x.id));
    return;
  }
  el.dataset.sig = sig;
  el.replaceChildren();
  el.className = '';
  home.style.left = home.style.right = home.style.bottom = '';
  if (!c.show) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.style.left = el.style.right = el.style.top = el.style.bottom = el.style.width = el.style.height = '';
  const dock = s.pmDock, folded = s.pmFolded, across = dock === 'bottom';
  el.classList.add('side', 'dock-' + dock);
  if (folded) el.classList.add('folded');
  if (across) el.classList.add('across');
  const size = folded ? STRIP : s.pmSize;
  if (dock === 'left') { el.style.left = '0'; el.style.top = '0'; el.style.bottom = '0'; el.style.width = size + 'px'; home.style.left = size + 'px'; }
  if (dock === 'right') { el.style.right = '0'; el.style.top = '0'; el.style.bottom = '0'; el.style.width = size + 'px'; home.style.right = size + 'px'; }
  if (dock === 'bottom') { el.style.left = '0'; el.style.right = '0'; el.style.bottom = '0'; el.style.height = size + 'px'; home.style.bottom = size + 'px'; }
  if (dock === 'float') {
    if (folded) { el.style.right = '16px'; el.style.bottom = '16px'; }
    else { el.style.width = s.pmSize + 'px'; el.style.height = '70%'; if (floatPos) { el.style.left = floatPos.x + 'px'; el.style.top = floatPos.y + 'px'; } else { el.style.right = '24px'; el.style.bottom = '24px'; } }
  }
  const set = patch => el.sideCtx.save({ ...el.sideCtx.settings, ...patch });

  // Folded whole: one strip naming both sessions; a click opens the sidebar again.
  if (folded) {
    el.append(h('div', { class: 'ph strip', title: 'Show the sidebar', onclick: () => set({ pmFolded: false }) },
      c.sessions.map(x => [c.dot(x.id), h('span', { class: 'pn' }, x.name)])));
    return;
  }

  const docks = h('span', { class: 'docks' },
    Object.keys(DOCK_ICON).map(d => h('button', { class: d === dock ? 'on' : '', title: TITLES[d], onclick: e => { e.stopPropagation(); floatPos = null; set({ pmDock: d }); } }, svg(DOCK_ICON[d]))),
    h('button', { title: 'Fold the sidebar away', onclick: e => { e.stopPropagation(); set({ pmFolded: true }); } }, svg(across ? 'M6 9l6 6 6-6' : dock === 'right' ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6')));
  const both = c.sessions.length > 1 && c.sessions.every(x => !s[x.fold]);
  const halves = c.sessions.map((sess, i) => {
    const shut = s[sess.fold];
    const fold = h('button', { class: 'hfold', title: shut ? `Show the ${sess.name}` : `Fold the ${sess.name}`, onclick: e => { e.stopPropagation(); set({ [sess.fold]: !shut }); } }, svg(shut ? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6'));
    const head = h('div', { class: 'ph', 'data-sess': sess.id, onclick: () => { if (shut) set({ [sess.fold]: false }); } },
      c.dot(sess.id), h('span', { class: 'pn' }, sess.name), sess.sub ? h('span', { class: 'lbl' }, sess.sub) : null,i === 0 ? docks : null, fold);
    const body = h('div', { class: 'body' });
    const share = c.sessions.length === 1 ? 1 : !both ? (shut ? 0 : 1) : i === 0 ? s.sideSplit : 1 - s.sideSplit;
    const half = h('div', { class: 'pane manager sidepane' + (shut ? ' shut' : ''), style: shut ? `flex:0 0 ${HEAD}px` : `flex:${share * 100} 1 0` }, head, body);
    if (!shut) c.mount(sess.id, body);
    // Floating: drag the sidebar by the first title bar.
    if (dock === 'float' && i === 0) head.onmousedown = e => {
      if (e.target.closest('button')) return;
      const r = el.getBoundingClientRect(), box = el.parentElement.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = ev => {
        floatPos = { x: Math.max(0, Math.min(ev.clientX - box.left - dx, box.width - r.width)), y: Math.max(0, Math.min(ev.clientY - box.top - dy, box.height - r.height)) };
        el.style.right = el.style.bottom = 'auto'; el.style.left = floatPos.x + 'px'; el.style.top = floatPos.y + 'px';
      };
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); c.refit(); };
      addEventListener('mousemove', move); addEventListener('mouseup', up);
    };
    return half;
  });
  // The divider between the CTO and the PM; its place is remembered.
  if (both) {
    const div = h('div', { class: 'sdiv' });
    div.onmousedown = e => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      let split = s.sideSplit;
      const move = ev => {
        split = Math.min(0.85, Math.max(0.15, across ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height));
        halves[0].style.flex = `${split * 100} 1 0`; halves[1].style.flex = `${(1 - split) * 100} 1 0`;
        c.refit();
      };
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); set({ sideSplit: split }); };
      addEventListener('mousemove', move); addEventListener('mouseup', up);
    };
    el.append(halves[0], div, halves[1]);
  } else el.append(...halves);

  // Docked: drag the inner edge to resize; the size is remembered.
  if (dock !== 'float') {
    const grip = h('div', { class: 'sgrip' });
    el.append(grip);
    grip.onmousedown = e => {
      e.preventDefault();
      const box = el.parentElement.getBoundingClientRect();
      const sizeAt = ev => dock === 'left' ? ev.clientX - box.left : dock === 'right' ? box.right - ev.clientX : box.bottom - ev.clientY;
      let next = s.pmSize;
      const move = ev => {
        next = Math.min(900, Math.max(240, Math.round(sizeAt(ev))));
        if (dock === 'bottom') { el.style.height = next + 'px'; home.style.bottom = next + 'px'; }
        else { el.style.width = next + 'px'; home.style[dock] = next + 'px'; }
        c.refit();
      };
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); set({ pmSize: next }); };
      addEventListener('mousemove', move); addEventListener('mouseup', up);
    };
  }
}

// Coding view: a pill in the corner, and the PM sliding over the right edge when open.
// c: { h, el, show, open, toggle, mount, dot, label }
export function renderPmDrawer(c) {
  const { h, el } = c;
  el.replaceChildren();
  if (!c.show) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  if (!c.open) {
    el.className = 'pmpill';
    el.append(h('button', { title: 'Show the PM (Ctrl+Shift+P)', onclick: c.toggle }, c.dot('pm'), 'PM', h('kbd', {}, 'Ctrl+Shift+P')));
    return;
  }
  el.className = 'pmdrawer';
  const body = h('div', { class: 'body' });
  el.append(h('div', { class: 'pane manager sidepane' },
    h('div', { class: 'ph' }, c.dot('pm'), h('span', { class: 'pn' }, 'PM'), h('span', { class: 'lbl' }, c.label),
      h('button', { class: 'hclose', title: 'Hide (Escape or Ctrl+Shift+P)', onclick: c.toggle }, svg('M6 6l12 12M18 6L6 18'))),
    body));
  c.mount('pm', body);
}
