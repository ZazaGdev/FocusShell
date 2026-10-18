// Where each lead stopped (#383): one short line per lead, written by its CTO through
// `deck status`, kept in state/lead-status.json (lib/statusfile.js reads and writes it) and
// shown by the Status button above a CTO pane. The app asks a CTO to refresh the lines on the
// interval picked in Settings, while a lead is busy or has started or finished work since the last ask.
// No Node imports: the page uses this too.

export const IDLE_MS = 5 * 60000;
export const REFRESH = 'STATUS REFRESH';

// { leads: { 'lead-X': { line, at } } }; anything broken reads as empty.
export function parseStatus(text) {
  try {
    const o = JSON.parse(text);
    const leads = o && typeof o.leads === 'object' && o.leads ? o.leads : {};
    return { leads: Object.fromEntries(Object.entries(leads).filter(([, v]) => v && typeof v.line === 'string')) };
  } catch { return { leads: {} }; }
}

// The status with one lead's line set, at ms.
export function setStatus(st, lead, line, at) {
  const name = String(lead || '').trim();
  if (!/^lead-[\w.-]+$/.test(name)) throw new Error(`"${name}" is not a lead name (lead-<Project>)`);
  const one = String(line ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!one) throw new Error('the line is empty');
  if (/[\x00-\x08\x0b-\x1f\x7f]/.test(one)) throw new Error('the line holds a control character; check the quoting');
  return { leads: { ...st.leads, [name]: { line: one.slice(0, 200), at } } };
}

// Whether to ask a CTO to refresh now (#1034): the interval the owner picked in Settings (every,
// in ms) has passed since the last ask, and a lead of its started or finished work since then
// (leadLast, from workStep) or is busy now. A busy CTO is asked too: the line waits in its
// queue and runs at its next idle moment.
export function refreshDue({ now, askedAt = 0, leadLast = 0, busy = false, every = 30 * 60000 }) {
  return now - askedAt >= every && (leadLast > askedAt || busy);
}

// A lead is working only once its pane has printed without a break for WORK_MS (#392): Claude's
// spinner does that, while an idle pane's recap, redraw or status bar is a short burst. One
// sample: w is { runStart, working, changedAt }, active whether the pane printed in the last few
// seconds. changedAt moves when the lead starts working and when it stops, never otherwise.
export const WORK_MS = 20000;
export function workStep(w, active, now) {
  const s = { runStart: 0, working: false, changedAt: 0, ...w };
  if (active) {
    if (!s.runStart) s.runStart = now;
    if (!s.working && now - s.runStart >= WORK_MS) { s.working = true; s.changedAt = now; }
  } else {
    if (s.working) s.changedAt = now;
    s.runStart = 0; s.working = false;
  }
  return s;
}

// The Status table's rows (#413): A to Z by lead name, so lead-X sits right above lead-X-2.
export const sortLeads = list => [...list].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
// A lead's state for its badge: waiting on the owner (stopped on a prompt, or its task waits on
// an answer), blocked, busy or idle.
export const STATE_WORD = { needs: 'waiting on you', blocked: 'blocked', working: 'busy', idle: 'idle' };
export function leadState({ busy, prompt, task }) {
  if (prompt || (task && task.mark === '?')) return 'needs';
  if (task && task.mark === '!') return 'blocked';
  return busy ? 'working' : 'idle';
}

// The task a lead is on: the open one whose line names that lead (lead-X-2 is not lead-X), in
// progress first, then waiting on an answer, then blocked; none names it, no task (#413).
export function leadTask(tasks, name) {
  const mine = (tasks || []).filter(t => t.who === name);
  for (const m of ['~', '?', '!']) { const t = mine.find(x => x.mark === m); if (t) return t; }
  return null;
}

// The line typed into the CTO pane: the leads open in the app for it.
export const refreshLine = leads => `${REFRESH}: ${leads.join(', ')}`;
