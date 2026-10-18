// The tavern room as a Phaser scene (#246), shared by the demo page and the app. Everything the
// room demo drew by hand is a game object here: the room behind (floor, walls, floor pieces and
// every shadow) baked into one picture, the furniture as images at their depth, the people as
// sprites playing the poses bake.js drew for them, the light of the local clock (day, dusk or
// night, #283) as a multiply layer with additive glows, and the chalkboard opening the token board. The people keep the room's own
// walk logic and seat plans; a cast given to setCast decides who is in the room and how they are.
//
// opts: { room (loadRoom()), rows() -> the token board rows, boards: the chalkboard's other tabs (#285), onGuest(id) a click on a guest,
//         onNotice() a click on the notice board, presets: walk/sit/idle motion }
import { W, H, T, WALL, shell } from './scene.js';
import { loadPieces, footprint, PLACES, GLOWS, ANIMS, TABLES, KEEPER_SEAT, FLOOR, FIREPLACE, BEERS } from './furniture.js';
import { ROBOTS, DOOR, seatsOf, seatPlan, BAR_AISLE, BAR_SPOTS, STANDS, standSeat, arrivePlan, leavePlan, askPlan, backPlan, workPlan } from './robots.js';
import { rigCharacter, bake } from './bake.js';
import { openBoard } from './chalkboard.js';
import { RACK, HOOKS, rackCanvas, bareRack, drawTrophies } from './finished.js';
import { lightAt, LOOK, duskWindow } from './daylight.js';
import { CELL, blockersOf, floorGrid, findPath, solidAt } from './paths.js';
import { PRESETS as RIG } from '../people/parts.js';

export { W, H };
// Motion per pose, as the owner approved it (#249, #269, #271).
export const DEFAULTS = { walk: { speed: 3, fps: 15, bob: 2.5, arm: 5.5, leg: 4, tilt: 2.5 }, sit: { speed: 1, fps: 15, bob: 1, arm: 0, leg: 0, tilt: 0 }, idle: { ...RIG.idle, fps: 15, arm: 0, tilt: 0 } };
// The full-size characters are drawn bigger than their art (#260); the helpers are cut smaller.
const CHAR = 1.25;
const url = p => new URL(p, import.meta.url).href;
const D = { bg: -3e6, shadow: -2.5e6, wall: -2e6, dim: 3e6 };
// Where a mug given back stands on the bar counter (#312): the top's y, the counter's right end, and a depth just in front of it.
const MUG_DROP = [141, 370, 226.5];
// How long the cat is awake, stretching, when a new question or prompt comes in (#284).
const CAT_WAKE = 3000;
// The trophy shelf (#282): the mantel between its candles, [x0, x1, the line they stand on].
const MANTEL = [FIREPLACE.x + 48, FIREPLACE.x + 146, FIREPLACE.y - 120];

// ---------- the room behind, drawn once ----------
const hexRgb = new Map();
const rgbOf = c => { if (!hexRgb.has(c)) hexRgb.set(c, c[0] === '#' ? [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)) : c.match(/\d+/g).map(Number)); return hexRgb.get(c); };
function toCanvas(buf) {
  const c = document.createElement('canvas'); c.width = buf.w; c.height = buf.h;
  const ctx = c.getContext('2d'), img = ctx.createImageData(buf.w, buf.h);
  buf.px.forEach((col, i) => { if (!col) return; const [r, g, b] = rgbOf(col); img.data.set([r, g, b, 255], i * 4); });
  ctx.putImageData(img, 0, 0);
  return c;
}
// A piece's outline in the shadow colour, drawn at x, y.
function castOutline(c, img, x, y, a) {
  const o = document.createElement('canvas'); o.width = img.width; o.height = img.height;
  const k = o.getContext('2d'); k.drawImage(img, 0, 0); k.globalCompositeOperation = 'source-in'; k.fillStyle = 'rgb(20,8,16)'; k.fillRect(0, 0, o.width, o.height);
  c.save(); c.globalAlpha = a; c.drawImage(o, Math.round(x), Math.round(y)); c.restore();
}
// A soft pool of shadow on the floor: stepped rings, darker in the middle.
function softPool(c, x, y, rx, ry, strength = 1) {
  for (const [k, a] of [[1, 0.14], [0.8, 0.14], [0.55, 0.16]]) {
    c.fillStyle = `rgba(20,8,16,${a * strength})`;
    for (let j = -Math.ceil(ry * k); j <= ry * k; j++) for (let i = -Math.ceil(rx * k); i <= rx * k; i++) if ((i / (rx * k)) ** 2 + (j / (ry * k)) ** 2 <= 1) c.fillRect(Math.round(x + i), Math.round(y + j), 1, 1);
  }
}
// A tight, dark shadow right under where something meets the floor.
function contactShadow(c, x, y, rx) {
  for (const [k, ry, a] of [[1, 2.5, 0.42], [0.75, 1.5, 0.6]]) {
    c.fillStyle = `rgba(20,8,16,${a})`;
    for (let j = -Math.ceil(ry); j <= ry; j++) for (let i = -Math.ceil(rx * k); i <= rx * k; i++) if ((i / (rx * k)) ** 2 + (j / ry) ** 2 <= 1) c.fillRect(Math.round(x + i), Math.round(y - 1 + j), 1, 1);
  }
}
const pic = (pieces, n) => pieces[ANIMS[n] ? ANIMS[n][0][0] : n];
// The floor, walls, rugs and every piece's shadow, with the light from the upper left (#258).
function background(pieces) {
  const bg = toCanvas(shell()), b = bg.getContext('2d');
  for (const [n, x, y] of FLOOR) b.drawImage(pieces[n], x, y);
  for (const [n, x, y, base] of PLACES) {
    const img = pic(pieces, n), top = base < 0 ? y : y - img.height;
    // A wall piece casts its outline onto the wall, down and to the right.
    // The mug rack's mugs come and go (#282): only its beam's shadow is drawn here.
    if (base < 0) { castOutline(b, n === RACK ? bareRack(img) : img, x + 3, top + 3, 0.38); continue; }
    if (base % 1 !== 0) continue;
    // A floor piece: a soft pool to its lower right, its outline on the wall behind when it
    // stands against it, and a dark contact shadow where it meets the floor.
    const [l, rr] = footprint(img);
    if (base < WALL + 45) { b.save(); b.beginPath(); b.rect(0, 0, W, WALL + 1); b.clip(); castOutline(b, img, x + 5, top - 3, 0.3); b.restore(); }
    softPool(b, x + (l + rr) / 2 + 5, base - 1, (rr - l) / 2 + 6, 4.5);
    // The barrel stack, keg and barrel: wider, darker (#274); tall stools on thin legs (#271).
    // The keg and barrel by the back wall keep their pools up under their feet, or they hover (#323).
    if (/barrel-rack$/.test(n)) { const c = x + img.width / 2 + 4, r = img.width / 2; softPool(b, c, base + 3, r + 12, 9, 2.4); softPool(b, c - 1, base + 1, r + 4, 5, 2.6); }
    if (/^p:keg$|^p:barrel$/.test(n)) { const c = x + img.width / 2 + 3, r = img.width / 2; softPool(b, c, base - 2, r + 8, 5, 2.4); softPool(b, c - 1, base - 1, r + 2, 3, 2.6); }
    if (n.includes('stool')) { const c = x + img.width / 2 + 3, r = img.width / 2; softPool(b, c, base - 2, r + 9, 7, 2); softPool(b, c - 1, base - 2, r + 2, 4, 2.2); }
    contactShadow(b, x + (l + rr) / 2 + 1.5, base, (rr - l) / 2 + 2);
  }
  return bg;
}

