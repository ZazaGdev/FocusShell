// Walking around things (#298): the floor as a grid of small cells, the furniture people must not
// walk through marked solid, and a shortest path (A*) between two points over the free cells,
// pulled straight wherever the way is clear. Not a physics engine: blockers are boxes on the
// floor where each piece stands, made a little wider so a body stays clear of them.
export const CELL = 6;
// How far a body keeps from a blocker: half a body's width either side, a little front and back.
const PAD_X = 9, PAD_Y = 3;

// Which floor pieces block, and how deep their box is above the line they stand on. The chairs
// and bench a guest sits on, the barkeep's own stool and the rugs are left free: people sit there.
const DEPTH = [
  [/table-(long|square|round|small|barrel)/, 'table'], [/chair-small-side|chair-back/, 10], [/stool-tall/, 8],
  [/corner-bar~front/, 16], [/fireplace/, 20], [/barrel-rack|sacks|keg|p:barrel$|plant|broom-bucket/, 12],
];
// The opaque columns of a picture: [left, right].
function span(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let l = c.width, r = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 0) { if (x < l) l = x; if (x > r) r = x; }
  return r < 0 ? [0, c.width - 1] : [l, r];
}

// The blockers of a room: [{ x0, y0, x1, y1 }] from its floor pieces [name, x, y, base].
// A table blocks from its back edge (where its sitters sit, 12 above its base) to its front.
export function blockersOf(places, pictureOf) {
  const out = [];
  for (const [n, x, , base] of places) {
    if (base < 0 || base % 1 !== 0) continue;
    const rule = DEPTH.find(([re]) => re.test(n));
    if (!rule) continue;
    const img = pictureOf(n);
    if (!img) continue;
    const [l, r] = span(img), depth = rule[1] === 'table' ? 12 : rule[1];
    out.push({ x0: x + l, x1: x + r, y0: base - depth, y1: base });
  }
  return out;
}

// The grid: solid cells under the blockers (padded), above the floor's top and at the walls.
export function floorGrid(blockers, w, h, top) {
  const cols = Math.ceil(w / CELL), rows = Math.ceil(h / CELL), solid = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = i * CELL + CELL / 2, y = j * CELL + CELL / 2;
    if (y < top || x < 6 || x > w - 6 || y > h - 2) { solid[j * cols + i] = 1; continue; }
    for (const b of blockers) if (x >= b.x0 - PAD_X && x <= b.x1 + PAD_X && y >= b.y0 - PAD_Y && y <= b.y1 + PAD_Y) { solid[j * cols + i] = 1; break; }
  }
  return { cols, rows, solid, w, h };
}
const cellOf = (g, x, y) => Math.max(0, Math.min(g.rows - 1, Math.floor(y / CELL))) * g.cols + Math.max(0, Math.min(g.cols - 1, Math.floor(x / CELL)));
export const solidAt = (g, x, y, extra) => { const c = cellOf(g, x, y); return !!g.solid[c] || !!(extra && extra.has(c)); };

// The way from a to b: [[x, y], ...] ending at b. Cells within `near` of either end count as free,
// so people get out of and into their seats. extra: a Set of cells also solid (other people).
// No way at all: null.
export function findPath(g, [ax, ay], [bx, by], { near = 16, extra = null } = {}) {
  const n = g.cols * g.rows, start = cellOf(g, ax, ay), goal = cellOf(g, bx, by);
  const free = c => { const x = (c % g.cols) * CELL + CELL / 2, y = Math.floor(c / g.cols) * CELL + CELL / 2;
    return (!g.solid[c] && !(extra && extra.has(c))) || Math.hypot(x - ax, y - ay) <= near || Math.hypot(x - bx, y - by) <= near; };
  if (start === goal) return [[bx, by]];
  const cost = new Float32Array(n).fill(Infinity), from = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  const gx = goal % g.cols, gy = Math.floor(goal / g.cols);
  const est = c => { const dx = Math.abs((c % g.cols) - gx), dy = Math.abs(Math.floor(c / g.cols) - gy); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
  const heap = [[est(start), start]];
  const push = e => { heap.push(e); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  cost[start] = 0;
  let found = false;
  while (heap.length) {
    const [, c] = pop();
    if (done[c]) continue;
    done[c] = 1;
    if (c === goal) { found = true; break; }
    const cx = c % g.cols, cy = Math.floor(c / g.cols);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) continue;
      const d = y * g.cols + x;
      if (done[d] || !free(d)) continue;
      // No cutting a corner between two solid cells.
      if (dx && dy && (!free(cy * g.cols + x) || !free(y * g.cols + cx))) continue;
      const k = cost[c] + (dx && dy ? 1.414 : 1);
      if (k < cost[d]) { cost[d] = k; from[d] = c; push([k + est(d), d]); }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let c = from[goal]; c !== -1 && c !== start; c = from[c]) cells.push(c);
  const pts = cells.reverse().map(c => [(c % g.cols) * CELL + CELL / 2, Math.floor(c / g.cols) * CELL + CELL / 2]);
  pts.push([bx, by]);
  // Pulled straight: from each point, on to the furthest one in clear sight.
  const clear = (p, q) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]), s = Math.ceil(d / 3);
    for (let i = 1; i < s; i++) { const x = p[0] + (q[0] - p[0]) * i / s, y = p[1] + (q[1] - p[1]) * i / s; if (!free(cellOf(g, x, y))) return false; } return true; };
  const out = [];
  let at = [ax, ay], i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !clear(at, pts[j])) j--;
    out.push(pts[j]); at = pts[j]; i = j + 1;
  }
  return out;
}
