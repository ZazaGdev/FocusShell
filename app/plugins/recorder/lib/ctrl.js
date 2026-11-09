// Hold Ctrl to draw (#1908): while recording, Ctrl held on its own turns the pen on and letting it
// go turns it off again. Ctrl with another key (Ctrl+C, Ctrl+S) is a shortcut, so that hold never
// draws, not even after the other key is let go.

// prev: { down, spoiled } or null; keys: { ctrl, other } as read now. Returns { state, pen }.
export function ctrlHold(prev, { ctrl, other }) {
  if (!ctrl) return { state: null, pen: false };
  const state = { down: true, spoiled: !!(prev && prev.spoiled) || !!other };
  return { state, pen: !state.spoiled };
}

// The key watcher's lines: "<ctrl 0|1><other 0|1>", as "10". Anything else is null.
export function keysLine(line) {
  const m = String(line).trim().match(/^([01])([01])$/);
  return m ? { ctrl: m[1] === '1', other: m[2] === '1' } : null;
}