// Everything the scene needs before it starts: the pieces, the room behind, who has side and back views.
export async function loadRoom() {
  const pieces = await loadPieces();
  pieces['p:r2-window-dusk'] = duskWindow(pieces['p:r2-window-day']);
  // Read as a JSON module: the app's page may not fetch its own files (#246).
  const at = url('../../art/sprites/angles/angles.json');
  const angles = await import(at, { with: { type: 'json' } }).then(m => m.default).catch(() => fetch(at).then(r => r.json())).catch(() => ({}));
  return { pieces, bg: background(pieces), angles };
}

// ---------- people ----------
// The barkeep's round: behind the bar, a break on his stool at its right end (#254, #270).
const [KX, KY] = KEEPER_SEAT;
const KEEPER = [['stay', 'idle', 3], ['go', 230, 200], ['stay', 'idle', 4], ['go', 130, 200], ['stay', 'idle', 3], ['go', KX, 200],
  ['go', KX, KY], ['stay', 'sit', 7, -1], ['go', KX, 200], ['go', 160, 200]];
const lay = name => (ROBOTS.find(r => r[0] === name) || [])[2];
const HELPER = name => name.startsWith('helper');

// Two people closer than this ([x, y] between their feet) overlap on screen (#303).
export const OVERLAP = [20, 11];
// The longest a CTO stays on the phone to a lead that has not come in yet (#363), in ms.
const CALL_MS = 20000;

