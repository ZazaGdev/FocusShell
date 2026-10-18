// The tavern room at the 64x96 people's density (#248): 48px tiles, so a person stands two
// tiles tall. Everything is drawn in code from the #244 palette: the room behind (walls,
// floor, window, shelves, fireplace, rug) as one picture, and the furniture as sprites that
// people walk behind and in front of. Each object casts a soft shadow onto the floor.
import { Buf, R, darker, rng, FOAM } from '../art/pixels.js';

// 27 x 14 tiles: room for every robot, drawn bigger (#260), to have a seat at the bigger tables,
// with aisles between them (#251, #258).
export const T = 48, COLS = 27, ROWS = 14, W = T * COLS, H = T * ROWS;
export const WALL = 120; // where the floor starts

// Colour helpers: hex to rgb, and a colour darkened towards the shadow tint.
const rgbOf = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const hex = v => '#' + v.map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
export const SHADOW = '#1a0e14';
export const mix = (c, to, a) => { if (!c) return c; const p = rgbOf(c), q = rgbOf(to); return hex(p.map((n, i) => n * (1 - a) + q[i] * a)); };

// A soft shadow on a picture: two stepped rings of the shadow tint, darker in the middle.
export function shadow(b, cx, cy, rx, ry, a = 0.32) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    const u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry, q = u * u + v * v, c = b.get(x, y);
    if (q <= 1 && c) b.set(x, y, mix(c, SHADOW, q < 0.4 ? a * 1.45 : a));
  }
}

// ---------- the room behind everything ----------
// The room's shell (floor and walls) alone, for furniture drawn from the Gemini sprites (#249).
export function shell() {
  const b = new Buf(W, H), r = rng(11);
  floor(b, r); wall(b, r);
  return b;
}
export function background() {
  const b = new Buf(W, H), r = rng(11);
  floor(b, r); wall(b, r); windowPane(b, r); shelves(b, r); fireplace(b, r); rug(b);
  // Furniture shadows land on the floor and rug, under the sprites.
  for (const s of SPRITES) if (s.shadow) shadow(b, ...s.shadow);
  return b;
}

function floor(b, r) {
  // Boards about 15 cm wide at the people's scale (9 pixels), seams and grain kept quiet so the
  // floor reads finer than the furniture and people on it.
  const PH = 9;
  for (let row = 0; WALL + row * PH < H; row++) {
    const y0 = WALL + row * PH;
    let x = -Math.floor(r() * 120);
    while (x < W) {
      const len = 60 + Math.floor(r() * 110), base = mix(R.wood[1], R.wood[2], r() * 0.35), seed = Math.floor(r() * 97);
      for (let y = y0; y < y0 + PH; y++) for (let xx = Math.max(0, x); xx < Math.min(W, x + len); xx++) {
        let c = base;
        if (y === y0 || xx === x) c = mix(base, R.wood[0], 0.6);
        else if (y === y0 + 1) c = mix(base, R.wood[3], 0.25);
        else if ((xx * 3 + y * 17 + seed) % 41 === 0 || ((xx + seed) % 67 < 12 && y === y0 + 3 + (seed % 4))) c = mix(base, R.wood[0], 0.3);
        b.set(xx, y, c);
      }
      b.set(x + 2, y0 + 4, mix(base, R.stone[3], 0.5));
      x += len;
    }
  }
  // The floor darkens into the wall's shadow, and slightly towards the back.
  for (let y = WALL; y < WALL + 10; y++) for (let x = 0; x < W; x++) b.set(x, y, mix(b.get(x, y), SHADOW, 0.5 - (y - WALL) * 0.045));
}

