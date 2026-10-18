// The Gemini barkeep with clothes that move (#249, second pass). At rest he is the cleaned
// image pixel for pixel: the parts are cut along its outlines and the gap filling lives in its
// own layer under everything, so it only shows where a part has moved off it. In motion each
// part is warped per frame on the pixel grid rather than slid as a rigid cut-out:
// - legs bend from the hip: the stride swings the foot while the hip stays under the apron,
//   and a lifted foot bunches the trousers into a fold instead of the whole leg rising;
// - the apron skirt sways after the legs with a lag that grows towards the hem, and a crease
//   runs down from the knee that pushes it;
// - sleeves swing from the shoulder, mostly towards and away from the viewer: a little sideways
//   travel, and the forearm shortens a pixel as it comes forward; the cuff trails the swing.
// Shoulders, straps and the bib stay put; the whole upper body bobs together.
// The rows and columns below are the barkeep's. Another figure (the robots, #252) brings a
// layout that maps his rows onto its own body (layout()); for him the map is one to one.
import { h } from '../art/dom.js';
import { pose } from '../people/parts.js';

const ZOOM = 4, PAD = 10, M = 6;
// Room above his head on the stage canvas, so a bob upwards never clips his hair.
export const TOP = 8;
const INK = 'rgb(21,10,36)';
// Apron and trouser colours of the cleaned palette, for creases and folds.
const APRON = new Set(['rgb(162,88,58)', 'rgb(201,126,85)', 'rgb(140,73,60)', 'rgb(119,58,59)', 'rgb(110,54,57)']);
const APRON_DARK = 'rgb(119,58,59)', APRON_LIGHT = 'rgb(201,126,85)', TROUSER_FOLD = 'rgb(60,31,68)', TROUSER_LIGHT = 'rgb(132,87,71)';

// A straight line through points [[from, to], ...], rounded: the barkeep's row to the figure's.
const through = pts => v => {
  let i = 0;
  while (i < pts.length - 2 && v > pts[i + 1][0]) i++;
  const [[a, A], [b, B]] = [pts[i], pts[i + 1]];
  return Math.round(A + (v - a) * (B - A) / (b - a));
};

// The barkeep's own layout. y: his rows to the figure's; a: arm rows (shoulder 24 to hand 70);
// cx: the middle of his feet; k: leg length against his, which scales stride, lift and bob.
const BARKEEP = {
  y: v => v, a: v => v, x: v => v, cx: 25, k: 1, folds: true,
  partOf(x, y) {
    if (y <= 22) return 'head'; // hair, face, beard and jaw move as one
    if (y >= 76 || (y >= 73 && (x <= 16 || x >= 34)) || (y >= 63 && x >= 34 && x <= 38)) return x <= 24 ? 'legBack' : 'legFront';
    if (y >= 24 && y <= 72 && x <= (y <= 30 ? 14 : 13)) return 'armBack';
    if (y >= 24 && y <= 72 && x >= (y <= 30 ? 35 : 33)) return 'armFront';
    return 'torso';
  },
};

// Another figure's layout from where its body is: neck (last head row), shoulder (first arm
// row), hand (last arm row, the fingertips), hip (where the legs start), its height h and width w, and the
// columns its arms hang outside of: back arm at x <= back, front arm at x >= front.
export function layout({ neck, shoulder, hand, hip, h: hh, w, back, front }) {
  const y = through([[0, 0], [22, neck], [24, shoulder], [74, hip - 2], [104, hh - 1]]);
  const mid = Math.round((back + front) / 2);
  return {
    y, a: through([[24, shoulder], [70, hand - 2]]), x: v => Math.round(v * w / 51), cx: mid,
    k: (hh - 1 - hip) / 28,
    partOf(x, yy) {
      if (yy <= neck) return 'head';
      // Hands can hang below the hip; outside the arm columns there is no leg.
      if (yy >= shoulder && yy <= hand && x <= back) return 'armBack';
      if (yy >= shoulder && yy <= hand && x >= front) return 'armFront';
      if (yy >= hip) return x <= mid ? 'legBack' : 'legFront';
      return 'torso';
    },
  };
}

const blank = (w, hh) => ({ w, h: hh, px: new Array(w * hh).fill(null) });

