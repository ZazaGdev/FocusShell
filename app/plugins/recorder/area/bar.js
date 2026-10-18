// The recorder's floating bar while recording (#376): a red dot, the time so far, whether the mic
// is on, and Stop on the top row; the drawing tools below it (#1021), so aiming for one never
// lands on Stop: the pen, the rectangle, circle and arrow (#1022), and Clear (#380). Dragging the
// dot or the time moves it.
'use strict';
(async () => {
  const init = (await window.recwin.init()) || {};
  const at = init.startedAt || Date.now();
  const bar = document.getElementById('bar');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
  const SVG = 'http://www.w3.org/2000/svg';
  const icon = (...shapes) => {
    const s = document.createElementNS(SVG, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    for (const [tag, attrs] of shapes) {
      const n = document.createElementNS(SVG, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      s.append(n);
    }
    return s;
  };
  const time = el('span', 'time', '0:00');
  const grip = el('span', 'grip');
  grip.append(el('span', 'dot'), time);
  const stop = el('button', 'tbtn stop', 'Stop');
  stop.title = 'Stop recording (Ctrl+Alt+R)';
  stop.addEventListener('click', () => { stop.disabled = true; window.recwin.send('stop'); });
  const top = el('div', 'barrow');
  top.append(grip, el('span', 'mic' + (init.mic === false ? ' off' : ''), init.mic === false ? 'Mic off' : 'Mic on'), stop);

  const key = init.penKey ? ` (${init.penKey.replace(/Control/, 'Ctrl')} turns drawing on and off)` : '';
  const TOOLS = [
    ['pen', 'Pen', `Draw freehand on the recording${key}`, null],
    ['rect', '', 'Rectangle: drag to draw one', icon(['rect', { x: 4, y: 6, width: 16, height: 12, rx: 1 }])],
    ['circle', '', 'Circle: drag to draw one', icon(['ellipse', { cx: 12, cy: 12, rx: 8, ry: 7 }])],
    ['arrow', '', 'Arrow: drag from its tail to its tip', icon(['path', { d: 'M5 19L19 5M10 5h9v9' }])],
  ];
  const btns = new Map();
  const tools = el('div', 'barrow tools2');
  for (const [id, text, tip, svg] of TOOLS) {
    const b = el('button', 'tbtn pentgl' + (svg ? ' ico' : ''), text);
    if (svg) { b.append(svg); b.setAttribute('aria-label', tip.split(':')[0]); }
    b.title = tip;
    b.addEventListener('click', () => window.recwin.send('tool', id));
    btns.set(id, b);
    tools.append(b);
  }
  const clear = el('button', 'tbtn', 'Clear');
  clear.title = 'Clear the drawing (or right-click on it)';
  clear.addEventListener('click', () => window.recwin.send('clear'));
  tools.append(clear);
  bar.append(top, tools);

  // The tool in use lights up while drawing is on.
  window.recwin.onState(s => {
    if (!s || !('pen' in s)) return;
    for (const [id, b] of btns) b.classList.toggle('on', !!s.pen && (s.tool || 'pen') === id);
  });
  const tick = () => {
    const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
    time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  tick();
  setInterval(tick, 500);
})();
