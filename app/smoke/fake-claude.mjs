// A fake Claude Code screen for the smoke run (#3015): plain Node, no dependencies, raw stdin,
// a full redraw on each change. Run in a fake lead's pane as
//   node "<path>" lead-<Project> [--prompt]
// --prompt starts on a permission prompt (a lone Esc leaves it); otherwise on the input box as a
// session started with -n shows it, its name in the top rule, with the footer lines under it.
// Printable keys add to the draft, Backspace takes one off, Enter moves "> <draft>" up into the
// transcript with a "● ok" line, Ctrl+C exits.
const name = process.argv[2] || 'lead-Sample';
let mode = process.argv.includes('--prompt') ? 'prompt' : 'box';
let draft = '';
const transcript = [];
const out = s => process.stdout.write(s);
const NL = '\r\n';

function draw() {
  const cols = Math.max(40, process.stdout.columns || 80), rows = process.stdout.rows || 24;
  const rule = '─'.repeat(cols - 2);
  let lines;
  if (mode === 'prompt') {
    lines = [' Bash command', '', '   npm test', '', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No, and tell Claude what to do differently (esc)'];
  } else {
    const label = ` ${name} ─`;
    const top = '─'.repeat(Math.max(3, cols - 2 - label.length)) + label;
    const box = [top, `> ${draft}`, rule, '  Opus 5.5 · xhigh                                 ctx 22%', '  ⏵⏵ auto mode on · ← 1 agent', '  ● worker-1 running tests'];
    lines = [...transcript.slice(-Math.max(0, rows - box.length - 1)), ...box];
  }
  out('\x1b[2J\x1b[3J\x1b[H' + lines.map(l => l.slice(0, cols - 1)).join(NL));
}

function quit() {
  try { process.stdin.setRawMode(false); } catch { /* not a tty */ }
  out(NL);
  process.exit(0);
}

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  if (chunk.includes('\x03')) return quit();
  // A chunk that starts with Esc and is not an arrow key is an Esc, even joined to other bytes.
  if (chunk.startsWith('\x1b') && !/^\x1b[[O]/.test(chunk)) {
    if (mode === 'prompt') mode = 'box';
    return draw();
  }
  if (mode === 'prompt') return; // every other key is ignored on the prompt
  for (const ch of chunk) {
    if (ch === '\x7f' || ch === '\b') draft = [...draft].slice(0, -1).join('');
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\n' && chunk.includes('\r')) continue;
      transcript.push(`> ${draft}`, '● ok', '');
      draft = '';
    } else if (ch >= ' ' && ch !== '\x1b') draft += ch;
  }
  draw();
});
draw();