function wall(b, r) {
  for (let y = 0; y < WALL; y++) for (let x = 0; x < W; x++) {
    if (y < 10) { b.set(x, y, y === 9 ? R.dark[0] : y < 2 ? R.dark[3] : R.dark[2]); continue; }
    if (y >= 86) { // wainscot: dark vertical boards under a rail
      if (y < 91) b.set(x, y, y === 86 ? R.wood[4] : y === 90 ? R.wood[1] : R.wood[3]);
      else { const bx = x % 8; b.set(x, y, bx === 0 ? R.wood[0] : bx === 1 ? mix(R.wood[1], R.wood[2], 0.5) : y > WALL - 3 ? R.dark[1] : R.wood[1]); }
      continue;
    }
    const n = r(), base = y < 26 ? 1 : 2;
    b.set(x, y, R.plaster[n < 0.08 ? base - 1 : n > 0.93 ? base + 1 : base]);
  }
  // Timber posts, lit from the left.
  for (const px of [0, 236, 470, 704, 938, 1172]) for (let y = 10; y < 86; y++) for (let x = px; x < px + 10; x++) b.set(x, y, x === px ? R.dark[3] : x === px + 9 ? R.dark[0] : R.dark[2]);
  // Under the top beam, a band of shadow on the plaster.
  for (let y = 10; y < 14; y++) for (let x = 0; x < W; x++) b.set(x, y, mix(b.get(x, y), SHADOW, 0.35));
}

function windowPane(b, r) {
  const x0 = 300, y0 = 20, w = 96, h = 64;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const frame = x < x0 + 5 || x >= x0 + w - 5 || y < y0 + 5 || y >= y0 + h - 5, mull = Math.abs(x - (x0 + w / 2)) < 2 || Math.abs(y - (y0 + h / 2)) < 2;
    if (frame || mull) b.set(x, y, x === x0 || y === y0 ? R.wood[1] : (x === x0 + 4 || y === y0 + 4) ? R.wood[1] : R.wood[3]);
    else b.set(x, y, R.night[(y - y0) < 20 ? 0 : (y - y0) < 44 ? 1 : 2]);
  }
  for (let i = 0; i < 14; i++) b.set(x0 + 7 + Math.floor(r() * (w - 14)), y0 + 7 + Math.floor(r() * 40), R.night[4]);
  b.ellipse(x0 + 72, y0 + 16, 6, 6, (u, v) => (u > 0.35 ? null : R.cream[u < -0.4 ? 4 : 3]));
  // Sill, rod and curtains in folds.
  for (let x = x0 - 6; x < x0 + w + 6; x++) for (let y = y0 + h; y < y0 + h + 6; y++) b.set(x, y, y === y0 + h ? R.wood[4] : y === y0 + h + 5 ? R.wood[0] : R.wood[3]);
  for (let x = x0 - 18; x < x0 + w + 18; x++) { b.set(x, y0 - 7, R.brass[3]); b.set(x, y0 - 6, R.brass[1]); }
  for (const cx of [x0 - 16, x0 + w + 2]) for (let y = y0 - 5; y < y0 + h + 10; y++) for (let x = cx; x < cx + 14; x++) {
    const fold = (x - cx) % 5, tie = Math.abs(y - (y0 + 40)) < 2;
    b.set(x, y, tie ? R.brass[2] : fold === 0 ? R.red[1] : fold === 1 ? R.red[3] : fold === 4 ? R.red[1] : R.red[2]);
  }
}

function shelves(b, r) {
  const bottle = [R.glass, R.amber, R.red, R.purple, R.glass, R.blue];
  for (const sy of [42, 76]) {
    for (let x = 18; x < 206; x++) { b.set(x, sy, R.wood[4]); b.set(x, sy + 1, R.wood[3]); b.set(x, sy + 2, R.wood[3]); b.set(x, sy + 3, R.wood[1]); }
    for (let x = 18; x < 206; x++) for (let y = sy + 4; y < sy + 7; y++) b.set(x, y, mix(b.get(x, y), SHADOW, 0.4 - (y - sy - 4) * 0.12));
    for (const bx of [26, 196]) for (let y = sy + 4; y < sy + 12; y++) b.set(bx, y, R.dark[1]);
    let x = 22;
    while (x < 196) {
      const kind = r(), ramp = bottle[Math.floor(r() * bottle.length)];
      if (kind < 0.62) { // a bottle: body, shoulder, neck, cork, a glint
        const bh = 14 + Math.floor(r() * 7), bw = 6 + Math.floor(r() * 2);
        for (let y = sy - bh; y < sy; y++) for (let i = 0; i < bw; i++) {
          const neck = y < sy - bh + 6, inNeck = i >= Math.floor(bw / 2) - 1 && i <= Math.floor(bw / 2);
          if (neck && !inNeck) continue;
          b.set(x + i, y, y === sy - bh ? R.wood[2] : i === 1 && !neck ? ramp[4] : i === bw - 1 ? ramp[0] : ramp[2]);
        }
        x += bw + 2 + Math.floor(r() * 3);
      } else if (kind < 0.82) { // a jar
        for (let y = sy - 10; y < sy; y++) for (let i = 0; i < 10; i++) b.set(x + i, y, y === sy - 10 ? R.cream[3] : i === 1 ? R.cream[4] : i === 9 ? R.cream[1] : R.cream[2]);
        x += 13;
      } else { // books leaning
        for (let k = 0; k < 4; k++) { const c = [R.red, R.green, R.blue, R.amber][k]; for (let y = sy - 16 + (k % 2) * 2; y < sy; y++) for (let i = 0; i < 4; i++) b.set(x + k * 4 + i, y, i === 0 ? c[3] : i === 3 ? c[0] : c[2]); }
        x += 19;
      }
    }
  }
}

