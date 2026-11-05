// The owner's robots (#252): one per project lead plus the CTO, the PM, two spares, two
// helpers and a plain robot for projects without one of their own. Each is the free-armed
// front view of its Gemini sheet, cleaned and cut by tools/cut-figure.py into art/sprites, and
// rigged like the barkeep through its own body layout (where its neck, shoulders, hands and
// hips are, and the columns its arms hang outside of).

// Most robots are drawn on the same copper body.
const BODY = { neck: 32, shoulder: 34, hand: 92, hip: 82, back: 10, front: 55 };
// [sprite name, what it stands for, layout]. A long coat, robe or apron moves the hip down to
// its hem, so the garment sways with the body rather than splitting with the legs.
export const ROBOTS = [
  ['cto', 'the CTO', { neck: 24, shoulder: 27, hand: 84, hip: 94, back: 12, front: 56 }],
  ['pm', 'the PM', { neck: 26, shoulder: 28, hand: 86, hip: 82, back: 9, front: 50 }],
  ['focus-shell', 'FocusShell', { ...BODY, neck: 30, shoulder: 32, hand: 86 }],
  ['ai-fun', 'AI Fun', { ...BODY, neck: 33, shoulder: 35, hand: 90, front: 54 }],
  ['budget-expense-tracker', 'Budget Expense Tracker', BODY],
  ['compass', 'Compass', { ...BODY, front: 57 }],
  ['builder', 'Builder', BODY],
  ['claude-setup', 'Claude Setup', BODY],
  ['gym', 'Coach', BODY],
  ['research', 'research', { ...BODY, hip: 100 }],
  ['web', 'Web', { ...BODY, hip: 90 }],
  ['video-editor', 'video editor', { ...BODY, hip: 88 }],
  ['personal', 'Personal', { ...BODY, hip: 88 }],
  ['spare', 'spare (miner)', BODY],
  ['spare-1', 'spare (hooded cloak)', BODY],
  ['general-1', 'projects without their own robot', BODY],
  // The helpers are cut 85 rows tall, about three quarters of a robot (#263).
  ['helper', 'a helper (tray)', { neck: 25, shoulder: 26, hand: 69, hip: 62, back: 7, front: 41 }],
  ['helper-2', 'a helper (mushroom cap, scroll)', { neck: 26, shoulder: 28, hand: 69, hip: 62, back: 5, front: 38 }],
];

// Seats and walks (#251, #261): everyone has a seat at a table, sits a while, walks along the
// aisles to stand at the bar or the barrel table, and comes back. Aisles run along the front of
// the bar (y 320) and beside each table, so nobody walks through a table, bench or chair.
export const BAR_AISLE = 300;
export const BAR_SPOTS = [125, 185, 245, 320, 380, 480];
// Per table type: the sitters' offsets from the table's middle ([dx, dy]) and how far right of
// it the aisle runs.
const SEATING = {
  // Two on a long bench, with room between them (#270).
  long: { at: [[-38, 0], [38, -4]], gap: 125 },
  square: { at: [[-20, 0], [22, -4]], gap: 108 },
  round: { at: [[-20, 0], [22, -4]], gap: 108 },
  small: { at: [[0, 0]], gap: 75 },
  // A barrel table: two stand at it (#263).
  barrel: { at: [[-24, -2], [24, -6]], gap: 95, stand: true },
};

// The seats of a table [type, x, y]: where each sitter's feet are, and the path out to the bar
// aisle: along behind the table to the aisle beside it, and up the aisle, which runs clear past
// the tables in front.
// From the back row, the lane is followed to the aisle between the rows (y 492) and along it to
// the nearest front-row lane, so nobody crosses a front-row table.
const ROWS_AISLE = 492;
function tableSeats([type, x, y, aisle], frontLanes) {
  const { at, gap, stand } = SEATING[type], lane = aisle ?? x + gap;
  const up = y < ROWS_AISLE || !frontLanes.length ? [[lane, BAR_AISLE]]
    : (f => [[lane, ROWS_AISLE], [f, ROWS_AISLE], [f, BAR_AISLE]])(frontLanes.reduce((a, b) => (Math.abs(b - lane) < Math.abs(a - lane) ? b : a)));
  return at.map(([dx, dy]) => ({ type, x: x + dx, y: y + dy, face: -1, stand, out: [[lane, y + dy], ...up] }));
}

