// The recorder's marked area (#376): the rules behind the Snipping Tool style overlay. A drag
// gives a rectangle in the display's own coordinates (DIP, the overlay covers one display);
// the crop is that rectangle in the captured display's pixels; the floating bar and the border
// sit around it, never over what is recorded.

export const MIN = 32; // a smaller drag is a click, not an area

// The rectangle between two points of a drag, whichever way it went.
export function rectOf(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(Math.abs(b.x - a.x)), height: Math.round(Math.abs(b.y - a.y)) };
}

export const bigEnough = r => !!r && r.width >= MIN && r.height >= MIN;

// The area in the pixels of the captured display (its DIP size times scale), clamped to it and
// kept on even numbers, which the video frames need.
export function cropFor(r, scale, full) {
  const even = n => Math.max(0, Math.floor(n / 2) * 2);
  const x = even(Math.min(full.width - 2, r.x * scale)), y = even(Math.min(full.height - 2, r.y * scale));
  const width = Math.max(2, even(Math.min(full.width - x, r.width * scale)));
  const height = Math.max(2, even(Math.min(full.height - y, r.height * scale)));
  return { x, y, width, height };
}

// The area on the desktop: the display's origin plus the area.
export const onDesktop = (r, d) => ({ x: d.x + r.x, y: d.y + r.y, width: r.width, height: r.height });

// The border's window: the area grown by t on each side, so the line sits outside the recording.
export const borderBounds = (r, t = 3) => ({ x: r.x - t, y: r.y - t, width: r.width + 2 * t, height: r.height + 2 * t });

// Where the floating bar goes: centred above the area, else below it, else inside its top edge.
// r and d are desktop rectangles (the area and its display), bar is { width, height }.
export function barSpot(r, d, bar, gap = 8) {
  const x = Math.round(Math.min(Math.max(d.x, r.x + (r.width - bar.width) / 2), d.x + d.width - bar.width));
  if (r.y - gap - bar.height >= d.y) return { x, y: r.y - gap - bar.height };
  if (r.y + r.height + gap + bar.height <= d.y + d.height) return { x, y: r.y + r.height + gap };
  return { x, y: r.y + gap };
}
