// DOM helpers shared by the renderer: build elements without innerHTML, draw icons, show toasts.
export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e[k] = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) { if (k == null || k === false) continue; e.append(k instanceof Node ? k : document.createTextNode(String(k))); }
  return e;
}
const ICONS = {
  clock: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z', sun: 'M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8M12 8a4 4 0 100 8 4 4 0 000-8z', moon: 'M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z', repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 01-4 4H4',
  home: 'M4 11l8-7 8 7M6 9.5V20h12V9.5', plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M18 6L6 18',
  sidebar: 'M4 5h16v14H4zM10 5v14', groups: 'M12 4l8 4-8 4-8-4 8-4zM4 12l8 4 8-4M4 16l8 4 8-4', compact: 'M4 7h16M4 12h16M4 17h16',
  max: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', restore: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5', top: 'M5 4h14M12 20V9M7 13l5-5 5 5', layout: 'M4 5h16v14H4zM12 5v14M12 12h8',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14', gear: 'M12 9a3 3 0 100 6 3 3 0 000-6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1', popout: 'M14 4h6v6M20 4l-8 8M18 14v5H5V6h5', fold: 'M6 15l6-6 6 6', unfold: 'M6 9l6 6 6-6', foldside: 'M15 6l-6 6 6 6', unfoldside: 'M9 6l6 6-6 6', mic: 'M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM5 11a7 7 0 0014 0M12 18v3', board: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  download: 'M12 4v11M7 10l5 5 5-5M4 19h16', pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z', lastprompt: 'M9 10l-5 5 5 5M20 4v7a4 4 0 01-4 4H4',
  search: 'M10.5 4a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM20 20l-4.8-4.8', eye: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 9.2a2.8 2.8 0 100 5.6 2.8 2.8 0 000-5.6z', up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6',
  play: 'M7 5l12 7-12 7z', doc: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6', folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  dot: 'M12 6.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11z', plug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 01-12 0zM12 17v4',
  spark: 'M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9zM18.5 14l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z',
  // The Board's filter button, sort direction, column icons and column fold (#403, #404, #410).
  filter: 'M4 6h16M7 12h10M10 18h4', arrowdown: 'M12 5v14M6 13l6 6 6-6', arrowup: 'M12 19V5M6 11l6-6 6 6',
  alert: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8v5M12 16h.01', send: 'M4 12l16-8-6 16-2-7z', progress: 'M12 3a9 9 0 109 9', check: 'M5 12l5 5 9-10',
  colfold: 'M4 5v14M20 12H9M13 8l-4 4 4 4', colopen: 'M20 5v14M4 12h11M11 8l4 4-4 4',
  camera: 'M3 7h12v10H3zM15 10.5l6-3.5v10l-6-3.5', trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
};
export function icon(name) {
  const ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'i');
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', ICONS[name]); s.append(p); return s;
}
// action { label, run, later }: a button on the toast, which then stays until it is clicked or
// closed; later names the close button (× by default).
export function toast(msg, err, action) {
  const t = h('div', { class: 'toast' + (err ? ' err' : '') }, msg);
  if (action) {
    t.append(h('button', { class: 'toastbtn', onclick: () => { t.remove(); action.run(); } }, action.label),
      h('button', { class: 'toastbtn', title: 'Close', onclick: () => t.remove() }, action.later || '×'));
  }
  document.getElementById('toasts').append(t);
  if (!action) setTimeout(() => t.remove(), err ? 6000 : 2600);
}
