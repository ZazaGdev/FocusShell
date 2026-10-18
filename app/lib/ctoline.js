// Lines FocusShell types into a pane (#1029). Claude Code keeps only the tail of a long line
// written to it in one go (a 2,000 character RECORDING line arrived as its last 60 characters),
// so a line goes in short pieces. And a line that must reach the CTO is checked against the
// CTO's own Claude Code log afterwards.

export const CHUNK = 200;   // characters per write
export const CHUNK_GAP = 30; // ms between writes

export function chunksOf(line, size = CHUNK) {
  const s = String(line || '');
  const out = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
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
