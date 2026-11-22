// The owner's words after the click on their card (#2991): they go into the lead's pane only
// while it is clear (no permission prompt or question live there, the owner not writing or
// talking there), the box must hold them alone before the Enter, and they count as delivered
// only once the lead's own Claude Code log shows them. Every other end tells the owner and the
// CTO why. The words themselves stay in the main process: the page sends ids only (#228), and
// uses the card's copy only to read the box.
import * as T from './terminal.js';
import { toast } from './dom.js';
import { drafting, boxNow, CHECK_AFTER } from './cto-line.js';
import { inputDraft, livePrompt } from '../lib/prompts.js';
import { leftLine } from '../lib/ctoline.js';
import { boxStep, boxFailure, paneClear } from '../lib/ownerwords.js';

const pause = ms => new Promise(r => setTimeout(r, ms));
const runs = new Map();   // request id -> { say, phase, cancelled }
const cards = new Map();  // request id -> its cards drawn (Home and the whiteboard each draw one)
const chains = new Map(); // lead session -> the run in front, so one request types at a time
let checks = CHECK_AFTER, noBox = false;
// The smoke run looks for the words in the log sooner than a real lead needs, and its fake
// lead is a plain shell with no Claude Code input box, which then counts as clear.
export const checkTimesForSmoke = list => { checks = list; };
export const allowNoBoxForSmoke = yes => { noBox = !!yes; };

// What the card shows about a request after its click, and whether it can still be declined.
export const wordsState = id => runs.get(id) || null;
// The short status on a clicked card's button row (#3015), by phase.
export const queueLabel = (phase, lead) => phase === 'typing' ? `Typing into ${lead}`
  : phase === 'sent' ? `Sent, checking ${lead} got it` : `Queued, goes when ${lead} is free`;
// Cards no longer on screen are dropped at the next state change (say), never while one is
// being drawn and not yet placed.
export const cardFor = (id, el) => { cards.set(id, (cards.get(id) || new Set()).add(el)); };
function say(id, phase, text) {
  const run = runs.get(id);
  if (!run) return;
  Object.assign(run, { phase, say: text });
  const set = cards.get(id);
  if (!set) return;
  for (const el of [...set]) {
    if (!el.isConnected) { set.delete(el); continue; }
    const line = el.querySelector('.pstate');
    if (line) line.textContent = text;
    const queue = el.querySelector('.pqueue');
    if (queue) queue.textContent = queueLabel(phase, el.dataset.lead || '');
    el.classList.toggle('queued', phase === 'held');
    el.querySelectorAll('[data-decline]').forEach(b => { b.disabled = phase !== 'held'; });
  }
}
// Decline or the X on a held request: marked before the Decline goes, so a run that reaches
// words:type just after it ends quietly; unmarked again if the main process answers that the
// words are already being typed.
export function cancelWords(id, yes = true) { const run = runs.get(id); if (run) run.cancelled = yes; }

// Starts a request the main process now holds (words:approve gave its lead's session).
// tell(project, line) tells the CTO.
export function startWords(deck, r, session, tell) {
  if (runs.has(r.id)) return;
  runs.set(r.id, { phase: 'held', say: '', cancelled: false });
  const ahead = chains.get(session);
  if (ahead) say(r.id, 'held', `Waiting: your other words go into ${r.lead} first`);
  const run = (ahead || Promise.resolve()).then(() => typeWords(deck, r, session, tell)).catch(e => {
    finish(deck, r, tell, { outcome: `not delivered: ${String(e && e.message || e).replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 120)}` }, true);
  });
  chains.set(session, run);
  run.finally(() => { if (chains.get(session) === run) chains.delete(session); });
}

async function typeWords(deck, r, session, tell) {
  const run = runs.get(r.id);
  let at = 0;
  for (;;) {
    // Held while the lead's pane shows a prompt or the owner writes there. No time limit while
    // the app runs; the request's own 24 hours still apply in the main process.
    while (!run.cancelled && await drafting(session)) {
      say(r.id, 'held', `Waiting: ${r.lead} is on a prompt or you are writing there; the words go once it is clear`);
      await pause(1000);
    }
    if (run.cancelled) return end(r.id);
    // Only an empty Claude Code input box with no prompt live takes the words: a pane with no
    // box (a dialog, a prompt shape not known, Claude exited to the shell) holds them too. A
    // pane closed or ended goes on, so the main process answers that no pane is open.
    const rows = await T.screen(session, true), paneGone = !rows.length || T.isExited(session);
    if (!paneGone && !paneClear(inputDraft(rows), livePrompt(rows), noBox)) {
      say(r.id, 'held', `Waiting: no input box in ${r.lead}; the words go once it shows an empty one`);
      await pause(1000);
      continue;
    }
    say(r.id, 'typing', `Typing into ${r.lead}`);
    at = Date.now();
    const typed = await deck.wordsType(r.id);
    if (!typed || !typed.ok) return finish(deck, r, tell, typed);
    await pause(r.words.length > 200 ? 300 : 60);
    // The box was there before (hadBox), so a box missing now gives 'left', never an Enter.
    const box = await boxNow(session, r.words, at, !noBox);
    const step = boxStep(box, box === 'left' ? leftLine(inputDraft(await T.screen(session, true)), r.words) : null);
    if (step === 'enter') {
      const sent = await deck.wordsEnter(r.id);
      if (!sent || !sent.ok) return finish(deck, r, tell, sent);
      break;
    }
    if (step === 'again') {
      // The owner's own words sat before them: they come back out and wait again.
      const out = await deck.wordsErase(r.id);
      if (!out || !out.ok) return finish(deck, r, tell, out);
      continue;
    }
    if (step === 'out') {
      const out = await deck.wordsErase(r.id);
      if (!out || !out.ok) return finish(deck, r, tell, out);
    }
    return done(deck, r, tell, boxFailure(step, r.lead));
  }
  // Delivered only once the lead's own log shows them.
  say(r.id, 'sent', `Sent into ${r.lead}; checking that it got them`);
  let found = false;
  for (const [i, ms] of checks.entries()) {
    await pause(ms - (i ? checks[i - 1] : 0));
    found = await deck.ctoArrived(session, r.words.slice(0, 160), at);
    if (found) return done(deck, r, tell, 'typed');
  }
  return done(deck, r, tell, found === null ? `not delivered: ${r.lead}'s conversation log was not found`
    : `not delivered: the words did not reach ${r.lead}'s conversation`);
}

const end = id => { runs.delete(id); cards.delete(id); };
async function done(deck, r, tell, outcome) {
  const res = await deck.wordsDone(r.id, outcome);
  return finish(deck, r, tell, res && res.outcome === 'refused' ? { outcome: 'refused', why: outcome } : res);
}
// Every end is said: to the CTO with the main process's WORDS line, to the owner in a toast.
async function finish(deck, r, tell, res, crashed = false) {
  const run = runs.get(r.id);
  end(r.id);
  if (crashed) res = await deck.wordsDone(r.id, res.outcome) || res;
  if (!res || res.outcome === 'gone') {
    await pause(200); // a Decline answered just before is told by the card itself
    if (run && run.cancelled) return;
    toast(`${r.lead}'s words were no longer waiting (expired or declined), so nothing more was typed.`, true);
    return;
  }
  if (res.outcome === 'refused') { toast(`Your words to ${r.lead} could not be ended as "${res.why}"; the request stays until it expires.`, true); return; }
  if (res.cto) tell(r.project, res.cto);
  if (res.outcome !== 'typed') toast(`Not delivered to ${r.lead}: ${String(res.outcome).replace(/^not delivered: /, '')}`, true);
}