// above: rows the image has over the first barkeep's row 0 (the owner-likeness barkeep's
// headphones, #254). They go with the head; the rest of the rig keeps its rows.
export function cutCloth(rgba, W, H, above = 0, L = BARKEEP) {
  if (above) {
    const parts = cutCloth(rgba.subarray(above * W * 4), W, H - above, 0, L), head = blank(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, c = y < above ? (rgba[i + 3] >= 128 ? `rgb(${rgba[i]},${rgba[i + 1]},${rgba[i + 2]})` : null) : parts.head.px[(y - above) * W + x];
      head.px[y * W + x] = c;
    }
    parts.head = { ...head, oy: above };
    return parts;
  }
  const Y = L.y, parts = { L }, col = (x, y) => { const i = (y * W + x) * 4; return `rgb(${rgba[i]},${rgba[i + 1]},${rgba[i + 2]})`; };
  const opaque = (x, y) => x >= 0 && x < W && y >= 0 && y < H && rgba[(y * W + x) * 4 + 3] >= 128;
  for (const n of ['head', 'torso', 'armBack', 'armFront', 'legBack', 'legFront', 'under']) parts[n] = blank(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (opaque(x, y)) parts[L.partOf(x, y)].px[y * W + x] = col(x, y);
  // The layer under everything: wherever an arm or leg covers the body in the image, the body
  // carries on, mirrored from just inside the torso's edge, up to eight pixels out.
  const T = parts.torso, U = parts.under, tp = (x, y) => (x >= 0 && x < W ? T.px[y * W + x] : null);
  for (let y = Y(22); y < Y(80); y++) {
    let l = -1, r = -1;
    for (let x = 0; x < W; x++) if (tp(x, y)) { if (l < 0) l = x; r = x; }
    if (l < 0) continue;
    for (const [edge, dir] of [[l, -1], [r, 1]]) {
      let n = 0;
      while (n < 8 && opaque(edge + dir * (n + 1), y) && !tp(edge + dir * (n + 1), y)) { n++; U.px[y * W + edge + dir * n] = tp(edge - dir * (n + 1), y) || tp(edge - dir, y) || INK; }
      if (n) U.px[y * W + edge + dir * n] = INK;
    }
  }
  // Trousers carry on up behind the apron, so a lifted hem shows trouser, not floor.
  for (const name of ['legBack', 'legFront']) {
    const b = parts[name];
    for (let x = 0; x < W; x++) {
      let top = -1;
      for (let y = Y(62); y < Y(90); y++) if (b.px[y * W + x]) { top = y; break; }
      if (top < 0 || top > Y(80)) continue;
      // The colour this column has at mid-thigh: shading inside, outline at the leg's sides.
      // (Another figure has no trousers to match: its leg's own colour a few rows down.)
      const c = (L.folds ? b.px[Y(82) * W + x] : b.px[(top + 3) * W + x]) || b.px[top * W + x];
      for (let y = Y(58); y < top; y++) if (tp(x, y)) b.px[y * W + x] = c;
    }
  }
  // Sitting, seen from the front: the thighs point at the viewer, so they shrink to a knee
  // band just under the lap; the shins and boots stay where they stood. Each leg keeps its
  // own pixels: the hidden part under the apron drops with the body, the trouser top becomes
  // the knees, and the shin from three rows above the boot cuff down is unchanged.
  // SEAT: how far the body drops to sit; LAP: the row the knees take, under the lap.
  const SEAT = Y(84) - Y(74), LAP = Y(82);
  for (const [name, keep] of [['legBack', Y(81)], ['legFront', Y(84)]]) {
    const src = parts[name], s = blank(W, H), at = (x, y) => src.px[y * W + x];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = at(x, y);
      if (!c) continue;
      if (y >= keep) s.px[y * W + x] = c;
      else if (y < Y(76) && y + SEAT < keep) s.px[(y + SEAT) * W + x] = c;
    }
    for (let k = 0; k < 3; k++) for (let x = 0; x < W; x++) { const c = at(x, Y(76) + k); if (c) s.px[(LAP + k) * W + x] = c; }
    parts[name === 'legBack' ? 'sitBack' : 'sitFront'] = s;
  }
  // The apron lies over the lap: its skirt shortens by four rows, so the hem ends at the knees.
  const S = blank(W, H), a0 = Y(64), a1 = Y(72), a2 = Y(76);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sy = y < a0 ? y : y <= a1 ? a0 + Math.round((y - a0) * (a2 - a0) / (a1 - a0)) : -1;
    if (sy >= 0) S.px[y * W + x] = T.px[sy * W + x];
  }
  parts.sitTorso = S;
  // Under the shortened apron, the gap filling stops at the lap too.
  parts.sitUnder = { ...U, px: U.px.map((c, i) => (Math.floor(i / W) <= a1 ? c : null)) };
  parts.SEAT = SEAT;
  return parts;
}

