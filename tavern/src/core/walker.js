// A walker (#238): anyone who moves on the grid, guest or barkeeper. It holds a position in
// pixels and a path of tiles, and steps along it at a fixed speed. A guest's small state
// machine sits on top: walking to its spot, then working, drinking or waiting at the bar,
// or leaving through the door. No Phaser here; the scene only draws what this says.

import { TILE, DOOR } from './layout.js';
import { findPath } from './path.js';

export const centre = t => ({ x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE / 2 });
export const tileOf = p => ({ x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) });

export class Walker {
  constructor(tile, speed = 40) {
    const c = centre(tile);
    this.x = c.x; this.y = c.y; this.path = []; this.speed = speed; this.facing = 'down';
  }
  get tile() { return tileOf(this); }
  get moving() { return this.path.length > 0; }
  // Walk to a tile; false when it cannot be reached.
  goTo(grid, tile) {
    const p = findPath(grid, this.tile, tile);
    if (!p) return false;
    this.path = p;
    return true;
  }
  // Moves dt seconds along the path; true on the step it arrives.
  step(dt) {
    let left = this.speed * dt;
    while (left > 0 && this.path.length) {
      const c = centre(this.path[0]), dx = c.x - this.x, dy = c.y - this.y, d = Math.hypot(dx, dy);
      if (Math.abs(dx) > Math.abs(dy)) this.facing = dx > 0 ? 'right' : 'left';
      else if (d) this.facing = dy > 0 ? 'down' : 'up';
      if (d <= left) { this.x = c.x; this.y = c.y; this.path.shift(); left -= d; if (!this.path.length) return true; }
      else { this.x += dx / d * left; this.y += dy / d * left; left = 0; }
    }
    return false;
  }
}

// A guest's states: 'walking' to its spot, then 'working' | 'drinking' | 'waiting' (at the
// bar), or 'leaving' and finally 'gone'. 'lost' when its spot cannot be reached.
const AT = { work: 'working', drink: 'drinking', ask: 'waiting' };

export class GuestBrain {
  constructor(agent, grid) {
    this.agent = agent; this.grid = grid;
    this.walker = new Walker({ x: DOOR.x, y: DOOR.y }, agent.role === 'helper' ? 52 : 40);
    this.state = 'idle'; this.want = null; this.spot = null;
  }
  // A new spot and what to do there (from the sync step).
  send(want, spot) {
    this.want = want; this.spot = spot;
    if (!spot) { this.state = 'lost'; return; }
    this.state = this.walker.goTo(this.grid, spot) || this.atSpot() ? 'walking' : 'lost';
    if (this.atSpot() && !this.walker.moving) this.state = AT[want];
  }
  leave() { this.want = 'leave'; this.spot = null; this.state = this.walker.goTo(this.grid, DOOR) ? 'leaving' : 'gone'; }
  atSpot() { const t = this.walker.tile; return !!this.spot && t.x === this.spot.x && t.y === this.spot.y; }
  step(dt) {
    if (this.state !== 'walking' && this.state !== 'leaving') return;
    if (this.walker.step(dt) || !this.walker.moving) {
      if (this.state === 'leaving') this.state = 'gone';
      else { this.state = AT[this.want]; this.walker.facing = this.spot.face || 'up'; }
    }
  }
}
