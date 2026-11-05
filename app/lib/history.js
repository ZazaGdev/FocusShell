// Past Claude Code sessions for a folder. Claude Code keeps one JSON-lines file per
// session in ~/.claude/projects/<encoded folder>/<session id>.jsonl. The format is
// internal to Claude Code, so unknown lines are skipped rather than trusted.

// "G:\SideProjects\Streaky" -> "G--SideProjects-Streaky"
export function encodeProjectDir(folder) {
  return String(folder).replace(/[^A-Za-z0-9]/g, '-');
}

// Text that came from another session or the harness, not typed by the user.
const NOT_TYPED = /^(<|Another Claude session|\[SYSTEM|Caveat:|This session is being continued)/;

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const t = content.find(c => c && c.type === 'text' && typeof c.text === 'string');
    return t ? t.text : '';
  }
  return '';
}

// Summarise one session file's lines. Title preference: a custom title that is not
// FocusShell's own lead name, then the first message the user typed, then a fallback.
export function summarizeSession(lines, id) {
  let start = '', end = '', user = 0, assistant = 0, custom = '', firstTyped = '', firstAny = '';
  for (const line of lines) {
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (!d || typeof d !== 'object') continue;
    if (d.timestamp) { if (!start) start = d.timestamp; end = d.timestamp; }
    if (d.type === 'custom-title' && d.customTitle && !/^(lead-|manager$|cto$|cto-|pm$)/.test(d.customTitle)) custom = d.customTitle;
    if (d.type === 'assistant') assistant++;
    if (d.type === 'user' && d.message) {
      const text = textOf(d.message.content).trim();
      if (!text) continue;
      user++;
      if (!firstAny) firstAny = text;
      if (!firstTyped && !NOT_TYPED.test(text)) firstTyped = text;
    }
  }
  // A lead started by the manager opens with a cross-session message carrying "TASK #n:".
  const task = firstAny.match(/TASK #(\d+):\s*(?:Your words:\s*)?"?([^\n"]+)/);
  const fromManager = task ? `Task #${task[1]}: ${task[2].trim()}` : '';
  const raw = custom || firstTyped || fromManager || (firstAny ? 'Started by another session' : 'Empty session');
  const title = raw.replace(/\s+/g, ' ').slice(0, 120);
  return { id, title, start, end, user, assistant };
}

// The conversation a pane last ran, so Restart can pick it up again (#197): the newest
// session file whose text carries the pane's name, which Claude Code writes from -n as a
// custom-title line. files: [{ id, mtime, text }].
export function lastConversation(files, name) {
  const tag = `"customTitle":${JSON.stringify(name)}`;
  const hit = [...files].sort((a, b) => b.mtime - a.mtime).find(f => f.text.includes(tag));
  return hit ? hit.id : null;
}

// The conversation a pane is writing now (#1887): the newest log named after it, unless a newer
// log carries no name at all. That is the pane's Claude exited and started again by hand in the
// shell the pane falls back to (#353), so it runs without -n. A log named after another session
// (a group CTO in the same folder) never counts. files: as lastConversation, written since the
// pane started.
const NAMED = /^\{"type":"(custom-title|agent-name)"/m;
export function paneConversation(files, name) {
  const named = lastConversation(files, name);
  const at = named ? files.find(f => f.id === named).mtime : -Infinity;
  const bare = [...files].sort((a, b) => b.mtime - a.mtime).find(f => f.mtime > at && !NAMED.test(f.text));
  return bare ? bare.id : named;
}
