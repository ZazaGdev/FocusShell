// The AI helper (#148, #154): a Haiku chat that turns a rough thought into one concise,
// descriptive item. Pure parts: the system prompt and its context, reply parsing, and
// turning a draft into the lines the shared files already use.
import { addTaskLine, nextNumber } from './tasks.js';

// What each add field writes: shown in the modal's header and told to the helper.
export const KINDS = {
  task: { label: p => (p === 'Me' ? 'New to-do' : `New task for ${p}`), what: p => (p === 'Me' ? "a to-do on the owner's own list" : `a task for the ${p} project, which a Claude Code session will carry out`) },
  idea: { label: () => 'New idea', what: () => "an idea for the owner's ideas deck" },
  note: { label: () => 'New note', what: () => "a note in the owner's general notes" },
  pnote: { label: p => `New note for ${p}`, what: p => `a note on the ${p} project` },
};

export const DOC_CAP = 6000;

// ctx: { kind, project, open: [titles], doc: { name, text } | null }
export function systemPrompt(ctx) {
  const k = KINDS[ctx.kind] || KINDS.task, project = ctx.project || 'Me';
  const out = [
    `You help the owner write ${k.what(project)}. Turn what they say into one item that is concise but descriptive.`,
    'Rules:',
    '- Ask at most one or two short questions per turn, and only when the answer would change the item. Otherwise just improve the draft.',
    '- If one of the open items below already covers it, say which (by number) and draft it anyway.',
    '- Title: one plain line, no trailing full stop. Lines: what and why, in a few short lines. No headings, no filler, no restating the question.',
    '- Never use the em dash or the en dash; use a comma, a colon or a full stop.',
    '- Always answer with only this JSON object and nothing else: {"reply": "<what you say to the owner>", "draft": {"title": "<title>", "lines": ["<line>", "..."]}}',
  ];
  if (ctx.open && ctx.open.length) out.push('', `Open items in ${project}:`, ...ctx.open.slice(0, 80).map(t => `- ${t}`));
  if (ctx.doc && ctx.doc.text) {
    const text = String(ctx.doc.text);
    out.push('', `${project}'s ${ctx.doc.name}:`, text.length > DOC_CAP ? text.slice(0, DOC_CAP) + '\n[cut]' : text);
  }
  return out.join('\n');
}

const cleanLine = s => String(s ?? '').replace(/\s+/g, ' ').trim();

// The helper's reply: { reply, draft } where draft is { title, lines } or null. Text
// around the JSON (a code fence, a sentence) is ignored; text with no JSON is the reply.
export function parseReply(text) {
  const s = String(text ?? '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try {
      const o = JSON.parse(s.slice(a, b + 1));
      const d = o && o.draft, title = d && cleanLine(d.title);
      const draft = title ? { title, lines: (Array.isArray(d.lines) ? d.lines : []).map(cleanLine).filter(Boolean) } : null;
      return { reply: cleanLine(o.reply) || (draft ? '' : s), draft };
    } catch { /* not JSON after all */ }
  }
  return { reply: s, draft: null };
}

// A task or idea with its description on "  > " detail lines, right under it.
// n: its number, from the shared counter on a task board (#411); the board's own next by default.
export function addItem(md, draft, who, date, n = nextNumber(md)) {
  const lines = (draft.lines || []).map(cleanLine).filter(Boolean).map(l => `  > ${l}`);
  return { md: addTaskLine(md, draft.title, who, date, n).replace(/\n$/, '') + (lines.length ? '\n' + lines.join('\n') : '') + '\n', n };
}

// Notes are one line: the title, then the lines as sentences.
export function noteText(draft) {
  const end = s => (/[.!?:]$/.test(s) ? s : s + '.');
  const lines = (draft.lines || []).map(cleanLine).filter(Boolean);
  return lines.length ? [end(cleanLine(draft.title)), ...lines.map(end)].join(' ') : cleanLine(draft.title);
}

// The draft box as text and back: the title on the first line, one detail per line after.
export const draftText = d => (d ? [d.title, ...(d.lines || [])].join('\n') : '');
export function textDraft(text) {
  const [title = '', ...lines] = String(text).split(/\r?\n/).map(cleanLine).filter(Boolean);
  return title ? { title, lines } : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The command line for one turn, run through cmd.exe (claude is a .cmd shim). Only fixed
// flags, a checked session id and a quoted file path go on it; the message goes on stdin.
// --setting-sources "" keeps the owner's global rules, plugins and output style out: with
// them a turn sent about 7,200 tokens and Haiku ignored this prompt; without, about 650.
// The model is the one picked in Settings (#174): Haiku unless changed, none for Claude's default.
// effort: low for the helper; the recorder's extraction (#369) asks for medium.
export function helperCommand({ promptFile, session, model = 'haiku', effort = 'low' }) {
  const parts = ['claude', '-p', ...(/^(fable|opus|sonnet|haiku)$/.test(model || '') ? ['--model', model] : []), '--tools', '""', '--strict-mcp-config', '--disable-slash-commands',
    '--setting-sources', '""', '--effort', /^(low|medium|high)$/.test(effort) ? effort : 'low', '--output-format', 'json'];
  if (session && UUID.test(session)) parts.push('--resume', session);
  else if (promptFile && !/["\r\n]/.test(promptFile)) parts.push('--system-prompt-file', `"${promptFile}"`);
  return parts.join(' ');
}
