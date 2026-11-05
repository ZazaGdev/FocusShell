// The Gemini barkeep demo page (#249): the cleaned image, the previous animation and the new one
// with moving clothes, side by side, all at the owner's #248 motion settings.
import { h } from '../art/dom.js';
import { PRESETS as RIG } from '../people/parts.js';

// The rig's presets, with the calm walk and sit the owner chose for this barkeep (#249).
const PRESETS = { ...RIG, walk: { speed: 3, fps: 15, bob: 2.5, arm: 5.5, leg: 4, tilt: 2.5 }, sit: { speed: 1, fps: 15, bob: 1, arm: 0, leg: 0, tilt: 0 } };
import { cutPrev, stagePrev } from './prev.js';
import { cutCloth, clothStage, TOP } from './cloth.js';

const controls = { mode: 'walk', ...PRESETS.walk, paused: false };
const SLIDERS = [
  ['speed', 'Speed', 0.2, 3, 0.1], ['fps', 'Frame rate', 4, 30, 1], ['bob', 'Bob height', 0, 6, 0.5],
  ['arm', 'Arm swing', 0, 14, 0.5], ['leg', 'Leg swing', 0, 10, 0.5], ['tilt', 'Head tilt', 0, 6, 0.5],
];

async function pixels(src) {
  const img = new Image(); img.src = src; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  return { rgba: ctx.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height, img };
}

const root = document.getElementById('demo');
const { rgba, w, h: H, img } = await pixels('barkeep.png');
const parts = cutCloth(rgba, w, H);
const live = clothStage(parts, w, H, controls), prev = stagePrev(cutPrev(rgba, w, H), w, H, false, controls);
// The cleaned image as it is, on the same floor and shadow.
const original = clothStage(parts, w, H, controls);
const bar = h('div', { class: 'bar' });
const sliders = h('div', { class: 'sliders' });
function loadPreset() { Object.assign(controls, PRESETS[controls.mode]); sliders.querySelectorAll('input').forEach((x, i) => { x.value = String(controls[SLIDERS[i][0]]); x.dispatchEvent(new Event('input')); }); }
for (const [m, label] of [['idle', 'Idle'], ['walk', 'Walk'], ['sit', 'Sit']]) {
  const b = h('button', { class: m === controls.mode ? 'on' : '' }, label);
  b.onclick = () => { controls.mode = m; loadPreset(); bar.querySelectorAll('.mode').forEach(x => x.classList.toggle('on', x === b)); };
  b.classList.add('mode');
  bar.append(b);
}
const pause = h('button', {}, 'Pause');
pause.onclick = () => { controls.paused = !controls.paused; pause.classList.toggle('on', controls.paused); };
const reset = h('button', {}, 'Reset sliders');
reset.onclick = loadPreset;
bar.append(pause, reset);
for (const [key, label, min, max, step] of SLIDERS) {
  const val = h('b', {}, String(controls[key]));
  const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(controls[key]) });
  input.oninput = () => { controls[key] = Number(input.value); val.textContent = input.value; };
  sliders.append(h('label', {}, h('span', {}, label, ' ', val), input));
}
const sheet = await pixels('parts.png');
const sheetCanvas = h('canvas', { width: String(sheet.w), height: String(sheet.h), style: `width:${sheet.w * 3}px` });
sheetCanvas.getContext('2d').drawImage(sheet.img, 0, 0);
root.append(bar, sliders,
  h('div', { class: 'row' },
    h('figure', {}, original.canvas, h('figcaption', {}, h('b', {}, 'Original'), ' the cleaned image, 51x105, 32 colours')),
    h('figure', {}, prev.canvas, h('figcaption', {}, h('b', {}, 'Previous'), ' rigid parts, gap filling painted on the body')),
    h('figure', {}, live.canvas, h('figcaption', {}, h('b', {}, 'New'), ' clothes move: apron sway, hem and crease, trouser folds, sleeve swing'))),
  h('h2', {}, 'The parts sheet, cleaned the same way'),
  h('p', {}, 'For comparison. Its arms are drawn in another pose than the standing image, so the animation uses parts cut from the standing image instead, which keeps him identical at rest.'),
  h('figure', {}, sheetCanvas, h('figcaption', {}, '211x60, shown at 3x')));
original.draw(0, { mode: 'idle', ctl: PRESETS.idle });
original.ctx.drawImage(img, 10, TOP);

// ?frames: every frame of one cycle of each pose on magenta, so any hole through the body shows.
if (location.search.includes('frames')) {
  const probe = clothStage(parts, w, H, controls);
  for (const [mode, secs] of [['idle', 4], ['walk', 1], ['sit', 2]]) {
    const ctl = PRESETS[mode], n = Math.round(secs * ctl.fps), cols = 12;
    const sheet = h('canvas', { width: String(probe.CW * cols), height: String(probe.CH * Math.ceil(n / cols)), style: 'width:100%' });
    const sx = sheet.getContext('2d');
    for (let f = 0; f < n; f++) { probe.draw(f / ctl.fps, { mode, ctl, bg: '#ff00ff' }); sx.drawImage(probe.canvas, (f % cols) * probe.CW, Math.floor(f / cols) * probe.CH); }
    root.prepend(h('h2', {}, `${mode}: ${n} frames`), sheet);
  }
}

let clock = 0, last = performance.now(), shown = -1;
function loop(now) {
  if (!controls.paused) clock += (now - last) / 1000;
  last = now;
  const frame = Math.floor(clock * controls.fps);
  if (frame !== shown) { shown = frame; live.draw(frame / controls.fps); prev.draw(frame / controls.fps); }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
