// Layered people for the character demo (#248): each body part is its own small pixel image,
// drawn in code from the #244 palette at a chosen density, outlined on its own so parts
// read against each other. The pose moves parts by whole pixels only, so nothing blurs.
// Proportions are written for a 64x96 figure and scaled to the density asked for.
import { Buf, R, lit, darker } from '../art/pixels.js';

// The two people in the demo. Three-quarter view, facing down and to the right.
export const CAST = {
  barkeep: { name: 'Barkeep', skin: R.skinA, hair: R.hairBrown, beard: true, shirt: R.cream, vest: R.green, apron: R.cream, pants: R.pants, boots: R.dark },
  traveller: { name: 'Traveller', skin: R.skinA, hair: R.hairRed, long: true, shirt: R.cream, jacket: R.blue, pants: R.wood, boots: R.dark },
};

// Motion per pose: walk as the owner approved it in the room (#249), sit as tuned in #248,
// idle as first shown.
export const PRESETS = {
  idle: { speed: 1, fps: 12, bob: 2, arm: 6, leg: 5, tilt: 2 },
  walk: { speed: 3, fps: 15, bob: 2.5, arm: 5.5, leg: 4, tilt: 2.5 },
  sit: { speed: 1, fps: 20, bob: 1, arm: 0, leg: 2.5, tilt: 0 },
};

// Hue shift on top of the ramps: shadows lean cool, lights lean warm, as in hand-shaded art.
const shade = (ramp, u, v, base, k) => lit(ramp, u, v, base, k);

