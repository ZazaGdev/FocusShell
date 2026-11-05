// The room's light follows the local clock (#283): day, dusk and night in the windows, the room
// dimmed to match. It replaced the evening that fell after 30 minutes without input.

// Day from 7:00 to 18:00, dusk either side (5:00-7:00, 18:00-21:00), night the rest.
export function lightAt(d = new Date()) {
  const h = d.getHours() + d.getMinutes() / 60;
  return h >= 7 && h < 18 ? 'day' : (h >= 5 && h < 7) || (h >= 18 && h < 21) ? 'dusk' : 'night';
}
export const LIGHTS = ['day', 'dusk', 'night'];
// Per light: the colour multiplied over the room (null: none), how strong the lamps' glows are,
// and the window picture. Night is lighter than the old evening (0x6a5a86), lighter again in #310
// (it was 0x80709a): about halfway to dusk's brightness, its blue kept.
export const LOOK = {
  day: { dim: null, glow: 0, window: 'p:r2-window-day' },
  dusk: { dim: 0xc4a2a0, glow: 0.55, window: 'p:r2-window-dusk' },
  night: { dim: 0x988bae, glow: 1, window: 'p:r2-window-night' },
};

// The dusk window, made from the day one: its pale blue glass turned into a sunset sky, violet
// at the top to orange low down, keeping the glass's own light and shade.
export function duskWindow(day) {
  const c = document.createElement('canvas'); c.width = day.width; c.height = day.height;
  const k = c.getContext('2d'); k.drawImage(day, 0, 0);
  const img = k.getImageData(0, 0, c.width, c.height), d = img.data;
  const top = [122, 84, 150], low = [244, 160, 92];
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const i = (y * c.width + x) * 4, [r, g, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
    if (!a || !(b > 150 && b > r + 30)) continue;
    const f = y / c.height, shade = (r + g + b) / (3 * 210);
    for (let j = 0; j < 3; j++) d[i + j] = Math.min(255, Math.round((top[j] + (low[j] - top[j]) * f) * shade));
  }
  k.putImageData(img, 0, 0);
  return c;
}
