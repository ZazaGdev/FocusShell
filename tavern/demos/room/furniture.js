// The room's furniture (#249, #251, #261). The owner's new pieces (#251) come one picture each and are
// cut and brought to the people's scale by tools/fit-prop.py into tavern/art/props ("p:" names);
// the pieces not sent yet (shields, painting, rug, cat, plant, the small things on the tables) are
// left out until they come. Everything is shown 1:1, so every pixel in the room is the same size
// as the people's.
// Relative to this file, so the same code works in the demo page and in the app (#246).
const ART = new URL('../../art/sprites/', import.meta.url).href, PROPS = new URL('../../art/props/', import.meta.url).href;
export const S = 1; // every piece 1:1

// [name, x, y, base]. Wall pieces (base -1, behind everyone): y is the top. Everything else: y is
// the line it rests on (the floor line, a table top, the mantel), and its bottom row is drawn on
// it, so nothing floats. base orders depth: a floor piece's base is its floor line and it gets a
// contact shadow there; items on a surface use that surface's base plus a little.
// A name in ANIMS is drawn from its frames in turn.
// The tables (#251, #261, #270): [type, x, y, aisle], where y is the middle of the table's back
// edge and aisle the x of the clear lane right of the table (its chairs included). Sitters
// sit behind their table facing the room, the table hiding their laps, on the long bench (or a
// stool at the small round table). Seats per type (offsets from x), and how far right of x the
// aisle beside it runs, are in robots.js. 20 seats: a long table for four, three square and
// four round tables for two, two small round tables for one.
// Moved for #297: both long tables on the right, one above the other; the barrel table up by the
// bar, beside the bar's own barrel table and clear of the bar aisle; the rest spread evenly.
// The right side holds three tables (the owner's pick): a square one up by the fire over the two
// long ones; the two left in the top row spread wider.
export const TABLES = [
  ['square', 250, 430, 358], ['round', 640, 430, 748], ['square', 1090, 290, 1198], ['long', 1090, 430, 1225],
  ['round', 140, 610, 248], ['square', 360, 610, 468], ['round', 580, 610, 688], ['small', 800, 610, 875], ['long', 1090, 610, 1225],
  ['barrel', 600, 250, 690],
];
const TOP = { long: 'r2-table-long', square: 'r2-table-square-front', round: 'r2-table-round', small: 'r2-table-small' };
const tableSet = ([type, x, y]) => {
  // A barrel table (#263) is stood at, not sat at: no seat behind it, its mugs on top.
  if (type === 'barrel') return [['p:r2-table-barrel', x - 37, y + 12, y + 12]];
  // Sizes as cut (#267: tables reach a seated robot's chest).
  const t = TOP[type], w = { long: 184, square: 87, round: 92, small: 73 }[type], h = { long: 90, square: 90, round: 90, small: 80 }[type];
  // Only the long table has the long bench; at the others each sitter has a small chair, seen
  // from the front behind them, and an empty one stands side-on at the table's left (#265).
  const chair = dx => ['p:r2-chair-small-front', x + dx - 20, y - 8, y - 8];
  // A chair stands side-on at each end of a long table, facing it (#270).
  const seats = type === 'long' ? [['p:r2-bench-long', x - 92, y - 8, y - 8], ['p:r2-chair-small-side', x - 92 - 42, y + 10, y + 10], ['p:r2-chair-small-side~flip', x + 92 + 1, y + 10, y + 10]]
    : [...(type === 'small' ? [chair(0)] : [chair(-20), chair(22)]), ['p:r2-chair-small-side', x - Math.floor(w / 2) - 44, y + 10, y + 10]];
  // On the top (#266): the candle, and a little clutter by table type.
  const top = y + 12 - h + 14, on = (n, dx, k) => ['p:' + n, x + dx, top, y + 12.2 + k * 0.01];
  const clutter = { long: [on('r3-jug', -50, 0), on('r3-bread', 30, 1)], round: [on('r3-bread', 10, 0), on('r3-mug', -24, 1)], square: [on('r3-tankard', 12, 0)], small: [on('r3-mug-2', 8, 0)] }[type];
  return [...seats, ['p:' + t, x - Math.floor(w / 2), y + 12, y + 12], ['candle', x - 7, top, y + 12.1], ...clutter];
};
// The barkeep's break: a stool behind the right end of the bar (#263; it was a bench past it).
export const KEEPER_SEAT = [322, 196];
// The front-on fireplace with its own chimney (#261); [x, floor line].
export const FIREPLACE = { x: 806, y: 150 }; // 1.3 times its art (#263)
export const PLACES = [
  // Wall, between the top beam and the wainscot rail; the door stands on the floor. Timber posts
  // at x 0, 236, 470, 704, 938 and 1172.
  // Behind the bar (#268): the chalkboard menu high over the bar's left return, the mug rack
  // under the beam over the tap barrels on their ledge where the barkeep stands, the bottle shelf.
  ['p:r3-back-chalkboard', 38, 14, -1], ['p:r3-back-mug-rack', 92, 12, -1], ['p:r3-back-tap-ledge', 93, 44, -1], ['p:r2-back-shelf', 218, 14, -1],
  ['p:notice-board-lamp', 386, 28, -1], ['p:door-closed', 482, 10, -1],
  ['window', 728, 14, -1], ['p:lantern', 1010, 10, -1], ['window', 1060, 14, -1],
  // Decorations (#266, moved for #268): antlers over the barrel stack, shields on two posts, the
  // painting on the far right wall.
  ['p:r3-antlers', 602, 6, -1], ['p:r3-shield-round', 678, 26, -1], ['p:r3-shield-crest', 1154, 24, -1], ['p:r3-painting', 1196, 18, -1],
  // The fireplace, its fire in the opening, candles on its mantel, the cat asleep in front.
  ['p:r2-fireplace', FIREPLACE.x, FIREPLACE.y, FIREPLACE.y], ['fire', FIREPLACE.x + 66, FIREPLACE.y - 24, FIREPLACE.y + 0.1],
  ['candle', FIREPLACE.x + 29, FIREPLACE.y - 120, FIREPLACE.y + 0.2], ['candle', FIREPLACE.x + 146, FIREPLACE.y - 120, FIREPLACE.y + 0.2],
  ['cat', FIREPLACE.x + 80, FIREPLACE.y + 26, FIREPLACE.y + 26],
  // The broom and bucket by the door, the plant by the right wall.
  ['p:r3-broom-bucket', 432, 152, 152], ['p:r3-plant', 1250, 330, 330],
  // Behind the bar against the wall: the tap barrels and the barrel rack. Along the rest of the
  // wall: sacks, a keg, a barrel; two chairs by the fire.
  // The one barrel stack (#263), right of the door.
  ['p:r2-barrel-rack', 566, 150, 150],
  ['p:sacks', 1004, 144, 144], ['p:keg', 1185, 142, 142], ['p:barrel', 1250, 146, 146],
  // The chairs by the fire both face it: the right one as drawn, the left one its mirror (#263);
  // set back near the wall (#269), clear of the aisles that end in front of them.
  ['p:r2-chair-back~flip', 736, 178, 178], ['p:r2-chair-back', 1004, 178, 178],
  // The corner bar (#261): the front with the taps runs along the room; on the left it turns back
  // to the wall (end blocks stepping back), on the right it is open, the way in. Tall stools in
  // front, and a barrel table to stand at by the open end.
  // The front-on corner counter (#265): its left end turns back to the wall, its right end is
  // open; drawn 1.85 times its picture to keep the doubled width of #263.
  // Two layers (#267): the left return, rising behind the front, is drawn behind the barkeep;
  // the front section in front of him. Moved back a little, half a tile.
  ['p:r2-corner-bar~back', 10, 226, 150.5], ['p:r2-corner-bar~front', 10, 226, 226],
  ...[86, 146, 206, 266, 326].map(x => ['p:r2-stool-tall', x, 256, 256]),
  ['p:r2-table-barrel', 478, 300, 300],
  ['p:r2-stool-round', KEEPER_SEAT[0] - 16, KEEPER_SEAT[1] - 6, KEEPER_SEAT[1] - 6],
  ...TABLES.flatMap(tableSet),
];
// Pieces drawn from frames: [frames, frames a second]. The window shows the clock's light (#283):
// day, dusk (made from the day one, daylight.js) or night.
export const ANIMS = {
  fire: [['p:r2-fire-1', 'p:r2-fire-2', 'p:r2-fire-3', 'p:r2-fire-4'], 8],
  candle: [['p:candle-1', 'p:candle-2', 'p:candle-3'], 5],
  torch: [['p:torch-1', 'p:torch-2', 'p:torch-3'], 7],
  window: [['p:r2-window-night', 'p:r2-window-day'], 0],
  // The cat breathes: two frames, slowly.
  cat: [['p:r3-cat-1', 'p:r3-cat-2'], 1.2],
};
// Pieces drawn flat on the floor, under everyone: the rug under the long table (#266).
export const FLOOR = [['p:r3-rug', 986, 405], ['p:r3-rug', 986, 585]];
// The owner's floor and wall tiles (#266), loaded for ?tiles.
export const TILES = ['p:r3-floor-tile', 'p:r3-wall-tile'];
// Pieces swapped in while the room runs: the door standing open (#281).
export const SWAPS = ['p:door-open'];
// The mugs the guests drink from (#307): wooden tankard, glass pint, pewter stein, clay mug.
export const BEERS = ['p:r4-beer-wood', 'p:r4-beer-glass', 'p:r4-beer-stein', 'p:r4-beer-clay'];
// Where the light comes from, in room pixels: [x, y, radius in tiles, colour, strength].
export const GLOWS = [
  [FIREPLACE.x + 95, FIREPLACE.y - 58, 1.9, '#ff8a30', 0.19], [FIREPLACE.x + 37, FIREPLACE.y - 130, 0.8, '#ffa040', 0.16], [FIREPLACE.x + 154, FIREPLACE.y - 130, 0.8, '#ffa040', 0.16],
  [414, 34, 0.7, '#ffb050', 0.14],
  [1020, 40, 0.9, '#ffb050', 0.16],
  ...[758, 1090].map(x => [x, 52, 0.9, '#5070c0', 0.18]),
  ...TABLES.filter(([t]) => t !== 'barrel').map(([, x, y]) => [x, y - 50, 0.9, '#ffa040', 0.16]),
];

