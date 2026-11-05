// The tavern core's tests (#238): room, paths, the sync step, guests' states and the fake
// agents. Run: npm test (in tavern/).
import test from 'node:test';
import assert from 'node:assert/strict';
import { blockedGrid, SEATS, BAR_SPOTS, DOOR, BAR, BEHIND_BAR, BAR_GAP, COLS, ROWS } from './layout.js';
import { findPath } from './path.js';
import { syncGuests, wantOf, waitingCount } from './sync.js';
import { Walker, GuestBrain, centre } from './walker.js';
import { startingAgents, tickAgents, answerAgent } from '../mock/fakeAgents.js';

const grid = blockedGrid();

test('every seat, bar spot and the barkeeper side are reachable from the door', () => {
  for (const s of [...SEATS, ...BAR_SPOTS]) assert.ok(findPath(grid, DOOR, s), `no way to ${s.id}`);
  assert.ok(findPath(grid, DOOR, { x: BAR.x0, y: BEHIND_BAR }), 'behind the bar');
  assert.ok(findPath(grid, { x: BAR.x0 + 1, y: BEHIND_BAR }, { x: BAR_GAP, y: BAR.y + 1 }), 'out from behind the bar');
});

test('paths go round furniture, never through it, and stop at blocked goals', () => {
  const p = findPath(grid, DOOR, BAR_SPOTS[0]);
  for (const t of p) assert.equal(grid[t.y][t.x], false);
  for (let i = 1; i < p.length; i++) assert.equal(Math.abs(p[i].x - p[i - 1].x) + Math.abs(p[i].y - p[i - 1].y), 1);
  assert.equal(findPath(grid, DOOR, { x: BAR.x0, y: BAR.y }), null);
  assert.deepEqual(findPath(grid, DOOR, DOOR), []);
  assert.equal(grid.length, ROWS); assert.equal(grid[0].length, COLS);
});

test('sync adds, moves and lets guests leave, keeping seats that still fit', () => {
  const a = [{ id: 'x', state: 'working' }, { id: 'y', state: 'idle' }, { id: 'z', state: 'asking' }];
  const ops = syncGuests(new Map(), a);
  assert.deepEqual(ops.map(o => [o.op, o.id, o.want]), [['add', 'x', 'work'], ['add', 'y', 'drink'], ['add', 'z', 'ask']]);
  assert.ok(ops[2].spot.id.startsWith('bar:'));
  const guests = new Map(ops.map(o => [o.id, { want: o.want, spot: o.spot }]));
  assert.deepEqual(syncGuests(guests, a), [], 'nothing changed, nothing to do');
  const next = syncGuests(guests, [{ id: 'x', state: 'asking' }, { id: 'y', state: 'idle' }]);
  assert.deepEqual(next.map(o => [o.op, o.id]), [['leave', 'z'], ['move', 'x']]);
  assert.notEqual(next[1].spot, null);
  assert.equal(wantOf({ state: 'idle' }), 'drink');
  assert.equal(waitingCount(a), 1);
});

test('a full room leaves the newcomer without a spot rather than doubling up', () => {
  const many = Array.from({ length: BAR_SPOTS.length + 2 }, (_, i) => ({ id: 'q' + i, state: 'asking' }));
  const ops = syncGuests(new Map(), many);
  const spots = ops.map(o => o.spot?.id).filter(Boolean);
  assert.equal(new Set(spots).size, spots.length);
  assert.equal(ops.filter(o => !o.spot).length, 2);
});

test('a guest walks from the door to its seat, sits, then leaves and is gone', () => {
  const g = new GuestBrain({ id: 'x', role: 'lead' }, grid);
  const seat = SEATS.find(s => s.kind === 'work');
  g.send('work', seat);
  assert.equal(g.state, 'walking');
  for (let i = 0; i < 400 && g.state === 'walking'; i++) g.step(0.05);
  assert.equal(g.state, 'working');
  assert.deepEqual({ x: g.walker.x, y: g.walker.y }, centre(seat));
  assert.equal(g.walker.facing, seat.face);
  g.leave();
  for (let i = 0; i < 400 && g.state === 'leaving'; i++) g.step(0.05);
  assert.equal(g.state, 'gone');
});

test('a walker moves at its speed and does not overshoot', () => {
  const w = new Walker({ x: 2, y: 6 }, 32);
  w.goTo(grid, { x: 5, y: 6 });
  w.step(0.25);
  assert.equal(w.x, centre({ x: 2, y: 6 }).x + 8);
  w.step(10);
  assert.equal(w.x, centre({ x: 5, y: 6 }).x);
  assert.equal(w.moving, false);
});

test('the fake agents start with a mix and change, and answering sends one back to work', () => {
  const a = startingAgents();
  assert.ok(a.some(x => x.role === 'cto') && a.some(x => x.role === 'pm') && a.some(x => x.role === 'helper'));
  assert.equal(waitingCount(a), 1);
  let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let b = a; for (let i = 0; i < 40; i++) b = tickAgents(b, rnd, i);
  assert.ok(waitingCount(b) <= 3);
  assert.ok(b.filter(x => x.role === 'helper').length <= 2);
  const asking = b.find(x => x.state === 'asking') || a[2];
  assert.equal(answerAgent([asking], asking.id)[0].state, 'working');
});
