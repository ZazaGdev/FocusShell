// Lines FocusShell types into a pane (#1029). Claude Code keeps only the tail of a long line
// written to it in one go (a 2,000 character RECORDING line arrived as its last 60 characters),
// so a line goes in short pieces. And a line that must reach the CTO is checked against the
// CTO's own Claude Code log afterwards.
import { RULE, BOX_LINE } from './prompts.js';

export const CHUNK = 200;   // characters per write
export const CHUNK_GAP = 30; // ms between writes

export function chunksOf(line, size = CHUNK) {
  const s = String(line || '');
  const out = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

// What the prompt box holds once a line was typed into it, read just before its Enter (#1277).
// draft is the box's text (null when the pane shows no Claude Code input box, as a plain
// shell): 'send' when it holds the line alone (or there is no box), 'owner' when the owner's
// words sit before it, so the line comes back out and the Enter is not pressed, 'mixed' when
// they sit before a line that lost characters (no Enter, nothing taken out), and 'wait'
// while the screen does not show the whole line yet. Wrapping and spacing do not count.
// hadBox: the pane showed an input box before the line was typed; then no box now means the
// box grew past a short pane's top, not a plain shell, so it waits (#1340).
const squash = s => String(s || '').replace(/\s+/g, '');
export function boxAfterLine(draft, line, hadBox = false) {
  if (draft === null || draft === undefined) return hadBox ? 'wait' : 'send';
  const box = squash(draft), want = squash(line);
  if (box === want) return 'send';
  if (want && box.endsWith(want)) return 'owner';
  // Other words before a line Claude Code took in with a few characters lost (a long one, cut
  // between its pieces): it cannot be taken back out exactly, so it stays in the box unsent.
  const head = want.slice(0, 24);
  if (head && box.indexOf(head) > 0) return 'mixed';
  return 'wait';
}

// A line whose check ran out without an Enter (#1340): 'out' when it is still the box's tail,
// so it can be taken back out and typed again later; 'keep' when it cannot be taken out
// cleanly (words after it, or the box not on screen), so it stays and the owner is told.
export function leftLine(draft, line) {
  const want = squash(line);
  return draft != null && want && squash(draft).endsWith(want) ? 'out' : 'keep';
}

// Whether Claude Code's own dictation is live on the screen (#1277): it prints "connecting…",
// then "listening…", at the right just above its input box while it records, and a key typed
// then ends the recording. Only the row just above the box's top rule counts, with the word
// alone at the right: output ending "Server ready, listening..." is not dictation (#1340).
const VOICE = /^\s{20,}(listening|connecting)(…|\.\.\.)\s*$/i;
export function voiceLive(rows) {
  const lines = rows.map(l => String(l).replace(/\s+$/, ''));
  for (let i = lines.length - 1; i > 1; i--) {
    if (BOX_LINE.test(lines[i]) && RULE(lines[i - 1])) return VOICE.test(rows[i - 2] ?? '');
  }
  return false;
}

// Whether the log (JSONL text) holds a message from the pane's prompt, sent or queued mid-turn,
// at or after since (ms), that contains text.
export function arrived(log, text, since = 0) {
  const want = String(text || '').trim();
  if (!want) return false;
  for (const raw of String(log || '').split('\n')) {
    if (!raw.includes('"user"') && !raw.includes('queue-operation')) continue;
    let o;
    try { o = JSON.parse(raw); } catch { continue; }
    if (Date.parse(o.timestamp || '') < since - 2000) continue;
    let body = null;
    if (o.type === 'queue-operation' && o.operation === 'enqueue') body = o.content;
    else if (o.type === 'user' && o.message) {
      const c = o.message.content;
      body = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(p => p && p.type === 'text').map(p => p.text).join('\n') : null;
    }
    if (typeof body === 'string' && body.includes(want)) return true;
  }
  return false;
}
