// The first-run setup's illustrations (#1061): small line drawings in the theme's colours, built
// with DOM methods (no markup strings). art(name) returns a <div class="art"> holding one.
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const k of kids) e.append(k);
  return e;
};
const box = (x, y, w, hgt, fill = 'var(--surface2)', r = 4) => el('rect', { x, y, width: w, height: hgt, rx: r, fill, stroke: 'var(--line2)' });
const bar = (x, y, w, hgt, fill, opacity = 1) => el('rect', { x, y, width: w, height: hgt, rx: 2, fill, opacity });
const tick = d => el('path', { d, stroke: 'var(--accent-ink)', 'stroke-width': 2, fill: 'none' });

const DRAW = {
  // The app: a CTO pane handing work to the Board's columns.
  welcome: () => [box(20, 14, 200, 82, 'var(--surface)', 8), box(30, 36, 54, 50, 'var(--pane)'),
    el('text', { x: 36, y: 48, 'font-size': 7, fill: 'var(--accent)', 'font-family': 'monospace' }, 'CTO'),
    bar(36, 54, 36, 3, 'var(--muted)'), bar(36, 61, 28, 3, 'var(--muted)'),
    box(94, 36, 36, 50), box(136, 36, 36, 50), box(178, 36, 32, 50),
    bar(99, 44, 26, 8, 'var(--accent)', 0.75), bar(141, 44, 26, 8, 'var(--accent)', 0.75), bar(141, 56, 26, 8, 'var(--ok)', 0.75), bar(183, 44, 22, 8, 'var(--warn)', 0.75),
    el('path', { d: 'M84 60 C 90 60, 90 48, 99 48', stroke: 'var(--accent)', 'stroke-width': 1.5, fill: 'none', 'stroke-dasharray': '3 3' })],
  // Several folders picked together, each ticked.
  connect: () => [
    el('path', { d: 'M30 40 h22 l6 6 h32 v40 h-60z', fill: 'var(--surface2)', stroke: 'var(--line2)' }),
    el('path', { d: 'M100 30 h22 l6 6 h32 v40 h-60z', fill: 'var(--surface2)', stroke: 'var(--line2)' }),
    el('path', { d: 'M170 40 h22 l6 6 h22 v40 h-50z', fill: 'var(--surface2)', stroke: 'var(--line2)' }),
    el('circle', { cx: 82, cy: 78, r: 7, fill: 'var(--accent)' }), el('circle', { cx: 152, cy: 68, r: 7, fill: 'var(--accent)' }), el('circle', { cx: 212, cy: 78, r: 7, fill: 'var(--accent)' }),
    tick('M79 78 l2 2 4-4'), tick('M149 68 l2 2 4-4'), tick('M209 78 l2 2 4-4')],
  // A terminal running claude, with a green check.
  check: () => [box(50, 18, 140, 74, 'var(--pane)', 8),
    el('text', { x: 62, y: 40, 'font-size': 9, fill: 'var(--accent)', 'font-family': 'monospace' }, '> claude'),
    bar(62, 50, 70, 4, 'var(--muted)'), bar(62, 60, 50, 4, 'var(--muted)'),
    el('circle', { cx: 168, cy: 72, r: 12, fill: 'var(--ok)' }), el('path', { d: 'M162 72 l4 4 8-8', stroke: 'var(--pane)', 'stroke-width': 2.5, fill: 'none' })],
  // The Board filling up.
  ready: () => [box(40, 22, 44, 66, 'var(--surface2)', 5), box(98, 22, 44, 66, 'var(--surface2)', 5), box(156, 22, 44, 66, 'var(--surface2)', 5),
    bar(46, 30, 32, 10, 'var(--accent)', 0.7), bar(46, 44, 32, 10, 'var(--accent)', 0.4), bar(104, 30, 32, 10, 'var(--warn)', 0.8),
    bar(162, 30, 32, 10, 'var(--ok)', 0.8), bar(162, 44, 32, 10, 'var(--ok)', 0.5),
    el('path', { d: 'M200 16 l4 -8 M208 22 l8 -4 M206 30 l9 2', stroke: 'var(--accent)', 'stroke-width': 2, 'stroke-linecap': 'round' })],
};

export function art(name) {
  const d = document.createElement('div');
  d.className = 'art';
  d.append(el('svg', { viewBox: '0 0 240 110', 'aria-hidden': 'true' }, ...(DRAW[name] || DRAW.welcome)()));
  return d;
}