export const key = n => n;
export async function loadPieces() {
  const names = [...new Set([...PLACES.map(p => p[0]), ...FLOOR.map(f => f[0]), ...TILES, ...SWAPS, ...BEERS].flatMap(n => (ANIMS[n] ? ANIMS[n][0] : [n])))], out = {};
  await Promise.all(names.map(async n => {
    // A name ending in ~flip is that piece mirrored; ~back and ~front are the corner bar's two
    // layers: its left return (columns 0-95, rows 0-53) and the rest.
    const base = n.replace(/~(flip|back|front)$/, ''), img = new Image(); img.src = base.startsWith('p:') ? `${PROPS}${base.slice(2)}.png` : `${ART}${base}.png`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const k = c.getContext('2d', { willReadFrequently: true });
    if (n.endsWith('~flip')) { k.translate(img.width, 0); k.scale(-1, 1); }
    k.drawImage(img, 0, 0);
    if (/~(back|front)$/.test(n)) {
      const back = n.endsWith('~back'), d = k.getImageData(0, 0, c.width, c.height);
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if ((x < 96 && y < 54) !== back) d.data[(y * c.width + x) * 4 + 3] = 0;
      k.putImageData(d, 0, 0);
    }
    out[n] = c;
  }));
  return out;
}

// Where a piece touches the floor: the span of its bottom three rows of pixels.
export function footprint(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let l = c.width, r = -1;
  for (let y = Math.max(0, c.height - 3); y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 0) { l = Math.min(l, x); r = Math.max(r, x); }
  return r < 0 ? [0, c.width - 1] : [l, r];
}
