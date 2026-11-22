// A pane at its ask point (#3016) is asked to stop at a safe point, and once it has (its READY TO
// REOPEN line in a finished turn) and nothing is going there, it is reopened fresh. A CTO whose
// conversation began before today's 05:00 is asked the same way with a NEW DAY line, once it has
// been idle a while (#3073). The rules are
// lib/context.js step(); this file reads the panes, types the lines and reopens.
import * as T from './terminal.js';
import { toast } from './dom.js';
import { managerFor, isMgr } from '../lib/groups.js';
import { projectOf, sessionName } from '../lib/sessions.js';
import { sessionOfLead } from '../lib/ownerwords.js';
import { livePrompt, backgroundWork, inputDraft } from '../lib/prompts.js';
import { voiceLive } from '../lib/ctoline.js';
import { step, askSent, readyPart, newDay, QUIET_MS } from '../lib/context.js';
import { typeLine, holdPane, releasePane, typingInto } from './cto-line.js';

const EVERY = 15000, BOX_WAIT = 180000;
const LIVE = true;
const pause = ms => new Promise(r => setTimeout(r, ms));
// The smoke run (#3016): manual (it calls checkNow itself), noBox (its plain shells have no input
// box, which counts as empty there), settle (ms to wait after a reopen before the box is read)
// and dayIdle (ms a CTO due for the new day must be idle before it is asked, #3073; null: the
// usual five minutes).
const smokeOpts = { manual: false, noBox: false, settle: 0, dayIdle: null };
export const contextForSmoke = o => Object.assign(smokeOpts, o);
// The smoke run starts a check on a pane not asked yet: an ask that went in outlives a drop below
// the ask point, so the watch's state for that pane is dropped instead.
let forgetPane = () => {};
export const forgetForSmoke = id => forgetPane(id);

