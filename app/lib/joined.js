// A session FocusShell opened must join Claude Code's cross-session messaging, or the CTO
// cannot list or reach it (#1113). Two things stop that on a fresh PC: Claude Code's first-run
// "trust this folder" question, which a session waits on before it joins, and anything else
// that leaves it stuck. Connecting a project means trusting it, so FocusShell answers that
// question itself; a session still not joined after a while is shown to the user to reopen.

// Claude Code's first-run question in a folder it has not been trusted in yet, on the screen.
export function trustQuestion(plain) {
  const t = String(plain).replace(/\s+/g, '');
  return /trustthisfolder/i.test(t) && /Entertoconfirm/i.test(t);
}

// The keys that pick "Yes, I trust this folder" from the question on screen: arrows from the
// highlighted choice (the ">" one) to Yes, then Enter. Claude Code 2.1.302 highlights "No, exit"
// first, so a bare Enter would close the session. null when the screen cannot be read.
export function trustKeys(plain) {
  const lines = String(plain).split(/\r?\n/).map(l => l.replace(/\s+/g, '')).filter(Boolean);
  const opts = [];
  for (const l of lines) {
    const m = l.match(/^([>❯›])?(?:\d+\.)?(Yes,?Itrustthisfolder|No,?exit)/i);
    if (m) opts.push({ yes: /^yes/i.test(m[2]), on: !!m[1] });
  }
  const last = opts.slice(-2), at = last.findIndex(o => o.on), yes = last.findIndex(o => o.yes);
  if (last.length !== 2 || at < 0 || yes < 0) return null;
  const move = yes - at;
  return (move > 0 ? '\x1b[B'.repeat(move) : '\x1b[A'.repeat(-move)) + '\r';
}

// How long a fresh session gets to join before the user is told, and how long FocusShell
// watches for the trust question after it opens.
export const JOIN_GRACE_MS = 60e3, TRUST_WATCH_MS = 120e3;

// Whether a session named `name`, started at `since` (ms), has joined messaging, from the
// session files Claude Code keeps in <config>/sessions (one JSON per running session).
// null when those files do not look as expected, so an unknown format never raises a warning.
export function joined(files, name, since) {
  const known = files.filter(f => f && typeof f === 'object' && 'messagingSocketPath' in f);
  if (!known.length) return null;
  return known.some(f => f.name === name && f.messagingSocketPath && Number(f.startedAt || 0) >= since - 10e3);
}
