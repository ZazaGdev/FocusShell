// The art demos page (#244): the same tavern corner at three densities, and the cast up close.
import { h } from './dom.js';
import { drawRoom, COLS, ROWS } from './room.js';
import { person, SIZES, CAST } from './characters.js';

const VARIANTS = [
  { id: 'A', T: 16, size: 's16', zoom: 4, title: 'A. Today\'s size: 16px tiles, 16x16 people', note: 'What the live tavern uses now (Kenney-sized). Round, chibi heads; little room for faces or clothes.' },
  { id: 'B', T: 16, size: 's32', zoom: 4, title: 'B. Stardew size: 16px tiles, 16x32 people', note: 'Same floor and furniture as A, people twice as tall. Faces, hair styles and an apron start to read. Stardew Valley and Travellers Rest both sit near here.' },
  { id: 'C', T: 32, size: 's48', zoom: 2, title: 'C. Denser: 32px tiles, 32x48 people', note: 'Twice the pixels in each direction, shown half as big so it takes the same space. Eyes with highlights, ears, belts, nails in the floor, brick bevels. About 4 times the drawing work per sprite.' },
];

const state = { night: true, anim: true, tick: 0 };
const live = [];

function scene(v) {
  const c = h('canvas', { width: COLS * v.T, height: ROWS * v.T });
  c.style.width = `${COLS * v.T * v.zoom}px`;
  live.push(() => drawRoom(c.getContext('2d'), v.T, v.size, state.tick, state.night));
  return h('figure', {}, c, h('figcaption', {}, h('b', {}, v.title), h('br'), v.note));
}

// A strip of the cast at one size: idle frame, then the four walk frames, at `zoom`.
function lineup(sizeKey, zoom, label, note) {
  const S = SIZES[sizeKey], pad = 6, w = CAST.length * (S.w + pad) + pad, hgt = S.h + 2 * pad;
  const mk = () => { const c = h('canvas', { width: w, height: hgt }); return c; };
  const big = mk(), small = mk();
  big.style.width = `${w * zoom}px`; small.style.width = `${w * 2}px`;
  const draw = () => {
    for (const [c, anim] of [[big, 'idle'], [small, 'walk']]) {
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#3a2a22'; ctx.fillRect(0, 0, c.width, c.height);
      CAST.forEach((look, i) => person(sizeKey, look, anim, anim === 'walk' ? state.tick : state.tick >> 2).draw(ctx, pad + i * (S.w + pad), pad));
    }
  };
  live.push(draw);
  return h('figure', {}, big, h('div', { style: 'height:8px' }), small,
    h('figcaption', {}, h('b', {}, label), h('br'), note));
}

const root = document.getElementById('sections');
root.append(
  h('h2', {}, '1. Pixel density: the same corner three ways'),
  h('p', {}, 'Each one is the same tavern corner drawn at its native size, then scaled by a whole number so pixels stay square. Toggle Evening light above to see the candle-lit version.'),
  h('div', { class: 'row' }, ...VARIANTS.map(scene)),
  h('h2', {}, '2. The cast up close'),
  h('p', {}, 'Barkeep, then three guests. Top: breathing idle, enlarged. Below: the walk cycle at 2x.'),
  h('div', { class: 'row' },
    lineup('s16', 8, '16x16 (today)', 'Enlarged 8x.'),
    lineup('s32', 8, '16x32 (Stardew size)', 'Enlarged 8x.'),
    lineup('s48', 5, '32x48 (denser)', 'Enlarged 5x.')),
);

document.getElementById('night').onclick = e => { state.night = !state.night; e.target.classList.toggle('on', state.night); render(); };
document.getElementById('anim').onclick = e => { state.anim = !state.anim; e.target.classList.toggle('on', state.anim); };
function render() { for (const f of live) f(); }
render();
setInterval(() => { if (state.anim && !document.hidden) { state.tick++; render(); } }, 125);
