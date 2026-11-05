// A plain-language summary for a Waiting on you card (#1521): one headless Haiku turn turns a
// card's lines into a few lines of Markdown the owner reads at a glance. Codes, hashes, paths
// and tags stay out of it; they remain on the card as chips and under "details". Made once per
// card text and kept; the parsed card (lib/cardview.js) shows while it is made or if it fails.
// No Node imports: the page uses summaryKey and the Markdown reader.
import { MAC, MAC_PATH } from './platform.js';

export const SUMMARY_PROMPT = `You rewrite one task card from a developer's board so its owner understands it at a glance.
The owner is busy and reads it in a few seconds. Write Markdown, at most 90 words:

1. First line: one bold sentence saying what the owner must decide or do now.
2. Then one or two short plain sentences on what it is about and why it matters.
3. If the card names choices (an "options:" list), a bullet per choice: "- **<choice>**: what picking it means". Add " (suggested)" to the one suggested.
   If it is a report with several proposals to approve, one short bullet per proposal in plain words instead.
   Never invent choices the card does not name. The latest lines of the card are its current state.

Never include: numbers starting with #, commit hashes or other codes, branch names, file names or paths, code, command lines, tags, or session names such as lead-X.
Do not address the reader ("Owner,"). Use plain everyday words. No dashes as punctuation (no em or en dashes). No heading lines. Output only the Markdown.`;

// Codes the model still let through: commit hashes, #numbers, lead names, Windows paths.
export function scrub(md) {
  return String(md)
    .replace(/\s*\((?:commit|commits|hash)?\s*[0-9a-f]{7,40}\)/gi, '')
    .replace(/\s*\((?:#\d+(?:,\s*)?)+\)/g, '')
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g, '')
    .replace(/\s?#\d+\b/g, '')
    .replace(/\s(?:on |for )?(?:task|item|card) \d+\b/gi, '')
    .replace(/\blead-[\w-]+/g, 'the lead')
    .replace(/[A-Za-z]:\\[^\s,;)]+/g, 'a file')
    .replace(MAC ? new RegExp(MAC_PATH.replace('[^\\s"', '[^\\s,;)"'), 'g') : /$^/g, 'a file')
    .replace(/[–—]/g, ',')
    .replace(/ {2,}/g, ' ').replace(/ ([.,;])/g, '$1');
}

// What the model reads: the card's title, its short result and its detail lines.
export function summaryInput(project, task) {
  return [`Project: ${project}`, `Card: ${task.text}`, task.result ? `Short status: ${task.result}` : '',
    ...(task.details || []).filter(d => !/^(Done|Priority|Version|Due|Sketch|Screenshot|Transcript):/i.test(d))].filter(Boolean).join('\n');
}

// A short hash of the card's text: a new summary is made only when that changes.
export function summaryKey(project, task) {
  const s = summaryInput(project, task);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${project}#${task.n}:${(h >>> 0).toString(36)}`;
}

// The reply from claude -p --output-format json: its Markdown, or null when it is not usable.
export function parseSummary(out) {
  let o; try { o = JSON.parse(out); } catch { return null; }
  const t = scrub(String((o && o.result) || '').trim());
  return !o || o.is_error || !t ? null : t.slice(0, 1200);
}

// The small Markdown the summary uses, as blocks: { p: [runs] } or { ul: [[runs], ...] }, where a
// run is { b: bool, text }. Only **bold**, "- " bullets and paragraphs.
export function readMarkdown(md) {
  const runs = s => String(s).split(/(\*\*[^*]+\*\*)/).filter(Boolean).map(x => (/^\*\*[^*]+\*\*$/.test(x) ? { b: true, text: x.slice(2, -2) } : { b: false, text: x.replace(/\*\*/g, '') }));
  const blocks = [];
  for (const raw of String(md || '').split(/\r?\n/)) {
    const line = raw.trim().replace(/^#+\s*/, '');
    if (!line) { blocks.push(null); continue; }
    const li = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    const prev = blocks[blocks.length - 1];
    if (li) { if (prev && prev.ul) prev.ul.push(runs(li[1])); else blocks.push({ ul: [runs(li[1])] }); }
    else if (prev && prev.p) prev.p.push({ b: false, text: ' ' }, ...runs(line));
    else blocks.push({ p: runs(line) });
  }
  return blocks.filter(Boolean);
}
