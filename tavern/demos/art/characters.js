// Guests and the barkeep for the art demos (#244), drawn from body proportions at three
// sprite sizes so the same person can be compared at each density. Front view only.
import { Buf, R, INK, FOAM, lit, darker } from './pixels.js';

// Body proportions per sprite size (w x h). Pixel rows and columns, all whole numbers.
export const SIZES = {
  s16: { w: 16, h: 16, head: [8, 5.5, 5, 4.6], torso: [5, 10, 11, 13], arm: 1, leg: [13, 15, 2, 0], shoe: 1, eye: [6, 1, 1, 1], mouth: 0, detail: 0 },
  s32: { w: 16, h: 32, head: [8, 9.5, 6.5, 6.5], torso: [4, 16, 12, 25], arm: 2, leg: [25, 31, 3, 0], shoe: 2, eye: [10, 2, 1, 2], mouth: 0, detail: 1 },
  s48: { w: 32, h: 48, head: [16, 14, 9.5, 9], torso: [9, 23, 23, 37], arm: 3, leg: [37, 47, 5, 2], shoe: 3, eye: [14, 3, 2, 3], mouth: 19, detail: 2 },
};

// The cast: a barkeep and three guests, one palette.
export const CAST = [
  { name: 'Barkeep', skin: R.skinA, hair: R.hairBrown, style: 'beard', shirt: R.cream, pants: R.pants, apron: true, sleeves: R.cream },
  { name: 'Guest: coder', skin: R.skinB, hair: R.hairGrey, style: 'bun', shirt: R.blue, pants: R.pants },
  { name: 'Guest: writer', skin: R.skinA, hair: R.hairRed, style: 'long', shirt: R.green, pants: R.dark },
  { name: 'Guest: researcher', skin: R.skinA, hair: R.hairBlond, style: 'hat', hat: R.purple, shirt: R.red, pants: R.pants, mug: true },
];

// One frame of a person. anim 'idle' (frames 0-1) or 'walk' (frames 0-3).
export function person(sizeKey, look, anim = 'idle', frame = 0) {
  const S = SIZES[sizeKey], b = new Buf(S.w, S.h);
  const [cx, hcy, hrx, hry] = S.head, [tx0, ty0, tx1, ty1] = S.torso;
  const walk = anim === 'walk', f = frame % (walk ? 4 : 2);
  const bob = walk ? (f % 2 ? -1 : 0) : (S.detail && f === 1 ? 1 : 0);   // breathing / stepping
  const swing = walk ? [0, 1, 0, -1][f] : 0;

  // Legs and shoes. A walking step lifts one leg a pixel.
  const [ly0, ly1, lw, gap] = S.leg;
  for (const side of [-1, 1]) {
    const x = side < 0 ? cx - gap / 2 - lw : cx + gap / 2, lift = walk && side === swing ? 1 : 0;
    b.box(x, ly0, lw, ly1 - ly0 + 1 - lift - S.shoe, (u, v) => lit(look.pants, u * 0.6 + side * 0.4, v * 0.3, 2));
    b.box(x - (S.detail > 1 && side < 0 ? 1 : 0), ly1 - S.shoe + 1 - lift, lw + (S.detail > 1 ? 1 : 0), S.shoe, (u, v) => lit(R.dark, u, v, 2));
  }
  // Torso, rounded at the shoulders on the bigger sizes.
  const ty = ty0 + bob, th = ty1 - ty0 - bob;
  b.box(tx0, ty, tx1 - tx0, th, (u, v, x, y) => {
    if (S.detail && y === ty && (x === tx0 || x === tx1 - 1)) return null;
    return lit(look.shirt, u, v * 0.5 - (y === ty ? 0.6 : 0), 2);
  });
  if (look.apron) {
    const ax0 = tx0 + 1 + (S.detail > 1 ? 1 : 0), ax1 = tx1 - 1 - (S.detail > 1 ? 1 : 0), ay = ty0 + Math.round((ty1 - ty0) * 0.35);
    b.box(ax0, ay, ax1 - ax0, ly0 - ay + Math.round((ly1 - ly0) * 0.5), (u, v) => lit(R.cream, u, v * 0.3, 4, 1.2));
    if (S.detail) b.hline(ax0, ax1 - 1, ay, R.cream[3]);
    if (S.detail > 1) { b.vline(ax0 + 2, ty + 1, ay - 1, R.cream[2]); b.vline(ax1 - 3, ty + 1, ay - 1, R.cream[2]); b.hline(ax0 + 3, ax1 - 4, ay + 4, R.cream[2]); }
  } else if (S.detail > 1) {
    b.hline(tx0, tx1 - 1, ty1 - 3, R.dark[2]); b.set(cx, ty1 - 3, R.brass[3]); b.set(cx - 1, ty1 - 3, R.brass[2]);      // belt and buckle
    b.vline(cx, ty + 2, ty1 - 5, darker(look.shirt[2])); b.set(cx + 1, ty + 4, look.shirt[4]); b.set(cx + 1, ty + 8, look.shirt[4]); // placket and buttons
  }
  // Arms swing against the step; hands in skin, a mug for the one holding one.
  const aw = S.arm;
  for (const side of [-1, 1]) {
    const x = side < 0 ? tx0 - aw : tx1, dy = walk ? side * swing : 0, ay0 = ty + 1 + dy, ay1 = ty1 - 2 - (S.detail > 1 ? 1 : 0) + dy;
    b.box(x, ay0, aw, ay1 - ay0, (u, v) => lit(look.sleeves || look.shirt, u + side * 0.5, v * 0.4, 2));
    b.box(x, ay1, aw, Math.max(1, S.detail), (u, v) => lit(look.skin, u, v, 3));
    if (look.mug && side > 0) {
      const mh = 2 + S.detail * 2, mw = 2 + S.detail;
      b.box(x + aw - 1, ay1 - mh + 2, mw, mh, (u, v) => lit(R.wood, u, v, 3)).hline(x + aw - 1, x + aw + mw - 2, ay1 - mh + 1, FOAM);
    }
  }
  // Head, ears on the bigger sizes, then hair, face and beard.
  const hy = hcy + bob;
  if (look.style === 'long') b.box(cx - hrx, hy - 1, hrx * 2, hry + 3 + S.detail * 2, (u, v) => lit(look.hair, u, v, 2));
  if (S.detail > 1) for (const s of [-1, 1]) b.ellipse(cx + s * (hrx - 0.5), hy + 1.5, 1.6, 2.2, (u, v) => lit(look.skin, u, v, 2));
  b.ellipse(cx, hy, hrx, hry, (u, v) => lit(look.skin, u, v, 3, 1.2));
  hair(b, S, look, cx, hy, hrx, hry);
  const [ey, edx, ew, eh] = S.eye, eyeY = ey + bob;
  for (const s of [-1, 1]) {
    const ex = s < 0 ? cx - edx - ew : cx + edx;
    b.rect(ex, eyeY, ew, eh, INK);
    if (S.detail > 1) { b.set(ex + (s < 0 ? 1 : 0), eyeY, FOAM); b.set(ex + (s < 0 ? -1 : 2), eyeY + 3, R.red[4]); b.set(ex + (s < 0 ? 0 : 1), eyeY + 3, R.red[4]); }
    if (S.detail > 1) b.hline(ex - (s < 0 ? 0 : 0), ex + ew - 1, eyeY - 2, darker(look.hair[2]));   // brows
  }
  if (S.mouth) b.hline(cx - 1, cx, S.mouth + bob, look.skin[1]);
  if (look.style === 'beard') {
    const top = S.detail > 1 ? S.mouth - 1 : eyeY + eh + 1;
    b.ellipse(cx, hy + hry * 0.35, hrx * 0.82, hry * 0.75, (u, v) => lit(look.hair, u, v, 3, 1.2), (x, y) => y >= top + bob);
    if (S.mouth) b.hline(cx - 1, cx, S.mouth + 1 + bob, look.skin[2]);
  }
  return b.outline();
}

