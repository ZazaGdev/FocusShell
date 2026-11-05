// One corner of the tavern for the art demos (#244): back wall with a bottle shelf, window and
// fireplace, the counter with the barkeep, barrels, a table with guests, and a walker. Drawn
// at a tile size of 16 or 32 so detail scales with density rather than just getting bigger.
import { Buf, R, INK, FOAM, lit, rng } from './pixels.js';
import { person, SIZES, CAST } from './characters.js';

export const COLS = 10, ROWS = 7;

// The still parts, drawn once per tile size.
const cache = new Map();
function backdrop(T) {
  if (cache.has(T)) return cache.get(T);
  const d = T / 16, W = COLS * T, H = ROWS * T, b = new Buf(W, H), rnd = rng(7 * T);
  floor(b, T, d, rnd);
  wall(b, T, d, rnd);
  // A rug under the table.
  const rx = Math.round(5.2 * T), ry = Math.round(3.9 * T), rw = Math.round(4.4 * T), rh = Math.round(2.6 * T);
  b.box(rx, ry, rw, rh, (u, v, x, y) => {
    const bx = Math.min(x - rx, rx + rw - 1 - x), by = Math.min(y - ry, ry + rh - 1 - y), e = Math.min(bx, by);
    if (e < d) return R.rug[1];
    if (e < 2 * d) return R.rug[4];
    if (e < 3 * d) return R.rug[2];
    return ((x + y) >> d) % 4 === 0 && e > 4 * d ? R.rug[3] : R.rug[2];
  });
  if (d > 1) for (let x = rx; x < rx + rw; x += 2) { b.set(x, ry - 1, R.cream[2]); b.set(x, ry + rh, R.cream[2]); }   // tassels
  shelf(b, T, d, rnd);
  windowPane(b, T, d);
  fireplace(b, T, d, rnd);
  cache.set(T, b);
  return b;
}

function floor(b, T, d, rnd) {
  const bh = d > 1 ? 6 : 4, top = 2 * T;
  for (let y0 = top, row = 0; y0 < ROWS * T; y0 += bh, row++) {
    let x0 = -Math.floor(rnd() * 3 * T);
    while (x0 < COLS * T) {
      const len = Math.round((2 + rnd() * 3) * T), base = rnd() < 0.5 ? 2 : 3;
      for (let y = y0; y < y0 + bh; y++) for (let x = Math.max(0, x0); x < Math.min(COLS * T, x0 + len); x++) {
        const edge = y === y0 ? R.wood[1] : y === y0 + 1 && d > 1 ? R.wood[base + 1] : null;
        b.set(x, y, edge || R.wood[base]);
      }
      for (let g = 0; g < len / (d > 1 ? 5 : 9); g++) {   // grain streaks, finer on the dense floor
        const gx = x0 + Math.floor(rnd() * len), gy = y0 + 1 + Math.floor(rnd() * (bh - 1)), gl = 2 + Math.floor(rnd() * 3 * d);
        b.hline(Math.max(0, gx), Math.min(COLS * T - 1, gx + gl), gy, rnd() < 0.7 ? R.wood[base - 1] : R.wood[base + 1]);
      }
      b.vline(x0, y0, y0 + bh - 1, R.wood[0]);
      if (d > 1) { b.set(x0 + 2, y0 + 3, R.dark[1]); b.set(x0 + len - 3, y0 + 3, R.dark[1]); }   // nails
      x0 += len;
    }
  }
  b.box(0, top, COLS * T, Math.round(T * 0.25), (u, v, x, y) => (y - top) < 2 * d ? R.dark[1] : null);   // the wall's shadow on the floor
}

function wall(b, T, d, rnd) {
  const H = 2 * T, wain = Math.round(1.3 * T);
  b.box(0, 0, COLS * T, wain, (u, v) => { const r = rnd(); return r < 0.06 ? R.plaster[2] : r < 0.1 ? R.plaster[4] : lit(R.plaster, 0, v * 0.6, 3, 1); });
  // Timber frame: a top beam and posts.
  b.box(0, 0, COLS * T, Math.round(0.22 * T), (u, v) => lit(R.dark, 0, v, 3));
  for (const px of [0, 3.6, 6.8]) b.box(Math.round(px * T), 0, Math.round(0.24 * T), wain, (u, v) => lit(R.dark, u, 0, 3));
  // Wainscot panels below.
  b.box(0, wain, COLS * T, H - wain, (u, v, x, y) => {
    const pw = Math.round(T / 2), px = x % pw;
    if (y - wain < d) return R.wood[4];
    if (y - wain < 2 * d) return R.dark[4];
    if (px === 0) return R.dark[1];
    if (d > 1 && px === 1) return R.dark[4];
    return R.dark[3];
  });
  b.hline(0, COLS * T - 1, H - 1, R.dark[0]);
}

