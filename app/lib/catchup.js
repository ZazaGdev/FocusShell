// Open and catch up (#1025): a group opens and each project's lead, and the CTO, get a recap of
// where the project stands and where work stopped yesterday. By default one headless model
// turn (Haiku unless Settings picks another) writes it from the project's board, its git log
// and its lead's recent sessions; Settings can leave it to each lead instead. No Node imports.
import { parseTasks, doneOf } from './tasks.js';

export const CATCHUP_BY = ['model', 'lead'];
const MARK_WORD = { '~': 'in progress', '?': 'waiting on the owner', '!': 'blocked' };
const pad = n => String(n).padStart(2, '0');
export const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// The start of yesterday, local time: what "since yesterday" means here.
export function yesterday(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return d;
}

// The board's part: open items in progress, waiting or blocked with their Stopped at lines and
// latest result, and the items closed since `since` (a Date).
export function boardDigest(md, since) {
  const day = dayOf(since), out = [];
  const tasks = parseTasks(md || '');
  for (const t of tasks.filter(x => MARK_WORD[x.mark])) {
    out.push(`- #${t.n} ${t.text} (${MARK_WORD[t.mark]})`);
    for (const d of t.details.filter(x => /^Stopped at\b/i.test(x)).slice(-2)) out.push(`  ${d}`);
    if (t.result) out.push(`  Result: ${t.result}`);
  }
  const done = tasks.filter(t => t.mark === 'x' && doneOf(t) && doneOf(t).slice(0, 10) >= day);
  if (done.length) out.push('Done since yesterday:', ...done.map(t => `- #${t.n} ${t.text}${t.result ? ` -> ${t.result}` : ''}`));
  return out.join('\n') || 'Nothing in progress, waiting or blocked, and nothing done since yesterday.';
}

// A lead's session log (JSONL text): what the owner, the CTO and the lead said since `since`
// (ms), newest last, cut to the last `max` characters. Tool calls and results are left out.
export function sessionDigest(log, since, max = 6000) {
  const out = [];
  for (const raw of String(log || '').split('\n')) {
    if (!raw.includes('"type":"user"') && !raw.includes('"type":"assistant"')) continue;
    let o;
    try { o = JSON.parse(raw); } catch { continue; }
    if (!o.message || Date.parse(o.timestamp || '') < since) continue;
    const c = o.message.content;
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(p => p && p.type === 'text').map(p => p.text).join('\n') : '';
    const t = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    out.push(`${o.type === 'assistant' ? 'Lead' : 'To the lead'}: ${t.slice(0, 600)}`);
  }
  const all = out.join('\n');
  return all.length > max ? all.slice(all.length - max) : all;
}

export const SYSTEM = `You write a short catch-up recap of one software project for its owner and its tech lead, at the start of a work day.
You get the project's board (open work with its "Stopped at" notes, and what was done since yesterday), its git commits since yesterday, and what was said in its lead's recent sessions.
Write plain Markdown, at most 12 lines, under these headings in this order, leaving out a heading with nothing under it:
**Where it stands**: what is in progress, waiting on the owner, or blocked, one bullet each with its #number.
**Where we stopped**: the last thing being worked on and exactly where it stopped.
**Done since yesterday**: one bullet per finished item or commit group.
**Next**: the one or two obvious next steps.
Use only what the input says; never invent work. Short, plain words. Never use em dashes or en dashes.`;

export function catchupInput({ project, board, git, sessions }) {
  return [`Project: ${project}`, '', 'Board:', board, '', 'Git commits since yesterday:', git || 'none',
    '', 'Lead sessions since yesterday:', sessions || 'none'].join('\n');
}

// The lines typed into panes. A recap file for both, or (by lead) the lead's own instruction.
export const leadLine = file => (file ? `CATCH UP: ${file}` : 'CATCH UP: write your own recap');
export const ctoLine = (project, file) => `CATCH UP ${project}: ${file}`;