function hair(b, S, look, cx, hy, hrx, hry) {
  const h = look.hair, d = S.detail, line = hy - hry * (look.style === 'beard' ? 0.42 : 0.3);
  const paint = (u, v) => lit(h, u, v, 3, 1.3);
  if (look.style === 'hat') {
    const brimY = Math.round(line) + 1;
    b.ellipse(cx, hy - hry * 0.35, hrx * 0.82, hry * 0.8, (u, v) => lit(look.hat, u, v, 2), (x, y) => y < brimY);
    b.box(Math.round(cx - hrx - 1 - d), brimY, Math.round(hrx * 2 + 2 + d * 2), 1 + (d > 1 ? 1 : 0), (u, v) => lit(look.hat, u, v - 0.5, 3));
    if (d) b.hline(Math.round(cx - hrx * 0.6), Math.round(cx + hrx * 0.6) - 1, brimY - 1 - d, R.brass[3]);   // band
    for (const s of [-1, 1]) b.box(s < 0 ? Math.round(cx - hrx) : Math.round(cx + hrx) - 1 - d, brimY + 1, 1 + d, 2 + d * 2, paint);
    return;
  }
  b.ellipse(cx, hy - 0.6, hrx + 0.6, hry + 0.6, paint, (x, y) => {
    if (y + 0.5 < line) return true;
    const side = x < cx - hrx * 0.62 || x >= cx + hrx * 0.62;
    if (look.style === 'beard') return false;
    if (side && y < hy + (look.style === 'long' ? hry : 1)) return true;
    return d > 1 && y + 0.5 < line + 2 && (x % 4 === 0 || x % 4 === 1) && Math.abs(x + 0.5 - cx) > 2;   // a ragged fringe
  });
  if (look.style === 'bun') b.ellipse(cx, hy - hry - 1 - d, 2 + d, 2 + d * 0.8, paint);
  if (d > 1) for (let x = Math.round(cx - hrx * 0.5); x < cx + hrx * 0.3; x += 3) b.set(x, Math.round(hy - hry + 2), h[4]);   // shine
}
