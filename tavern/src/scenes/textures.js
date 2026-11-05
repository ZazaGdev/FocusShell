// Textures drawn in code (#238): the floor, walls, fireplace, bottle shelf, mugs, papers and
// the soft glows lights add at night. Drawn once at start into canvas textures; the Kenney
// sheets supply the furniture and characters.

import { TILE, COLS, ROWS, WALL_ROWS, FIREPLACE } from '../core/layout.js';

// A tiny seeded random, so the planks look the same every run (and in screenshots).
function rand(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

function canvas(scene, key, w, h, draw) {
  const t = scene.textures.createCanvas(key, w, h), c = t.getContext();
  draw(c, w, h);
  t.refresh();
  return t;
}
const px = (c, col, x, y, w = 1, h = 1) => { c.fillStyle = col; c.fillRect(x, y, w, h); };

export function makeTextures(scene) {
  const W = COLS * TILE, H = ROWS * TILE;
  // Floor: horizontal planks, 4px tall, seams and the odd knot.
  canvas(scene, 'floor', W, H, c => {
    const r = rand(7), tones = ['#8a5a33', '#93613a', '#82552f', '#8e5d36'];
    for (let y = 0; y < H; y += 4) {
      let x = -Math.floor(r() * 40);
      while (x < W) {
        const len = 24 + Math.floor(r() * 40);
        px(c, tones[Math.floor(r() * tones.length)], x, y, len, 4);
        px(c, '#6b4325', x, y + 3, len, 1);
        px(c, '#a87245', x, y, len, 1);
        px(c, '#5e3a20', x + len - 1, y, 1, 4);
        if (r() < 0.15) px(c, '#6f4628', x + 4 + Math.floor(r() * (len - 8)), y + 1, 2, 1);
        x += len;
      }
    }
  });
  // Walls: the back wall's two rows of stone with a wooden skirting, and dark side walls.
  canvas(scene, 'wall', W, WALL_ROWS * TILE, (c, w, h) => {
    const r = rand(3);
    px(c, '#3b3536', 0, 0, w, h);
    for (let y = 0; y < h - 4; y += 6) {
      const off = (y / 6) % 2 ? 5 : 0;
      for (let x = -off; x < w; x += 10) {
        const t = 0x55 + Math.floor(r() * 18);
        px(c, `rgb(${t},${t - 6},${t - 8})`, x + 1, y + 1, 9, 5);
        px(c, `rgb(${t + 14},${t + 8},${t + 4})`, x + 1, y + 1, 9, 1);
      }
    }
    px(c, '#5a3a22', 0, h - 4, w, 4); px(c, '#7a5232', 0, h - 4, w, 1); px(c, '#3e2716', 0, h - 1, w, 1);
  });
  // The fireplace: a stone frame round a dark mouth, drawn into the wall.
  canvas(scene, 'fireplace', FIREPLACE.w * TILE, (WALL_ROWS + 1) * TILE, (c, w, h) => {
    px(c, '#6d6669', 0, 2, w, h - 2); px(c, '#8a8386', 0, 2, w, 2);
    for (let y = 4; y < h; y += 5) for (let x = (y / 5) % 2 ? 0 : 4; x < w; x += 8) px(c, '#5b5457', x, y, 1, 5);
    px(c, '#4a2b1a', 0, 0, w, 3); px(c, '#6b4527', 0, 0, w, 1);       // mantel
    px(c, '#1a1210', 8, 10, w - 16, h - 12); px(c, '#2a1b15', 8, 10, w - 16, 2);
    px(c, '#3a2a22', 6, h - 4, w - 12, 4);                            // hearth stone
    px(c, '#4b3227', 14, h - 9, 20, 3); px(c, '#5b3c2c', 18, h - 11, 12, 3); // logs
    for (let i = 0; i < 3; i++) { px(c, '#d9c9a0', 6 + i * 16, -0, 2, 1); }
  });
  // Flames: three frames, and embers for the evening.
  for (let f = 0; f < 3; f++) canvas(scene, `flame${f}`, 24, 14, c => {
    const r = rand(11 + f);
    for (let i = 0; i < 26; i++) {
      const x = 3 + Math.floor(r() * 18), hgt = 3 + Math.floor(r() * 10) - Math.abs(x - 12) / 2;
      px(c, '#e2541b', x, 14 - hgt, 2, hgt); px(c, '#f59a2a', x, 14 - hgt * 0.7, 2, hgt * 0.7); px(c, '#ffe08a', x, 14 - hgt * 0.35, 1, hgt * 0.35);
    }
  });
  canvas(scene, 'embers', 24, 6, c => { const r = rand(5); for (let i = 0; i < 18; i++) px(c, r() < 0.5 ? '#b33a12' : '#e2681e', 2 + Math.floor(r() * 20), 2 + Math.floor(r() * 4), 2, 1); });
  // The bottle shelf behind the bar.
  canvas(scene, 'shelf', 7 * TILE, 12, (c, w) => {
    px(c, '#5a3a22', 0, 9, w, 3); px(c, '#7a5232', 0, 9, w, 1);
    const r = rand(9), cols = ['#3f7a4a', '#7a2f2f', '#c9a14a', '#3a5a8a', '#6a3f7a', '#b8662a'];
    for (let x = 2; x < w - 4; x += 5 + Math.floor(r() * 3)) {
      const col = cols[Math.floor(r() * cols.length)], hgt = 5 + Math.floor(r() * 4);
      px(c, col, x, 9 - hgt, 3, hgt); px(c, col, x + 1, 9 - hgt - 2, 1, 2); px(c, '#ffffff55', x, 9 - hgt + 1, 1, 2);
    }
  });
  // A round tavern table filling its 2x2 tiles: a planked top over a dark rim and its shadow.
  canvas(scene, 'table', 32, 32, c => {
    const row = (y, x0, x1, col) => px(c, col, x0, y, x1 - x0, 1);
    for (let y = 0; y < 32; y++) {
      const dy = (y - 14) / 13, half = dy * dy <= 1 ? Math.round(15 * Math.sqrt(1 - dy * dy)) : -1;
      if (half < 0) continue;
      row(y + 2, 16 - half, 16 + half, '#00000040');                        // shadow
      row(y, 16 - half, 16 + half, '#5e3a20');                               // rim
      if (half > 1 && y > 1 && y < 26) row(y, 17 - half, 15 + half, y % 5 === 0 ? '#8a5a33' : '#a4703f');
    }
    row(3, 9, 23, '#c08a52');
  });
  // A woven rug for before the fire.
  canvas(scene, 'rug', 48, 28, (c, w, h) => {
    px(c, '#7a2a1e', 0, 0, w, h); px(c, '#a33d24', 2, 2, w - 4, h - 4); px(c, '#d9a441', 4, 4, w - 8, 1); px(c, '#d9a441', 4, h - 5, w - 8, 1);
    for (let x = 8; x < w - 8; x += 6) px(c, '#e3b860', x, h / 2 - 1, 3, 2);
    for (let x = 0; x < w; x += 3) { px(c, '#e8d3a0', x, -0, 1, 1); px(c, '#e8d3a0', x, h - 1, 1, 1); }
  });
  // A mug of ale, and a sheet of paper with writing, for drinkers and workers.
  canvas(scene, 'mug', 6, 7, c => { px(c, '#f3ead2', 0, 0, 4, 2); px(c, '#b07a3c', 0, 2, 4, 5); px(c, '#8a5a2a', 4, 3, 2, 3); px(c, '#d29a50', 1, 2, 1, 5); });
  canvas(scene, 'paper', 8, 6, c => { px(c, '#efe6cf', 0, 0, 8, 6); px(c, '#9b8f78', 1, 1, 5, 1); px(c, '#9b8f78', 1, 3, 6, 1); px(c, '#3c2f25', 6, 0, 1, 4); });
  // Soft round glows for candles and the fire: brightest in the middle.
  for (const [key, size] of [['glow', 64], ['glowBig', 128]]) canvas(scene, key, size, size, (c, w) => {
    const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,190,110,0.9)'); g.addColorStop(0.4, 'rgba(255,150,60,0.35)'); g.addColorStop(1, 'rgba(255,120,40,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, w);
  });
  // The "?" a waiting guest shows, and the barkeeper's "z".
  canvas(scene, 'ask', 9, 11, c => {
    px(c, '#2b1d14', 0, 0, 9, 9); px(c, '#fff4d6', 1, 1, 7, 7); px(c, '#2b1d14', 3, 9, 3, 1); px(c, '#2b1d14', 4, 10, 1, 1);
    px(c, '#c0392b', 3, 2, 3, 1); px(c, '#c0392b', 5, 3, 1, 1); px(c, '#c0392b', 4, 4, 1, 1); px(c, '#c0392b', 4, 6, 1, 1);
  });
}
