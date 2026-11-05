// Finished work on the wall (#282): the mug rack behind the bar hangs one mug per item closed
// today, and the mantel over the fire is the trophy shelf, a trophy for each day this week that
// closed something, taller the more it closed. Drawn in code from the rack's own art until there
// is art for it.
export const RACK = 'p:r3-back-mug-rack';
// The rack's picture: its beam is rows 0-16, the eleven mugs hang below it, split at these columns.
const BEAM = 17, CUTS = [14, 27, 40, 49, 59, 71, 79, 89, 99, 108];
export const HOOKS = CUTS.length + 1;
const mugOf = x => { const i = CUTS.findIndex(c => x < c); return i < 0 ? CUTS.length : i; };

// The rack with only its first n mugs, each casting its shadow on the wall the way the room's
// wall pieces do (3 right, 3 down). n 0 is the bare beam, whose shadow is in the room behind.
export function rackCanvas(art, n) {
  const w = art.width, h = art.height, c = document.createElement('canvas');
  c.width = w + 3; c.height = h + 3;
  const k = c.getContext('2d'), src = art.getContext('2d').getImageData(0, 0, w, h);
  const mugs = new ImageData(w, h);
  for (let y = BEAM; y < h; y++) for (let x = 0; x < w; x++) if (mugOf(x) < n) { const i = (y * w + x) * 4; mugs.data.set(src.data.subarray(i, i + 4), i); }
  const m = document.createElement('canvas'); m.width = w; m.height = h; m.getContext('2d').putImageData(mugs, 0, 0);
  const s = document.createElement('canvas'); s.width = w; s.height = h;
  const sk = s.getContext('2d'); sk.drawImage(m, 0, 0); sk.globalCompositeOperation = 'source-in'; sk.fillStyle = 'rgb(20,8,16)'; sk.fillRect(0, 0, w, h);
  k.globalAlpha = 0.38; k.drawImage(s, 3, 3); k.globalAlpha = 1;
  k.drawImage(bareRack(art), 0, 0); k.drawImage(m, 0, 0);
  return c;
}
// The beam alone, for the room behind's shadow.
export function bareRack(art) {
  const c = document.createElement('canvas'); c.width = art.width; c.height = art.height;
  c.getContext('2d').drawImage(art, 0, 0, art.width, BEAM, 0, 0, art.width, BEAM);
  return c;
}

// The trophies on the mantel: seven places, Monday to Sunday, standing on the line y between x0
// and x1. A day that closed nothing has an empty place.
export function drawTrophies(g, days, x0, x1, y) {
  g.clear();
  const most = Math.max(1, ...days), step = (x1 - x0) / days.length;
  days.forEach((n, i) => {
    if (!n) return;
    const cx = Math.round(x0 + step * (i + 0.5)), h = 9 + Math.round(9 * n / most), cup = Math.round(h * 0.5), w = 4 + Math.round(h / 4);
    const top = y - h;
    // A dark rim first, then the gold: foot, stem, cup, handles, a shine.
    g.fillStyle(0x2a1608).fillRect(cx - w / 2 - 2, y - 3, w + 4, 3).fillRect(cx - 2, top + cup - 1, 4, h - cup - 1).fillRect(cx - w / 2 - 1, top - 1, w + 2, cup + 2);
    g.fillStyle(0x2a1608).fillRect(cx - w / 2 - 4, top + 1, 3, Math.max(3, cup - 3)).fillRect(cx + w / 2 + 1, top + 1, 3, Math.max(3, cup - 3));
    g.fillStyle(0xd9a032).fillRect(cx - w / 2 - 1, y - 2, w + 2, 2).fillRect(cx - 1, top + cup, 2, h - cup - 2).fillRect(cx - w / 2, top, w, cup);
    g.fillStyle(0xd9a032).fillRect(cx - w / 2 - 3, top + 2, 2, Math.max(1, cup - 5)).fillRect(cx + w / 2 + 1, top + 2, 2, Math.max(1, cup - 5));
    g.fillStyle(0xffe08a).fillRect(cx - w / 2 + 1, top + 1, 1, cup - 2).fillStyle(0x8a5a1a).fillRect(cx + w / 2 - 1, top + 1, 1, cup - 1);
  });
}
