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

// A project pane's leads side by side (#1554): the multi-project layouts' grids without the CTO
// pane; five leads are three above two. One lead or none is no grid.
export function leadGrid(n) {
  if (n <= 1) return null;
  if (n === 5) return ['v', [[['h', [[0, .34], [1, .33], [2, .33]]], .5], [['h', [[3, .5], [4, .5]]], .5]]];
  return LAYOUTS[autoLayout(Math.min(n, 4))].tree[1].find(([c]) => c !== 'M')[0];
}

// Ctrl+click on lead number n in a pane's header (#1554): it joins the pane's split, or leaves it
// if it is in. A split starts from the lead shown. split: the saved lead numbers, or null.
// Returns { split (null once one lead or none is left), show (the lead the pane shows) }.
export function toggleLead(split, shown, n) {
  const cur = split && split.length ? split : [shown];
  const next = cur.includes(n) ? cur.filter(k => k !== n) : [...cur, n];
  if (next.length <= 1) return { split: null, show: next[0] || shown };
  return { split: next, show: next.includes(shown) ? shown : next[next.length - 1] };
}