// The script for someone in seat s (the n-th sitter): sit, walk out to the bar, stand, walk back.
// off: how far the figure's feet sit below the seat line on a bench (robot.seat in room.js).
export function seatPlan(s, n, off) {
  // Uneven sits of 20-40 s (#264), so everyone is seen walking within a minute, and about half
  // the room stays seated.
  const spot = BAR_SPOTS[n % BAR_SPOTS.length], sit = 20 + (n * 7) % 21, stand = 3 + (n % 3);
  const out = s.out.map(([x, y]) => ['go', x, y]), back = [...out].reverse();
  return [['stay', s.stand ? 'idle' : 'sit', sit, s.face], ...out, ['go', spot, BAR_AISLE], ['go', spot, BAR_AISLE - 10], ['stay', 'idle', stand, -1],
    ['go', spot, BAR_AISLE], ...back, ['go', s.x, s.y + off]];
}
export const seatsOf = tables => {
  const front = tables.filter(t => t[2] < ROWS_AISLE && t[3] && t[0] !== 'barrel').map(t => t[3]);
  return tables.flatMap(t => tableSeats(t, front));
};

// Guests who come and go (#246): in the app a robot is a live session, so it walks in by the door
// when the session starts, out of it when it ends, and to the bar when it has a question. Plans
// are lists of steps: ['go', x, y], ['stay', mode, seconds, face] (Infinity: until told
// otherwise), ['at', place] marks where it now is ('seat', 'bar' or 'door'), ['gone'] leaves.
// The middle of the open door's dark doorway (#281), just in front of the wall.
export const DOOR = [537, 132];
// Places to stand for guests beyond the seats: along the walls, clear of the aisles.
export const STANDS = [[590, 215], [640, 215], [690, 215], [1110, 215], [1160, 215], [1210, 215], [1252, 262], [1252, 340], [560, 262], [760, 262]];
export const standSeat = ([x, y]) => ({ type: 'stand', x, y, face: -1, stand: true, out: [[x, BAR_AISLE]] });
const lane = s => s.out[s.out.length - 1][0];
const go = pts => pts.map(([x, y]) => ['go', x, y]);
const toSeat = (s, off) => [...go([...s.out].reverse().slice(1)), ['go', s.x, s.y + off], ['at', 'seat']];
// Into the room from the door to the seat; then the plan for its state.
export const arrivePlan = (s, off) => [['go', DOOR[0], BAR_AISLE], ['go', lane(s), BAR_AISLE], ...toSeat(s, off)];
// From the seat (or the bar) out of the door.
export const leavePlan = (s, from, spot) => [...(from === 'bar' ? [['go', spot, BAR_AISLE]] : go(s.out)), ['go', DOOR[0], BAR_AISLE], ['go', DOOR[0], DOOR[1]], ['gone']];
// From the seat to its own spot at the bar, standing there until the question is answered.
export const askPlan = (s, spot) => [...go(s.out), ['go', spot, BAR_AISLE], ['go', spot, BAR_AISLE - 10], ['at', 'bar'], ['stay', 'idle', Infinity, -1]];
// From the bar back to the seat.
export const backPlan = (s, spot, off) => [['go', spot, BAR_AISLE], ['go', lane(s), BAR_AISLE], ...toSeat(s, off)];
// Seated (or standing at a barrel table or by a wall) until told otherwise: a session at work.
export const workPlan = s => [['stay', s.stand ? 'idle' : 'sit', Infinity, s.face]];