function shelf(b, T, d, rnd) {
  const y = Math.round(0.95 * T), x0 = Math.round(0.6 * T), x1 = Math.round(3.4 * T);
  const s = new Buf(x1 - x0, Math.round(0.6 * T));
  s.box(0, s.h - 2 * d, s.w, 2 * d, (u, v) => lit(R.wood, u, v, 3));
  const colours = [R.glass, R.amber, R.red, R.glass, R.purple, R.amber, R.green];
  for (let x = 2 * d, i = 0; x < s.w - 4 * d; i++) {
    const bw = (2 + (i % 2)) * d, bh = Math.round((0.32 + 0.12 * ((i * 7) % 3)) * T), ramp = colours[i % colours.length];
    const top = s.h - 2 * d - bh;
    s.box(x, top + Math.round(bh * 0.35), bw, bh - Math.round(bh * 0.35), (u, v) => lit(ramp, u, v * 0.4, 2));
    s.box(x + Math.floor(bw / 2) - (d > 1 ? 1 : 0), top, d > 1 ? 2 : 1, Math.round(bh * 0.35), (u, v) => lit(ramp, u, 0, 2));
    s.set(x + Math.floor(bw / 2), top, R.brass[3]);
    if (d > 1) s.vline(x, top + Math.round(bh * 0.45), top + bh - 3, ramp[4]);   // glint
    x += bw + d + Math.floor(rnd() * 2 * d);
  }
  b.blit(s.outline(), x0, y - s.h + 2 * d);
}

function windowPane(b, T, d) {
  const x = Math.round(4.6 * T), y = Math.round(0.36 * T), w = Math.round(1.3 * T), h = Math.round(0.85 * T);
  const s = new Buf(w, h);
  s.box(0, 0, w, h, (u, v, px, py) => {
    if (px < d || py < d || px >= w - d || py >= h - d || Math.abs(px - w / 2) < d || Math.abs(py - h / 2) < d / 2) return lit(R.wood, u, v, 3);
    return R.night[Math.max(0, 2 - Math.floor((py / h) * 3))];
  });
  s.set(Math.round(w * 0.25), Math.round(h * 0.25), R.night[4]); s.set(Math.round(w * 0.7), Math.round(h * 0.7), R.night[4]);
  if (d > 1) { s.set(Math.round(w * 0.8), Math.round(h * 0.2), FOAM); s.rect(Math.round(w * 0.2), h - 4, 6, 2, R.night[1]); }
  b.blit(s.outline(), x, y);
  b.box(x - d, y + h + 1, w + 2 * d, 2 * d, (u, v) => lit(R.wood, u, v, 4));   // sill
}

function fireplace(b, T, d, rnd) {
  const x0 = 7 * T, w = 3 * T, H = 2 * T, bh = Math.round(T / 4), bw = Math.round(T / 2);
  b.box(x0, 0, w, H, (u, v, x, y) => {
    const row = Math.floor(y / bh), off = row % 2 ? bw / 2 : 0, bx = (x - x0 + off) % bw, by = y % bh;
    if (by === 0 || bx === 0) return R.stone[0];
    const shade = ((row * 31 + Math.floor((x - x0 + off) / bw) * 17) % 3);
    if (d > 1 && (by === 1 || bx === 1)) return R.stone[4];
    return R.stone[1 + shade];
  });
  // The opening, dark inside, with logs.
  const ox = x0 + Math.round(0.55 * T), ow = Math.round(1.9 * T), oy = Math.round(0.95 * T);
  b.box(ox, oy, ow, H - oy, (u, v, x, y) => (y - oy) < Math.round(0.2 * T) && Math.abs(u) > 0.8 ? null : v < -0.2 ? R.dark[0] : INK);
  b.box(ox - d, oy - 2 * d, ow + 2 * d, 2 * d, (u, v) => lit(R.stone, u, v, 4));
  b.box(x0 - d, Math.round(0.62 * T), w + 2 * d, Math.round(0.14 * T) + d, (u, v) => lit(R.wood, u, v, 3));   // mantel
  for (const lx of [0.25, 0.55]) b.box(ox + Math.round(lx * ow), H - 3 * d, Math.round(0.4 * ow), 2 * d, (u, v) => lit(R.wood, u, v, 2));
}