// Warps a part: each destination pixel asks src(x, y) for the source pixel it shows, so the
// result has no holes. A margin of M pixels lets it reach past the part's box.
function warp(b, src) {
  const out = { w: b.w + 2 * M, h: b.h, px: new Array((b.w + 2 * M) * b.h).fill(null), ox: M, oy: 0 };
  for (let y = 0; y < b.h; y++) for (let x = -M; x < b.w + M; x++) {
    const s = src(x, y);
    if (!s) continue;
    const [sx, sy] = s;
    if (sx < 0 || sy < 0 || sx >= b.w || sy >= b.h) continue;
    out.px[y * out.w + x + M] = b.px[sy * b.w + sx];
  }
  return out;
}
const clamp01 = v => Math.max(0, Math.min(1, v));
// How far down the arm a row is: 0 at the shoulder, 1 at the hand.
const armT = (L, y) => clamp01((y - L.a(24)) / (L.a(70) - L.a(24)));

// One frame's clothing for the walk: given the step phase, the warped parts.
function walkParts(parts, p, ctl) {
  const L = parts.L, Y = L.y, k = L.k;
  // stride: how far each foot travels from under the hip. In a room it comes from the ground
  // speed, so a planted foot stays put (ctl.stride); walking on the spot it is the leg slider.
  const step = Math.sin(p), stride = ctl.stride ?? Math.max(1, ctl.leg) * k, out = {};
  // He faces left, so a foot swings forward while it moves left (side * cos p < 0): that foot
  // lifts, the other is planted and carries him.
  const lift = side => Math.round(Math.max(0, -side * Math.cos(p)) * Math.max(2, ctl.leg * 0.6) * k);
  // Legs: foot travel grows from the hip to the boot; a lifted foot folds the trousers.
  const hip = Y(74), reach = Y(102) - hip, knee = Y(81), fold = Y(80);
  for (const [name, side] of [['legFront', 1], ['legBack', -1]]) {
    const dx = side * stride * step, Lf = lift(side), b = parts[name];
    const w = warp(b, (x, y) => [x - Math.round(dx * clamp01((y - hip) / reach)), y >= knee ? y + Lf : y]);
    if (Lf && L.folds) for (let x = 0; x < w.w; x++) {
      const i = fold * w.w + x;
      if (w.px[i] && w.px[i] !== INK && w.px[i - w.w] && w.px[i + w.w]) { w.px[i] = TROUSER_FOLD; if (w.px[i - w.w] !== INK) w.px[i - w.w] = TROUSER_LIGHT; }
    }
    out[name] = w;
  }
  // Apron skirt: sways after the legs, more towards the hem, so the hem trails the stride.
  const sway = Math.max(1, ctl.leg * 0.75) * k * Math.sin(p - 0.9), s0 = Y(62), sl = Y(77) - s0;
  const torso = warp(parts.torso, (x, y) => (y < s0 ? [x, y] : [x - Math.round(sway * clamp01((y - s0) / sl) ** 2), y]));
  // A crease from the knee that pushes the apron: a dark line with a lit edge beside it.
  const push = Math.sin(p), c0 = Y(64), c1 = Y(74);
  if (Math.abs(push) > 0.3) {
    const x0 = L.x(push > 0 ? 31 : 18), lean = push > 0 ? 1 : -1;
    for (let y = c0; y <= c1; y++) {
      const x = x0 + Math.round(lean * (y - c0) / 6) - Math.round(sway * ((y - s0) / sl) ** 2) + M, i = y * torso.w + x;
      if (APRON.has(torso.px[i]) && APRON.has(torso.px[i - lean])) { torso.px[i] = APRON_DARK; if (APRON.has(torso.px[i - lean])) torso.px[i - lean] = APRON_LIGHT; }
    }
  }
  out.torso = torso;
  // Sleeves: a short sideways swing from the shoulder; the forward forearm shortens a pixel and
  // the cuff trails the swing by one more.
  const cuff0 = L.a(44), cuff1 = L.a(52), fore = L.a(46);
  for (const [name, side] of [['armFront', -1], ['armBack', 1]]) {
    const a = side * ctl.arm * step * 0.5 * k, fwd = side * step > 0.4 ? 1 : 0;
    out[name] = warp(parts[name], (x, y) => {
      const trail = y >= cuff0 && y <= cuff1 && Math.abs(a) >= 1.5 ? Math.sign(a) : 0;
      return [x - Math.round(a * armT(L, y)) + trail, y >= fore ? y + fwd : y];
    });
  }
  return out;
}

// The arms in idle: a slow sway from the shoulder.
const swayArm = (parts, n, a) => warp(parts[n], (x, y) => [x - Math.round(a * armT(parts.L, y)), y]);

