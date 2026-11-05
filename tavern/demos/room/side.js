// A figure seen from the side, walking (#262). The side view (drawn facing right) is cut at the
// hip: above it the body rides the walk's bob; below it the legs swing front to back from the
// hip. The leg as drawn is the near one; the far one is a darker copy swinging the other way,
// behind the body. A lifted foot rises a little as it swings forward. Rows and stage size follow
// the front rig's (cloth.js) conventions, so the room places either the same way.
import { h } from '../art/dom.js';
import { pose } from '../people/parts.js';

const PAD = 10, TOP = 8;
const clamp01 = v => Math.max(0, Math.min(1, v));
const darker = c => { const [r, g, b] = c.match(/\d+/g).map(Number); return `rgb(${Math.round(r * 0.72)},${Math.round(g * 0.72)},${Math.round(b * 0.75)})`; };

// rgba, W, H: the side view; hip: the first leg row; ctl: the person's controls.
export function sideStage(rgba, W, H, hip, ctl) {
  const px = (x, y) => { const i = (y * W + x) * 4; return rgba[i + 3] >= 128 ? `rgb(${rgba[i]},${rgba[i + 1]},${rgba[i + 2]})` : null; };
  // The legs are kept row by row, so a row that moves away from the one above can be filled.
  const upper = [], near = [], far = [];
  for (let y = 0; y < H; y++) {
    const nr = [], fr = [];
    for (let x = 0; x < W; x++) {
      const c = px(x, y);
      if (!c) continue;
      if (y < hip) upper.push([x, y, c]); else { nr.push([x, c]); fr.push([x, darker(c)]); }
    }
    if (y >= hip) { near.push(nr); far.push(fr); }
  }
  const leg = H - 1 - hip, k = leg / 28;
  const CW = W + PAD * 2, CH = H + 4 + TOP;
  const canvas = h('canvas', { width: String(CW), height: String(CH) });
  const ctx = canvas.getContext('2d');
  // A leg: each row moves forward by its share of the swing (none at the hip, all of it at the
  // foot); the shin and foot rise by lift.
  // The hip rides the body's bob and the feet stay on the floor, so nothing parts at the hip;
  // where a row lands more than one row below the one before, that row is drawn again in between.
  const drawLeg = (rows, swing, lift, body) => {
    let last = null;
    rows.forEach((row, i) => {
      const y = hip + i, t = clamp01(i / leg), dx = Math.round(swing * t), yd = y + (t > 0.45 ? -lift : 0) + Math.round(body * (1 - t));
      const put = (r, ox, yy) => { for (const [x, c] of r) { ctx.fillStyle = c; ctx.fillRect(PAD + x + ox, TOP + yy, 1, 1); } };
      if (last) for (let yy = last.yd + 1; yy < yd; yy++) put(last.row, last.dx, yy);
      put(row, dx, yd);
      last = { row, dx, yd };
    });
  };
  function draw(t, o = {}) {
    if (o.clear) ctx.clearRect(0, 0, CW, CH);
    const c = o.ctl || ctl, p = t * c.speed * Math.PI * 2, step = Math.sin(p);
    // The stride: in a room it comes from the ground speed, so a planted foot stays put.
    const stride = c.stride ?? Math.max(1, c.leg) * k;
    const lift = s => Math.round(Math.max(0, s * Math.cos(p)) * Math.max(2, c.leg * 0.5) * k);
    const body = Math.round(pose('walk', t, c, 96).body * k);
    drawLeg(far, -stride * step, lift(-1), body);
    for (const [x, y, col] of upper) { ctx.fillStyle = col; ctx.fillRect(PAD + x, TOP + y + body, 1, 1); }
    drawLeg(near, stride * step, lift(1), body);
  }
  // cx: the middle of the feet, which the room keeps on the person's position.
  return { canvas, draw, ctx, CW, CH, foot: H - 1, cx: Math.round(W / 2) };
}