function fireplace(b, r) {
  const x0 = 496, x1 = 668, top = 0, bottom = 150;
  // Stone blocks with bevels, staggered rows.
  for (let row = 0; top + row * 13 < bottom; row++) {
    const y0 = top + row * 13; let x = x0 - (row % 2 ? 12 : 0);
    while (x < x1) {
      const w = 20 + Math.floor(r() * 12), tone = r() < 0.3 ? 3 : 2;
      for (let y = y0; y < Math.min(bottom, y0 + 13); y++) for (let xx = Math.max(x0, x); xx < Math.min(x1, x + w); xx++) {
        const c = y === y0 || xx === x ? R.stone[0] : y === y0 + 1 || xx === x + 1 ? R.stone[tone + 1] : y === y0 + 12 || xx === x + w - 1 ? R.stone[1] : R.stone[tone];
        b.set(xx, y, (xx * 7 + y * 3) % 31 === 0 ? R.stone[1] : c);
      }
      x += w;
    }
  }
  // The opening: an arch, soot, back bricks, logs.
  const ox0 = 528, ox1 = 636, oy0 = 74, oy1 = 140, cx = (ox0 + ox1) / 2;
  for (let y = oy0 - 14; y < oy1; y++) for (let x = ox0; x < ox1; x++) {
    const u = (x - cx) / ((ox1 - ox0) / 2), arch = y < oy0 && (u * u + ((oy0 - y) / 14) ** 2 > 1);
    if (arch) continue;
    const brick = (y % 8 === 0) || ((x + (Math.floor(y / 8) % 2) * 8) % 16 === 0);
    b.set(x, y, y < oy0 + 6 ? R.dark[0] : brick ? R.dark[0] : R.dark[1]);
  }
  for (const [lx, ly, lw] of [[540, 128, 56], [566, 122, 50]]) for (let y = ly; y < ly + 9; y++) for (let x = lx; x < lx + lw; x++) b.set(x, y, x === lx || x === lx + lw - 1 ? R.wood[4] : y === ly ? R.wood[3] : y === ly + 8 ? R.dark[0] : R.wood[1]);
  // Mantel beam with candles, a jug and a little plant on it.
  for (let y = 60; y < 70; y++) for (let x = x0 - 6; x < x1 + 6; x++) b.set(x, y, y === 60 ? R.wood[4] : y === 69 ? R.wood[0] : y > 66 ? R.wood[1] : R.wood[3]);
  for (let y = 70; y < 74; y++) for (let x = x0 - 6; x < x1 + 6; x++) b.set(x, y, mix(b.get(x, y), SHADOW, 0.35));
  for (const mx of [508, 652]) candleStick(b, mx, 60);
  b.ellipse(548, 52, 7, 8, (u, v) => (u < -0.4 ? R.cream[3] : u > 0.5 ? R.cream[1] : R.cream[2]));
  for (let y = 40; y < 46; y++) { b.set(546, y, R.cream[2]); b.set(547, y, R.cream[2]); }
  for (let y = 48; y < 60; y++) for (let x = 612; x < 624; x++) b.set(x, y, y === 48 ? R.amber[3] : x === 612 ? R.amber[3] : R.amber[2]);
  for (let i = 0; i < 9; i++) b.ellipse(614 + (i % 3) * 4, 40 + Math.floor(i / 3) * 3, 3, 3, (u, v) => R.leaf[u + v < -0.4 ? 4 : u + v > 0.5 ? 1 : 3]);
  // The hearth slab on the floor.
  for (let y = bottom; y < bottom + 12; y++) for (let x = x0 - 8; x < x1 + 8; x++) b.set(x, y, y === bottom ? R.stone[4] : y > bottom + 9 ? R.stone[0] : (x % 24 === 0) ? R.stone[1] : R.stone[3]);
  // Firewood stacked beside it, log ends showing rings.
  for (const [lx, ly] of [[470, 150], [482, 150], [476, 141], [470, 132], [482, 132]]) b.ellipse(lx, ly, 6, 5, (u, v) => { const q = u * u + v * v; return q > 0.7 ? R.wood[1] : q > 0.25 ? R.wood[4] : R.wood[3]; });
}

