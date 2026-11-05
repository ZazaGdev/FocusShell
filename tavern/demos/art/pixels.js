// Tiny pixel buffer for the art demos (#244): fill shapes with shaded colour ramps, then add
// a selective outline (each edge takes the darkest colour of the ramp it borders), the way
// hand-made pixel art does. Everything is drawn at native size and scaled by whole numbers.

// One palette for every sprite, dark to light per ramp. A fixed palette is the research's
// first style lock (Papers #41).
export const R = {
  wood: ['#3b2224', '#5c3527', '#7d4a2e', '#a0663b', '#c48a52', '#e0b07a'],
  dark: ['#1e1216', '#2e1b1e', '#422622', '#58331f', '#6e4126'],
  stone: ['#26222b', '#3e3743', '#5a505d', '#7a6e79', '#a0939a', '#c4b8b8'],
  plaster: ['#5e4a48', '#7e6a5e', '#a08a74', '#c2ac8e', '#dccaa6', '#efe2c2'],
  skinA: ['#5a2f2a', '#9a5a44', '#c98463', '#e8ad86', '#f6cfa8'],
  skinB: ['#2e1a17', '#5a3426', '#87502f', '#ab6e48', '#c98e65'],
  hairBrown: ['#24130f', '#422216', '#653720', '#86512e', '#a66c3c'],
  hairBlond: ['#5a3a1a', '#9a6a26', '#cf9a3a', '#ecc45e', '#f8e398'],
  hairRed: ['#3a1410', '#6e2418', '#a33c22', '#d0602e', '#ec8a44'],
  hairGrey: ['#34303a', '#5c5660', '#8a8290', '#b6aeb8', '#dcd6dc'],
  red: ['#3a1420', '#6a2030', '#9c3036', '#c84c3e', '#e47c56'],
  green: ['#14261e', '#22402e', '#36603e', '#558650', '#86ae66'],
  blue: ['#161a32', '#23305a', '#344a80', '#4b6ca6', '#78a0cc'],
  cream: ['#4a3a30', '#8a7660', '#b8a486', '#dacba8', '#f2ead2'],
  purple: ['#20142e', '#3a2250', '#583676', '#7a549c', '#a07cc0'],
  pants: ['#18141e', '#28222e', '#3c3242', '#544658', '#6e5e70'],
  brass: ['#4a2a10', '#8a5a1a', '#c4902a', '#ecc84e', '#fff0a0'],
  fire: ['#5a1010', '#a42a10', '#e05a10', '#f8a020', '#ffe060', '#fff8c8'],
  glass: ['#122a1e', '#24503a', '#3c7e4a', '#6aae62', '#b4dc8a'],
  amber: ['#3a1a0a', '#76360e', '#b05e14', '#e09030', '#f8c870'],
  night: ['#0e1230', '#18244e', '#283e78', '#4864a4', '#88a8d8'],
  leaf: ['#12261a', '#1e4228', '#2e6636', '#4c8c44', '#86b85a'],
  rug: ['#2a0f1a', '#4e1a26', '#7a2a30', '#a8463a', '#d27a4c'],
};
export const INK = '#1a1015';
export const FOAM = '#f6eedb';

const RAMP_OF = new Map();
for (const ramp of Object.values(R)) ramp.forEach((c, i) => RAMP_OF.has(c) || RAMP_OF.set(c, { ramp, i }));
// The colour one step darker (or `n` steps) in the same ramp.
export const darker = (c, n = 1) => { const r = RAMP_OF.get(c); return r ? r.ramp[Math.max(0, r.i - n)] : INK; };
export const edgeOf = c => { const r = RAMP_OF.get(c); return r ? r.ramp[0] : INK; };

// Seeded random numbers, so every reload draws the same grain.
export function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export class Buf {
  constructor(w, h) { this.w = w; this.h = h; this.px = new Array(w * h).fill(null); }
  get(x, y) { return x < 0 || y < 0 || x >= this.w || y >= this.h ? null : this.px[y * this.w + x]; }
  set(x, y, c) { x |= 0; y |= 0; if (c && x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); return this; }
  hline(x0, x1, y, c) { for (let x = x0; x <= x1; x++) this.set(x, y, c); return this; }
  vline(x, y0, y1, c) { for (let y = y0; y <= y1; y++) this.set(x, y, c); return this; }
  // Fill an ellipse, coloured per pixel by `paint(u, v)` with u, v in -1..1 across it.
  ellipse(cx, cy, rx, ry, paint, clip) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry;
      if (u * u + v * v <= 1 && (!clip || clip(x, y))) this.set(x, y, typeof paint === 'function' ? paint(u, v, x, y) : paint);
    }
    return this;
  }
  // A box shaded across its width (lit from the left), `paint(u, v)` like ellipse.
  box(x, y, w, h, paint) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, paint((i + 0.5) / w * 2 - 1, (j + 0.5) / h * 2 - 1, x + i, y + j));
    return this;
  }
  // Selective outline: every empty pixel touching a filled one takes that colour's darkest step.
  outline(color) {
    const add = [];
    for (let y = -1; y <= this.h; y++) for (let x = -1; x <= this.w; x++) {
      if (this.get(x, y)) continue;
      const n = this.get(x, y - 1) || this.get(x, y + 1) || this.get(x - 1, y) || this.get(x + 1, y);
      if (n) add.push([x, y, color || edgeOf(n)]);
    }
    if (add.some(([x, y]) => x < 0 || y < 0 || x >= this.w || y >= this.h)) return this.grow(1).outline(color);
    for (const [x, y, c] of add) this.set(x, y, c);
    return this;
  }
  // A copy with `n` empty pixels added on every side (the outline needs room).
  grow(n) {
    const b = new Buf(this.w + 2 * n, this.h + 2 * n); b.ox = (this.ox || 0) + n; b.oy = (this.oy || 0) + n;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) b.px[(y + n) * b.w + x + n] = this.px[y * this.w + x];
    return b;
  }
  flipX() { const b = new Buf(this.w, this.h); b.ox = this.ox; b.oy = this.oy; for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) b.px[y * b.w + x] = this.px[y * this.w + this.w - 1 - x]; return b; }
  // Draw `src` onto this buffer with its top-left at x, y (its own grow offset applied).
  blit(src, x, y) {
    const ox = src.ox || 0, oy = src.oy || 0;
    for (let j = 0; j < src.h; j++) for (let i = 0; i < src.w; i++) { const c = src.px[j * src.w + i]; if (c) this.set(x + i - ox, y + j - oy, c); }
    return this;
  }
  draw(ctx, x = 0, y = 0) {
    const ox = this.ox || 0, oy = this.oy || 0;
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) { const c = this.px[j * this.w + i]; if (c) { ctx.fillStyle = c; ctx.fillRect(x + i - ox, y + j - oy, 1, 1); } }
  }
}

// Ramp index for a lit surface: light from the upper left. `base` is the mid step.
export function lit(ramp, u, v, base = Math.floor(ramp.length / 2), k = 1.6) {
  const l = -(u * 0.55 + v * 0.85) * k;
  return ramp[Math.max(0, Math.min(ramp.length - 1, base + Math.round(l)))];
}
