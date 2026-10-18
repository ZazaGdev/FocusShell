// The overlap check (#303): runs a room scene fast for a while, the game loop asleep, and reports
// every time two guests stood one on top of the other. The room demo runs it with ?check, the
// app's smoke run on its tavern. A pair counts while their feet are closer than OVERLAP; a guest
// still waiting outside the door is hidden and left out.
import { OVERLAP } from './roomscene.js';

// scene: a room scene. seconds: simulated time. shake(scene, i): called every 30 s, to change states.
// { seconds, guests, sharedSeats, worst: the longest one pair overlapped (s), pairs: [who, s] }
export async function overlapCheck(scene, { seconds = 300, shake = null } = {}) {
  const dt = 50, game = scene.game, asleep = game.loop.sleeping;
  if (!asleep) game.loop.sleep();
  const run = new Map(), longest = new Map();
  let t = scene.time.now;
  try {
    for (let i = 0; i < seconds * 1000 / dt; i++) {
      t += dt; scene.update(t, dt);
      if (shake && i % 600 === 300) await shake(scene, i);
      const g = [...scene.guests.values()].filter(p => !p.gone && !p.hold), now = new Set();
      for (let a = 0; a < g.length; a++) for (let b = a + 1; b < g.length; b++) {
        const p = g[a], q = g[b];
        if (Math.abs(p.x - q.x) >= OVERLAP[0] - 2 || Math.abs(p.y - q.y) >= OVERLAP[1] - 1) continue;
        const k = `${p.id}/${q.id}`;
        now.add(k); run.set(k, (run.get(k) || 0) + dt / 1000);
        longest.set(k, Math.max(longest.get(k) || 0, run.get(k)));
      }
      for (const k of run.keys()) if (!now.has(k)) run.delete(k);
    }
  } finally { if (!asleep) game.loop.wake(); }
  const seats = [...scene.guests.values()].map(p => p.seat && `${p.seat.x},${p.seat.y}`).filter(Boolean);
  const pairs = [...longest].sort((a, b) => b[1] - a[1]).map(([k, s]) => [k, Math.round(s * 10) / 10]);
  return { seconds, guests: scene.guests.size, sharedSeats: seats.length - new Set(seats).size, worst: pairs.length ? pairs[0][1] : 0, pairs: pairs.slice(0, 8) };
}
