// Lines FocusShell types into a CTO's pane (WAITING, ANSWER, NOTE, send, WORDS) never merge with
// a prompt the owner is still writing there (#243). A line waits while the pane's input box
// holds a draft or the owner typed in that pane in the last ten seconds, then goes with Enter;
// lines for one pane go one at a time, in order. A long line goes in short pieces, since Claude
// Code keeps only the tail of one written in one go (#1029).
import * as T from './terminal.js';
import { inputDraft, livePrompt } from '../lib/prompts.js';
import { chunksOf, CHUNK_GAP, boxAfterLine, voiceLive, leftLine } from '../lib/ctoline.js';

export const QUIET = 10e3;
const queues = new Map(); // pane id -> { line, onSent } waiting
const typing = new Set(); // panes a line is being typed into right now
let timer = null;

// Whether a line must wait: the owner is writing in the pane (a draft on screen, or typing in
// the last QUIET ms), or a permission prompt or question is live there, whose Enter the line
// would answer (#388). A held line goes once the prompt is gone. Any draft on screen holds it,
// whether or not the app saw it typed (#1205: dictated words were missed and a refresh merged).
// While the owner talks (#1277), Claude Code's dictation shows no words in the box until they
// stop, so a line typed then took the spoken words with its Enter: every line waits.
let talking = () => false;
export const setTalking = fn => { talking = fn; };
export async function drafting(id) {
  if (talking() || T.typingIn(id).ago < QUIET) return true;
  const rows = await T.screen(id, true);
  return !!livePrompt(rows) || !!inputDraft(rows) || voiceLive(rows);
}

// Types the line now if the owner is not writing there, else holds it. Resolves 'sent' or 'held'.
// onSent(at) is called once the line has gone in with its Enter, at the time it started;
// onLeft() when it stayed in the box without one and could not be taken back out (#1340).
export async function typeLine(deck, id, line, onSent, onLeft) {
  const q = queues.get(id) || [];
  queues.set(id, [...q, { line, onSent, onLeft }]);
  if (q.length || typing.has(id) || await drafting(id)) { tick(deck); return 'held'; }
  flushOne(deck, id);
  if (queues.has(id)) tick(deck);
  return 'sent';
}

const pause = ms => new Promise(r => setTimeout(r, ms));
async function flushOne(deck, id) {
  const [next, ...rest] = queues.get(id) || [];
  if (rest.length) queues.set(id, rest); else queues.delete(id);
  if (!next) return;
  typing.add(id);
  const at = Date.now();
  try {
    const hadBox = inputDraft(await T.screen(id, true)) !== null;
    for (const [i, part] of chunksOf(next.line).entries()) {
      if (i) await pause(CHUNK_GAP);
      deck.write(id, part);
    }
    await pause(next.line.length > 200 ? 300 : 60);
    // The Enter goes only when the box holds this line alone (#1277). With the owner's words
    // before it, the line comes back out, their words stay as they were, and it waits again.
    // Left without an Enter (the owner typed or talked meanwhile), it comes out the same way
    // while it is the box's tail; otherwise it stays and onLeft tells the owner (#1340).
    const box = await boxNow(id, next.line, at, hadBox);
    if (box === 'owner' || (box === 'left' && leftLine(inputDraft(await T.screen(id, true)), next.line) === 'out')) {
      deck.write(id, '\x7f'.repeat([...next.line].length));
      queues.set(id, [next, ...(queues.get(id) || [])]);
      tick(deck);
      return;
    }
    if (box !== 'send') { if (next.onLeft) next.onLeft(); return; }
    deck.write(id, '\r');
  } finally { typing.delete(id); }
  if (next.onSent) next.onSent(at);
}
// The box once the screen shows the whole line, for two seconds at most. A box that never
// shows it (a long line Claude Code folds into "[Pasted text]") gets its Enter only if the
// owner neither typed nor talked since the line started; otherwise it is left unsent. A box
// that was there before the line and is gone now (its ❯ row pushed off a short pane) never
// gets the Enter (#1340).
async function boxNow(id, line, at, hadBox) {
  let r = 'wait', draft = null;
  for (let i = 0; i < 14; i++) {
    draft = inputDraft(await T.screen(id, true));
    r = boxAfterLine(draft, line, hadBox);
    if (r === 'send' || r === 'owner') return r;
    await pause(150);
  }
  return r === 'mixed' || (hadBox && draft === null) || talking() || T.typingIn(id).ago < Date.now() - at ? 'left' : 'send';
}

// Every second, one waiting line per pane goes once its owner has stopped writing there.
function tick(deck) {
  if (timer) return;
  timer = setInterval(async () => {
    for (const id of [...queues.keys()]) if (!typing.has(id) && !(await drafting(id))) flushOne(deck, id);
    if (!queues.size && !typing.size) { clearInterval(timer); timer = null; }
  }, 1000);
}

export const heldCount = id => (queues.get(id) || []).length;

// A line that must reach the CTO (the recorder's RECORDING line): typed as above, then looked
// for in the CTO's own log. If it is not there after a while, fail(retry) tells the owner.
export const CHECK_AFTER = [15e3, 45e3];
// onSent and onLeft as for typeLine.
export function deliver(deck, id, line, fail, onSent, onLeft) {
  const check = (at, round) => setTimeout(async () => {
    if (await deck.ctoArrived(id, line.slice(0, 160), at)) return;
    if (round + 1 < CHECK_AFTER.length) check(at, round + 1);
    else fail(() => deliver(deck, id, line, fail, onSent, onLeft));
  }, CHECK_AFTER[round] - (round ? CHECK_AFTER[round - 1] : 0));
  return typeLine(deck, id, line, at => { check(at, 0); if (onSent) onSent(at); }, onLeft);
}
