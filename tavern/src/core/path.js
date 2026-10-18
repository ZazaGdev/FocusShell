// A* over the tavern's tile grid, four directions. Returns the tiles to walk after `from`,
// ending on `to`, or null when there is no way through. A blocked goal is never reached.

export function findPath(grid, from, to) {
  const rows = grid.length, cols = grid[0].length;
  const ok = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && !grid[y][x];
  if (!ok(to.x, to.y)) return null;
  if (from.x === to.x && from.y === to.y) return [];
  const key = (x, y) => y * cols + x;
  const h = (x, y) => Math.abs(x - to.x) + Math.abs(y - to.y);
  const g = new Map([[key(from.x, from.y), 0]]), came = new Map();
  const open = [{ x: from.x, y: from.y, f: h(from.x, from.y) }];
  const closed = new Set();
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0], ck = key(cur.x, cur.y);
    if (closed.has(ck)) continue;
    if (cur.x === to.x && cur.y === to.y) {
      const out = [];
      for (let k = ck; k !== key(from.x, from.y); k = came.get(k)) out.push({ x: k % cols, y: Math.floor(k / cols) });
      return out.reverse();
    }
    closed.add(ck);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx, ny = cur.y + dy, nk = key(nx, ny);
      // The start tile may be blocked (a guest sitting in a chair); every other tile may not.
      if (!ok(nx, ny) || closed.has(nk)) continue;
      const ng = g.get(ck) + 1;
      if (ng < (g.get(nk) ?? Infinity)) { g.set(nk, ng); came.set(nk, ck); open.push({ x: nx, y: ny, f: ng + h(nx, ny) }); }
    }
  }
  return null;
}
