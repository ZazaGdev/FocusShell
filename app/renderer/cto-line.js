// Lines FocusShell types into a CTO's pane (WAITING, ANSWER, NOTE, send, WORDS) never merge with
// a prompt the owner is still writing there (#243). A line waits while the pane's input box
// holds a draft or the owner typed in that pane in the last ten seconds, then goes with Enter;
// lines for one pane go one at a time, in order. A long line goes in short pieces, since Claude
// Code keeps only the tail of one written in one go (#1029).
import * as T from './terminal.js';
import { inputDraft, livePrompt } from '../lib/prompts.js';
import { chunksOf, CHUNK_GAP } from '../lib/ctoline.js';

export const QUIET = 10e3;
const queues = new Map(); // pane id -> { line, onSent } waiting
const typing = new Set(); // panes a line is being typed into right now
let timer = null;

// Whether a line must wait: the owner is writing in the pane (a draft on screen, or typing in
// the last QUIET ms), or a permission prompt or question is live there, whose Enter the line
// would answer (#388). A held line goes once the prompt is gone.
export async function drafting(id) {
  const t = T.typingIn(id);
  if (t.ago < QUIET) return true;
  const rows = await T.screen(id, true);
  if (livePrompt(rows)) return true;
  return t.since && !!inputDraft(rows);
}

// Types the line now if the owner is not writing there, else holds it. Resolves 'sent' or 'held'.
// onSent(at) is called once the line has gone in with its Enter, at the time it started.
export async function typeLine(deck, id, line, onSent) {
  const q = queues.get(id) || [];
  queues.set(id, [...q, { line, onSent }]);
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
    for (const [i, part] of chunksOf(next.line).entries()) {
      if (i) await pause(CHUNK_GAP);
      deck.write(id, part);
    }
    await pause(next.line.length > 200 ? 300 : 60);
    deck.write(id, '\r');
  } finally { typing.delete(id); }
  if (next.onSent) next.onSent(at);
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
export function deliver(deck, id, line, fail) {
  const check = (at, round) => setTimeout(async () => {
    if (await deck.ctoArrived(id, line.slice(0, 160), at)) return;
    if (round + 1 < CHECK_AFTER.length) check(at, round + 1);
    else fail(() => deliver(deck, id, line, fail));
  }, CHECK_AFTER[round] - (round ? CHECK_AFTER[round - 1] : 0));
  return typeLine(deck, id, line, at => check(at, 0));
}