export function clothStage(parts, W, H, controls) {
  const L = parts.L, Y = L.y, SEAT = parts.SEAT;
  const CW = W + PAD * 2, CH = H + 4 + TOP;
  const canvas = h('canvas', { width: String(CW), height: String(CH), style: `width:${CW * ZOOM}px` });
  const ctx = canvas.getContext('2d');
  const blit = (b, dx, dy) => { for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) { const c = b.px[j * b.w + i]; if (c) { ctx.fillStyle = c; ctx.fillRect(PAD + i - (b.ox || 0) + dx, TOP + j - (b.oy || 0) + dy, 1, 1); } } };
  function floor() {
    ctx.fillStyle = '#3a2422'; ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = '#2e1b1e'; for (let y = 6; y < CH; y += 12) ctx.fillRect(0, y, CW, 1);
    for (const [rx, ry, a] of [[22, 4.5, 0.28], [15, 3, 0.45]]) {
      ctx.fillStyle = `rgba(20,8,18,${a})`;
      for (let y = -Math.ceil(ry); y <= ry; y++) for (let x = -Math.ceil(rx); x <= rx; x++) if ((x / rx) ** 2 + (y / ry) ** 2 <= 1) ctx.fillRect(PAD + L.cx + x, TOP + Y(101) + y, 1, 1);
    }
  }
  // The bench stands behind him: its seat shows either side of his hips, at hip height, and
  // its far legs end higher up the floor than his boots.
  function stool() {
    const wood = ['#3c1f44', '#5a3147', '#845747', '#af6a48', '#c97e55'], put = (x, y, c) => { ctx.fillStyle = c; ctx.fillRect(PAD + x, TOP + y, 1, 1); };
    const s0 = Y(74), l = L.x(-8), r = L.x(58);
    for (let x = l; x <= r; x++) for (let y = s0; y <= s0 + 6; y++) put(x, y, x === l || x === r || y === s0 + 6 ? wood[0] : y === s0 ? wood[4] : y === s0 + 1 ? wood[3] : y === s0 + 5 ? wood[1] : wood[2]);
    for (const lx of [l + 2, r - 5]) for (let y = s0 + 7; y <= s0 + 23; y++) { put(lx, y, wood[0]); put(lx + 1, y, wood[3]); put(lx + 2, y, wood[1]); }
  }
  // o: { mode, ctl, bg } draws a given pose on a flat colour (the ?frames check); o.clear on
  // nothing at all, for a room to draw him into.
  function draw(t, o = {}) {
    if (o.clear) ctx.clearRect(0, 0, CW, CH); else if (o.bg) { ctx.fillStyle = o.bg; ctx.fillRect(0, 0, CW, CH); } else floor();
    const mode = o.mode || controls.mode, ctl = o.ctl || controls, P = pose(mode, t, ctl, 96);
    const lift = Math.round(P.body * L.k) + (mode === 'sit' ? SEAT : 0);
    if (mode === 'walk') {
      const p = t * ctl.speed * Math.PI * 2, w = walkParts(parts, p, ctl);
      // The upper body leans a pixel into the walk and rides the bob (down as each foot lands,
      // up as the legs pass); it does not rock from side to side.
      const lean = -1;
      blit(parts.under, lean, lift); blit(w.armBack, lean, lift); blit(w.legBack, 0, 0); blit(w.legFront, 0, 0);
      blit(w.torso, lean, lift); blit(w.armFront, lean, lift); blit(parts.head, lean, lift);
      return;
    }
    const arm = n => { const s = ((P.parts[n] || {}).shear || 0) * L.k; return Math.round(s) ? swayArm(parts, n, s) : parts[n]; };
    const sit = mode === 'sit';
    if (sit && !o.noBench) stool(); // a room brings its own bench
    blit(sit ? parts.sitUnder : parts.under, 0, lift); blit(arm('armBack'), 0, lift + ((P.parts.armBack || {}).dy || 0));
    if (sit) {
      blit(parts.sitBack, 0, 0);
      const d = ((P.parts.sitFront || {}).shearBottom || 0) * L.k, f0 = Y(86), fl = Y(104) - f0;
      blit(Math.round(d) ? warp(parts.sitFront, (x, y) => [x - Math.round(d * clamp01((y - f0) / fl)), y]) : parts.sitFront, 0, 0);
    } else { blit(parts.legBack, 0, 0); blit(parts.legFront, 0, 0); }
    blit(sit ? parts.sitTorso : parts.torso, 0, lift); blit(arm('armFront'), 0, lift + ((P.parts.armFront || {}).dy || 0)); blit(parts.head, 0, lift);
  }
  return { canvas, draw, ctx, CW, CH };
}
