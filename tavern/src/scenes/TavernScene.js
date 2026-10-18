// The tavern (#238): draws the room, the guests the sync step asks for and the barkeeper the
// owner walks. It owns no truth: agents come in through setAgents(), answers go out as
// events ('answer-open' with the agent), so FocusShell can later feed it real sessions.

import { TILE, COLS, ROWS, TABLES, SEATS, BAR, BEHIND_BAR, FIREPLACE, DOOR, WALL_ROWS, blockedGrid } from '../core/layout.js';
import { syncGuests, waitingCount } from '../core/sync.js';
import { Walker, GuestBrain, centre, tileOf } from '../core/walker.js';
import { findPath } from '../core/path.js';
import { makeTextures } from './textures.js';

const Phaser = globalThis.Phaser;
export const ZOOM = 3;
const IN = (c, r) => r * 27 + c;          // a frame in Kenney's indoor sheet
const CH = ([c, r]) => r * 54 + c;        // a frame in Kenney's character sheet
const BARKEEPER_LOOK = [0, 6];
const TALK_RANGE = 34;                    // px: next to a guest, or across the counter

export class TavernScene extends Phaser.Scene {
  constructor() { super('tavern'); }

  preload() {
    this.load.spritesheet('indoor', 'assets/indoor.png', { frameWidth: 16, frameHeight: 16, spacing: 1 });
    this.load.spritesheet('chars', 'assets/characters.png', { frameWidth: 16, frameHeight: 16, spacing: 1 });
  }

  create() {
    makeTextures(this);
    this.grid = blockedGrid();
    this.guests = new Map();               // id -> { brain, sprite, prop, ask, label, agent }
    this.agents = [];
    this.evening = false;
    this.cameras.main.setZoom(ZOOM).centerOn(COLS * TILE / 2, ROWS * TILE / 2).setBackgroundColor('#1b1412');
    this.drawRoom();
    this.makeBarkeeper();
    this.makeLight();
    this.makeInput();
    this.events.on('update', (_t, ms) => this.tick(Math.min(ms, 200) / 1000));
    this.game.events.emit('tavern-ready', this);
  }

  // ---- The room: floor, walls, bar, fireplace, tables, chairs, candles. ----
  drawRoom() {
    const at = (x, y) => [x * TILE, y * TILE];
    this.add.image(0, 0, 'floor').setOrigin(0).setDepth(-100);
    this.add.image(0, 0, 'wall').setOrigin(0).setDepth(-90);
    const dark = this.add.graphics().setDepth(-89);
    dark.fillStyle(0x2a2022).fillRect(0, 0, TILE, ROWS * TILE).fillRect((COLS - 1) * TILE, 0, TILE, ROWS * TILE)
      .fillRect(0, (ROWS - 1) * TILE, COLS * TILE, TILE);
    dark.fillStyle(0x6b4527).fillRect(DOOR.x * TILE, (ROWS - 1) * TILE, TILE, TILE);           // the doorway
    dark.fillStyle(0x4a2f1c).fillRect(DOOR.x * TILE + 2, (ROWS - 1) * TILE, TILE - 4, 3);
    // Fireplace in the back wall, its flames, and a rug before it.
    this.add.image(...at(FIREPLACE.x, 0), 'fireplace').setOrigin(0).setDepth(-80);
    const fx = (FIREPLACE.x + FIREPLACE.w / 2) * TILE, fy = (WALL_ROWS + 1) * TILE - 6;
    this.glowBoost = 1;
    this.flame = this.add.image(fx, fy, 'flame0').setOrigin(0.5, 1).setDepth(-79);
    this.embers = this.add.image(fx, fy, 'embers').setOrigin(0.5, 1).setDepth(-79).setVisible(false);
    this.flameFrame = 0;
    this.time.addEvent({ delay: 160, loop: true, callback: () => { this.flameFrame = (this.flameFrame + 1) % 3; this.flame.setTexture(`flame${this.flameFrame}`); } });
    this.add.image(...at(FIREPLACE.x, WALL_ROWS + 1), 'rug').setOrigin(0).setDepth(-95);
    // The bar: bottles on the back wall, the counter, a candelabra on it.
    this.add.image(...at(BAR.x0, 1), 'shelf').setOrigin(0, 0).setDepth(-85);
    for (let x = BAR.x0; x <= BAR.x1; x++) {
      const f = x === BAR.x0 ? IN(4, 7) : x === BAR.x1 ? IN(7, 7) : IN(5, 7);
      this.add.image(...at(x, BAR.y), 'indoor', f).setOrigin(0).setDepth(BAR.y * TILE + TILE);
    }
    this.candles = [];
    const candle = (x, y, frame, depth) => {
      this.add.image(x, y, 'indoor', frame).setDepth(depth);
      this.candles.push({ x, y: y - 4 });
    };
    candle(BAR.x0 * TILE + 24, BAR.y * TILE + 4, IN(16, 7), BAR.y * TILE + TILE + 1);
    candle((BAR.x1 - 1) * TILE + 8, BAR.y * TILE + 4, IN(16, 6), BAR.y * TILE + TILE + 1);
    // Tables with their chairs and a candle each.
    for (const t of TABLES) {
      const d = (t.y + 2) * TILE;
      this.add.image(...at(t.x, t.y), 'table').setOrigin(0).setDepth(d - 8);
      candle((t.x + 1) * TILE, t.y * TILE + 10, IN(16, 6), d - 7);
    }
    for (const s of SEATS) this.add.image(...at(s.x, s.y), 'indoor', s.face === 'right' ? IN(2, 2) : IN(3, 2)).setOrigin(0).setDepth(s.y * TILE + 2);
    // Wall things: torches, shields, a painting, plants in the corners.
    for (const x of [12, 19]) { this.add.image(...at(x, 1), 'indoor', IN(20, 6)).setOrigin(0).setDepth(-84); this.candles.push({ x: x * TILE + 8, y: TILE + 4 }); }
    this.add.image(...at(13, 0), 'indoor', IN(22, 8)).setOrigin(0).setDepth(-84);
    this.add.image(...at(14, 0), 'indoor', IN(22, 9)).setOrigin(0).setDepth(-84);
    this.add.image(...at(19, 0), 'indoor', IN(20, 12)).setOrigin(0).setDepth(-84);
    for (const [x, y] of [[1, 12], [20, 12], [20, 2]]) this.add.image(...at(x, y), 'indoor', IN(16, 0)).setOrigin(0).setDepth((y + 1) * TILE);
  }