// All parts of one person at height H (48, 72 or 96), keyed by name. Each part is a Buf with
// an anchor (ax, ay) in figure pixels where its top-left sits in the standing pose.
export function buildParts(look, H) {
  const k = H / 96, s = v => Math.round(v * k), parts = {};
  const part = (name, x0, y0, w, h, draw, outline = true) => {
    const b = new Buf(Math.max(1, s(w)), Math.max(1, s(h)));
    draw(b, (x) => (x - x0) * k, (y) => (y - y0) * k);
    parts[name] = { buf: outline ? b.outline() : b, ax: s(x0), ay: s(y0) };
  };
  const skin = look.skin;

  // Hair that falls behind the shoulders (long hair only).
  if (look.long) part('hairBack', 19, 10, 28, 42, (b, X, Y) => {
    b.ellipse(X(33), Y(24), 13 * k, 14 * k, (u, v) => shade(look.hair, u, v, 2, 1.4));
    b.box(X(21), Y(24), 24 * k, 26 * k, (u, v, x, y) => (v > 0.7 && (x + y) % 3 === 0 ? null : shade(look.hair, u, v * 0.4, 2, 1.6)));
  });
  // Arms: a sleeve with its hand. The back arm sits behind the body, the front one in front.
  for (const [name, x] of [['armBack', 16], ['armFront', 43]]) part(name, x, 37, 8, 27, (b, X, Y) => {
    const sleeve = look.jacket || look.shirt, back = name === 'armBack';
    b.box(X(x + 1), Y(38), 6 * k, 20 * k, (u, v) => shade(sleeve, u + (back ? 0.5 : -0.2), v * 0.3, back ? 1 : 2, 1.5));
    if (look.jacket) b.box(X(x + 1), Y(55), 6 * k, 2 * k, (u, v) => shade(look.shirt, u, v, 2));
    b.ellipse(X(x + 4), Y(60), 3.4 * k, 3.6 * k, (u, v) => shade(skin, u + (back ? 0.4 : 0), v, back ? 2 : 3, 1.4));
  });
  // Legs: trousers and a boot pointing a little to the right.
  for (const [name, x] of [['legBack', 24], ['legFront', 33]]) part(name, x, 61, 11, 34, (b, X, Y) => {
    const back = name === 'legBack';
    b.box(X(x + 1), Y(62), 7 * k, 25 * k, (u, v) => shade(look.pants, u + (back ? 0.5 : 0), v * 0.3, back ? 1 : 2, 1.5));
    b.box(X(x + 1), Y(86), 9 * k, 8 * k, (u, v) => shade(look.boots, u, v, back ? 2 : 3, 1.5));
    b.hline(X(x + 1), X(x + 9), Y(86), look.boots[back ? 3 : 4]);
  });
  // Sitting legs: the thigh runs forward from the hip, the shin hangs from the knee.
  for (const [name, x, y] of [['sitBack', 24, 61], ['sitFront', 31, 62]]) part(name, x, y, 24, 34, (b, X, Y) => {
    const back = name === 'sitBack';
    b.box(X(x + 1), Y(y + 1), 18 * k, 8 * k, (u, v) => shade(look.pants, u * 0.3, v + (back ? 0.6 : 0), back ? 1 : 2, 1.5));
    b.box(X(x + 12), Y(y + 6), 7 * k, 11 * k, (u, v) => shade(look.pants, u + (back ? 0.5 : 0), v * 0.3, back ? 1 : 2, 1.5));
    b.box(X(x + 12), Y(y + 16), 9 * k, 7 * k, (u, v) => shade(look.boots, u, v, back ? 2 : 3, 1.5));
  });
  // Torso: shirt, then a vest or a jacket, a belt and, for the barkeep, an apron.
  part('torso', 20, 34, 27, 36, (b, X, Y) => {
    b.box(X(21), Y(36), 24 * k, 26 * k, (u, v, x, y) => (y === Math.round(Y(36)) && (x <= X(22) || x >= X(43)) ? null : shade(look.shirt, u, v * 0.6, 2, 1.6)));
    const coat = look.vest || look.jacket;
    if (coat) {
      const open = look.vest ? 4 : 2;
      for (const [x0, w] of [[21, 12 - open / 2], [33 + open / 2, 12 - open / 2]]) b.box(X(x0), Y(37), w * k, (look.jacket ? 26 : 21) * k, (u, v) => shade(coat, u + (x0 > 30 ? 0.2 : 0.2) - 0.1, v * 0.5, 2, 1.6));
      for (const y of [44, 50, 56]) b.set(X(34 + open / 2), Y(y), R.brass[3]);
    }
    b.box(X(21), Y(58), 24 * k, 3 * k, (u, v) => shade(R.wood, u, v, 1));
    b.box(X(32), Y(58), 3 * k, 3 * k, (u, v) => shade(R.brass, u, v, 3));
    // The apron hangs in soft vertical folds, darker towards the far side.
    if (look.apron) b.box(X(24), Y(52), 18 * k, 18 * k, (u, v, x) => shade(look.apron, u * 0.9 + (Math.floor((x - X(24)) / Math.max(2, s(4))) % 2 ? 0.5 : 0), -0.2, 3, 1.3));
  });
  // Head: face, ear, eyes with a highlight, nose, mouth. Then hair and beard on top.
  part('head', 21, 8, 25, 28, (b, X, Y) => {
    b.box(X(30), Y(31), 7 * k, 5 * k, (u, v) => shade(skin, u + 0.6, v, 2));
    b.ellipse(X(23.5), Y(23), 2.6 * k, 3.4 * k, (u, v) => shade(skin, u, v, 2, 1.2));
    b.ellipse(X(33.5), Y(21), 11 * k, 12 * k, (u, v) => shade(skin, u * 0.9 - 0.1, v * 0.8, 3, 1.5));
    const eye = (x, y) => {
      const w = Math.max(1, s(2)), hh = Math.max(1, s(3));
      b.rect(X(x), Y(y), w, hh, R.dark[0]);
      if (H >= 72) b.set(X(x) + w - 1, Y(y), '#fff4dc');
      if (H >= 72) b.hline(X(x) - 1, X(x) + w - 1, Y(y) - s(2), look.hair[1]);
    };
    eye(29, 21); eye(37.5, 21);
    b.vline(X(35), Y(24), Y(26), darker(skin[3]));
    if (!look.beard) b.hline(X(32), X(36), Y(29), skin[1]);
    b.set(X(31), Y(26), skin[4]);
  });
  part('hair', 20, 6, 27, 30, (b, X, Y) => {
    // A cap over the crown, a fringe swept to the left and a side lock over the ear.
    b.ellipse(X(33.5), Y(17), 12 * k, 10 * k, (u, v, x, y) => (y > Y(15) + Math.round((x - X(22)) * 0.18) ? null : shade(look.hair, u, v, 2, 1.6)));
    b.box(X(21), Y(16), 4 * k, (look.long ? 18 : 9) * k, (u, v) => shade(look.hair, u, v * 0.5, 1, 1.4));
    for (let i = 0; i < 4; i++) b.set(X(27 + i * 3), Y(12 + (i % 2)), look.hair[4]);
    if (look.beard) {
      b.ellipse(X(34), Y(28.5), 9.5 * k, 6.5 * k, (u, v, x, y) => (y < Y(25) ? null : shade(look.hair, u, v, 2, 1.4)));
      b.hline(X(32), X(36), Y(28), R.dark[1]);
    }
  });
  return parts;
}

