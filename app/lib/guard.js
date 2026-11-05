// The board guard (#349): a PreToolUse hook of the CTO and the PM runs `deck guard`, which
// refuses a hand edit of a board file, the rule both already have ("only with deck") made
// enforced. Boards: tasks\, ideas\, notes\ and notes.md in the data folder. Briefs
// stay editable by hand (they are written by hand on purpose).
import path from 'node:path';

const BOARDS = ['tasks', 'ideas', 'notes'];
const FILE_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
const SHELL_TOOLS = /^(Bash|PowerShell)$/;
// Shell commands that write whatever file they name, as far as a quick look can tell; a
// redirect (> or >>) counts only for the file it writes to.
const WRITERS = /\bsed\s+-i|\bperl\s+-[a-z]*i|\b(Set|Add)-Content\b|\bOut-File\b|\btee\b|writeFile|appendFile|\.write\(|\b(Copy|Move)-Item\b|\b(cp|mv)\s/i;
const REDIRECT = /(?:^|[^>&0-9])>{1,2}\s*["']?([^\s"';|&<>]+)/g;

const norm = p => path.resolve(String(p)).toLowerCase().split(path.sep).join('/');

// Whether a path is a board file of the data folder.
export function isBoard(file, data) {
  const f = norm(file), d = norm(data);
  if (!f.startsWith(`${d}/`)) return false;
  const rel = f.slice(d.length + 1);
  return rel === 'notes.md' || BOARDS.some(b => rel.startsWith(`${b}/`));
}

// The reason to refuse this tool call, or '' to let it run. input: the hook's JSON.
export function guardReason(input, data) {
  const tool = String(input && input.tool_name || ''), t = (input && input.tool_input) || {};
  const why = what => `${what} is a board file: change boards only with the deck command (node <data>\\deck.mjs <verb> ...), never by hand.`;
  if (FILE_TOOLS.test(tool)) {
    const f = t.file_path || t.notebook_path;
    return f && isBoard(f, data) ? why(f) : '';
  }
  if (SHELL_TOOLS.test(tool)) {
    const cmd = String(t.command || '');
    if (/deck\.mjs/i.test(cmd)) return '';
    const flat = s => s.toLowerCase().split('\\').join('/');
    const d = norm(data), names = [...BOARDS.map(b => `${d}/${b}/`), `${d}/notes.md`, ...BOARDS.map(b => `${b}/`), 'notes.md'];
    const board = s => { const c = flat(s); return names.find(m => c.includes(m)); };
    for (const m of cmd.matchAll(REDIRECT)) { const hit = board(m[1]); if (hit) return why(m[1]); }
    const hit = WRITERS.test(cmd) && board(cmd);
    return hit ? why(hit) : '';
  }
  return '';
}
