// What a Waiting on you card shows (#1521): the ask as a bold headline, the options with the
// suggested one marked, the words a lead needs typed, tests and commits as badges, and the rest
// folded under "details". Read from the lines leads and the CTO already write:
// "NEEDS YOU #<n> | <question> | options: a, b | suggest: a (why) | words: ..." and
// "DONE #<n> | <result>; <label>: <item>; ... | tests: pass | commit: <hash>".
// No Node imports: the page uses this.

// A report line's parts at " | ": its head (DONE #n), the known fields and the body.
export function reportParts(line) {
  const parts = String(line || '').split(/\s+\|\s+/);
  const head = /^(DONE|NEEDS YOU|BLOCKED)\b/.test(parts[0] || '') ? parts.shift() : '';
  const out = { head, body: [], tests: '', commits: [], words: '' };
  for (const p of parts) {
    const m = p.match(/^(tests|commits?|words|unblock|options|suggest):\s*([\s\S]*)$/i);
    if (!m) { out.body.push(p); continue; }
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'tests') out.tests = v;
    else if (k.startsWith('commit')) out.commits = v && !/^none$/i.test(v) ? v.split(/,\s*/) : [];
    else if (k === 'words') out.words = v;
  }
  return out;
}

// A long result in pieces at "; ": a piece starting "<label>: " opens a group of its own.
export function resultGroups(text) {
  const groups = [];
  let g = { label: '', items: [] };
  for (const piece of String(text || '').split(/;\s+/).map(s => s.trim()).filter(Boolean)) {
    const m = piece.match(/^([A-Za-z][A-Za-z ]{1,30}):\s+([\s\S]+)$/);
    if (m) { if (g.items.length) groups.push(g); g = { label: m[1], items: [m[2]] }; }
    else g.items.push(piece);
  }
  if (g.items.length) groups.push(g);
  return groups;
}

// A question's headline: its last sentence when it ends in "?", else its first clause.
// rest is what is left of it, for details.
export function headlineOf(question) {
  const q = String(question || '').trim();
  const m = /\?$/.test(q) ? q.match(/(?:^|[.;]\s+)((?:(?![.;]\s).)*\?)$/) : null;
  if (m) return { headline: m[1].trim(), rest: q.slice(0, q.length - m[1].length).replace(/[\s;.]+$/, '') };
  const first = q.split(/;\s+|\s\(/)[0];
  if (first.length >= q.length || first.length < 12) return { headline: q, rest: '' };
  return { headline: first, rest: q.slice(first.length).replace(/^[\s;,]+/, '') };
}

// The suggestion without the words a lead tucked after it, and the reason in brackets.
export function suggestParts(suggest) {
  let s = String(suggest || '').trim(), words = '';
  const w = s.match(/\s*\|\s*words:\s*([\s\S]*)$/i);
  if (w) { words = w[1].trim(); s = s.slice(0, w.index).trim(); }
  const r = s.match(/^(.*?)\s*\(([^()]*)\)$/);
  return r && r[1] ? { pick: r[1].trim(), why: r[2].trim(), words } : { pick: s, why: '', words };
}

const lastResult = task => {
  const results = (task.details || []).filter(d => /^Result:/i.test(d)).map(d => d.replace(/^Result:\s*/i, ''));
  return results.length ? results[results.length - 1] : '';
};

// task: a parsed board task; ask: askOf(task) or null.
// Returns { headline, title, options: [{ key, text, suggested }], why, words, tests, commits,
//   groups: [{ label, items }], context }.
export function cardView(task, ask) {
  const last = lastResult(task), rep = reportParts(last);
  const out = { headline: '', title: task.text, options: [], why: '', words: rep.words, tests: /^(none|)$/i.test(rep.tests) ? '' : rep.tests, commits: rep.commits, groups: [], context: '' };
  // A question only when a report line starts with NEEDS YOU: a DONE that mentions
  // "NEEDS YOU" in passing is a report, not a question.
  const lines = [task.result, ...(task.details || []).map(d => d.replace(/^Result:\s*/i, ''))];
  if (ask && lines.some(l => /^NEEDS YOU\b/.test(String(l || '')))) {
    const { headline, rest } = headlineOf(ask.question || task.text);
    const sp = suggestParts(ask.suggest);
    const sug = sp.pick.toLowerCase();
    out.headline = headline; out.context = rest; out.why = sp.why; out.words = out.words || sp.words;
    out.options = (ask.options || []).map(o => ({ ...o, suggested: !!sug && (o.key ? sug.startsWith(o.key) : sug === o.text.toLowerCase() || sug.startsWith(o.text.toLowerCase())) }));
    if (!out.options.length && sp.pick) out.suggestion = sp.pick;
    return out;
  }
  // No question: a report waiting on the owner. Its short result leads; the long one is details.
  out.headline = task.result || task.text;
  out.groups = resultGroups(rep.body.join(' | '));
  return out;
}