// The pose at time t (seconds) for the controls c: per-part whole-pixel offsets and shears.
// Distances in c are in 96-unit pixels and scaled to the density, then rounded.
export function pose(mode, t, c, H) {
  const k = H / 96, px = v => Math.round(v * k), p = t * c.speed * Math.PI * 2;
  // Sitting lowers everything above the knees onto the stool.
  const out = { body: 0, seat: mode === 'sit' ? px(10) : 0, parts: {} };
  const breath = (1 - Math.cos(t * c.speed * Math.PI)) / 2;
  const sway = Math.sin(t * c.speed * Math.PI * 0.5);
  if (mode === 'walk') {
    const step = Math.sin(p), lift = v => -px(c.leg * 0.45 * Math.max(0, v));
    out.body = -px(c.bob * Math.abs(Math.cos(p)));
    out.parts.legFront = { dx: px(c.leg * step), dy: lift(Math.cos(p)) };
    out.parts.legBack = { dx: -px(c.leg * step), dy: lift(-Math.cos(p)) };
    out.parts.armFront = { shear: -c.arm * step * k };
    out.parts.armBack = { shear: c.arm * step * k };
    out.parts.head = out.parts.hair = out.parts.hairBack = { shear: c.tilt * Math.sin(p * 0.5) * k * 0.5 };
  } else {
    out.body = -px(c.bob * breath);
    out.parts.armFront = { shear: c.arm * 0.25 * sway * k, dy: px(c.bob * breath * 0.5) };
    out.parts.armBack = { shear: -c.arm * 0.25 * sway * k, dy: px(c.bob * breath * 0.5) };
    out.parts.head = out.parts.hair = out.parts.hairBack = { shear: c.tilt * sway * k };
    if (mode === 'sit') out.parts.sitFront = { dx: 0, shearBottom: c.leg * 0.3 * Math.sin(p * 0.5) * k };
  }
  return out;
}

// A copy of a part with each row moved sideways: `amount` pixels at the far end, fading to 0
// at the anchored end (top for arms and legs, bottom for the head). Whole pixels only.
export function sheared(buf, amount, fromBottom = false) {
  if (!amount || Math.abs(amount) < 0.5) return buf;
  const n = Math.ceil(Math.abs(amount)) + 1, b = new Buf(buf.w + 2 * n, buf.h);
  b.ox = (buf.ox || 0) + n; b.oy = buf.oy || 0;
  for (let y = 0; y < buf.h; y++) {
    const f = fromBottom ? 1 - y / (buf.h - 1 || 1) : y / (buf.h - 1 || 1), dx = Math.round(amount * f);
    for (let x = 0; x < buf.w; x++) { const c = buf.px[y * buf.w + x]; if (c) b.px[y * b.w + x + n + dx] = c; }
  }
  return b;
}
