// The app's one tooltip (#1035): where it goes and how its text splits. renderer/tip.js shows it.

export const DELAY = 300;
// Moving straight from one tooltip to the next within this long shows the next at once,
// so a row of icon buttons does not blink.
export const CHAIN = 400;
export const GAP = 9;
export const MARGIN = 6;

// A trailing "(Ctrl+Shift+F)" or "(Esc)" is the shortcut, shown faint after the label.
const KEY = /\s*\(((?:Ctrl|Alt|Shift|Win|Esc|Enter|Tab|F\d{1,2})\b[^()]*)\)\s*$/;
export function splitTip(text) {
  const s = String(text || '').trim(), m = s.match(KEY);
  return m ? { label: s.slice(0, m.index), key: m[1] } : { label: s, key: '' };
}

// target: the element's rect; size: the tooltip's { w, h }; view: { w, h }. Below the target
// unless there is no room, then above; kept MARGIN inside the window; the arrow points at the
// target's middle but never leaves the tooltip's rounded corners.
export function placeTip(target, size, view, gap = GAP) {
  const left = Math.max(MARGIN, Math.min(view.w - size.w - MARGIN, target.left + target.width / 2 - size.w / 2));
  const roomBelow = target.bottom + gap + size.h <= view.h - MARGIN;
  const roomAbove = target.top - gap - size.h >= MARGIN;
  const below = roomBelow || !roomAbove;
  const top = below ? Math.min(target.bottom + gap, view.h - size.h - MARGIN) : target.top - gap - size.h;
  const arrow = Math.max(8, Math.min(size.w - 16, target.left + target.width / 2 - left - 4));
  return { left: Math.round(left), top: Math.round(Math.max(MARGIN, top)), below, arrow: Math.round(arrow) };
}
