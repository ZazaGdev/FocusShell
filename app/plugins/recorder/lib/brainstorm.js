// The recorder's brainstorm (#369, stage 4): a separate CTO or PM session talks the cards over
// with the owner and writes a proposal, which changes the open cards. Pure rules: the prompt,
// reading the proposal, applying it with a mark on each card and what Undo restores.

const ACTIONS = ['unchanged', 'rewrite', 'merge', 'drop', 'add'];
const KINDS = ['task', 'note', 'reminder'];
const DUE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
// What a card had before the first brainstorm changed it.
const KEPT = ['kind', 'project', 'title', 'description', 'quote', 'shotAt', 'shots', 'due', 'mergeInto', 'mergeTitle', 'status'];

const line = s => String(s ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s*[–—]\s*/g, ', ').replace(/\s+/g, ' ').trim();
const text = d => (Array.isArray(d) ? d : String(d ?? '').split(/\r?\n/)).map(line).filter(Boolean).join('\n');
const snap = c => Object.fromEntries(KEPT.map(k => [k, Array.isArray(c[k]) ? [...c[k]] : c[k]]));

// The proposal in the agent's reply or file: { "cards": [...] } or a bare list. Throws when there
// is none; entries with no known action are left out.
export function readProposal(raw) {
  const s = String(raw ?? '');
  let j = null;
  for (const [a, b] of [[s.indexOf('{'), s.lastIndexOf('}')], [s.indexOf('['), s.lastIndexOf(']')]]) {
    if (a < 0 || b <= a) continue;
    try { j = JSON.parse(s.slice(a, b + 1)); break; } catch { j = null; }
  }
  const list = Array.isArray(j) ? j : j && Array.isArray(j.cards) ? j.cards : null;
  if (!list) throw new Error('The brainstorm proposal was not the JSON asked for');
  return list.filter(e => e && typeof e === 'object' && ACTIONS.includes(e.action));
}

// The fields an entry may set on a card, checked: a reminder is a Me item, a project must exist.
function fields(e, projects) {
  const out = {};
  if (line(e.title)) out.title = line(e.title).replace(/[.\s]+$/, '').slice(0, 120);
  if (e.description != null && text(e.description)) out.description = text(e.description);
  if (KINDS.includes(e.kind)) out.kind = e.kind;
  if (e.project && (projects || []).includes(e.project)) out.project = e.project;
  if (DUE.test(String(e.due))) out.due = String(e.due);
  return out;
}
// A reminder is a Me item and merges into nothing; anything else has no due time.
const settle = c => (c.kind === 'reminder' ? { ...c, project: 'Me', mergeInto: null, mergeTitle: '' } : { ...c, due: '' });

// The cards after a proposal. Only open cards change; each keeps what it had before the first
// brainstorm in `before`. o: { open: { project: [{ n, title }] }, projects: [names] }
export function applyProposal(cards, entries, o = {}) {
  let out = (cards || []).map(c => ({ ...c }));
  const isOpen = c => c && c.status === 'open' && c.mark !== 'dropped' && c.mark !== 'merged';
  const find = id => out.find(c => c.id === id);
  const touch = (c, mark, patch) => Object.assign(c, { before: c.before || (c.mark === 'added' ? null : snap(c)) }, patch, { mark: c.mark === 'added' ? 'added' : mark });
  const done = new Set();
  for (const e of entries || []) {
    if (e.action === 'add') {
      const f = fields(e, o.projects);
      if (!f.title) continue;
      const n = Math.max(0, ...out.map(c => Number(String(c.id).replace(/\D/g, '')) || 0)) + 1;
      out.push(settle({ id: `c${n}`, kind: 'task', project: 'Me', description: '', quote: line(e.quote), at: 0, shotAt: [], shots: [], due: '',
        mergeInto: null, mergeTitle: '', status: 'open', placed: null, ...f, mark: 'added', before: null }));
      continue;
    }
    const c = find(e.id);
    if (!c || c.status !== 'open' || done.has(c.id)) continue;
    done.add(c.id);
    if (e.action === 'unchanged') { if (!c.mark) c.mark = 'unchanged'; continue; }
    if (e.action === 'drop') { touch(c, 'dropped', { status: 'dropped' }); continue; }
    if (e.action === 'rewrite') { Object.assign(c, settle({ ...touch(c, 'rewritten', fields(e, o.projects)) })); continue; }
    // merge: into an open item on its board, or into another card on this review
    const item = ((o.open || {})[c.project] || []).find(t => t.n === Number(e.mergeInto));
    if (item) { touch(c, 'merged', { mergeInto: item.n, mergeTitle: item.title, ...fields(e, o.projects) }); continue; }
    const into = find(e.mergeWith);
    if (into && into !== c && isOpen(into)) {
      touch(into, into.mark && into.mark !== 'unchanged' ? into.mark : 'rewritten', {
        quote: [into.quote, c.quote].filter(Boolean).join(' / '),
        shots: [...new Set([...(into.shots || []), ...(c.shots || [])])],
        shotAt: [...new Set([...(into.shotAt || []), ...(c.shotAt || [])])],
      });
      touch(c, 'merged', { status: 'dropped', mergedWith: into.id });
      continue;
    }
    if (!c.mark) c.mark = 'unchanged'; // nothing to merge into
  }
  // Open cards the proposal left out are unchanged.
  for (const c of out) if (c.status === 'open' && !c.mark) c.mark = 'unchanged';
  return out;
}