// The fire's flames for one tick.
function flames(b, T, tick) {
  const d = T / 16, ox = 7 * T + Math.round(0.55 * T), ow = Math.round(1.9 * T), base = 2 * T - 3 * d, rnd = rng(tick * 13 + 1);
  for (let i = 0; i < 5 + 4 * d; i++) {
    const fx = ox + ow * (0.2 + 0.6 * rnd()), fh = (0.35 + rnd() * 0.45) * T, fw = (0.12 + rnd() * 0.1) * T;
    // Each tongue narrows to a point at the top and burns hotter at its core.
    b.ellipse(fx, base - fh / 2, fw, fh / 2, (u, v) => R.fire[Math.max(1, Math.min(5, Math.round(3.6 + v * 0.8 - Math.abs(u) * 2.4)))],
      (x, y) => Math.abs(x + 0.5 - fx) / fw <= 0.25 + 0.75 * ((y - (base - fh)) / fh) ** 1.5);
  }
}

function counter(T, d) {
  const w = Math.round(4.8 * T), top = Math.round(0.4 * T), front = Math.round(0.75 * T), s = new Buf(w, top + front);
  s.box(0, 0, w, top, (u, v, x, y) => y === 0 ? R.wood[5] : lit(R.wood, u * 0.3, v, 3));
  s.box(0, top, w, front, (u, v, x, y) => {
    const pw = Math.round(T * 0.6), px = x % pw;
    if (y === top) return R.dark[0];
    if (px === 0) return R.dark[1];
    if (d > 1 && px === 1) return R.dark[4];
    if (d > 1 && y > top + 5 && y < top + front - 5 && px > 4 && px < pw - 4) return (px === 5 || y === top + 6) ? R.dark[2] : R.dark[4];
    return R.dark[3];
  });
  for (const mx of [0.7, 2.6, 3.4]) {   // mugs on the counter
    const mw = 3 * d, mh = 3 * d + 1, x = Math.round(mx * T);
    s.box(x, -mh + top - 2, mw, mh, (u, v) => lit(R.wood, u, v, 3));
  }
  return s;
}

function table(T, d) {
  const rx = 0.8 * T, ry = 0.42 * T, th = Math.round(0.14 * T), w = Math.ceil(rx * 2) + 2, s = new Buf(w, Math.round(ry * 2 + th + 0.55 * T));
  const cx = w / 2, cy = ry + 1;
  s.box(Math.round(cx - T * 0.1), Math.round(cy), Math.round(T * 0.2), s.h - Math.round(cy), (u, v) => lit(R.dark, u, v, 3));
  s.ellipse(cx, cy + th, rx, ry, R.wood[1]);
  s.ellipse(cx, cy, rx, ry, (u, v) => lit(R.wood, u, v, 3, 1.1));
  if (d > 1) s.ellipse(cx, cy, rx - 2, ry - 2, (u, v) => (Math.abs(u * 3 + v) % 1 < 0.15 ? R.wood[2] : null) || lit(R.wood, u, v, 3, 1.1));
  return s;
}

function barrel(T, d) {
  const w = Math.round(0.8 * T), h = Math.round(1.0 * T), s = new Buf(w, h);
  s.box(0, 0, w, h, (u, v, x, y) => {
    const bulge = Math.abs(v) > 0.8 && Math.abs(u) > 0.85;
    if (bulge) return null;
    const hoop = [0.22, 0.78].some(t => Math.abs((y + 0.5) / h - t) < 0.05 * (d > 1 ? 1.2 : 1.6));
    if (hoop) return lit(R.stone, u, 0, 2);
    if (d > 1 && x % 5 === 0) return R.wood[1];
    return lit(R.wood, u, 0, 2);
  });
  s.ellipse(w / 2, Math.round(0.12 * T), w / 2 - 0.5, 0.12 * T, (u, v) => lit(R.wood, u, v, 4));
  return s;
}

