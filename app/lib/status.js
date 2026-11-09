// Where each lead stopped (#383): one short line per lead, written by its CTO through
// `deck status`, kept in state/lead-status.json (lib/statusfile.js reads and writes it) and
// shown by the Status button above a CTO pane. The app asks a CTO to refresh the lines once the
// owner has been away for the time picked in Settings, while a lead is busy or has started or
// finished work since the last ask.
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

// Whether to ask a CTO to refresh now (#1699): only once the owner has been away for the time
// picked in Settings (idle, in ms; ownerAgo is ms since their last key or click anywhere in the
// app), and a lead of its started or finished work since the last ask (leadLast, from workStep)
// or is busy now. Two asks at most per idle stretch: at the idle time and at twice it, then none
// until the owner is back. A busy CTO is asked too: the line waits in its queue and runs at its
// next idle moment. A draft in its prompt holds the ask (#1205).
export function refreshDue({ now, askedAt = 0, leadLast = 0, busy = false, idle = 30 * 60000, ownerAgo = Infinity, draft = false }) {
  if (ownerAgo < idle || draft) return false;
  // The last mark passed in this stretch; an ask since then has covered it.
  const mark = now - ownerAgo + (ownerAgo >= 2 * idle ? 2 : 1) * idle;
  if (askedAt > 0 && askedAt >= mark) return false;
  return leadLast > askedAt || busy;
}

// A lead's dot (#1756), from its own pane only, never from its project's board: one plain
// meaning per colour, said in its tooltip. prompt: what it is stopped on in its pane; asked:
// its unanswered NEEDS YOU question; active: its turn is running (printing steadily); back: what
// it still runs in the background after its turn ended, such as "1 shell" (#2706), which keeps
// it purple until that ends too. Waiting on the owner wins over both.
export function leadDot({ exited = false, prompt = null, asked = null, active = false, back = null }) {
  if (exited) return { state: 'ended', tip: 'Session ended' };
  if (prompt) return { state: 'needs', tip: `Waits on you: ${prompt}` };
  if (asked && !active) return { state: 'needs', tip: `Waits on your answer: ${asked}` };
  if (active) return { state: 'working', tip: 'Working' };
  return back ? { state: 'working', tip: `Working in the background: ${back}` } : { state: 'idle', tip: 'Idle' };
}

// Whether a pane is working now, for its dot (#2706). Claude's spinner redraws many times a
// second for the whole of a turn, while an idle pane prints in short bursts: the recap Claude
// Code writes a few minutes after a turn ends, a redraw after a resize, a status line update.
// Any output used to light the dot, so a quiet lead lit up purple. Now a pane counts as working
// only once it has printed with no gap over GAP_MS for RUN_MS, and until HOLD_MS after its last
// output. o is { runStart, last }; outputStep is called on each chunk of output.
export const RUN_MS = 2500, GAP_MS = 3000, HOLD_MS = 3000;
export function outputStep(o, now) {
  const s = { runStart: 0, last: 0, ...o };
  if (!s.last || now - s.last > GAP_MS) s.runStart = now;
  s.last = now;
  return s;
}
export const printing = (o, now) => !!o && !!o.last && now - o.last < HOLD_MS && o.last - o.runStart >= RUN_MS;

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