// One card back to before the brainstorm; an added card goes.
export function undoCard(cards, id) {
  const c = (cards || []).find(x => x.id === id);
  if (!c || !c.mark || c.status === 'accepted') return cards;
  if (c.mark === 'added') return cards.filter(x => x !== c);
  const { mergedWith, ...rest } = c;
  return cards.map(x => (x === c ? { ...rest, ...(c.before || {}), mark: null, before: null } : x));
}

export function undoAll(cards) {
  let out = cards || [];
  for (const c of [...out]) out = undoCard(out, c.id);
  return out;
}

// The brainstorm session's prompt, added to its own rules. who: 'cto' or 'pm'.
export function brainstormPrompt({ who, cards, transcript, transcriptFile, proposedFile, open }) {
  const role = who === 'pm'
    ? 'You are the PM, opened as a separate brainstorm session (brainstorm-pm). Look at the cards as the board keeper: duplicates of open items, the right project, which ones belong together, clear short titles.'
    : 'You are the CTO, opened as a separate brainstorm session (brainstorm-cto). Look at the cards as the one who briefs the leads: what a lead would need to build each, what is missing or unclear, what should be split or joined.';
  const list = (cards || []).filter(c => c.status === 'open').map(c => ({ id: c.id, kind: c.kind, project: c.project, title: c.title,
    description: String(c.description || '').split('\n'), quote: c.quote, due: c.due || null, mergeInto: c.mergeInto ?? null }));
  const out = [
    '# Brainstorm the cards of a screen recording',
    '',
    role,
    '',
    'The owner recorded their screen and talked; FocusShell turned what they said into the cards below. The owner opened you from the review to talk them over before they go on the boards. You are not the running CTO or PM, and this is not a task.',
    '',
    'Rules for this session:',
    '- Talk with the owner here, in plain short replies. Ask what is unclear; suggest changes.',
    '- Never change a board, never run deck, never message another session and never hand work to a lead. The owner accepts the cards on the review themselves.',
    `- When the owner is happy, or asks you to update the cards, write your proposal to ${proposedFile} with the Write tool, as JSON, then say in one line what you changed. Write it again after any later change.`,
    '- The proposal lists what to do with each card by its id, plus any new ones:',
    '  {"cards": [{"id": "c1", "action": "rewrite", "title": "...", "description": ["...", "..."], "kind": "task|note|reminder", "project": "<name or Me>", "due": "YYYY-MM-DD HH:MM or null"},',
    '   {"id": "c2", "action": "merge", "mergeInto": <number of an open item below>}, {"id": "c3", "action": "merge", "mergeWith": "c1"},',
    '   {"id": "c4", "action": "drop"}, {"id": "c5", "action": "unchanged"}, {"action": "add", "kind": "task", "project": "<name>", "title": "...", "description": ["..."]}]}',
    '- rewrite needs only the fields that change. Reminders are always Me items with a due time.',
    '- Never use the em dash or the en dash.',
    '',
    `The cards (as JSON):\n${JSON.stringify(list, null, 2)}`,
    '',
    `The transcript (${transcriptFile}), each line with its start and end:\n${transcript || '(empty)'}`,
  ];
  for (const [p, items] of Object.entries(open || {})) {
    if (!items || !items.length) continue;
    out.push('', `Open items in ${p}:`, ...items.slice(0, 60).map(t => `- #${t.n} ${t.title}`));
  }
  return out.join('\n');
}