function candle(d, tick, seed) {
  const s = new Buf(3 * d + 2, 8 * d), on = (tick + seed) % 3;
  s.box(Math.round(d), 4 * d, d + 1, 4 * d, (u, v) => lit(R.cream, u, v, 3));
  s.ellipse(d + 1.5, 2.5 * d + (on ? 0 : 0.5), 0.9 * d + 0.3, 1.8 * d, (u, v) => R.fire[v < -0.2 ? 5 : 4]);
  return s;
}

function plant(T, d) {
  const s = new Buf(Math.round(0.9 * T), Math.round(1.1 * T)), cx = s.w / 2;
  s.box(Math.round(cx - 0.25 * T), s.h - Math.round(0.35 * T), Math.round(0.5 * T), Math.round(0.35 * T), (u, v) => lit(R.rug, u, v, 3));
  for (const [ox, oy, r] of [[0, -0.55, 0.28], [-0.22, -0.4, 0.22], [0.22, -0.42, 0.22], [0, -0.75, 0.18]])
    s.ellipse(cx + ox * T, s.h + oy * T, r * T, r * T * 0.9, (u, v, x, y) => (d > 1 && (x + y) % 5 === 0) ? R.leaf[4] : lit(R.leaf, u, v, 2));
  return s;
}

// Draw the whole corner at tile size T with people at `sizeKey`, for animation tick `tick`.
export function drawRoom(ctx, T, sizeKey, tick, night) {
  const d = T / 16, b = new Buf(COLS * T, ROWS * T);
  b.blit(backdrop(T), 0, 0);
  flames(b, T, tick);
  const S = SIZES[sizeKey], items = [];
  const put = (buf, x, y, baseY) => items.push({ buf, x: Math.round(x), y: Math.round(y), baseY });
  const guest = (look, anim, fx, fy, frame, flip) => {
    let p = person(sizeKey, look, anim, frame);
    if (flip) p = p.flipX();
    put(p, fx * T - S.w / 2, fy * T - S.h, fy * T);
  };
  guest(CAST[0], 'idle', 2.2, 2.95, tick >> 2);
  const c = counter(T, d).outline(); put(c, 0, 2.55 * T, 3.4 * T);
  put(candle(d, tick, 0).outline(), 1.6 * T, 2.55 * T - 8 * d, 3.41 * T);
  for (const bx of [5.2, 6.05]) put(barrel(T, d).outline(), bx * T, 1.95 * T, 2.95 * T);
  const t = table(T, d).outline(); put(t, 7.5 * T - t.w / 2 + 1, 4.2 * T, 5.0 * T);
  put(candle(d, tick, 1).outline(), 7.45 * T, 4.45 * T - 8 * d, 5.01 * T);
  guest(CAST[2], 'idle', 6.25, 5.15, (tick >> 2) + 1);
  guest(CAST[3], 'idle', 8.8, 5.05, tick >> 2, true);
  const walkX = 0.8 + ((tick * 0.04) % 4.2);
  guest(CAST[1], 'walk', walkX, 6.4, tick, false);
  put(plant(T, d).outline(), 0.15 * T, 5.6 * T, 6.7 * T);
  for (const it of items.sort((a, z) => a.baseY - z.baseY)) b.blit(it.buf, it.x, it.y);
  b.draw(ctx);
  if (night) light(ctx, T, tick);
}

// Evening: darken everything, then add warm stepped glows around each flame.
function light(ctx, T, tick) {
  const W = COLS * T, H = ROWS * T;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = '#6a5a86'; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  const flick = k => 1 + 0.06 * Math.sin(tick * 1.7 + k * 3) + 0.04 * Math.sin(tick * 3.1 + k);
  const glow = (x, y, r, colour, a, k) => {
    for (const [f, al] of [[1, a * 0.18], [0.85, a * 0.22], [0.68, a * 0.3], [0.5, a * 0.4], [0.32, a * 0.5]]) {
      ctx.fillStyle = colour; ctx.globalAlpha = al;
      ctx.beginPath(); ctx.arc(Math.round(x), Math.round(y), Math.round(r * f * flick(k)), 0, Math.PI * 2); ctx.fill();
    }
  };
  glow(8.5 * T, 1.7 * T, 2 * T, '#ff8a30', 0.19, 0);
  glow(1.7 * T, 2.45 * T, 0.95 * T, '#ffa040', 0.16, 1);
  glow(7.55 * T, 4.35 * T, 1 * T, '#ffa040', 0.16, 2);
  glow(5.25 * T, 0.8 * T, 1.1 * T, '#5070c0', 0.18, 3);
  ctx.restore();
}