export function roomScene(opts) {
  const Phaser = globalThis.Phaser;
  const presets = structuredClone(opts.presets || DEFAULTS);
  return class RoomScene extends Phaser.Scene {
    constructor() { super('room'); }

    create() {
      const { pieces, bg } = opts.room;
      this.textures.addCanvas('room-bg', bg);
      this.add.image(0, 0, 'room-bg').setOrigin(0).setDepth(D.bg);
      for (const [n, c] of Object.entries(pieces)) this.textures.addCanvas(`pc:${n}`, c);
      // The furniture: wall pieces behind everyone, the rest at the line they stand on.
      this.anim = [];
      PLACES.forEach(([n, x, y, base], i) => {
        const a = ANIMS[n], first = pic(pieces, n), img = this.add.image(x, base < 0 ? y : y - first.height, `pc:${a ? a[0][0] : n}`).setOrigin(0).setDepth(base < 0 ? D.wall + i : base);
        if (n === 'p:door-closed') this.door = img;
        if (n === RACK) this.rack = img;
        if (a) this.anim.push({ img, frames: a[0], fps: a[1], x, y, base, h: first.height, k: 1, name: n });
      });
      // The cat (#284) stands on its bottom middle, so it can stretch where it lies.
      this.cat = this.anim.find(a => a.frames[0] === 'p:r3-cat-1');
      if (this.cat) { this.cat.img.setOrigin(0.5, 1).setX(this.cat.x + pic(pieces, 'cat').width / 2); this.cat.foot = true; }
      this.shadows = this.add.graphics().setDepth(D.shadow);
      // Dusk and night: a multiply over the room, then warm stepped glows at the lights (#247, #283).
      this.dim = this.add.rectangle(0, 0, W, H, 0x6a5a86).setOrigin(0).setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(D.dim);
      this.glows = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setDepth(D.dim + 1);
      for (const [x, y, tiles, colour, a] of GLOWS) for (const [f, al] of [[1, a * 0.18], [0.85, a * 0.22], [0.68, a * 0.3], [0.5, a * 0.4], [0.32, a * 0.5]]) {
        this.glows.fillStyle(Phaser.Display.Color.HexStringToColor(colour).color, al).fillCircle(x, y, Math.round(tiles * T * f));
      }
      // The light follows the local clock (#283), looked at every half minute.
      this.setLight();
      this.time.addEvent({ delay: 30000, loop: true, callback: () => this.setLight() });
      // The chalkboard (#272): a little brighter and rimmed under the pointer; a click opens the board.
      this.chalk = this.hotspot('p:r3-back-chalkboard', () => openBoard({ now: () => (this.tokens ? Promise.resolve(this.tokens) : this.refreshTokens()), ...opts.boards }));
      // The notice board by the door (#276): a red pin with the number of open questions; a
      // click lists them all, each answerable there (opts.onNotice).
      this.notice = this.hotspot('p:notice-board-lamp', () => opts.onNotice && opts.onNotice());
      const nb = PLACES.find(p => p[0] === 'p:notice-board-lamp');
      this.pin = this.add.text(nb[1] + 14, nb[2] + 10, '', { fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold', color: '#fff', backgroundColor: '#b8322a', padding: { x: 3, y: 0 } })
        .setOrigin(0.5).setDepth(D.dim + 4).setVisible(false);
      this.setNotices(0);
      // The token counts are read when the room opens and every two minutes after, board open or
      // not, so the board is current the moment it is clicked (#288).
      this.refreshTokens();
      this.time.addEvent({ delay: 120000, loop: true, callback: () => this.refreshTokens() });
      // The tap barrels (#279): a sight glass on each shows the beer left of the 5-hour allowance,
      // read now and every minute (the status line writes it about as often); the ledge says the
      // numbers under the pointer.
      this.taps = this.add.graphics().setDepth(D.wall + 500);
      // Big and bold on a parchment panel with a dark wooden frame, so it still reads with the room
      // shrunk to fit the window (#302).
      this.tapTip = this.tip();
      const ledge = this.hotspot('p:r3-back-tap-ledge', () => this.tapTip.setVisible(!this.tapTip.visible));
      ledge.zone.on('pointerover', () => this.tapTip.setVisible(!!this.usage)).on('pointerout', () => this.tapTip.setVisible(false));
      this.refreshUsage();
      this.setBusy(0);
      // Finished work (#282): a mug on the rack for each item closed today (the day's number on
      // the beam once all eleven hang), a trophy on the mantel for each day this week; the
      // numbers under the pointer. opts.finished is read now and every minute; the app sets it.
      const [, rx, ry] = PLACES.find(p => p[0] === RACK), art = opts.room.pieces[RACK];
      this.rackCount = this.add.text(rx + art.width / 2, ry + 8, '', { fontFamily: 'Consolas, monospace', fontSize: '12px', fontStyle: 'bold', color: '#f6ecd2', stroke: '#1e120a', strokeThickness: 3 })
        .setResolution(2).setOrigin(0.5).setDepth(D.wall + 600).setVisible(false);
      this.trophies = this.add.graphics().setDepth(FIREPLACE.y + 0.3);
      this.rackTip = this.tip(); this.trophyTip = this.tip();
      const zone = (x, y, w, hh, box) => this.add.zone(x, y, w, hh).setOrigin(0).setDepth(D.dim + 3).setInteractive()
        .on('pointerover', () => box.setVisible(!!this.finished)).on('pointerout', () => box.setVisible(false)).on('pointerdown', () => box.setVisible(!box.visible && !!this.finished));
      zone(rx, ry, art.width, art.height, this.rackTip);
      zone(MANTEL[0], MANTEL[2] - 20, MANTEL[1] - MANTEL[0], 20, this.trophyTip);
      this.setFinished({ today: 0, week: 0, days: [0, 0, 0, 0, 0, 0, 0] });
      this.refreshFinished();
      this.time.addEvent({ delay: 60000, loop: true, callback: () => this.refreshFinished() });
      this.time.addEvent({ delay: 60000, loop: true, callback: () => this.refreshUsage() });

      this.guests = new Map();
      this.rigs = new Map();
      this.SEATS = seatsOf(TABLES);
      // Where people may walk (#298): the floor less the furniture standing on it.
      this.grid = floorGrid(blockersOf(PLACES, n => pic(pieces, n)), W, H, WALL + 8);
      this.made = 0;
      // The barkeep, walked by the owner (arrow keys, WASD, a click on the floor) and back on his
      // round behind the bar a while after being left alone.
      this.ready = this.addPerson('barkeep', 'barkeep', 160, 200).then(k => { this.keeper = k; k.queue = [{ steps: KEEPER, loop: true }]; k.sitAt = KY; });
      this.keys = this.input.keyboard ? this.input.keyboard.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D,SHIFT', false) : null;
      this.input.on('pointerdown', (p, over) => {
        if (over.length || !this.keeper) return;
        this.keeper.target = [Phaser.Math.Clamp(p.worldX, 12, W - 12), Phaser.Math.Clamp(p.worldY, WALL + 22, H - 4)];
        this.keeper.manual = this.time.now;
      });
      this.events.emit('room-ready', this);
    }

    // The fire (#280): bigger and brighter with each busy agent, up to eight, at most its full size
    // in the opening (its picture has the opening's dark behind it); a low fire for none.
    setBusy(n) {
      const k = Math.min(8, Math.max(0, n));
      this.busy = k;
      for (const a of this.anim) if (a.name === 'fire') a.k = 0.55 + k * 0.05625;
      this.fireHeat = k / 8;
      if (!this.fireGlow) {
        const Phaser = globalThis.Phaser, [fx, fy] = [FIREPLACE.x + 95, FIREPLACE.y - 50];
        this.fireGlow = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setDepth(D.dim + 1);
        for (const [f, al] of [[1, 0.06], [0.75, 0.08], [0.5, 0.1], [0.3, 0.12]]) this.fireGlow.fillStyle(0xff8a30, al).fillCircle(fx, fy, Math.round(3.2 * T * f));
      }
    }
    async refreshUsage() {
      if (!opts.usage) return;
      try { this.setUsage(await opts.usage()); } catch { /* keep the last level */ }
    }
    // u: { used: 0-100, resetsAt } or null (nothing known: no glass shown).
    setUsage(u) {
      this.usage = u;
      const g = this.taps.clear(), [, lx, ly] = PLACES.find(p => p[0] === 'p:r3-back-tap-ledge');
      if (!u) return;
      const left = 1 - u.used / 100, top = ly + 5, h = 14, beer = Math.round(h * left);
      for (const bx of [30, 50, 69]) {
        const x = lx + bx - 2;
        g.fillStyle(0x1a1008).fillRect(x - 1, top - 1, 6, h + 2).fillStyle(0x3a2c22).fillRect(x, top, 4, h);
        if (beer) g.fillStyle(left < 0.2 ? 0xd0682a : 0xe8a83a).fillRect(x, top + h - beer, 4, beer).fillStyle(0xfff4dc).fillRect(x, top + h - beer, 4, 1);
        g.fillStyle(0xffffff, 0.25).fillRect(x + 1, top, 1, h);
      }
      const at = u.resetsAt ? new Date(u.resetsAt).toTimeString().slice(0, 5) : null;
      this.tapTip.say(`5-hour allowance: ${Math.round(u.used)}% used${at ? `, refills at ${at}` : ''}`, lx + 4, ly + 48);
    }
    async refreshTokens() {
      try { this.tokens = await opts.rows(); } catch { /* keep the last counts */ }
      return this.tokens || [];
    }

    async refreshFinished() {
      if (!opts.finished) return;
      try { this.setFinished(await opts.finished()); } catch { /* keep the last counts */ }
    }
    // f: { today, week, days: [Mon..Sun] } (app/lib/tavern/finished.js).
    setFinished(f) {
      const key = JSON.stringify(f);
      if (key === this.finishedKey) return;
      this.finishedKey = key; this.finished = f.week || f.today ? f : null;
      const n = Math.min(HOOKS, f.today), tex = `rack:${n}`;
      if (!this.textures.exists(tex)) this.textures.addCanvas(tex, rackCanvas(opts.room.pieces[RACK], n));
      this.rack.setTexture(tex);
      this.rackCount.setText(String(f.today)).setVisible(f.today > HOOKS);
      drawTrophies(this.trophies, f.days, ...MANTEL);
      const [rx, , ry] = [this.rack.x, 0, this.rack.y + this.rack.height + 4];
      this.rackTip.say(`Finished today: ${f.today} ${f.today === 1 ? 'task' : 'tasks'}`, rx, ry);
      const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], upTo = (new Date().getDay() + 6) % 7;
      this.trophyTip.say(`This week: ${f.week} finished
${DAYS.slice(0, upTo + 1).map((d, i) => `${d} ${f.days[i]}`).join(' · ')}`, MANTEL[0] - 20, MANTEL[2] + 6);
    }
    // A tip in the room's style (#302): big bold text on a parchment panel with a dark wooden frame,
    // so it still reads with the room shrunk to fit the window. box.say(text, x, y) fills and places it.
    tip() {
      const text = this.add.text(8, 6, '', { fontFamily: 'Consolas, monospace', fontSize: '20px', fontStyle: 'bold', color: '#1e120a' }).setResolution(2);
      const panel = this.add.rectangle(0, 0, 10, 10, 0xf6ecd2).setOrigin(0).setStrokeStyle(3, 0x3a2414);
      const box = this.add.container(0, 0, [panel, text]).setDepth(D.dim + 5).setVisible(false);
      box.say = (s, x, y) => { text.setText(s); panel.setSize(text.width + 16, text.height + 12); return box.setPosition(Math.max(4, Math.min(x, W - text.width - 20)), y); };
      return box;
    }

    // The light (#283): the clock's, or `pin` one ('day', 'dusk', 'night'; null goes back to the clock).
    setLight(pin) {
      if (pin !== undefined) this.pinned = pin;
      const light = this.pinned || lightAt(), look = LOOK[light];
      this.light = light;
      this.dim.setVisible(!!look.dim); if (look.dim) this.dim.setFillStyle(look.dim);
      this.glows.setVisible(look.glow > 0).setAlpha(look.glow);
    }

    // A wall piece that lights up and gets a rim under the pointer, and does something on a click.
    hotspot(name, click) {
      const Phaser = globalThis.Phaser, at = PLACES.find(p => p[0] === name), img = opts.room.pieces[name];
      const lit = this.add.image(at[1], at[2], `pc:${name}`).setOrigin(0).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.28).setDepth(D.dim + 2).setVisible(false);
      const rim = this.add.rectangle(at[1] - 1, at[2] - 1, img.width + 2, img.height + 2).setOrigin(0).setStrokeStyle(1, 0xf0d9a0, 0.5).setDepth(D.dim + 2).setVisible(false);
      const zone = this.add.zone(at[1], at[2], img.width, img.height).setOrigin(0).setDepth(D.dim + 3).setInteractive({ useHandCursor: true })
        .on('pointerover', () => { lit.setVisible(true); rim.setVisible(true); })
        .on('pointerout', () => { lit.setVisible(false); rim.setVisible(false); })
        .on('pointerdown', click);
      return { lit, rim, zone };
    }
    // How many questions and prompts are pinned on the notice board (#276). keys name each one:
    // one not seen before wakes the cat (#284); the first call only learns what is there.
    setNotices(n, keys = null) {
      this.pin.setText(String(n)).setVisible(n > 0);
      if (!keys) return;
      if (this.seen && keys.some(k => !this.seen.has(k))) this.wakeCat();
      this.seen = new Set(keys);
    }
    // The cat lifts its head, stretches long, then curls up and sleeps again (#284).
    wakeCat() { if (this.cat && !(this.catAt && this.time.now - this.catAt < CAT_WAKE)) this.catAt = this.time.now; }
    catPose(time) {
      const t = this.catAt ? (time - this.catAt) / 1000 : Infinity;
      if (!(t < CAT_WAKE / 1000)) { this.catAt = 0; return null; }
      // [time, scale across, scale up]: up, a long stretch, held, back, a little settle.
      const keys = [[0, 1, 1], [0.35, 0.82, 1.4], [0.9, 1.55, 0.74], [1.9, 1.55, 0.74], [2.4, 0.94, 1.12], [2.8, 1, 1]];
      const i = keys.findIndex(k => k[0] > t), [t0, x0, y0] = keys[Math.max(0, i - 1)], [t1, x1, y1] = i < 0 ? keys[keys.length - 1] : keys[i];
      const f = t1 > t0 ? Math.min(1, (t - t0) / (t1 - t0)) : 1, ease = f * f * (3 - 2 * f);
      return [x0 + (x1 - x0) * ease, y0 + (y1 - y0) * ease];
    }

    // A character's rig, baked into its animations once.
    async rig(name) {
      if (!this.rigs.has(name)) this.rigs.set(name, (async () => {
        const front = name === 'barkeep' ? url('barkeep.png') : url(`../../art/sprites/robot-${name}.png`);
        const views = opts.room.angles[name] || [], side = views.includes('side') ? url(`../../art/sprites/angles/${name}-side.png`) : null;
        const back = views.includes('back') ? url(`../../art/sprites/angles/${name}-back.png`) : null;
        const rig = await rigCharacter(front, name === 'barkeep' ? null : lay(name), { side, back });
        return { rig, ...bake(this, `ch:${name}`, rig, presets) };
      })());
      return this.rigs.get(name);
    }
    // After a motion setting changed (the demo's sliders): every character baked again.
    async rebake(next) {
      Object.assign(presets, structuredClone(next));
      for (const [name, pr] of this.rigs) { const r = await pr; Object.assign(r, bake(this, `ch:${name}`, r.rig, presets)); }
      for (const p of this.guests.values()) p.anim = '';
      if (this.keeper) this.keeper.anim = '';
    }

    async addPerson(id, name, x, y) {
      const r = await this.rig(name), n = this.made++, f = r.rig.front;
      const sprite = this.add.sprite(x, y, `ch:${name}:front`).setScale(CHAR);
      const p = { id, name, sprite, r, x, y, face: -1, dir: 'front', mode: 'idle', anim: '', queue: [], step: 0, wait: 0,
        n, phase: (n * 0.6180339) % 1, pace: 0.95 + ((n * 0.7548776) % 1) * 0.1, k: f.k, w: f.w,
        off: Math.round((f.hh - 1 - f.hip74) * CHAR - 34), sitAt: 0, where: 'door' };
      sprite.setInteractive({ pixelPerfect: true });
      // A click on a guest (#277): its card, or its question when it has one.
      sprite.on('pointerdown', () => { if (id !== 'barkeep' && opts.onGuest) opts.onGuest(p.id); });
      sprite.on('pointerover', () => { if (id !== 'barkeep' && opts.onGuest) this.input.setDefaultCursor('pointer'); });
      sprite.on('pointerout', () => this.input.setDefaultCursor('default'));
      return p;
    }

    // ---- who is in the room ----
    // cast: [{ id, robot, state: 'working'|'idle'|'asking' }]. New guests walk in by the door and
    // gone ones walk out. With seated (a room just opened, or opened again after being closed,
    // #296) everyone is put straight where their state puts them: at their seat, or at the bar
    // with a question; gone ones are simply gone. Nothing walks to catch up.
    async setCast(cast, { seated = false } = {}) {
      await this.ready;
      const ids = new Set(cast.map(c => c.id));
      // A project's visitor at the bar becomes its lead when the lead opens (#281): the same
      // robot stays where it is, rather than one walking out as the other walks in.
      for (const c of cast) {
        const v = c.was && !this.guests.has(c.id) && !ids.has(c.was) && this.guests.get(c.was);
        if (v && v.next !== 'leave') { this.guests.delete(c.was); v.id = c.id; this.guests.set(c.id, v); }
      }
      for (const p of [...this.guests.values()]) {
        if (ids.has(p.id)) continue;
        if (seated) { p.sprite.destroy(); p.bubble?.destroy(); p.prop?.destroy(); p.mug?.destroy(); p.call?.destroy(); this.guests.delete(p.id); }
        else if (p.next !== 'leave') p.next = 'leave';
      }
      // Helpers first, so the round tables are still free for them.
      for (const c of [...cast].sort((a, b) => HELPER(b.robot) - HELPER(a.robot))) {
        const p = this.guests.get(c.id);
        // Away from its seat counts too: an idle guest standing at the bar for a refill is still
        // "at its seat" by its plan, and would otherwise walk back once the room opens (#319).
        const away = c.state !== 'asking' && Math.hypot(p?.x - p?.seat?.x, p?.y - p?.seat?.y - (p?.seat?.stand ? 0 : p?.off)) > 1;
        if (p && seated) { if (p.state !== c.state || p.next || p.where !== (c.state === 'asking' ? 'bar' : 'seat') || p.mode === 'walk' || away) this.place(p, c.state); continue; }
        // Given a task while drinking (#312): the mug goes back to the counter first.
        if (p && p.state === 'idle' && c.state === 'working' && p.where === 'seat' && !p.next && !p.hold) { p.state = c.state; this.giveBack(p); continue; }
        if (p) { if (p.state !== c.state && p.next !== 'leave') { p.state = c.state; p.next = c.state; } continue; }
        if (this.adding?.has(c.id)) continue;
        (this.adding ||= new Set()).add(c.id);
        // The seat is claimed before the robot's art loads, so a cast given meanwhile (the app
        // gives one on every change) cannot hand it to someone else (#303).
        const seat = this.freeSeat(c.robot);
        (this.claimed ||= new Set()).add(seat);
        const q = await this.addPerson(c.id, c.robot, ...(seated ? [seat.x, seat.y] : DOOR));
        this.adding.delete(c.id); this.claimed.delete(seat);
        q.seat = seat; q.state = c.state;
        // Walking in, it waits outside until the doorway is clear (#303).
        if (!seated) { q.hold = true; q.sprite.setVisible(false); }
        if (seated) { this.place(q, c.state); q.wait = 20 * (1 - (q.n * 0.618) % 1); }
        else {
          q.queue = [{ steps: arrivePlan(seat, seat.stand ? 0 : q.off), loop: false }]; q.next = c.state;
          // Its CTO calls it in (#281): a phone over the CTO's head, wherever it is, until it is inside.
          const cto = c.caller && this.guests.get(c.caller);
          if (cto) { cto.phone = c.id; cto.phoneAt = this.time.now; }
        }
        this.guests.set(c.id, q);
      }
    }
    // A free seat: helpers at the round tables (#271), the rest in order, then the walls. One
    // robot to a seat or a place by the wall, seats being claimed included (#303).
    freeSeat(robot) {
      const taken = new Set([...[...this.guests.values()].map(p => p.seat), ...(this.claimed || [])]);
      const free = this.SEATS.filter(s => !taken.has(s) && (!HELPER(robot) || s.type === 'round' || s.type === 'small'));
      const any = free.length ? free : this.SEATS.filter(s => !taken.has(s));
      if (any.length) return any[0];
      const used = s => [...taken].some(t => t && Math.abs(t.x - s.x) < 24 && Math.abs(t.y - s.y) < 12);
      for (const xy of STANDS) { const s = standSeat(xy); if (!used(s)) return s; }
      // More guests than places: further along the wall, each its own place.
      for (let k = 0; ; k++) { const s = standSeat([575 + (k % 7) * 30, 262 + 26 * Math.floor(k / 7)]); if (!used(s)) return s; }
    }
    // A free place at the bar for a question: the bar spots, then between them, then further on.
    freeSpot() {
      const used = [...this.guests.values()].map(p => p.spot).filter(x => x != null);
      const mid = BAR_SPOTS.slice(1).map((x, i) => (x + BAR_SPOTS[i]) / 2);
      for (const x of [...BAR_SPOTS, ...mid]) if (!used.some(u => Math.abs(u - x) < 24)) return x;
      for (let x = BAR_SPOTS[BAR_SPOTS.length - 1] + 30; ; x += 30) if (!used.some(u => Math.abs(u - x) < 24)) return x;
    }
    // A guest with work to do takes its mug back to the counter, puts it down and goes to its seat
    // to work (#312). Already standing at the counter, it puts it down where it is.
    giveBack(p) {
      const s = p.seat, off = s.stand ? 0 : p.off, atBar = Math.abs(p.y - (BAR_AISLE - 10)) < 6 && p.x < MUG_DROP[1];
      const used = [...this.guests.values()].map(q => q.spot).filter(x => x != null);
      const spot = atBar ? Math.round(p.x) : BAR_SPOTS.filter(x => x < MUG_DROP[1]).sort((a, b) => used.some(u => Math.abs(u - a) < 24) - used.some(u => Math.abs(u - b) < 24) || Math.abs(a - p.x) - Math.abs(b - p.x))[0];
      const home = Math.hypot(p.x - s.x, p.y - s.y - off) < 4 ? s.out.map(([x, y]) => ['go', x, y]) : [];
      const to = atBar ? [] : [...home, ['go', spot, BAR_AISLE], ['go', spot, BAR_AISLE - 10]];
      p.carry = true; p.spot = spot; p.step = 0; p.wait = 0; p.route = null;
      p.queue = [{ steps: [...to, ['stay', 'idle', 0.5, -1], ['drop'], ['stay', 'idle', 0.4, -1]], loop: false }, { steps: backPlan(s, spot, off), loop: false }, { steps: workPlan(s), loop: false }];
      p.sitAt = s.stand ? 0 : s.y;
    }
    // The mug left on the counter, until the barkeep clears it a few seconds later.
    dropMug(p) {
      p.carry = false; p.spot = null; p.mug?.setVisible(false);
      if (!p.mug) return;
      const left = this.add.image(Math.round(p.x), MUG_DROP[0], p.mug.texture.key).setOrigin(0.5, 1).setDepth(MUG_DROP[2]);
      this.tweens.add({ targets: left, alpha: 0, delay: 8000, duration: 600, onComplete: () => left.destroy() });
    }
    // A guest put straight where its state puts it (#296): at the bar with a question, else in its seat.
    place(p, what) {
      p.carry = false;
      const s = p.seat, off = s.stand ? 0 : p.off;
      p.state = what; p.next = null; p.step = 0; p.wait = 0; p.spot = null; p.mode = 'idle'; p.route = null;
      if (what === 'asking') {
        p.spot = this.freeSpot(); p.x = p.spot; p.y = BAR_AISLE - 10; p.where = 'bar'; p.face = -1; p.sitAt = 0;
        p.queue = [{ steps: [['stay', 'idle', Infinity, -1]], loop: false }];
        return;
      }
      p.x = s.x; p.y = s.y + off; p.where = 'seat';
      this.plan(p, what);
    }
    // The plan for a state, from where the guest is.
    plan(p, what) {
      const s = p.seat, off = s.stand ? 0 : p.off;
      if (what === 'leave') { p.queue = [{ steps: leavePlan(s, p.where, p.spot), loop: false }]; p.spot = null; return; }
      const back = p.where === 'bar' ? [{ steps: backPlan(s, p.spot, off), loop: false }] : [];
      if (p.where === 'bar' && what !== 'asking') p.spot = null;
      if (what === 'asking') { if (p.where === 'bar') return; p.spot = this.freeSpot(); p.queue = [{ steps: askPlan(s, p.spot), loop: false }]; return; }
      p.queue = [...back, what === 'working' ? { steps: workPlan(s), loop: false } : { steps: seatPlan(s, p.n, off), loop: true }];
      p.sitAt = s.stand ? 0 : s.y;
    }

    // ---- moving ----
    // Walks to x, y round the furniture (#298), waiting for someone in the way and looking for a
    // way round them; after three seconds of that it goes on regardless, so nobody is stuck for good.
    // direct (the barkeep on the keys): straight on, sliding along whatever it would walk into.
    walkTo(p, x, y, dt, direct = false) {
      if (direct) { p.route = null; return this.stepTo(p, x, y, dt, true); }
      if (!p.route || p.route.want[0] !== x || p.route.want[1] !== y) {
        const to = this.freePlace(p, x, y);
        // Round anyone standing or sitting on the way too (#303), or failing that round the furniture only.
        p.route = { want: [x, y], to, from: [p.x, p.y], pts: findPath(this.grid, [p.x, p.y], to, { extra: this.peopleCells(p, true) }) || findPath(this.grid, [p.x, p.y], to) || [to], wait: 0 };
      }
      const r = p.route, next = r.pts[0];
      // Someone just ahead: wait a moment, then go on. Not into someone either (#303): wait and
      // look for a way round them, squeezing past only when there is none after four seconds.
      if ((r.wait < 3 && this.inTheWay(p, next)) || (r.wait < 4 && this.bumps(p, next, dt))) {
        r.wait += dt; p.mode = 'idle';
        if (r.wait - (r.round || 0) > 0.6) { r.round = r.wait; r.pts = findPath(this.grid, [p.x, p.y], r.to, { near: 6, extra: this.peopleCells(p) }) || r.pts; }
        return false;
      }
      if (this.stepTo(p, next[0], next[1], dt)) { r.pts.shift(); if (!r.pts.length) { p.route = null; return true; } }
      return false;
    }
    // Where to stop: x, y, or beside it when someone already stands there (at the bar, say).
    // Where others are headed counts too, so two arriving together do not stop on one place (#303).
    freePlace(p, x, y) {
      const taken = (a, b) => this.people().some(q => q !== p && ((q.mode !== 'walk' && q.mode !== 'sit' && !q.route && Math.abs(q.x - a) < 22 && Math.abs(q.y - b) < 12)
        || (q.route && Math.abs(q.route.to[0] - a) < 22 && Math.abs(q.route.to[1] - b) < 12)));
      if (!taken(x, y)) return [x, y];
      for (const dx of [26, -26, 52, -52, 78, -78, 104, -104]) if (!taken(x + dx, y) && !solidAt(this.grid, x + dx, y)) return [x + dx, y];
      return [x, y];
    }
    // Someone standing or walking just ahead on the way to `to`.
    inTheWay(p, to) {
      const dx = to[0] - p.x, dy = to[1] - p.y, d = Math.hypot(dx, dy) || 1;
      for (const q of this.people()) {
        if (q === p || q.mode === 'sit') continue;
        const ox = q.x - p.x, oy = q.y - p.y, along = (ox * dx + oy * dy) / d, side = Math.abs(ox * dy - oy * dx) / d;
        if (along > 0 && along < Math.min(20, d + 8) && side < 9) return true;
      }
      return false;
    }
    // Would a step towards `to` bring p closer to someone it then overlaps (#303)?
    bumps(p, to, dt) {
      const dx = to[0] - p.x, dy = to[1] - p.y, d = Math.hypot(dx, dy);
      if (d < 0.5) return false;
      const k = Math.min(d, Math.max(2, this.speedOf(p) * dt)) / d, nx = p.x + dx * k, ny = p.y + dy * k;
      return this.people().some(q => q !== p && !q.hold && !q.gone && Math.abs(q.x - nx) < OVERLAP[0] && Math.abs(q.y - ny) < OVERLAP[1]
        && Math.hypot(q.x - nx, (q.y - ny) * 2) < Math.hypot(q.x - p.x, (q.y - p.y) * 2));
    }
    people() { return this.keeper ? [this.keeper, ...this.guests.values()] : [...this.guests.values()]; }
    // The cells everyone else stands on, for a way round them; still: only those not walking,
    // sitters included (#303), a body's width either side.
    peopleCells(p, still = false) {
      const out = new Set(), rx = still ? 18 : 12, ry = still ? 9 : 12;
      for (const q of this.people()) {
        if (q === p || q.hold || (still ? q.mode === 'walk' || q.route : q.mode === 'sit')) continue;
        for (let y = q.y - ry; y <= q.y + ry; y += CELL) for (let x = q.x - rx; x <= q.x + rx; x += CELL) out.add(Math.floor(y / CELL) * this.grid.cols + Math.floor(x / CELL));
      }
      return out;
    }
    // The ground speed of the baked stride, at the person's own pace (#258, #269).
    // Shift held with the barkeep's keys runs him at twice the pace (#291).
    speedOf(p) { return 4 * (1.8 + presets.walk.leg * 0.9) * p.k * CHAR * presets.walk.speed * p.pace * (p.run ? 2 : 1); }
    // One straight stretch of a walk; true once there.
    stepTo(p, x, y, dt, slide = false) {
      const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
      if (d < 1) { p.x = x; p.y = y; return true; }
      p.mode = 'walk'; if (Math.abs(dx) > 0.5) p.face = dx > 0 ? 1 : -1;
      // Seen from the side across the room, from behind going up it (#262).
      p.dir = Math.abs(dx) >= Math.abs(dy) ? 'side' : dy < 0 ? 'back' : 'front';
      const k = Math.min(1, this.speedOf(p) * dt / d), nx = p.x + dx * k, ny = p.y + dy * k;
      if (slide && !solidAt(this.grid, p.x, p.y)) {
        // Into furniture: along it instead, or not at all.
        if (solidAt(this.grid, nx, ny)) {
          if (!solidAt(this.grid, nx, p.y)) p.x = nx; else if (!solidAt(this.grid, p.x, ny)) p.y = ny; else { p.mode = 'idle'; return true; }
          return false;
        }
      }
      p.x = nx; p.y = ny;
      return false;
    }
    // One step of the guest's plan. A new state waits for a seat or the bar to be reached.
    advance(p, dt) {
      const cur = p.queue[0];
      if (p.next && (!cur || (p.where === 'seat' && cur.loop && p.step % cur.steps.length === 0 && p.mode !== 'walk') || (p.where === 'seat' && !cur.loop && cur.steps[p.step]?.[0] === 'stay') || (p.where === 'bar' && cur.steps[p.step]?.[0] === 'stay'))) {
        const what = p.next; p.next = null; p.step = 0; p.wait = 0;
        p.carry = false; this.plan(p, what);
        return;
      }
      if (!cur) { p.mode = 'idle'; return; }
      if (p.step >= cur.steps.length) { if (cur.loop) p.step = 0; else { p.queue.shift(); p.step = 0; } return; }
      const s = cur.steps[p.step];
      if (s[0] === 'go') { if (this.walkTo(p, s[1], s[2], dt)) p.step++; }
      else if (s[0] === 'at') { p.where = s[1]; p.step++; }
      else if (s[0] === 'gone') { p.gone = true; }
      else if (s[0] === 'drop') { this.dropMug(p); p.step++; }
      else { p.mode = s[1]; if (s[3]) p.face = s[3]; p.wait += dt; if (p.wait >= s[2]) { p.wait = 0; p.step++; } }
    }
    // The barkeep: the owner's keys or click first; after 8 s alone, back to his round.
    keeperStep(k, dt) {
      const K = this.keys, now = this.time.now;
      const kx = K ? (K.RIGHT.isDown || K.D.isDown) - (K.LEFT.isDown || K.A.isDown) : 0, ky = K ? (K.DOWN.isDown || K.S.isDown) - (K.UP.isDown || K.W.isDown) : 0;
      k.run = !!(kx || ky) && K.SHIFT.isDown;
      if (kx || ky) { k.manual = now; k.target = [Phaser.Math.Clamp(k.x + kx * 40, 12, W - 12), Phaser.Math.Clamp(k.y + ky * 40, WALL + 22, H - 4)]; }
      if (k.target) { if (this.walkTo(k, k.target[0], k.target[1], dt, !!(kx || ky))) { k.target = null; k.mode = 'idle'; } return; }
      if (k.manual) {
        if (now - k.manual < 8000) { k.mode = 'idle'; return; }
        k.manual = 0; k.queue = [{ steps: [['go', 230, 200]], loop: false }, { steps: KEEPER, loop: true }]; k.step = 0; k.wait = 0;
      }
      this.advance(k, dt);
    }

    // ---- drawing ----
    show(p) {
      const views = p.r.rig, side = p.mode === 'walk' && p.dir === 'side' && views.side, back = p.mode === 'walk' && p.dir === 'back' && views.back;
      const anim = p.mode === 'walk' ? (side ? 'walk-side' : back ? 'walk-back' : 'walk') : p.mode === 'sit' ? 'sit' : 'idle';
      if (anim !== p.anim) {
        p.anim = anim;
        const key = `ch:${p.name}:${anim}`, n = this.anims.get(key).frames.length;
        p.sprite.play({ key, startFrame: Math.floor(p.phase * n) % n, timeScale: p.pace }).setOrigin(...p.r.origin[anim]);
      }
      // Running steps the legs faster too.
      if (p.sprite.anims) p.sprite.anims.timeScale = p.pace * (p.run && p.mode === 'walk' ? 2 : 1);
      p.sprite.setFlipX(side ? p.face < 0 : back ? false : p.face > 0);
      p.sprite.setPosition(Math.round(p.x), Math.round(p.y));
      // Someone sitting is in front of the bench or chair behind them and behind their table.
      p.sprite.setDepth(p.mode === 'sit' && p.sitAt ? p.sitAt + 5 : p.y + (p.mode === 'sit' ? 30 : 0));
      if (p.mode !== 'sit') {
        const rx = p.w * 0.3 * CHAR;
        this.shadows.fillStyle(0x140810, 0.42).fillEllipse(p.x + 1.5, p.y - 1, rx * 2, 5).fillStyle(0x140810, 0.6).fillEllipse(p.x + 1.5, p.y - 1, rx * 1.5, 3);
      }
      // Waiting on the owner: a "!" over the head at the bar (#246, #278; it was a "?").
      const asking = p.state === 'asking' && p.where === 'bar';
      if (asking && !p.bubble) p.bubble = this.add.text(0, 0, '!', { fontFamily: 'monospace', fontSize: '14px', fontStyle: 'bold', color: '#fff6dc', backgroundColor: '#b8322a', padding: { x: 5, y: 1 } }).setOrigin(0.5, 1).setDepth(D.dim + 4);
      if (p.bubble) { p.bubble.setVisible(asking).setPosition(Math.round(p.x), Math.round(p.y - p.sprite.displayHeight * 0.92 - (Math.floor(this.time.now / 400) % 2))); }
      if (p.id !== 'barkeep') this.props(p);
      // On the phone to a lead walking in (#281), for CALL_MS at most (#363).
      const calling = p.phone && this.time.now - p.phoneAt < CALL_MS && this.guests.get(p.phone)?.where === 'door';
      if (!calling) p.phone = null;
      if (calling && !p.call) p.call = this.add.text(0, 0, '\u{1F4DE}', { fontFamily: '"Segoe UI Emoji", sans-serif', fontSize: '14px', backgroundColor: '#f6ecd2', padding: { x: 3, y: 1 } }).setOrigin(0.5, 1).setDepth(D.dim + 4);
      if (p.call) { const b = p.sprite.getBounds(); p.call.setVisible(!!calling).setPosition(Math.round(b.centerX + 12), Math.round(b.y + 4 - (Math.floor(this.time.now / 250) % 2))); }
      // Through the doorway (#281): fading in from the dark as it steps in, out as it steps out.
      const inDoor = Math.abs(p.x - DOOR[0]) < 30 && p.y < DOOR[1] + 34;
      p.sprite.setAlpha(inDoor ? Math.max(0, Math.min(1, (p.y - DOOR[1]) / 34)) : 1);
    }
    // What a guest holds (#278): busy, a scroll on the table it writes on with a quill; idle, a mug
    // of beer it lifts to drink now and then, seated or standing: one of the four art mugs (#307),
    // the same one every time, chosen from its name.
    props(p) {
      const busy = p.state === 'working' && p.mode === 'sit', drinking = (p.state === 'idle' && p.mode !== 'walk') || !!p.carry;
      p.prop?.setVisible(busy); p.mug?.setVisible(drinking);
      if (!busy && !drinking) return;
      const b = p.sprite.getBounds(), cx = Math.round(b.centerX), t = this.time.now / 1000 + p.phase * 7;
      // Seated, in front of the table top (its base is 12 below the seat line, #251); standing, just in front.
      const depth = p.mode === 'sit' && p.sitAt ? p.sitAt + 20 : p.sprite.depth + 1;
      if (busy) {
        const g = (p.prop ||= this.add.graphics()).clear().setDepth(depth);
        const y = Math.round(b.y + b.height * (p.sitAt ? 0.62 : 0.5));
        g.fillStyle(0xf0e4bf).fillRect(cx - 13, y, 26, 13).fillStyle(0xc9b07a).fillRect(cx - 15, y - 2, 30, 3).fillRect(cx - 15, y + 12, 30, 3);
        g.fillStyle(0x5a4a38); for (let i = 0; i < 4; i++) g.fillRect(cx - 11, y + 2 + i * 3, 8 + ((i * 5 + Math.floor(t * 2)) % 12), 1);
        // The quill scratches along the line.
        const qx = cx - 6 + Math.round(Math.abs(((t * 6) % 16) - 8)), qy = y + 5;
        g.lineStyle(2, 0xfaf6ea).lineBetween(qx + 1, qy - 2, qx + 7, qy - 14).lineStyle(1, 0x2a1a10).lineBetween(qx, qy, qx + 1, qy - 3);
        return;
      }
      // A sip every few seconds: the mug rises to the face and comes back down.
      const cyc = (t % 5) / 5, lift = cyc < 0.2 && !p.carry ? Math.sin((cyc / 0.2) * Math.PI) : 0;
      const side = p.face > 0 ? -1 : 1, x = cx + side * Math.round(b.width * 0.22) - 3;
      const rest = b.y + b.height * (p.mode === 'sit' ? 0.55 : 0.5), sip = b.y + b.height * 0.24, y = Math.round(rest + (sip - rest) * lift);
      // Its bottom where the drawn mug's was, the handle towards the robot; twice the art's size in
      // the hand (#316), so it reads at the room's scale, a little further out to clear the body.
      p.mug ||= this.add.image(0, 0, `pc:${BEERS[[...String(p.id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % BEERS.length]}`).setOrigin(0.5, 1).setScale(2);
      p.mug.setPosition(x + 5 + side * 4, y + 12).setFlipX(side > 0).setDepth(depth);
    }
    update(time, delta) {
      // Up to half a second a frame, so a slow or hidden window still walks people at their speed.
      const dt = Math.min(0.5, delta / 1000);
      for (const a of this.anim) {
        const name = a.fps ? a.frames[Math.floor((time / 1000) * a.fps + a.x * 0.37) % a.frames.length] : LOOK[this.light].window, tex = this.textures.get(`pc:${name}`).getSourceImage();
        if (a.foot) {
          const pose = this.catPose(time), awake = pose && time - this.catAt < 1200;
          a.img.setTexture(`pc:${pose ? a.frames[1] : name}`).setY(a.y).setScale(...(pose || [1, 1]));
          // A small "!" over its head for the first moment awake.
          if (awake && !this.catMark) this.catMark = this.add.text(a.img.x, a.y - a.h - 6, '!', { fontFamily: 'monospace', fontSize: '12px', fontStyle: 'bold', color: '#fff6dc', backgroundColor: '#b8322a', padding: { x: 4, y: 0 } }).setOrigin(0.5, 1).setDepth(D.dim + 4);
          if (this.catMark) this.catMark.setVisible(!!awake);
          continue;
        }
        // Grown from the middle of its bottom edge (the fire, #280).
        a.img.setTexture(`pc:${name}`).setScale(a.k).setX(a.x - Math.round(tex.width * (a.k - 1) / 2)).setY(a.base < 0 ? a.y + a.h - tex.height : a.y - Math.round(tex.height * a.k));
      }
      if (this.fireGlow) this.fireGlow.setAlpha(this.fireHeat * (0.75 + 0.25 * Math.sin(time / 180) * Math.sin(time / 77)));
      this.shadows.clear();
      // The door stands open while someone is in or near the doorway, and shuts a moment after (#281).
      if (this.door) {
        if (this.people().some(p => Math.abs(p.x - DOOR[0]) < 40 && p.y < DOOR[1] + 50)) this.doorUntil = time + 700;
        const open = time < (this.doorUntil || 0);
        if (open !== !!this.doorOpen) { this.doorOpen = open; this.door.setTexture(open ? 'pc:p:door-open' : 'pc:p:door-closed'); }
      }
      if (this.keeper) { this.keeperStep(this.keeper, dt); this.show(this.keeper); }
      for (const p of [...this.guests.values()]) {
        if (p.hold) {
          // One at a time, a moment apart, so a crowd comes in one by one (#306).
          if (time - (this.lastIn ?? -Infinity) < 1500 || this.people().some(q => q !== p && !q.hold && Math.abs(q.x - DOOR[0]) < 24 && q.y < DOOR[1] + 70)) continue;
          p.hold = false; p.sprite.setVisible(true); this.lastIn = time;
        }
        this.advance(p, dt);
        if (p.gone) { p.sprite.destroy(); p.bubble?.destroy(); p.prop?.destroy(); p.mug?.destroy(); p.call?.destroy(); this.guests.delete(p.id); continue; }
        this.show(p);
      }
    }
  };
}