// A candle in a brass holder, its wick at (x, y - 13). Flames are drawn live.
export function candleStick(b, x, base) {
  for (let i = -4; i <= 4; i++) { b.set(x + i, base - 1, R.brass[i < 0 ? 3 : 2]); b.set(x + i, base - 2, R.brass[i < -2 ? 4 : 3]); }
  for (let y = base - 12; y < base - 2; y++) for (let i = -2; i <= 1; i++) b.set(x + i, y, i === -2 ? FOAM : i === 1 ? R.cream[2] : R.cream[3]);
  b.set(x - 1, base - 13, R.dark[0]);
}

function rug(b) {
  const x0 = 332, x1 = 548, y0 = 244, y1 = 372;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const bx = Math.min(x - x0, x1 - 1 - x), by = Math.min(y - y0, y1 - 1 - y), edge = Math.min(bx, by);
    let c;
    if (edge === 0) c = R.rug[0];
    else if (edge < 8) c = (x + y) % 6 < 2 && edge > 2 && edge < 6 ? R.rug[4] : R.rug[1];
    else { const d = Math.abs(((x - x0) % 24) - 12) + Math.abs(((y - y0) % 24) - 12); c = d === 6 ? R.rug[3] : d < 3 ? R.rug[4] : R.rug[2]; }
    b.set(x, y, mix(c, SHADOW, 0.08));
  }
  for (const fx of [x0 - 4, x1]) for (let y = y0 + 2; y < y1 - 2; y += 2) for (let i = 0; i < 4; i++) b.set(fx + i, y, R.cream[i % 2 ? 2 : 3]);
}

// ---------- furniture: sprites drawn in depth order with the people ----------
// Each: { x, y } top-left on the room, base (the floor line it stands on, for depth order),
// buf, shadow [cx, cy, rx, ry] cast onto the floor, flames [[x, y]] drawn live.
export const SPRITES = [];
const sprite = (x, y, w, h, base, draw, extra = {}) => { const b = new Buf(w, h); draw(b); SPRITES.push({ x, y, base, buf: b.outline(), ...extra }); };

function tankard(b, x, base) {
  for (let y = base - 11; y < base; y++) for (let i = 0; i < 8; i++) b.set(x + i, y, y < base - 9 ? (i % 3 ? FOAM : R.cream[3]) : (y === base - 7 || y === base - 3) ? R.brass[2] : i === 0 ? R.wood[4] : i === 7 ? R.wood[1] : R.wood[3]);
  for (let y = base - 8; y < base - 3; y++) b.set(x + 8, y, y === base - 8 || y === base - 4 ? R.wood[2] : null);
  b.set(x + 9, base - 7); b.set(x + 9, base - 6, R.wood[2]); b.set(x + 9, base - 5, R.wood[2]);
}

function barrel(b, x, y, w, h) {
  b.ellipse(x + w / 2, y + h / 2, w / 2, h / 2 + 4, (u, v, px, py) => {
    if (py < y || py >= y + h) return null;
    const stave = Math.floor((u + 1) * 4) % 2, hoop = Math.abs(py - (y + h * 0.25)) < 2 || Math.abs(py - (y + h * 0.75)) < 2;
    return hoop ? R.stone[u < -0.3 ? 3 : 1] : R.wood[(u < -0.5 ? 3 : u > 0.5 ? 1 : 2) + (stave ? 0 : 0)] ;
  });
  b.ellipse(x + w / 2, y + 2, w / 2 - 2, 4, (u, v) => (u * u + v * v > 0.6 ? R.wood[2] : R.wood[4]));
}

