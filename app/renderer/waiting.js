// Leads waiting on the owner: a lead stopped on a prompt in its own pane (#119, #152, #191)
// and requests for the owner's words (#228), shown as cards and told to the lead's CTO.
import * as T from './terminal.js';
import { h, toast } from './dom.js';
import { managerFor, isMgr, PM } from '../lib/groups.js';
import { projectOf, sessionName } from '../lib/sessions.js';
import { alertStep, livePrompt, samePrompt, askedOwner } from '../lib/prompts.js';
import { promptCard, wordsCard } from './prompt-card.js';
import { typeLine } from './cto-line.js';

// c: { deck, started, groups(), hasProjects(), mgrName, openTab, updateLive, showPrompts, outputAt(id) -> ms of its last output }
export function waitingWatch(c) {
  const { deck, started, mgrName, openTab, updateLive, showPrompts } = c;
  const waitingOn = new Map();  // lead session id -> the prompt it stopped on (#119)
  // A lead stopped on a prompt in its own pane (#119): its dot and label say so at once. Its
  // CTO is told in one line, since the lead cannot report while the prompt is open, but only
  // once per prompt and only when the owner has left it for five minutes (#146).
  const promptAlerts = new Map(); // lead session id -> alertStep state
  function checkPromptAlerts(now = Date.now()) {
    let sent = 0;
    for (const id of new Set([...waitingOn.keys(), ...promptAlerts.keys()])) {
      const what = waitingOn.get(id) || null, { state, alert } = alertStep(promptAlerts.get(id) || null, what, now);
      if (state) promptAlerts.set(id, state); else promptAlerts.delete(id);
      if (!alert) continue;
      const project = projectOf(id), lead = sessionName(id);
      const m = managerFor(c.groups(), project);
      if (!started.has(m) || T.isExited(m)) continue;
      // It waits while the owner is writing in the CTO's prompt (#243).
      typeLine(deck, m, `WAITING ${lead} | stopped on a prompt in its own pane: ${what} | the owner answers it on Home's For you, the whiteboard, or that pane`); sent++;
    }
    return sent;
  }
  // What the lead's output suggests it waits on (#191). It counts only while the prompt is
  // live on the lead's screen, read again every few seconds: an answered prompt's text left
  // in the output raises nothing. The screen also gives the card its options (#152).
  const promptSeen = new Map(); // lead session id -> what its output suggests
  const notified = new Map();   // lead session id -> the prompt Windows was told about
  function confirmPrompt(id) {
    const what = promptSeen.get(id);
    return T.screen(id).then(rows => {
      if (promptSeen.get(id) !== what) return;
      const p = livePrompt(rows), was = waitingOn.get(id), redraw = !samePrompt(promptOn.get(id) || null, p) && (!!p || promptOn.has(id));
      if (p) { waitingOn.set(id, what); promptOn.set(id, p); } else { waitingOn.delete(id); promptOn.delete(id); }
      if (p && notified.get(id) !== what) { notified.set(id, what); deck.notifyWaiting(id, what); }
      if (!p) notified.delete(id);
      if ((was || null) !== (p ? what : null)) { updateLive(); checkPromptAlerts(); showPrompts(); }
      else if (redraw) showPrompts(); // same wording, another prompt (#388): the card shows the new one
    });
  }
  // A lead whose last report on its own screen is NEEDS YOU (#1756): it waits on the owner's
  // answer. Read every few seconds; the caller counts it only while the pane is quiet.
  const askedOn = new Map(); // lead session id -> its question
  const readAt = new Map();  // lead session id -> its last output when its screen was read
  function readAsked() {
    for (const id of started) {
      if (isMgr(id) || id === PM || T.isExited(id)) { askedOn.delete(id); continue; }
      const at = c.outputAt(id);
      if (readAt.get(id) === at) continue; // nothing printed since: the same answer
      readAt.set(id, at);
      T.screen(id).then(rows => { const q = askedOwner(rows || []); if (q) askedOn.set(id, q); else askedOn.delete(id); }, () => {});
    }
    for (const id of [...askedOn.keys(), ...readAt.keys()]) if (!started.has(id)) { askedOn.delete(id); readAt.delete(id); }
  }
  setInterval(() => { checkPromptAlerts(); readAsked(); for (const id of promptSeen.keys()) confirmPrompt(id); }, 5000);
  deck.onWaiting(({ id, what }) => {
    if (what) { promptSeen.set(id, what); confirmPrompt(id); return; }
    promptSeen.delete(id); notified.delete(id); hidden.delete(id);
    if (waitingOn.delete(id)) { promptOn.delete(id); updateLive(); checkPromptAlerts(); showPrompts(); }
  });
  // The leads stopped on a prompt, as cards on Home's For you and each CTO's whiteboard (#152).
  const promptOn = new Map(); // lead session id -> the prompt read off its screen, or null
  function waitingLeads(mgr) {
    return [...[...waitingOn].map(([id, what]) => {
      return { id, project: projectOf(id), lead: sessionName(id), what, prompt: promptOn.get(id) || null };
    }), ...wordReqs.map(r => ({ id: `words:${r.id}`, project: r.project, lead: r.lead, words: r }))]
      .filter(w => !isHidden(w) && (!mgr || managerFor(c.groups(), w.project) === mgr));
  }
  // A prompt card removed with its X (#1278) stays off Waiting while the lead is stopped on that
  // same prompt; the next prompt shows again. Nothing is typed into the lead's pane.
  const hidden = new Map(); // lead session id -> { what, prompt } hidden
  const isHidden = w => {
    const x = !w.words && hidden.get(w.id);
    if (!x) return false;
    if (x.what === w.what && (x.prompt ? samePrompt(x.prompt, w.prompt) : !w.prompt)) return true;
    hidden.delete(w.id);
    return false;
  };
  function hide(w) {
    hidden.set(w.id, { what: w.what, prompt: w.prompt });
    showPrompts();
    toast(`Removed ${w.lead}'s prompt from Waiting. It stays stopped until you answer it in its pane.`, false,
      { label: 'Undo', ms: 6000, run: () => { hidden.delete(w.id); showPrompts(); } });
  }
  // Requests for the owner's words (#228), as cards beside the prompt cards.
  let wordReqs = [];
  deck.onWords(list => { wordReqs = list || []; if (c.hasProjects()) showPrompts(); });
  // After the owner's click, the project's CTO is told what happened, as a card's ANSWER is.
  function tellCto(project, line) {
    const m = managerFor(c.groups(), project);
    if (!started.has(m) || T.isExited(m)) { toast(`Done. The ${mgrName(m)} is not running, so it was not told.`, true); return; }
    typeLine(deck, m, line).then(r => toast(line.replace(/^WORDS /, '') + (r === 'held' ? ' (sent when your prompt is empty)' : '')));
  }
  const leadCard = w => (w.words ? wordsCard(h, w.words, deck, openTab, tellCto) : promptCard(h, w, deck, openTab, hide));
  return { waitingOn, askedOn, waitingLeads, leadCard, checkPromptAlerts, setWords: list => { wordReqs = list || []; } };
}
