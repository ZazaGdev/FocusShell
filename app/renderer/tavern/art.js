// The tavern's art catalogue (#240): every sprite and tile the scene draws, by name. The
// scene asks for 'chairRight' or a character's look and never for sheet coordinates, so the
// final art replaces this file and the sheets, and nothing else. Placeholder art today:
// Kenney's CC0 packs (assets/LICENSES.md) plus what textures.js draws in code.

const BASE = new URL('./assets/', import.meta.url).href;

export const SHEETS = {
  indoor: { url: BASE + 'indoor.png', size: 16, spacing: 1, cols: 27 },
  chars: { url: BASE + 'characters.png', size: 16, spacing: 1, cols: 54 },
};

// name -> [sheet, col, row]
const TILES = {
  chairRight: ['indoor', 2, 2], chairLeft: ['indoor', 3, 2],
  barLeft: ['indoor', 4, 7], barMid: ['indoor', 5, 7], barRight: ['indoor', 7, 7],
  candle: ['indoor', 16, 6], candelabra: ['indoor', 16, 7], torch: ['indoor', 20, 6],
  shieldRound: ['indoor', 22, 8], shieldKite: ['indoor', 22, 9], painting: ['indoor', 20, 12], plant: ['indoor', 16, 0],
};

const frameOf = (sheet, c, r) => [sheet, r * SHEETS[sheet].cols + c];
// [texture key, frame index] for a named tile.
export const tile = name => frameOf(...TILES[name]);
// [texture key, frame index] for a character look ([col, row] in the character sheet).
export const character = look => frameOf('chars', look[0], look[1]);
// CSS for a look as a portrait `scale` times its size (the answer box, Settings' picker).
export function portraitStyle(look, scale) {
  const s = SHEETS.chars, step = (s.size + s.spacing) * scale;
  return `background-image:url("${s.url}");background-position:-${look[0] * step}px -${look[1] * step}px;background-size:${918 * scale}px ${203 * scale}px;width:${s.size * scale}px;height:${s.size * scale}px`;
}
