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
