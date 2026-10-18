// The recorder's overlay (#376): drag a rectangle over the dimmed display, toggle the mic, press
// Record (or Enter). Esc, Cancel or a click outside the bar with no drag closes it.
'use strict';
(async () => {
  const MIN = 32;
  const init = (await window.recwin.init()) || {};
  let mic = init.mic !== false, rect = null, from = null;
  const sel = document.getElementById('sel'), tools = document.getElementById('tools');

  const el = (tag, props, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v != null) n.setAttribute(k, v);
    }
    n.append(...kids);
    return n;
  };
  const SVG = 'http://www.w3.org/2000/svg';
  const micIcon = on => {
    const s = document.createElementNS(SVG, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    for (const d of ['M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z', 'M19 11a7 7 0 0 1-14 0', 'M12 18v3'].concat(on ? [] : ['M4 4l16 16'])) {
      const p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', d);
      s.append(p);
    }
    return s;
  };

  const micBtn = el('button', { class: 'tbtn', onclick: () => { mic = !mic; paint(); } });
  const recBtn = el('button', { class: 'tbtn rec', onclick: () => record() }, el('span', { class: 'dot' }), 'Record');
  const cancelBtn = el('button', { class: 'tbtn', title: 'Cancel (Esc)', onclick: () => window.recwin.send('cancel') }, 'Cancel');
  tools.append(micBtn, recBtn, cancelBtn);

  function paint() {
    micBtn.replaceChildren(micIcon(mic), mic ? 'Mic on' : 'Mic off');
    micBtn.classList.toggle('off', !mic);
    micBtn.title = mic ? 'Your voice is recorded. Click to record without it' : 'No sound is recorded. Click to record your voice';
    recBtn.disabled = !rect;
    document.body.classList.toggle('has', !!rect);
    if (!rect) { sel.hidden = true; return; }
    sel.hidden = false;
    Object.assign(sel.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  }

  const rectOf = (a, b) => ({ x: Math.round(Math.min(a.x, b.x)), y: Math.round(Math.min(a.y, b.y)), width: Math.round(Math.abs(b.x - a.x)), height: Math.round(Math.abs(b.y - a.y)) });
  const record = () => { if (rect) window.recwin.send('record', { rect, mic }); };

  document.addEventListener('mousedown', e => {
    if (e.button !== 0 || tools.contains(e.target)) return;
    from = { x: e.clientX, y: e.clientY };
    rect = null;
    document.body.classList.add('drag');
    paint();
  });
  document.addEventListener('mousemove', e => {
    if (!from) return;
    rect = rectOf(from, { x: e.clientX, y: e.clientY });
    paint();
  });
  document.addEventListener('mouseup', () => {
    if (!from) return;
    from = null;
    document.body.classList.remove('drag');
    if (rect && (rect.width < MIN || rect.height < MIN)) rect = null;
    paint();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') window.recwin.send('cancel');
    else if (e.key === 'Enter') record();
  });
  paint();
})();
