// The tavern's room (#238): one grid of 16px tiles, and every place on it a guest or the
// barkeeper can stand. Pure data, so paths and seats are tested without a browser.

export const TILE = 16;
export const COLS = 22;
export const ROWS = 14;

// What stands where. Furniture blocks walking; seats, bar spots and the door do not.
export const TABLES = [
  { id: 'work-1', x: 4, y: 8, kind: 'work' },
  { id: 'work-2', x: 9, y: 8, kind: 'work' },
  { id: 'work-3', x: 4, y: 11, kind: 'work' },
  { id: 'drink-1', x: 15, y: 6, kind: 'drink' },
  { id: 'drink-2', x: 15, y: 10, kind: 'drink' },
];
export const BAR = { x0: 2, x1: 9, y: 4 };          // the counter, cols x0..x1 on row y
export const BEHIND_BAR = 3;                         // the barkeeper's row behind the counter
export const BAR_GAP = 10;                           // the col where the barkeeper walks out
export const FIREPLACE = { x: 15, y: 0, w: 3 };      // in the back wall, hearth on row 2
export const DOOR = { x: 11, y: ROWS - 1 };
export const WALL_ROWS = 2;

// A table is 2x2; its seats are the two tiles on each side.
export const seatsOf = t => [
  { x: t.x - 1, y: t.y, face: 'right' }, { x: t.x - 1, y: t.y + 1, face: 'right' },
  { x: t.x + 2, y: t.y, face: 'left' }, { x: t.x + 2, y: t.y + 1, face: 'left' },
].map((s, i) => ({ ...s, id: `${t.id}:${i}`, kind: t.kind, table: t.id }));
export const SEATS = TABLES.flatMap(seatsOf);
// Where a guest with a question stands: in front of the counter, one per col.
export const BAR_SPOTS = Array.from({ length: BAR.x1 - BAR.x0 - 1 }, (_, i) => ({ id: `bar:${i}`, x: BAR.x0 + 1 + i, y: BAR.y + 1 }));

// The walking grid: true where nobody can step.
export function blockedGrid() {
  const g = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const block = (x, y) => { if (y >= 0 && y < ROWS && x >= 0 && x < COLS) g[y][x] = true; };
  for (let x = 0; x < COLS; x++) { for (let y = 0; y < WALL_ROWS; y++) block(x, y); block(x, ROWS - 1); }
  for (let y = 0; y < ROWS; y++) { block(0, y); block(COLS - 1, y); }
  g[DOOR.y][DOOR.x] = false;
  for (let x = BAR.x0; x <= BAR.x1; x++) block(x, BAR.y);
  for (let y = WALL_ROWS; y < BAR.y; y++) block(1, y);                 // the bar's back corner
  for (let x = FIREPLACE.x; x < FIREPLACE.x + FIREPLACE.w; x++) block(x, WALL_ROWS); // hearth
  for (const t of TABLES) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) block(t.x + dx, t.y + dy);
  return g;
}
