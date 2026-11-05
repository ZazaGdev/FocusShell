// Hold to talk sends on release (#415): once the keys are let go, Claude Code writes what was
// said into the CTO's prompt, and Enter sends it when the pane has gone quiet, so the words are
// in before the Enter. A pane that never goes quiet (the CTO still printing) gets the Enter
// after MAX_WAIT anyway; Claude Code then queues the message. No Node imports.

export const QUIET_MS = 1000;   // the pane printed nothing for this long: the words are in
export const MIN_WAIT = 700;    // never sooner than this after the release
export const MAX_WAIT = 8000;   // never later than this

// Whether to press Enter now: ms since the release and since the pane last printed.
export function readyToSend({ now, releasedAt, lastOutput }) {
  const since = now - releasedAt;
  if (since >= MAX_WAIT) return true;
  return since >= MIN_WAIT && now - (lastOutput || 0) >= QUIET_MS;
}
