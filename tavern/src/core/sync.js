// The sync step (#238): FocusShell's agent list is the truth and the tavern only shows it.
// Given the agents and the guests on screen, this works out who comes in, who moves where
// and who leaves. Pure, so the rules are tested without Phaser.
//
// An agent: { id, name, role: 'cto'|'pm'|'lead'|'helper', project, state: 'working'|'idle'|
// 'asking', question?: { text, options: [] } }. A guest's spot is a seat or a bar spot.

import { SEATS, BAR_SPOTS } from './layout.js';

// What a guest should be doing for its agent's state.
export const wantOf = agent => agent.state === 'asking' ? 'ask' : agent.state === 'working' ? 'work' : 'drink';
const spotsFor = want => want === 'ask' ? BAR_SPOTS : SEATS.filter(s => s.kind === want);
const fits = (spot, want) => spot && (want === 'ask' ? spot.id.startsWith('bar:') : spot.kind === want);

// guests: Map id -> { want, spot }. Returns the changes to make, in order:
// { op: 'add' | 'move' | 'leave', id, agent?, want?, spot? }. A guest that cannot get a
// spot (the room is full) waits where it is with spot null.
export function syncGuests(guests, agents) {
  const ops = [], live = new Set(agents.map(a => a.id));
  const taken = new Set();
  for (const [id, g] of guests) if (live.has(id) && g.spot) taken.add(g.spot.id);
  for (const [id] of guests) if (!live.has(id)) ops.push({ op: 'leave', id });
  // Keep spots that still fit first, so nobody is pushed out of a chair by a newcomer.
  const free = want => spotsFor(want).find(s => !taken.has(s.id)) || null;
  for (const agent of agents) {
    const want = wantOf(agent), g = guests.get(agent.id);
    if (g && g.want === want && fits(g.spot, want)) continue;
    if (g?.spot) taken.delete(g.spot.id);
    const spot = free(want);
    if (spot) taken.add(spot.id);
    ops.push({ op: g ? 'move' : 'add', id: agent.id, agent, want, spot });
  }
  return ops;
}

// How many agents wait at the bar: the Tavern button's badge.
export const waitingCount = agents => agents.filter(a => a.state === 'asking').length;
