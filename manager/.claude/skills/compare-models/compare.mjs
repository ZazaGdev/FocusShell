// Side-by-side summary of a model comparison (#211), read from each lead's saved Claude
// Code conversation, never from what the leads say about themselves.
// Usage: node compare.mjs <project folder> <project folder> [<project folder>]
// For each folder: the model, the prompt it received, when it arrived and when the lead
// last worked, minutes taken, its last report to the CTO, its commits and its tokens. Then
// whether every lead received exactly the same prompt, and the gap between the arrivals.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The text of a cross-session message, without the wrapper Claude Code puts around it.
export function messageText(content) {
  const s = typeof content === 'string' ? content
    : Array.isArray(content) ? content.filter(c => c && c.type === 'text').map(c => c.text).join('\n') : '';
  const m = s.match(/<cross-session-message[^>]*>\n?([\s\S]*?)\n?<\/cross-session-message>/);
  return m ? m[1] : null;
}

// One lead's conversation lines (JSONL) in, its facts out.
export function summarize(lines) {
  const usage = new Map(), out = { prompt: null, received: null, last: null, models: [], report: null, tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }, messages: 0 };
  const entries = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* a torn line */ }
  }
  entries.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
  for (const e of entries) {
    const m = e.message;
    if (e.type === 'user' && m && out.prompt === null) {
      const t = messageText(m.content);
      if (t !== null) { out.prompt = t; out.received = e.timestamp; }
    }
    if (e.type !== 'assistant' || !m) continue;
    if (out.prompt !== null) out.last = e.timestamp;
    if (m.id && m.usage) usage.set(m.id, { model: m.model, ...m.usage });
    for (const c of Array.isArray(m.content) ? m.content : []) {
      const said = c && c.type === 'tool_use' && c.name === 'SendMessage' && c.input && String(c.input.message || '');
      if (said && /^(DONE|BLOCKED|NEEDS YOU)\b/.test(said)) out.report = said.split('\n')[0];
    }
  }
  for (const u of usage.values()) {
    if (u.model && u.model !== '<synthetic>' && !out.models.includes(u.model)) out.models.push(u.model);
    out.messages++;
    out.tokens.input += u.input_tokens || 0;
    out.tokens.output += u.output_tokens || 0;
    out.tokens.cacheWrite += u.cache_creation_input_tokens || 0;
    out.tokens.cacheRead += u.cache_read_input_tokens || 0;
  }
  return out;
}

// Where the first difference between two texts is, or -1 when they are the same.
export function firstDifference(a, b) {
  if (a === b) return -1;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

// The folder Claude Code keeps a project's conversations in, for each spelling of its path.
function transcriptDirs(folder) {
  const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
  const names = new Set([folder, path.resolve(folder)]);
  try { names.add(fs.realpathSync.native(folder)); } catch { /* gone */ }
  return [...names].map(f => path.join(root, String(f).replace(/[^A-Za-z0-9]/g, '-'))).filter(d => fs.existsSync(d));
}

function jsonlLines(dirs) {
  const lines = [];
  const walk = d => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) walk(p); else if (n.endsWith('.jsonl')) lines.push(...fs.readFileSync(p, 'utf8').split('\n')); } };
  for (const d of dirs) walk(d);
  return lines;
}

const clock = t => (t ? new Date(t).toLocaleTimeString('en-GB') : '-');
const minutes = (a, b) => (a && b ? ((Date.parse(b) - Date.parse(a)) / 60000).toFixed(1) : '-');
const num = n => n.toLocaleString('en-US');
const cell = s => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

// The files each folder started from (its first commit, without the shared permissions
// file), as path -> git blob hash: whether every model got the same input files.
export function inputsSummary(starts) {
  const keyOf = m => Object.entries(m).sort().map(([p, h]) => `${p} ${h}`).join('\n');
  const n = Object.keys(starts[0] || {}).length;
  const dirs = [...new Set(Object.keys(starts[0] || {}).map(p => (p.includes('/') ? p.split('/')[0] + '/' : p)))];
  const where = n ? `${n} file${n === 1 ? '' : 's'} (${dirs.slice(0, 4).join(', ')}${dirs.length > 4 ? ', ...' : ''})` : 'none';
  return starts.every(m => keyOf(m) === keyOf(starts[0])) ? `Inputs: ${n ? `identical in every folder, ${where}` : 'none, every folder started empty'}.`
    : `Inputs: NOT identical. ${starts.map(m => `${Object.keys(m).length} file(s)`).join(' against ')}.`;
}

export function report(folders, facts) {
  const row = (label, f) => `| ${label} | ${facts.map(x => cell(f(x))).join(' | ')} |`;
  const lines = [
    `| | ${folders.map(f => path.basename(f)).join(' | ')} |`,
    `|---|${folders.map(() => '---').join('|')}|`,
    row('Model', x => x.models.join(', ') || 'no conversation found'),
    row('Prompt arrived', x => clock(x.received)),
    row('Last worked', x => clock(x.last)),
    row('Minutes', x => minutes(x.received, x.last)),
    row('Report', x => x.report || 'none yet'),
    row('Input files at the start', x => Object.keys(x.start).length),
    row('Commits after the start', x => x.commits),
    row('Output tokens', x => num(x.tokens.output)),
    row('Input tokens', x => num(x.tokens.input)),
    row('Cache write', x => num(x.tokens.cacheWrite)),
    row('Cache read', x => num(x.tokens.cacheRead)),
  ];
  lines.push('', inputsSummary(facts.map(x => x.start)));
  const prompts = facts.map(x => x.prompt);
  if (prompts.some(p => p === null)) lines.push('', 'Prompts: not every lead has received one yet.');
  else {
    const diffs = prompts.slice(1).map(p => firstDifference(prompts[0], p));
    lines.push('', diffs.every(d => d < 0) ? `Prompts: identical, ${prompts[0].length} characters each.`
      : `Prompts: NOT identical. ${diffs.map((d, i) => d < 0 ? '' : `${path.basename(folders[i + 1])} differs from ${path.basename(folders[0])} at character ${d}.`).filter(Boolean).join(' ')}`);
    const times = facts.map(x => Date.parse(x.received));
    lines.push(`Gap between the arrivals: ${((Math.max(...times) - Math.min(...times)) / 1000).toFixed(1)} seconds.`);
  }
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const folders = process.argv.slice(2);
  if (folders.length < 2) { console.error('usage: node compare.mjs <project folder> <project folder> [<project folder>]'); process.exit(1); }
  const facts = folders.map(f => {
    const x = summarize(jsonlLines(transcriptDirs(f)));
    let log = [];
    try { log = execFileSync('git', ['-C', f, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean); } catch { /* no repo */ }
    // The oldest commit is the starting point both leads were given.
    const made = log.slice(0, -1).reverse();
    const start = {};
    try {
      const root = execFileSync('git', ['-C', f, 'rev-list', '--max-parents=0', 'HEAD'], { encoding: 'utf8' }).trim().split('\n')[0];
      for (const l of execFileSync('git', ['-C', f, 'ls-tree', '-r', root], { encoding: 'utf8' }).split('\n')) {
        const m = l.match(/^\S+ blob (\S+)\t(.+)$/);
        if (m && m[2] !== '.claude/settings.json') start[m[2]] = m[1];
      }
    } catch { /* no repo */ }
    return { ...x, start, commits: !made.length ? 'none' : made.length > 12 ? `${made.length}: ${made.slice(-12).join('; ')}` : made.join('; ') };
  });
  console.log(report(folders, facts));
}
