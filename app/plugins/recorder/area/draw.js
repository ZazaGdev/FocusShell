// The recorder's drawing layer (#380): sits exactly over the recorded area and is recorded with
// it. With drawing on, a drag draws with the tool picked on the bar: a thick red freehand line,
// or a rectangle, circle or arrow outline from where the drag starts to where it ends (#1022).
// Everything stays until Clear or a right-click (#1022).
'use strict';
(() => {
  const INK = '#ff2b2b', WIDTH = 5, HEAD = 18;
  const cv = document.getElementById('ink'), g = cv.getContext('2d');
  let pen = false, tool = 'pen', last = null, start = null, under = null;

  // The canvas in device pixels, so the line is sharp; a resize keeps what was drawn.
  function fit() {
    const r = window.devicePixelRatio || 1, w = Math.round(innerWidth * r), h = Math.round(innerHeight * r);
    if (cv.width === w && cv.height === h) return;
    const keep = cv.width && cv.height ? g.getImageData(0, 0, cv.width, cv.height) : null;
    cv.width = w; cv.height = h;
    if (keep) g.putImageData(keep, 0, 0);
  }
  const style = () => {
    const r = window.devicePixelRatio || 1;
    g.strokeStyle = INK; g.lineWidth = WIDTH * r; g.lineCap = 'round'; g.lineJoin = 'round';
    return r;
  };
  function line(a, b) {
    const r = style();
    g.beginPath(); g.moveTo(a.x * r, a.y * r); g.lineTo(b.x * r, b.y * r); g.stroke();
  }
  // A shape from a to b, outlined in the pen's colour.
  function shape(kind, a, b) {
    const r = style();
    const x = Math.min(a.x, b.x) * r, y = Math.min(a.y, b.y) * r, w = Math.abs(b.x - a.x) * r, h = Math.abs(b.y - a.y) * r;
    g.beginPath();
    if (kind === 'rect') g.rect(x, y, w, h);
    else if (kind === 'circle') g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, 2 * Math.PI);
    else if (kind === 'arrow') {
      const ang = Math.atan2(b.y - a.y, b.x - a.x), tip = { x: b.x * r, y: b.y * r }, head = HEAD * r;
      g.moveTo(a.x * r, a.y * r); g.lineTo(tip.x, tip.y);
      for (const s of [-1, 1]) { g.moveTo(tip.x, tip.y); g.lineTo(tip.x - head * Math.cos(ang + s * Math.PI / 6), tip.y - head * Math.sin(ang + s * Math.PI / 6)); }
    }
    g.stroke();
  }
  const clear = () => { g.clearRect(0, 0, cv.width, cv.height); last = start = under = null; };

  document.addEventListener('pointerdown', e => {
    if (!pen) return;
    if (e.button === 2) { clear(); return; }
    if (e.button !== 0) return;
    const p = { x: e.clientX, y: e.clientY };
    if (tool === 'pen') { last = p; line(last, last); }
    else { start = p; under = g.getImageData(0, 0, cv.width, cv.height); }
    cv.setPointerCapture(e.pointerId);
  });
  document.addEventListener('pointermove', e => {
    if (!pen) return;
    const p = { x: e.clientX, y: e.clientY };
    if (last) { line(last, p); last = p; }
    else if (start) { g.putImageData(under, 0, 0); shape(tool, start, p); }
  });
  const up = () => { last = start = under = null; };
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', up);
  document.addEventListener('contextmenu', e => e.preventDefault());

  window.recwin.onState(s => {
    if (!s) return;
    if ('tool' in s) tool = s.tool || 'pen';
    if ('pen' in s) { pen = !!s.pen; document.body.classList.toggle('pen', pen); if (!pen) up(); }
    if (s.clear) clear();
    if (Array.isArray(s.stroke)) for (let i = 1; i < s.stroke.length; i++) line(s.stroke[i - 1], s.stroke[i]);
    if (s.shape) shape(s.shape.kind, s.shape.from, s.shape.to);
  });
  addEventListener('resize', fit);
  fit();
})();
