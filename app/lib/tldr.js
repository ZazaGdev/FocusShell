// The first line of a Waiting on you or Maybe missed card (#1000): what the question is about,
// in a few words. A card naming a task: "<Project> #<n> <task title>: <the ask, short>"; one
// naming none: its question cut to about a dozen words. No Node imports.

const plain = s => String(s || '').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
// The ask without its lead-in ("Needs you:", "NEEDS YOU #3 |", a task tag) and without the
// reasons after it: the first question, else the first sentence.
export function askOf(text) {
  let s = plain(text).replace(/^needs you\b[^:|]{0,30}[:|]\s*/i, '').replace(/^[A-Z][\w-]* #\d+\s*[:,-]?\s*/, '').replace(/^#\d+\s*[:,-]?\s*/, '');
  const q = s.indexOf('?');
  if (q > 0) s = s.slice(0, q + 1);
  else { const dot = s.search(/[.!](\s|$)/); if (dot > 0) s = s.slice(0, dot); }
  return s.trim();
}
export function cut(s, words) {
  const w = plain(s).split(' ').filter(Boolean);
  return w.length <= words ? w.join(' ') : w.slice(0, words).join(' ').replace(/[,;:]$/, '') + '...';
}
// A card's short summary (#1033): whole sentences, about three or four lines (max characters),
// never cut mid-sentence or with "..." (#1038). A first sentence longer than max stays whole.
export function gist(text, max = 260) {
  // A sentence ends at . ! or ? before a space, so a dot inside a link or a version stays.
  const sentences = plain(text).split(/(?<=[.!?])\s+/);
  let out = '';
  for (const s of sentences.map(x => x.trim()).filter(Boolean)) {
    if (out && (out + ' ' + s).length > max) break;
    out = out ? `${out} ${s}` : s;
  }
  return out;
}

// Never cut with "..." (#1038): the line wraps instead.
export function tldr({ project, n, title, ask }) {
  const a = askOf(ask || '');
  if (project && n && title) {
    const head = `${project} #${n} ${plain(title)}`;
    // A question with only options has no ask of its own: the task names it.
    return !a || plain(a).toLowerCase() === plain(title).toLowerCase() ? head : `${head}: ${a}`;
  }
  return plain(a || ask || title || '');
}
