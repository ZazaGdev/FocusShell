// Snap layouts. A tree is ["h"|"v", [[child, fraction], ...]];
// "M" is the manager pane, a number is a slot filled by a session.

export const LAYOUTS = {
  'm-1':   { mgr: true,  tree: ['h', [['M', .3], [0, .7]]] },
  'm-2r':  { mgr: true,  tree: ['h', [['M', .3], [['v', [[0, .5], [1, .5]]], .7]]] },
  'm-3r':  { mgr: true,  tree: ['h', [['M', .3], [['v', [[0, .34], [1, .33], [2, .33]]], .7]]] },
  'm-2x2': { mgr: true,  tree: ['h', [['M', .3], [['v', [[['h', [[0, .5], [1, .5]]], .5], [['h', [[2, .5], [3, .5]]], .5]]], .7]]] },
  'm-3c':  { mgr: true,  tree: ['h', [['M', .3], [['h', [[0, .34], [1, .33], [2, .33]]], .7]]] },
  'm-1+2': { mgr: true,  tree: ['h', [['M', .3], [['v', [[0, .6], [['h', [[1, .5], [2, .5]]], .4]]], .7]]] },
  'm-3x2': { mgr: true,  tree: ['h', [['M', .25], [['v', [[['h', [[0, .34], [1, .33], [2, .33]]], .5], [['h', [[3, .34], [4, .33], [5, .33]]], .5]]], .75]]] },
  '3x2-m': { mgr: true,  tree: ['h', [[['v', [[['h', [[0, .34], [1, .33], [2, .33]]], .5], [['h', [[3, .34], [4, .33], [5, .33]]], .5]]], .75], ['M', .25]]] },
};

export const SINGLE_WITH_MANAGER = ['h', [['M', .3], [0, .7]]];

export function slotCount(t) {
  if (t === 'M') return 0;
  if (typeof t === 'number') return 1;
  return t[1].reduce((a, [c]) => a + slotCount(c), 0);
}

// Projects the manager opens join the panes on screen; the most recent `max` stay visible.
export function splitWith(current, added, max = 6) {
  const out = current.filter(n => !added.includes(n));
  return [...out, ...added.filter((n, i) => added.indexOf(n) === i)].slice(-max);
}

// The CTO pane is in every split (#118).
export function autoLayout(n) {
  return n <= 1 ? 'm-1' : n === 2 ? 'm-2r' : n === 3 ? 'm-3r' : n === 4 ? 'm-2x2' : 'm-3x2';
}