function stool(b, cx, seat) {
  b.ellipse(cx, seat, 13, 5, (u, v) => R.wood[v < -0.3 ? 4 : v > 0.4 ? 2 : 3]);
  for (let y = seat + 4; y < seat + 7; y++) for (let x = cx - 12; x <= cx + 12; x++) b.set(x, y, Math.abs(x - cx) < 12 ? R.wood[1] : null);
  for (const lx of [cx - 10, cx - 1, cx + 8]) for (let y = seat + 5; y < seat + 22; y++) { b.set(lx, y, R.wood[2]); b.set(lx + 1, y, R.wood[1]); }
}

export function buildSprites() {
  SPRITES.length = 0;
  // The bar counter, with tankards, a bottle, a candle, a small keg and a bread board.
  sprite(0, 140, 306, 100, 236, b => {
    for (let y = 12; y < 30; y++) for (let x = 0; x < 300; x++) b.set(x, y, y < 14 ? R.wood[2] : y > 27 ? R.wood[4] : (x * 5 + y * 11) % 41 === 0 ? R.wood[2] : R.wood[3]);
    for (let y = 30; y < 96; y++) for (let x = 0; x < 300; x++) {
      const bx = x % 30, rail = y < 34 || y > 88, inset = bx > 4 && bx < 26 && y > 40 && y < 82;
      b.set(x, y, y > 91 ? R.dark[0] : rail ? R.wood[2] : inset ? ((bx === 5 || y === 41) ? R.wood[0] : (bx === 25 || y === 81) ? R.wood[3] : R.wood[1]) : (bx === 0 ? R.wood[0] : R.wood[2]));
    }
    tankard(b, 34, 18); tankard(b, 104, 20); tankard(b, 252, 19);
    for (let y = 0; y < 18; y++) for (let i = 0; i < 7; i++) { if (y < 6 && (i < 2 || i > 4)) continue; b.set(70 + i, y, y === 0 ? R.wood[2] : i === 1 ? R.glass[4] : i === 6 ? R.glass[0] : R.glass[2]); }
    candleStick(b, 160, 20);
    barrel(b, 196, -6, 30, 24); for (let x = 224; x < 230; x++) b.set(x, 8, R.brass[3]); b.set(229, 9, R.brass[2]); b.set(229, 10, R.brass[2]);
    for (let y = 14; y < 19; y++) for (let x = 268; x < 296; x++) b.set(x, y, y === 14 ? R.wood[4] : R.wood[3]);
    b.ellipse(282, 11, 9, 5, (u, v) => R.amber[v < -0.2 ? 4 : u > 0.4 ? 2 : 3]);
  }, { shadow: [150, 240, 160, 7], flames: [[160 - 1, 140 + 20 - 13]] });
  // Barrels against the wall, between the window and the fireplace.
  sprite(410, 112, 90, 62, 170, b => { barrel(b, 4, 6, 38, 52); barrel(b, 46, 10, 36, 48); }, { shadow: [455, 170, 46, 6] });
  // The round table on the rug, with a candle, a tankard and a plate with an apple.
  sprite(390, 256, 104, 70, 320, b => {
    b.ellipse(52, 18, 46, 16, (u, v) => R.wood[v < -0.5 ? 4 : v > 0.55 ? 1 : u < -0.6 ? 4 : 3]);
    for (let y = 28; y < 34; y++) for (let x = 8; x < 96; x++) { const u = (x - 52) / 46; if (u * u < 1 - ((y - 18) / 18) ** 2 + 0.25) b.set(x, y, R.wood[1]); }
    for (let y = 30; y < 62; y++) for (let x = 47; x < 57; x++) b.set(x, y, x === 47 ? R.wood[3] : x === 56 ? R.wood[0] : R.wood[2]);
    b.ellipse(52, 63, 16, 4, (u, v) => R.wood[v < 0 ? 3 : 1]);
    candleStick(b, 52, 20); tankard(b, 18, 20);
    b.ellipse(78, 16, 9, 4, (u, v) => R.cream[v < -0.2 ? 4 : 2]); b.ellipse(78, 12, 3, 3, (u, v) => R.red[u < -0.3 ? 4 : 2]);
  }, { shadow: [442, 322, 44, 8], flames: [[390 + 51, 256 + 20 - 13]] });
  // Stools at the round table. The traveller sits on the left one.
  sprite(354, 298, 28, 32, 330, b => stool(b, 14, 6), { shadow: [368, 330, 14, 4] });
  sprite(500, 298, 28, 32, 330, b => stool(b, 14, 6), { shadow: [514, 330, 14, 4] });
  // A long table lower left, with a candle, an open book and a tankard; a bench in front.
  sprite(80, 322, 170, 82, 396, b => {
    for (let y = 8; y < 30; y++) for (let x = 2; x < 166; x++) b.set(x, y, y === 8 ? R.wood[4] : y === 29 ? R.wood[1] : (y - 8) % 7 === 0 ? R.wood[2] : R.wood[3]);
    for (let y = 30; y < 36; y++) for (let x = 2; x < 166; x++) b.set(x, y, R.wood[1]);
    for (const lx of [8, 154]) for (let y = 36; y < 74; y++) for (let x = lx; x < lx + 6; x++) b.set(x, y, x === lx ? R.wood[3] : R.wood[1]);
    candleStick(b, 82, 22); tankard(b, 130, 22);
    for (let y = 12; y < 22; y++) for (let x = 24; x < 52; x++) b.set(x, y, x === 37 || x === 38 ? R.cream[1] : (y - 12) % 3 === 0 && x % 4 ? R.cream[2] : R.cream[4]);
  }, { shadow: [165, 398, 90, 8], flames: [[80 + 81, 322 + 22 - 13]] });
  // Crates and a sack by the fireplace, a potted plant in the corner.
  sprite(586, 196, 80, 64, 258, b => {
    for (const [cx, cy, s] of [[4, 18, 42], [44, 30, 30]]) for (let y = cy; y < cy + s; y++) for (let x = cx; x < cx + s; x++) {
      const e = x === cx || y === cy || x === cx + s - 1 || y === cy + s - 1, d = Math.abs((x - cx) - (y - cy)) < 2;
      b.set(x, y, e ? R.wood[1] : x < cx + 3 || y < cy + 3 || x > cx + s - 4 || y > cy + s - 4 ? R.wood[3] : d ? R.wood[3] : (y - cy) % 8 === 0 ? R.wood[1] : R.wood[2]);
    }
    b.ellipse(20, 12, 13, 12, (u, v) => R.cream[v < -0.4 ? 3 : u > 0.4 ? 1 : 2]);
    for (let x = 16; x < 25; x++) b.set(x, 1, R.wood[1]);
  }, { shadow: [624, 260, 42, 7] });
  sprite(620, 330, 44, 90, 418, b => {
    for (let y = 58; y < 86; y++) for (let x = 8 + Math.floor((y - 58) / 7); x < 36 - Math.floor((y - 58) / 7); x++) b.set(x, y, y < 62 ? R.red[4] : x < 14 ? R.red[4] : R.red[3]);
    const lr = rng(5);
    for (let i = 0; i < 26; i++) {
      const lx = 22 + (lr() - 0.5) * 34, ly = 8 + lr() * 50;
      b.ellipse(lx, ly, 5, 3, (u, v) => R.leaf[u + v < -0.6 ? 4 : u + v > 0.5 ? 1 : 2 + (i % 2)]);
    }
  }, { shadow: [642, 418, 20, 5] });
}

// The room's light sources (for the evening glows): [x, y, radius, colour, strength].
export const LIGHTS = () => [
  [582, 116, 2 * T, '#ff8a30', 0.19],
  ...SPRITES.flatMap(s => (s.flames || []).map(([x, y]) => [x, y, 0.95 * T, '#ffa040', 0.16])),
  [507, 47, 0.95 * T, '#ffa040', 0.16], [651, 47, 0.95 * T, '#ffa040', 0.16],
  [348, 52, 1.1 * T, '#5070c0', 0.18],
];
export const MANTEL_FLAMES = [[507, 47], [651, 47]];
