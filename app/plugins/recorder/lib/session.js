// The recorder's session (#369): one recording from start to the end of its review, as a pure
// state machine. The main side owns it, applies events with next() and saves the result to
// session.json after each one, so a restart resumes where it was.
//
// recording -> processing (one step at a time) -> review <-> sending -> done
// failed (a step's error) -> processing again on retry; discarded from recording, review, failed.
// In review the cards are edited, dropped and sent; sending places them on the boards one at a
// time (placed), then returns to review while cards are open, else ends in done.

import { undoCard, undoAll } from './brainstorm.js';

export const STEPS = ['audio', 'transcript', 'items', 'screenshots'];
const OPEN = ['recording', 'processing', 'review', 'sending', 'failed'];
// What the owner may change on a card in the review.
const EDITABLE = ['title', 'description', 'project', 'kind', 'due', 'mergeInto'];

export function newSession(id, at) {
  return { id, state: 'recording', startedAt: at, stoppedAt: null, step: null, done: [], error: null, cards: [], sending: null };
}

// One card changed by fn; the same session when there is no such card.
function onCard(s, id, fn) {
  const i = (s.cards || []).findIndex(c => c.id === id);
  if (i < 0) return s;
  const c = fn(s.cards[i]);
  if (c === s.cards[i]) return s;
  const cards = [...s.cards];
  cards[i] = c;
  return { ...s, cards };
}

function edit(c, patch) {
  const p = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => EDITABLE.includes(k)));
  if (!Object.keys(p).length) return c;
  const out = { ...c, ...p };
  if (out.kind === 'reminder') out.project = 'Me';
  if (out.project !== c.project && !('mergeInto' in p)) { out.mergeInto = null; out.mergeTitle = ''; }
  if (out.mergeInto == null) out.mergeTitle = '';
  return out;
}

// After a send for the CTO nothing waits for a CTO line any more.
const told = s => (s.sending && s.sending.cto ? { ctoPending: [] } : {});

// The session after an event; the same object when the event does not fit its state.
export function next(s, ev) {
  if (!s || !ev) return s;
  const to = patch => ({ ...s, ...patch });
  switch (`${s.state}:${ev.type}`) {
    case 'recording:stop':
    case 'recording:resume': // FocusShell closed mid-recording: what was saved is processed
      return to({ state: 'processing', stoppedAt: ev.at ?? null, step: STEPS[0], done: [], error: null });
    case 'processing:stepDone': {
      if (ev.step !== s.step) return s;
      const done = [...s.done, s.step], i = STEPS.indexOf(s.step) + 1;
      const cards = Array.isArray(ev.cards) ? { cards: ev.cards } : {};
      return i < STEPS.length ? to({ step: STEPS[i], done, ...cards }) : to({ state: 'review', step: null, done, ...cards });
    }
    case 'processing:stepFailed':
      return ev.step === s.step ? to({ state: 'failed', error: String(ev.error || 'failed') }) : s;
    case 'failed:retry':
      return to({ state: 'processing', error: null });
    case 'review:done':
      return to({ state: 'done', brainstorm: null });
    case 'recording:discard':
    case 'review:discard':
    case 'failed:discard':
      return to({ state: 'discarded', brainstorm: null });
    // Stage 4: a brainstorm session beside the review; its proposal changes the open cards
    // (lib/brainstorm.js works them out), each with Undo.
    case 'review:brainstorm':
      return s.brainstorm || !['cto', 'pm'].includes(ev.who) ? s : to({ brainstorm: { who: ev.who } });
    case 'review:brainstormEnd':
      return s.brainstorm ? to({ brainstorm: null }) : s;
    // rev counts the brainstorm's changes, so the screen redraws the cards' text for them.
    case 'review:proposal':
      return Array.isArray(ev.cards) ? to({ cards: ev.cards, error: null, rev: (s.rev || 0) + 1 }) : s;
    case 'review:proposalFailed':
      return to({ error: String(ev.error || 'failed') });
    case 'review:undo':
      return to({ cards: undoCard(s.cards, ev.id), rev: (s.rev || 0) + 1 });
    case 'review:undoAll':
      return to({ cards: undoAll(s.cards), rev: (s.rev || 0) + 1 });
    case 'review:edit':
      return onCard(s, ev.id, c => (c.status === 'open' ? edit(c, ev.patch) : c));
    case 'review:dropShot':
      return onCard(s, ev.id, c => (c.shots.includes(ev.path) ? { ...c, shots: c.shots.filter(p => p !== ev.path) } : c));
    case 'review:drop':
      return onCard(s, ev.id, c => (c.status === 'open' ? { ...c, status: 'dropped' } : c));
    case 'review:restore':
      return onCard(s, ev.id, c => (c.status === 'dropped' ? { ...c, status: 'open' } : c));
    case 'review:send': {
      const ids = (ev.ids || []).filter(id => s.cards.some(c => c.id === id && c.status === 'open'));
      return ids.length ? to({ state: 'sending', sending: { ids, cto: ev.cto === true }, error: null }) : s;
    }
    case 'sending:placed':
      return onCard(s, ev.id, c => ({ ...c, status: 'accepted', placed: { board: ev.board, n: ev.n ?? null } }));
    // A send for the CTO answers with the CTO line for what it placed, also when it fails, and
    // that line takes in ctoPending: cards a restart cut off from their CTO line.
    case 'sending:sent':
      return to({ state: s.cards.some(c => c.status === 'open') ? 'review' : 'done', sending: null, ...told(s) });
    case 'sending:sendFailed':
      return to({ state: 'review', sending: null, error: String(ev.error || 'failed'), ...told(s) });
    case 'sending:resume': { // a restart mid-send: what was placed is marked, the rest waits
      const cut = s.sending.cto ? s.cards.filter(c => s.sending.ids.includes(c.id) && c.status === 'accepted').map(c => c.id) : [];
      return to({ state: 'review', sending: null, ctoPending: [...new Set([...(s.ctoPending || []), ...cut])] });
    }
    default:
      return s;
  }
}

const mss = secs => `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;

// The title bar button for a session: idle, active with the time so far, busy, or attention
// with the number of cards still waiting.
export function buttonFor(s, now) {
  if (!s || !OPEN.includes(s.state)) return { state: 'idle', label: '' };
  if (s.state === 'recording') return { state: 'active', label: mss(Math.max(0, (now - s.startedAt) / 1000)) };
  if (s.state === 'processing' || s.state === 'sending') return { state: 'busy', label: '' };
  if (s.state === 'failed') return { state: 'attention', label: '!' };
  const open = (s.cards || []).filter(c => c.status === 'open').length;
  return { state: 'attention', label: open ? String(open) : '' };
}

// The session to carry on with: the newest one not yet done or discarded.
export function pickCurrent(sessions) {
  const open = (sessions || []).filter(s => s && OPEN.includes(s.state));
  return open.sort((a, b) => b.startedAt - a.startedAt)[0] || null;
}
