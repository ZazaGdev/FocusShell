// Baking a character's poses into sprite sheets (#246). The rigs (cloth.js for the front and back,
// side.js for the side) warp the cleaned picture pixel by pixel; run per frame for every figure
// that is the slow part of the room, so each character's poses are drawn once, here, into one
// canvas per view, and the scene plays them as Phaser animations. Frames are taken at the
// animation frame rate (15 a second), exactly the frames the room demo used to draw: a walk step
// cycle is 5 frames at speed 3, sitting and standing idle breathe over 30.
import { cutCloth, clothStage, layout, TOP } from '../gemini/cloth.js';
import { sideStage } from './side.js';

export const PAD = 10;
const FPS = 15;
const cycle = c => Math.round(FPS * (c.mode === 'walk' ? 1 : 2) / c.speed);

async function pixels(src) {
  const img = new Image(); img.src = src; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  return { rgba: ctx.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height };
}

// A character's rigs: { front: { stage, foot, cx, k, hh, seatRows }, side?, back? }.
// front: the picture's URL; lay: its body layout (robots.js), or null for the barkeep's own rig;
// angles: URLs of its side and back views, when it has them.
export async function rigCharacter(front, lay, angles = {}) {
  const im = await pixels(front);
  const L = lay ? layout({ ...lay, w: im.w, h: im.h }) : null;
  const parts = cutCloth(im.rgba, im.w, im.h, 0, ...(L ? [L] : []));
  const ctl = { mode: 'idle', speed: 1, bob: 0, arm: 0, leg: 0, tilt: 0 };
  const rig = { front: { stage: clothStage(parts, im.w, im.h, ctl), foot: im.h - 1, cx: parts.L.cx, k: parts.L.k, hh: im.h, hip74: parts.L.y(74), w: im.w } };
  const body = lay || { neck: 22, shoulder: 24, hand: 72, hip: 76, back: 13, front: 34 };
  if (angles.side) {
    const s = await pixels(angles.side);
    rig.side = { stage: sideStage(s.rgba, s.w, s.h, Math.round(body.hip * s.h / im.h), ctl), foot: s.h - 1, cx: Math.round(s.w / 2) };
  }
  if (angles.back) {
    const b = await pixels(angles.back), sx = b.w / im.w, sy = b.h / im.h;
    const BL = layout({ neck: Math.round(body.neck * sy), shoulder: Math.round(body.shoulder * sy), hand: Math.round(body.hand * sy), hip: Math.round(body.hip * sy),
      back: Math.round(body.back * sx), front: Math.round(body.front * sx), w: b.w, h: b.h });
    rig.back = { stage: clothStage(cutCloth(b.rgba, b.w, b.h, 0, BL), b.w, b.h, ctl), foot: b.h - 1, cx: BL.cx };
  }
  return rig;
}

// Draws the rigs' frames into sheets and makes the Phaser textures and animations, all named
// from key: animations <key>:idle, :sit, :walk, :walk-side, :walk-back. presets: the motion per
// pose (walk, sit, idle). The walk is baked at the stride its view shows: a mostly sideways walk
// at almost the whole reach, a mostly up-and-down one at a little of it.
// Returns { origin: { anim: [ox, oy] } } for placing a sprite's feet on its position.
export function bake(scene, key, rig, presets) {
  const anims = [], origin = {};
  const reach = (1.8 + presets.walk.leg * 0.9) * rig.front.k;
  const sheet = (view, rows) => {
    const st = rig[view].stage, n = Math.max(...rows.map(r => r.n)), tex = `${key}:${view}`;
    if (scene.textures.exists(tex)) scene.textures.remove(tex);
    const t = scene.textures.createCanvas(tex, st.CW * n, st.CH * rows.length), ctx = t.getContext();
    rows.forEach((r, j) => {
      for (let i = 0; i < r.n; i++) {
        st.draw(i / FPS, { clear: true, noBench: true, mode: r.ctl.mode, ctl: r.ctl });
        ctx.drawImage(st.canvas, i * st.CW, j * st.CH);
        t.add(`${r.name}-${i}`, 0, i * st.CW, j * st.CH, st.CW, st.CH);
      }
      anims.push({ key: `${key}:${r.name}`, frames: Array.from({ length: r.n }, (_, i) => ({ key: tex, frame: `${r.name}-${i}` })) });
      origin[r.name] = [(PAD + rig[view].cx) / st.CW, (TOP + rig[view].foot) / st.CH];
    });
    t.refresh();
  };
  const walk = share => ({ ...presets.walk, mode: 'walk', stride: reach * share });
  const row = (name, ctl) => ({ name, ctl, n: cycle(ctl) });
  sheet('front', [row('idle', { ...presets.idle, mode: 'idle' }), row('sit', { ...presets.sit, mode: 'sit' }), row('walk', walk(0.45))]);
  if (rig.side) sheet('side', [row('walk-side', walk(0.9))]);
  if (rig.back) sheet('back', [row('walk-back', walk(0.45))]);
  for (const a of anims) {
    if (scene.anims.exists(a.key)) scene.anims.remove(a.key);
    scene.anims.create({ key: a.key, frames: a.frames, frameRate: FPS, repeat: -1 });
  }
  return { origin };
}