  // ---- Light: a dark layer over the room, and warm glows added back on top of it. ----
  makeLight() {
    this.shade = this.add.rectangle(0, 0, COLS * TILE, ROWS * TILE, 0x10142a).setOrigin(0).setDepth(5000).setAlpha(0.08);
    this.glows = this.candles.map(c => {
      const g = this.add.image(c.x, c.y, 'glow').setDepth(5001).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.18).setScale(0.6);
      g.flick = Math.random() * 10;
      return g;
    });
    const fx = (FIREPLACE.x + FIREPLACE.w / 2) * TILE;
    this.fireGlow = this.add.image(fx, (WALL_ROWS + 1) * TILE, 'glowBig').setDepth(5001).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.3);
    this.tweens.add({ targets: this.fireGlow, scale: { from: 0.95, to: 1.05 }, duration: 260, yoyo: true, repeat: -1 });
  }

  // Evening (#238): after 30 idle minutes, or from the mock-up's button. The room dims,
  // candles glow warmer and wider, the fire burns down to embers, the barkeeper dozes and
  // waiting guests lean on the bar. Daytime comes back the same way, gently.
  setEvening(on) {
    if (on === this.evening) return;
    this.evening = on;
    const ms = 2500;
    this.tweens.add({ targets: this.shade, alpha: on ? 0.66 : 0.08, duration: ms });
    for (const g of this.glows) { this.tweens.add({ targets: g, scale: on ? 1.4 : 0.6, duration: ms }); g.setTint(on ? 0xffa050 : 0xffffff); }
    this.glowBoost = on ? 2.6 : 1;
    this.tweens.add({ targets: this.fireGlow, alpha: on ? 0.35 : 0.3, scale: on ? 0.7 : 1, duration: ms });
    this.flame.setVisible(!on); this.embers.setVisible(on);
    this.barkeeper.zzz.setVisible(on);
    this.barkeeper.sprite.setAngle(on ? -8 : 0);
    for (const g of this.guests.values()) this.pose(g);
  }

  // ---- The barkeeper: the owner, walked with the keyboard or sent by a click. ----
  makeBarkeeper() {
    const w = new Walker({ x: 5, y: BEHIND_BAR }, 56);
    const sprite = this.add.sprite(w.x, w.y, 'chars', CH(BARKEEPER_LOOK)).setOrigin(0.5, 0.75);
    const zzz = this.add.text(w.x + 6, w.y - 16, 'z z', { fontFamily: 'monospace', fontSize: '6px', color: '#e8e0ff', resolution: ZOOM }).setDepth(6000).setVisible(false);
    this.barkeeper = { walker: w, sprite, zzz, then: null };
  }

  makeInput() {
    this.keys = this.input.keyboard.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D,E,SPACE');
    this.input.keyboard.on('keydown-E', () => this.talkNearest());
    this.input.keyboard.on('keydown-SPACE', () => this.talkNearest());
    // A click on the floor walks the barkeeper there; a click on a guest is handled on the guest.
    this.input.on('pointerdown', (p, over) => {
      this.game.events.emit('owner-active');
      if (over.length) return;
      const t = tileOf({ x: p.worldX, y: p.worldY });
      if (this.barkeeper.walker.goTo(this.grid, t)) this.barkeeper.then = null;
    });
  }

  // The guest nearest the barkeeper, within talking range; across the counter counts.
  talkNearest() {
    this.game.events.emit('owner-active');
    const w = this.barkeeper.walker;
    let best = null, bd = TALK_RANGE;
    for (const g of this.guests.values()) {
      const d = Math.hypot(g.brain.walker.x - w.x, g.brain.walker.y - w.y);
      if (d <= bd && g.brain.state !== 'leaving') { best = g; bd = d; }
    }
    if (best) this.talkTo(best);
  }
  talkTo(g) {
    if (g.agent.state === 'asking') this.game.events.emit('answer-open', g.agent);
    else this.say(g, g.agent.state === 'working' ? `Busy on ${g.agent.project}` : 'Just a drink, thanks');
  }
  // A click on a guest: the barkeeper walks over (behind the counter for a guest at the
  // bar), then talks.
  walkTo(g) {
    this.game.events.emit('owner-active');
    const w = this.barkeeper.walker, gt = g.brain.walker.tile;
    const near = g.brain.state === 'waiting' ? [{ x: gt.x, y: BEHIND_BAR }, { x: gt.x, y: gt.y + 1 }] : [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: gt.x + dx, y: gt.y + dy }));
    let best = null;
    for (const t of near) { const p = findPath(this.grid, w.tile, t); if (p && (!best || p.length < best.length)) best = p; }
    if (!best) return;
    w.path = best;
    this.barkeeper.then = g.agent.id;
  }
  say(g, text) {
    g.bubble?.destroy();
    const b = this.add.text(g.brain.walker.x, g.brain.walker.y - 14, text, { fontFamily: 'monospace', fontSize: '5px', color: '#2b1d14', backgroundColor: '#fff4d6', padding: { x: 2, y: 1 }, resolution: ZOOM })
      .setOrigin(0.5, 1).setDepth(6000);
    g.bubble = b;
    this.time.delayedCall(1800, () => { if (g.bubble === b) { b.destroy(); g.bubble = null; } });
  }

  // ---- Guests, from the agent list. ----
  setAgents(agents) {
    this.agents = agents;
    const view = new Map([...this.guests].filter(([, g]) => g.brain.state !== 'leaving').map(([id, g]) => [id, { want: g.brain.want, spot: g.brain.spot }]));
    for (const op of syncGuests(view, agents)) {
      if (op.op === 'leave') { const g = this.guests.get(op.id); g.brain.leave(); this.pose(g); continue; }
      const g = op.op === 'add' ? this.addGuest(op.agent) : this.guests.get(op.id);
      g.agent = op.agent;
      g.brain.send(op.want, op.spot);
      this.pose(g);
    }
    for (const a of agents) { const g = this.guests.get(a.id); if (g) g.agent = a; }
    this.game.events.emit('waiting', waitingCount(agents));
  }
  addGuest(agent) {
    const brain = new GuestBrain(agent, this.grid);
    const small = agent.role === 'helper';
    const sprite = this.add.sprite(brain.walker.x, brain.walker.y, 'chars', CH(agent.look)).setOrigin(0.5, 0.75).setScale(small ? 0.8 : 1)
      .setInteractive({ useHandCursor: true });
    const g = { brain, sprite, agent, prop: null, ask: null, label: null, bubble: null, bob: Math.random() * 6 };
    sprite.on('pointerdown', () => this.walkTo(g));
    sprite.on('pointerover', () => g.label.setVisible(true));
    sprite.on('pointerout', () => g.label.setVisible(!small));
    g.label = this.add.text(0, 0, agent.role === 'lead' ? agent.name : agent.name.toUpperCase(), { fontFamily: 'monospace', fontSize: '4px', color: '#fff4d6', stroke: '#1b1412', strokeThickness: 1, resolution: ZOOM })
      .setOrigin(0.5, 0).setDepth(5500).setVisible(!small);
    if (agent.role === 'cto' || agent.role === 'pm') g.label.setColor('#ffd36b');
    this.guests.set(agent.id, g);
    return g;
  }
  // What a guest holds and shows for its state: papers at work, a mug when drinking, a "?"
  // at the bar.
  pose(g) {
    const s = g.brain.state;
    g.prop?.destroy(); g.prop = null;
    if (s === 'working') g.prop = this.add.image(0, 0, 'paper');
    if (s === 'drinking') g.prop = this.add.image(0, 0, 'mug');
    if (s === 'waiting' && !g.ask) {
      g.ask = this.add.image(0, 0, 'ask').setOrigin(0.5, 1).setDepth(5600);
      this.tweens.add({ targets: g.ask, scale: { from: 1, to: 1.15 }, duration: 500, yoyo: true, repeat: -1 });
    }
    if (s !== 'waiting' && g.ask) { g.ask.destroy(); g.ask = null; }
    g.sprite.setAngle(s === 'waiting' && this.evening ? -10 : 0);
  }

  // ---- Every frame: move, then draw where the brains say. ----
  tick(dt) {
    this.moveBarkeeper(dt);
    const t = this.time.now / 1000;
    // Candles flicker a little, brighter at night.
    for (const g of this.glows) g.setAlpha((0.16 + Math.sin(t * 7 + g.flick) * 0.03 + Math.sin(t * 13 + g.flick * 2) * 0.02) * (this.glowBoost || 1));
    for (const [id, g] of this.guests) {
      const before = g.brain.state;
      g.brain.step(dt);
      if (g.brain.state !== before) this.pose(g);
      if (g.brain.state === 'gone') { for (const o of [g.sprite, g.prop, g.ask, g.label, g.bubble]) o?.destroy(); this.guests.delete(id); continue; }
      const w = g.brain.walker, walking = g.brain.walker.moving || g.brain.state === 'walking' || g.brain.state === 'leaving';
      // A step bob while walking; a slow breath when still; a typing nod at work.
      const bob = walking ? -Math.abs(Math.sin(t * 10 + g.bob)) * 1.5 : g.brain.state === 'working' ? -Math.abs(Math.sin(t * 6 + g.bob)) * 0.6 : Math.sin(t * 2 + g.bob) * 0.4;
      g.sprite.setPosition(w.x, w.y + bob).setDepth(w.y).setFlipX(w.facing === 'left');
      g.label.setPosition(w.x, w.y + 5);
      if (g.prop) {
        const side = w.facing === 'left' ? -1 : 1;
        g.prop.setPosition(w.x + side * 8, w.y + (g.brain.state === 'drinking' && Math.sin(t * 0.8 + g.bob) > 0.85 ? -4 : 0)).setDepth(w.y + 1);
      }
      if (g.ask) g.ask.setPosition(w.x, w.y - 12 + Math.sin(t * 3) * 1);
      if (g.bubble) g.bubble.setPosition(w.x, w.y - 14);
    }
  }
  moveBarkeeper(dt) {
    const b = this.barkeeper, w = b.walker, k = this.keys;
    const dx = (k.RIGHT.isDown || k.D.isDown) - (k.LEFT.isDown || k.A.isDown), dy = (k.DOWN.isDown || k.S.isDown) - (k.UP.isDown || k.W.isDown);
    if (dx || dy) {
      this.game.events.emit('owner-active');
      w.path = []; b.then = null;
      const step = w.speed * dt / Math.hypot(dx, dy);
      const free = (x, y) => { const tt = tileOf({ x, y: y + 4 }); return this.grid[tt.y]?.[tt.x] === false; };
      if (free(w.x + dx * step, w.y)) w.x += dx * step;
      if (free(w.x, w.y + dy * step)) w.y += dy * step;
      w.facing = dx < 0 ? 'left' : dx > 0 ? 'right' : w.facing;
    } else if (w.step(dt) && b.then) {
      const g = this.guests.get(b.then); b.then = null;
      if (g) this.talkTo(g);
    }
    const moving = dx || dy || w.moving;
    const bob = moving ? -Math.abs(Math.sin(this.time.now / 100)) * 1.5 : 0;
    b.sprite.setPosition(w.x, w.y + bob).setDepth(w.y).setFlipX(w.facing === 'left');
    const z = (this.time.now / 1400) % 1;
    b.zzz.setPosition(w.x + 5, w.y - 14 - z * 5).setAlpha(1 - z * 0.7);
  }
}