// c: { deck, started, groups(), mgrName, waitingOn, backOn, wordReqs(), outputAt(id) -> ms of its
// last output, reopen(id) -> Promise<bool> }
export function contextWatch(c) {
  const { deck, started } = c;
  const kept = new Map(); // pane id -> its step state (lib/context.js step)
  forgetPane = id => kept.delete(id);
  const nameOf = id => (isMgr(id) ? c.mgrName(id) : sessionName(id));
  const draftOf = rows => { const d = inputDraft(rows); return d === null && smokeOpts.noBox ? '' : d; };

  async function paneNow(id) {
    const lead = !isMgr(id), rows = await T.screen(id), bright = await T.screen(id, true);
    return {
      cto: !lead,
      ...(typeof smokeOpts.dayIdle === 'number' ? { dayIdleMs: smokeOpts.dayIdle } : {}),
      exited: T.isExited(id),
      prompt: (lead && c.waitingOn.has(id)) || !!livePrompt(bright),
      words: lead && c.wordReqs().some(r => sessionOfLead(r.project, r.lead) === id),
      back: (lead && c.backOn.has(id)) || !!backgroundWork(rows),
      quietMs: Date.now() - (c.outputAt(id) || 0),
      draft: draftOf(bright),
      ownerMs: voiceLive(bright) ? 0 : T.typingIn(id).ago, // dictation shows no words in the box until it stops
    };
  }

  // Whether the pane is as the step saw it, just before it is closed: the same finished turn with
  // its READY line, and no output since. A message that reached it meanwhile changes one of these.
  async function stillReady(id, u) {
    const st = kept.get(id);
    if (!st || !st.askedAt || Date.now() - (c.outputAt(id) || 0) < QUIET_MS) return false;
    try {
      const now = ((await deck.contextUse({ [id]: st.askedAt })) || {})[id];
      return !!now && !!now.ready && now.endedAt === u.endedAt;
    } catch { return false; }
  }

  function ask(id, u, why) {
    const line = why === 'day'
      ? 'NEW DAY: a new day started, so FocusShell reopens this CTO fresh. Stop at a safe point as your rules say under "Context full", and end your reply with the READY TO REOPEN line.'
      : `CONTEXT FULL: this pane is at ${Math.floor(u.percent)}% of its context window. Stop at a safe point as your rules say under "Context full", and end your reply with the READY TO REOPEN line. FocusShell then reopens this pane fresh.`;
    // A line left in the box without its Enter counts as asked too: the next ask waits on that box.
    const went = at => { const st = kept.get(id); if (st && st.sending) kept.set(id, askSent(st, at)); };
    typeLine(deck, id, line, went, () => went(Date.now())).catch(() => { const st = kept.get(id); if (st) kept.set(id, { ...st, sending: false }); });
  }

  // The fresh pane's empty input box, BOX_WAIT at most.
  async function boxReady(id) {
    if (smokeOpts.settle) await pause(smokeOpts.settle);
    for (const end = Date.now() + BOX_WAIT; Date.now() < end; await pause(2000)) if (draftOf(await T.screen(id, true)) === '') return;
  }

  async function reopen(id, u) {
    const n = Math.floor(u.percent), name = nameOf(id), part = readyPart(u.ready) || 'none', cto = isMgr(id);
    const day = (kept.get(id) || {}).why === 'day'; // a NEW DAY ask, a CTO's only (#3073)
    let reopened = false, again = false;
    try {
      if (cto) {
        holdPane(id);
        for (let i = 0; i < 50 && typingInto(id); i++) await pause(100);
        // A line still going in after five seconds: no reopen now, the next round tries again.
        if (typingInto(id)) { again = true; return; }
      }
      if (!(await stillReady(id, u))) { again = true; return; }
      if (!(await c.reopen(id))) return;
      reopened = true;
      T.write(id, day ? '\r\n[FocusShell] Reopened fresh for the new day; the last session stopped at a safe point.\r\n'
        : `\r\n[FocusShell] Reopened fresh: the last session reached ${n}% of its context and stopped at a safe point.\r\n`);
      const done = day ? `${name} was reopened fresh for the new day.` : `${name} reached ${n}% of its context, stopped at a safe point and was reopened fresh.`;
      if (cto) {
        toast(done);
        await boxReady(id);
        // At the front of its queue, then the lines that waited meanwhile follow in order.
        const why = day ? 'a new day started and FocusShell reopened you fresh' : `your last session reached ${n}% of its context and FocusShell reopened you fresh`;
        typeLine(deck, id, `REOPENED ${id} | ${why} | it said: ${part}`, null, null, { first: true });
        return; // the finally releases the hold, after REOPENED took the front of the queue
      }
      const m = managerFor(c.groups(), projectOf(id));
      if (!started.has(m) || T.isExited(m)) { toast(`${done} The ${c.mgrName(m)} is not running, so it was not told.`, true); return; }
      toast(done);
      await boxReady(id);
      typeLine(deck, m, `REOPENED ${sessionName(id)} | it reached ${n}% of its context, stopped at a safe point and was reopened fresh | resend: ${part}`);
    } finally {
      if (cto) releasePane(id);
      // A reopened pane is not asked again until it has read below its ask point once, so a
      // reading of its old conversation never asks and reopens it a second time. One not reopened
      // yet keeps its ask.
      const st = kept.get(id);
      if (reopened) kept.set(id, { fresh: true });
      else if (again && st) kept.set(id, { ...st, reopening: false });
      else kept.delete(id);
    }
  }

  let running = false;
  async function checkNow() {
    if (running) return;
    running = true;
    try {
      const asks = {};
      for (const [id, st] of kept) if (st.askedAt) asks[id] = st.askedAt;
      const use = (await deck.contextUse(asks)) || {};
      for (const id of [...kept.keys()]) if (!started.has(id)) kept.delete(id);
      for (const [id, u] of Object.entries(use)) {
        if (!started.has(id)) continue;
        // Nothing to do, no screen to read: below the ask point, not asked, and not a CTO due for the day.
        if (!kept.has(id) && !(u.percent >= u.askAt) && !(isMgr(id) && newDay(u.since, Date.now()))) continue;
        // The pane first, then its state: an ask that went or a reopen that ended while the screens
        // were read has changed it, and the step must start from that.
        const pane = await paneNow(id);
        const { st, act } = step(kept.get(id) || null, u, pane, Date.now());
        if (st) kept.set(id, st); else kept.delete(id);
        if (act === 'ask') ask(id, u, st.why);
        else if (act === 'reopen') reopen(id, u);
        else if (act === 'giveup') {
          toast(st.why === 'day' ? `${nameOf(id)} was asked to stop for the new day and has not stopped at a safe point; it carries on as it is.`
            : `${nameOf(id)} is at ${Math.floor(u.percent)}% of its context and has not stopped at a safe point. Reopen it yourself once its work is safe.`, true);
        }
      }
    } catch { /* the next round tries again */ } finally { running = false; }
  }
  setInterval(() => { if (LIVE && !smokeOpts.manual) checkNow(); }, EVERY);
  return { checkNow };
}
