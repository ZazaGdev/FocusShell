// The recorder's sending rules (#369): accepted cards into board writes, and the one line the
// main CTO gets for "Accept and send to CTO". A screenshot rides on an item as a
// "Screenshot: <full path>" detail line, the way a Sketch line attaches a board.
import { clock } from './transcript.js';

const lines = text => String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const shotLines = c => (c.shots || []).map(p => `Screenshot: ${p}`);
const end = s => (/[.!?:]$/.test(s) ? s : `${s}.`);

// One write per card: { id, op: 'add', board, title, details, due } for a new item,
// { id, op: 'detail', board, n, details } for a card merged into an open item, and
// { id, op: 'note', board, text } for a note (notes are one line, so it carries the paths).
export function writesFor(cards, { transcript }) {
  return (cards || []).map(c => {
    const from = `Transcript: ${transcript} at ${clock(c.at || 0)}`, said = c.quote ? [`Said: "${c.quote}"`] : [];
    if (c.kind === 'note') {
      const text = [end(c.title), ...lines(c.description).map(end), ...shotLines(c), from].join(' ');
      return { id: c.id, op: 'note', board: c.project, text };
    }
    if (c.mergeInto != null && c.project !== 'Me') {
      return { id: c.id, op: 'detail', board: c.project, n: c.mergeInto, details: [`From a recording: ${c.title}`, ...lines(c.description), ...said, ...shotLines(c), from] };
    }
    return { id: c.id, op: 'add', board: c.kind === 'reminder' ? 'Me' : c.project, title: c.title, due: c.kind === 'reminder' ? c.due || '' : '',
      details: [...lines(c.description), ...said, ...shotLines(c), from] };
  });
}

// Talk to agent (#1482): the line that hands one recording to the main CTO to discuss, with no
// work attached. r: { title, transcript (path or null), video, cards: [{ title, placed }] }.
export function talkLine(r) {
  const cards = (r.cards || []).map(c => (c.placed && c.placed.n != null ? `${c.placed.board} #${c.placed.n}: ${c.title}` : c.title));
  return [`RECORDING TALK: ${r.title}`, r.transcript ? `transcript: ${r.transcript}` : 'no transcript', `video: ${r.video}`,
    cards.length ? `cards: ${cards.join('; ')}` : 'no cards'].join(' | ');
}

// The line for the main CTO, or null when every placed card is the owner's own (Me).
// placed: cards with placed { board, n }.
export function ctoLine(placed, { transcript }) {
  const parts = (placed || []).filter(c => c.placed && c.placed.board !== 'Me').map(c => {
    if (c.kind === 'note') return `note on ${c.placed.board}: ${c.title}`;
    const shots = (c.shots || []).length ? ` (screenshots: ${c.shots.join(', ')})` : '';
    return `${c.placed.board} #${c.placed.n}: ${c.title}${shots}`;
  });
  return parts.length ? `RECORDING: ${transcript} | ${parts.join(' | ')}` : null;
}

// Why a send for the CTO sent nothing (#2185): every card it placed went on Me.
export function noCtoReason(placed) {
  const n = (placed || []).length;
  return `Nothing sent to the CTO: ${n === 1 ? 'the card' : `all ${n} cards`} went on Me, and Me items never go to the CTO. Set a card's project before accepting it to send it.`;
}
