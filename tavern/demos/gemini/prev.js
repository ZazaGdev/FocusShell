// The previous Gemini barkeep (#249, commit c4ef97b), kept unchanged so the page can show it
// beside the new one: rigid parts, with the gap filling painted into the torso itself.
import { h } from '../art/dom.js';
import { pose, sheared } from '../people/parts.js';

const ZOOM = 4, PAD = 10;

// Which part a pixel of the standing barkeep belongs to (crop coordinates, 51x105). The
// image's own outlines already separate arms, apron and legs, so the cuts follow them.
function partOf(x, y) {
  if (y <= 21) return 'head';
  if (y >= 76 || (y >= 73 && (x <= 16 || x >= 34)) || (y >= 63 && x >= 34 && x <= 38)) return x <= 24 ? 'legBack' : 'legFront';
  if (y >= 24 && y <= 72 && x <= (y <= 30 ? 14 : 13)) return 'armBack';
  if (y >= 24 && y <= 72 && x >= (y <= 30 ? 35 : 33)) return 'armFront';
  return 'torso';
}

// A part as the rig's Buf shape: { w, h, px[], ox, oy } in full-figure coordinates.
const blank = (w, hh) => ({ w, h: hh, px: new Array(w * hh).fill(null), ox: 0, oy: 0 });
export function cutPrev(rgba, W, H) {
  const parts = {};
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (rgba[i + 3] < 128) continue;
    const name = partOf(x, y);
    parts[name] ||= blank(W, H);
    parts[name].px[y * W + x] = `rgb(${rgba[i]},${rgba[i + 1]},${rgba[i + 2]})`;
  }
  // Hidden underlayers, so a moving part uncovers body, never floor (all hidden at rest):
  // the torso carries on under the arms and the hips, mirrored from just inside its own edge,
  // wherever an arm or leg covered it in the image; the trousers carry on up under the apron.
  const opaque = (x, y) => x >= 0 && x < W && rgba[(y * W + x) * 4 + 3] >= 128;
  const T = parts.torso, tp = (x, y) => (x >= 0 && x < W ? T.px[y * W + x] : null), INK = 'rgb(21,10,36)';
  for (let y = 22; y < 80; y++) {
    let l = -1, r = -1;
    for (let x = 0; x < W; x++) if (tp(x, y)) { if (l < 0) l = x; r = x; }
    if (l < 0) continue;
    for (const [edge, dir] of [[l, -1], [r, 1]]) {
      let n = 0;
      while (n < 8 && opaque(edge + dir * (n + 1), y) && !tp(edge + dir * (n + 1), y)) {
        T.px[y * W + edge + dir * (n + 1)] = tp(edge - dir * (n + 2), y) || tp(edge - dir, y) || INK; n++;
      }
      if (n) { T.px[y * W + edge + dir * n] = INK; T.px[y * W + edge] = tp(edge - dir, y) || INK; }
    }
  }
  for (const name of ['legBack', 'legFront']) {
    const b = parts[name];
    for (let x = 0; x < W; x++) {
      let top = -1;
      for (let y = 62; y < 90; y++) if (b.px[y * W + x]) { top = y; break; }
      if (top < 0 || top > 80) continue;
      const c = b.px[Math.min(H - 1, top + 3) * W + x] || b.px[top * W + x];
      for (let y = 60; y < top; y++) if (tp(x, y)) b.px[y * W + x] = c;
    }
  }
  // Sitting legs: the thigh band drops with the body, the middle of the trousers goes, the
  // boots stay on the floor, so the knees read as bent towards the viewer.
  for (const name of ['legBack', 'legFront']) {
    const src = parts[name], s = blank(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = src.px[y * W + x];
      if (!c) continue;
      if (y < 79) { if (y + SEAT < H) s.px[(y + SEAT) * W + x] = c; } else if (y >= 79 + SEAT) s.px[y * W + x] = c;
    }
    parts[name === 'legBack' ? 'sitBack' : 'sitFront'] = s;
  }
  return parts;
}
const SEAT = 10;

export function stagePrev(parts, W, H, still, controls) {
  const CW = W + PAD * 2, CH = H + 4;
  const canvas = h('canvas', { width: String(CW), height: String(CH), style: `width:${CW * ZOOM}px` });
  const ctx = canvas.getContext('2d');
  const put = (x, y, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); };
  const blit = (b, dx, dy) => { for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) { const c = b.px[j * b.w + i]; if (c) put(PAD + i - (b.ox || 0) + dx, j - (b.oy || 0) + dy, c); } };
  const floor = () => {
    ctx.fillStyle = '#3a2422'; ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = '#2e1b1e'; for (let y = 6; y < CH; y += 12) ctx.fillRect(0, y, CW, 1);
    // A soft shadow under the feet, two stepped rings.
    for (const [rx, ry, a] of [[22, 4.5, 0.28], [15, 3, 0.45]]) {
      ctx.fillStyle = `rgba(20,8,18,${a})`;
      for (let y = -Math.ceil(ry); y <= ry; y++) for (let x = -Math.ceil(rx); x <= rx; x++) if ((x / rx) ** 2 + (y / ry) ** 2 <= 1) ctx.fillRect(PAD + 25 + x, 101 + y, 1, 1);
    }
  };
  const stool = () => {
    const wood = ['#3c1f44', '#5a3147', '#845747', '#af6a48', '#c97e55'];
    for (let x = 0; x <= 50; x++) for (let y = 84; y <= 89; y++) put(PAD + x, y, x === 0 || x === 50 || y === 89 ? wood[0] : y === 84 ? wood[4] : x < 3 ? wood[4] : wood[3]);
    for (const lx of [2, 46]) for (let y = 90; y <= 104; y++) { put(PAD + lx, y, wood[0]); put(PAD + lx + 1, y, wood[3]); put(PAD + lx + 2, y, wood[1]); }
  };
  // o: { mode, ctl, bg } to draw a given pose on a flat colour (the frame check below).
  function draw(t, o = {}) {
    if (o.bg) { ctx.fillStyle = o.bg; ctx.fillRect(0, 0, CW, CH); } else floor();
    if (still) { for (const n of ['armBack', 'legBack', 'legFront', 'torso', 'armFront', 'head']) blit(parts[n], 0, 0); return; }
    const mode = o.mode || controls.mode, sit = mode === 'sit', P = pose(mode, t, o.ctl || controls, 96), lift = P.body + (sit ? SEAT : 0);
    const at = (name, dy = 0) => {
      const o = P.parts[name] || {};
      // A hand swings in across the apron but at most a pixel away from it, so the strip
      // between forearm and apron never opens onto the floor.
      let shear = o.shear || o.shearBottom || 0;
      if (name === 'armBack') shear = Math.max(-1, shear);
      if (name === 'armFront') shear = Math.min(1, shear);
      blit(sheared(parts[name], shear, name === 'head'), o.dx || 0, (o.dy || 0) + dy);
    };
    at('armBack', lift);
    if (sit) { stool(); at('sitBack'); at('sitFront'); } else { at('legBack'); at('legFront'); }
    at('torso', lift); at('armFront', lift); at('head', lift);
  }
  return { canvas, draw, ctx, CW, CH };
}
