// The character demo page (#248): two people at three densities, posed every frame from the
// sliders. Parts are composed into a pixel image per canvas and scaled by whole numbers.
import { R } from '../art/pixels.js';
import { h } from '../art/dom.js';
import { CAST, PRESETS, buildParts, pose, sheared } from './parts.js';

const SIZES = [{ H: 48, zoom: 6, label: '32x48 (the #244 size)' }, { H: 72, zoom: 4, label: '48x72' }, { H: 96, zoom: 3, label: '64x96' }];
const controls = { mode: 'idle', ...PRESETS.idle, paused: false };
const SLIDERS = [
  ['speed', 'Speed', 0.2, 3, 0.1, 'cycles a second'],
  ['fps', 'Frame rate', 4, 30, 1, 'frames a second; pixel art often uses 8-12'],
  ['bob', 'Bob height', 0, 6, 0.5, 'breathing or stepping, in 64x96 pixels'],
  ['arm', 'Arm swing', 0, 14, 0.5, 'hand travel'],
  ['leg', 'Leg swing', 0, 10, 0.5, 'stride, or a dangling foot when sitting'],
  ['tilt', 'Head tilt', 0, 6, 0.5, 'how far the crown sways'],
];

// Colour strings to RGBA, cached.
const rgba = new Map();
function toRgba(c) {
  if (rgba.has(c)) return rgba.get(c);
  const m = c.match(/^#(..)(..)(..)$/), v = m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), 1] : [0, 0, 0, 1];
  rgba.set(c, v); return v;
}

// One canvas: a person at one density, with floor, shadow and stool drawn around them.
function figure(look, size) {
  const { H } = size, W = Math.round(H * 0.75) + 8, FH = H + 6, k = H / 96;
  const parts = buildParts(look, H);
  const canvas = h('canvas', { width: String(W), height: String(FH), style: `width:${W * size.zoom}px` });
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(W, FH), d = img.data;
  const put = (x, y, c, a = 1) => {
    x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= FH) return;
    const [r, g, b] = toRgba(c), i = (y * W + x) * 4;
    d[i] = d[i] * (1 - a) + r * a; d[i + 1] = d[i + 1] * (1 - a) + g * a; d[i + 2] = d[i + 2] * (1 - a) + b * a; d[i + 3] = 255;
  };
  const ox = Math.round((W - 64 * k) / 2), oy = 2;
  const blit = (buf, x, y) => {
    const bx = buf.ox || 0, by = buf.oy || 0;
    for (let j = 0; j < buf.h; j++) for (let i = 0; i < buf.w; i++) { const c = buf.px[j * buf.w + i]; if (c) put(ox + x + i - bx, oy + y + j - by, c); }
  };
  // A calm floor behind: long boards with faint seams, so the person and the shadow read first.
  const floor = [], board = Math.max(6, Math.round(12 * k));
  for (let y = 0; y < FH; y++) for (let x = 0; x < W; x++) {
    const plank = Math.floor(y / board), seam = y % board === 0 || (y % board > 0 && (x + plank * 37) % (board * 7) === 0);
    floor.push(seam ? R.dark[2] : (x * 7 + y * 13 + plank * 5) % 23 === 0 ? R.wood[2] : R.wood[1]);
  }
  const stool = (k2 => {
    const out = [];
    for (let y = Math.round(78 * k2); y <= Math.round(94 * k2); y++) for (let x = Math.round(22 * k2); x <= Math.round(46 * k2); x++) {
      const seat = y <= Math.round(82 * k2), leg = (x - Math.round(22 * k2) < Math.max(1, Math.round(3 * k2))) || (Math.round(46 * k2) - x < Math.max(1, Math.round(3 * k2)));
      if (seat) out.push([x, y, y === Math.round(78 * k2) ? R.wood[4] : R.wood[3]]); else if (leg) out.push([x, y, R.wood[x % 2 ? 1 : 2]]);
    }
    return out;
  })(k);

  function draw(t) {
    for (let i = 0; i < floor.length; i++) { const [r, g, b] = toRgba(floor[i]); d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; }
    const P = pose(controls.mode, t, controls, H), sit = controls.mode === 'sit';
    // A soft shadow under the feet: two stepped rings of dark, see-through pixels.
    const cx = 33 * k, cy = 94 * k, rx = (sit ? 18 : 15) * k, ry = 3.6 * k;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry, q = u * u + v * v;
      if (q <= 1) put(ox + x, oy + y, '#1a0e14', q < 0.45 ? 0.45 : 0.28);
    }
    const at = (name, lift = 0) => {
      const p = parts[name]; if (!p) return;
      const o = P.parts[name] || {};
      const fromBottom = name === 'head' || name === 'hair' || name === 'hairBack';
      const buf = sheared(p.buf, o.shear || o.shearBottom || 0, fromBottom);
      blit(buf, p.ax + (o.dx || 0), p.ay + (o.dy || 0) + lift);
    };
    const body = P.body + P.seat;
    at('hairBack', body); at('armBack', body);
    if (sit) { for (const [x, y, c] of stool) put(ox + x, oy + y, c); at('sitBack', P.seat); at('sitFront', P.seat); }
    else { at('legBack'); at('legFront'); }
    at('torso', body); at('armFront', body); at('head', body); at('hair', body);
    ctx.putImageData(img, 0, 0);
  }
  return { canvas, draw };
}

// Page: controls, then one row per person with the three densities side by side.
const figures = [];
const root = document.getElementById('demo');
const modeBar = h('div', { class: 'bar' });
for (const [m, label] of [['idle', 'Idle'], ['walk', 'Walk'], ['sit', 'Sit']]) {
  const b = h('button', { class: m === controls.mode ? 'on' : '' }, label);
  b.onclick = () => { controls.mode = m; loadPreset(); modeBar.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
  modeBar.append(b);
}
const pause = h('button', {}, 'Pause');
pause.onclick = () => { controls.paused = !controls.paused; pause.classList.toggle('on', controls.paused); };
modeBar.append(pause);
const sliders = h('div', { class: 'sliders' });
for (const [key, label, min, max, step, hint] of SLIDERS) {
  const val = h('b', {}, String(controls[key]));
  const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(controls[key]) });
  input.oninput = () => { controls[key] = Number(input.value); val.textContent = input.value; };
  sliders.append(h('label', {}, h('span', {}, label, ' ', val), input, h('small', {}, hint)));
}
const reset = h('button', {}, 'Reset sliders');
// Each pose starts from its own tuned motion; Reset goes back to it.
function loadPreset() { Object.assign(controls, PRESETS[controls.mode]); sliders.querySelectorAll('input').forEach((x, i) => { x.value = String(controls[SLIDERS[i][0]]); x.dispatchEvent(new Event('input')); }); }
reset.onclick = loadPreset;
modeBar.append(reset);
root.append(modeBar, sliders);
for (const look of Object.values(CAST)) {
  const row = h('div', { class: 'row' });
  for (const size of SIZES) {
    const f = figure(look, size);
    figures.push(f);
    row.append(h('figure', {}, f.canvas, h('figcaption', {}, h('b', {}, `${look.name}, ${size.label}`), ` shown at ${size.zoom}x`)));
  }
  root.append(h('h2', {}, look.name), row);
}

// Time advances in whole frames at the chosen frame rate, so motion steps like a sprite sheet.
let clock = 0, last = performance.now(), shown = -1;
function loop(now) {
  if (!controls.paused) clock += (now - last) / 1000;
  last = now;
  const frame = Math.floor(clock * controls.fps);
  if (frame !== shown) { shown = frame; for (const f of figures) f.draw(frame / controls.fps); }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
