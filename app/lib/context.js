// How full a pane's context window is, and how its last turn stands (#3016). Pure: app/context.js
// reads the files. The log is Claude Code's own and internal (one JSON line per content block of a
// reply, each carrying the reply's usage and stop_reason), so a line that does not parse or fit is
// skipped rather than trusted.
import { isMgr, PM } from './groups.js';
import { projectOf } from './sessions.js';

export const SMALL = 200000, LARGE = 1000000; // context windows, in tokens
export const TAIL = 1024 * 1024, LONG_TAIL = 8 * 1024 * 1024; // how much of a log's end is read
export const MIRROR_MS = 3 * 60000; // how long the status line mirror's number is trusted
const ROOM = 60000; // tokens left at the ask point: a 200k window compacts by itself before 90%
export const EARLY = 40; // the ask point of a CTO or an extra lead in a 1M window, #3245
const READY = /^READY TO REOPEN\b/;
// Markdown a model may wrap a last line in: backticks, asterisks, a quote's > and spaces.
const bare = s => String(s || '').replace(/^[\s`*>]+|[\s`*>]+$/g, '');

// The panes FocusShell may ask to stop and reopen: the CTOs and the leads, not the PM, Personal
// (its own rules, no lead prompt) or the recorder's brainstorm sessions.
// personal: the Personal projects' names; brainstorm: whether id is a brainstorm session.
export function inScope(id, { personal = [], brainstorm = false } = {}) {
  if (isMgr(id)) return true;
  if (id === PM || brainstorm) return false;
  return !personal.includes(projectOf(id));
}

// The entries of a piece read from a log's end. partial: the piece starts mid-file, so its first
// line is cut and dropped; a last line still being written does not parse and is skipped too.
export function tailEntries(text, partial) {
  const lines = String(text || '').split('\n');
  if (partial) lines.shift();
  const out = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { const d = JSON.parse(line); if (d && typeof d === 'object') out.push(d); } catch { /* cut short */ }
  }
  return out;
}

const mainChain = d => d.isSidechain !== true;

// The tokens in the window at the last reply of the main conversation (not a subagent's, not
// Claude Code's own synthetic error reply): what its status line calls used. null when none.
export function tokensOf(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const d = entries[i], m = d.message;
    if (d.type !== 'assistant' || !mainChain(d) || !m || m.model === '<synthetic>' || !m.usage) continue;
    const n = k => (typeof m.usage[k] === 'number' ? m.usage[k] : 0);
    return n('input_tokens') + n('cache_creation_input_tokens') + n('cache_read_input_tokens');
  }
  return null;
}

// The window: 1M when the pane's model (else Claude's own default model) is a [1m] one, or when
// more than 200k tokens are already in it; else 200k.
export function windowOf({ model, defaultModel, tokens } = {}) {
  return String(model || defaultModel || '').includes('[1m]') || tokens > SMALL ? LARGE : SMALL;
}

// The percent at which the pane is asked to stop: 90, or less where Claude Code would compact on
// its own first (70 for 200k). override: FOCUSSHELL_CONTEXT_AT, a number from 1 to 100, which wins
// for every pane. early: the CTOs and extra leads, asked at 40% of a 1M window (400K) since #3245
// because their re-reads past 300K cost the most.
export function askAt(window, override, early) {
  const n = Number(override);
  if (override != null && String(override).trim() !== '' && n > 0 && n <= 100) return n;
  if (early && window === LARGE) return EARLY;
  return Math.min(90, Math.floor((window - ROOM) * 100 / window));
}

// The owner's status line mirror (~/.claude/usage/<conversation>.json): its context_used_pct when
// the file is this conversation's and was written in the last three minutes; else null.
export function mirrorPercent(d, conv, now = Date.now()) {
  if (!d || typeof d !== 'object' || typeof d.context_used_pct !== 'number' || typeof d.at !== 'number') return null;
  if (d.session_id && d.session_id !== conv) return null;
  return Math.abs(now - d.at * 1000) <= MIRROR_MS ? d.context_used_pct : null;
}

// How full the window is, in whole percent: the mirror's number when there is one. null: unknown.
export function percentOf({ tokens, window, mirror } = {}) {
  if (typeof mirror === 'number') return mirror;
  return typeof tokens === 'number' && window > 0 ? Math.floor(tokens * 100 / window) : null;
}

const textOf = content => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter(c => c && c.type === 'text' && typeof c.text === 'string').map(c => c.text).join('\n') : '');

// How the last turn stands: endedAt, the time of the last main-chain user or assistant entry when
// that is a reply that ended its turn (null while a turn runs or a message waits), and that
// entry's text. A turn has ended only once Claude Code wrote its turn_duration line after the
// reply: before that a Stop hook may still send it on. A message typed or sent from another
// session is queued (queue-operation enqueue, then dequeue or remove) and then arrives as a user
// entry, so one still queued after the reply means the turn goes on. Claude Code's own error
// reply (model "<synthetic>") ends a turn too, with no text of the session's. A local slash
// command or a ! line typed after the reply writes user entries but starts no turn: its output
// entry, and the command entries just before it, are skipped. A command entry with no output
// after it may be a slash command that starts a turn, so it still reads as running.
const OUTPUT = /^<(local-command-stdout|local-command-stderr|bash-stdout|bash-stderr)>/;
const COMMAND = /^<(command-name|command-message|command-args|bash-input|local-command-caveat)>/;
export function lastTurn(entries) {
  let closed = false, queued = 0, output = false;
  for (let i = entries.length - 1; i >= 0; i--) {
    const d = entries[i];
    if (d.type === 'queue-operation') { queued += d.operation === 'enqueue' ? 1 : d.operation === 'dequeue' || d.operation === 'remove' ? -1 : 0; continue; }
    if (!mainChain(d)) continue;
    if (d.type === 'system' && d.subtype === 'turn_duration') { closed = true; continue; }
    if (d.type !== 'user' && d.type !== 'assistant') continue;
    if (d.type === 'user') {
      const said = textOf((d.message || {}).content).trimStart();
      if (OUTPUT.test(said)) { output = true; continue; }
      if (output && COMMAND.test(said)) continue;
    }
    const m = d.message || {}, at = Date.parse(d.timestamp);
    if (d.type !== 'assistant' || !Number.isFinite(at) || !closed || queued > 0) break;
    if (m.model === '<synthetic>') return { endedAt: at, text: '' };
    if (m.stop_reason !== 'end_turn') break;
    return { endedAt: at, text: textOf(m.content) };
  }
  return { endedAt: null, text: '' };
}

// The turn state the page steps on once it asked the pane at askedAt (ms): endedAt, and ready, the
// READY TO REOPEN line (markdown around it taken off) when it is the reply's last line, in a turn
// that ended after the ask.
export function turnState(last, askedAt) {
  const endedAt = last && last.endedAt ? last.endedAt : null;
  if (!endedAt) return { endedAt: null, ready: null };
  const line = String(last.text || '').split(/\r?\n/).map(bare).filter(Boolean).pop() || '';
  return { endedAt, ready: READY.test(line) && askedAt > 0 && endedAt > askedAt ? line : null };
}

// What a READY line carries after its first |: a lead's task numbers, a CTO's stopped at and
// next. '' when nothing follows.
export const readyPart = line => { const s = String(line || ''), i = s.indexOf('|'); return i < 0 ? '' : bare(s.slice(i + 1)); };

// ---------- asking, waiting, reopening (renderer/context-reopen.js steps each pane on these) ----------
export const AGAIN_MS = 10 * 60000; // a pane that ended its turn without READY is asked again after this
export const QUIET_MS = 5000;       // no output in the pane for this long before it is reopened
export const OWNER_MS = 10000;      // nor the owner typing there
export const MAX_ASKS = 3;          // asks before the owner is told and the asking stops

// ---------- a fresh CTO each morning (#3073) ----------
export const DAY_HOUR = 5, DAY_IDLE_MS = 5 * 60000; // the day starts at 05:00; a CTO idle this long is asked
// The most recent local hour:00 at or before now (ms), in the PC's own time zone.
export function dayStart(now, hour = DAY_HOUR) {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  if (d.getTime() > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}
// Whether a conversation that began at since (ms) began before the latest day start.
export const newDay = (since, now) => since > 0 && since < dayStart(now);

// One pane's step. st: what the watch keeps for it, null before it is asked:
// { sending (a CONTEXT FULL or NEW DAY line on its way), why ('full' or 'day': which line),
// dayOf (a day ask's day start), askedAt (when the last one went), asks, gaveUp, reopening, fresh (reopened: not asked again
// until it has read below its ask point once) }.
// u: its session:context entry (since: when its conversation began; idleAt: when its last turn
// ended, null while one runs). p: its pane now: { cto, exited, prompt, words (a words request
// waiting or in flight), back (background shells), quietMs (since its last output), draft
// (inputDraft: '' an empty box, null no box), ownerMs (since the owner typed there), dayIdleMs
// (the smoke run's idle time for a day ask) }.
// Answers { st, act }: act null, 'ask', 'reopen' or 'giveup'.
export function step(st, u, p, now) {
  if (st && st.reopening) return { st, act: null };
  if (!u || typeof u.percent !== 'number') return { st, act: null };
  // A CTO whose conversation began before today's day start is due for a fresh one.
  const day = !!p.cto && newDay(u.since, now);
  // Below the ask point (never there, Claude Code compacted it, or a reopened pane's fresh log)
  // and not due for the day: only an ask that went in or is on its way is kept, since the pane
  // may already be acting on it.
  const below = u.percent < u.askAt;
  // A given-up ask stops holding the pane: a day ask once the pane is above its ask point or a new
  // day began, a full ask once it reads below on a later day than its last ask.
  if (st && st.gaveUp && (st.why === 'day' ? (!below || st.dayOf !== dayStart(now)) : (below && dayStart(st.askedAt) !== dayStart(now)))) st = null;
  // A reopened pane's fresh log read below its ask point: asked again as any pane from now on.
  if (below && st && st.fresh) return { st: null, act: null };
  if (below && !day && !(st && !st.fresh && (st.askedAt || st.sending))) return { st: null, act: null };
  if (st && st.fresh) return { st, act: null };
  const held = p.exited || !!p.prompt || !!p.words;
  // A day ask, first or again, waits until the CTO has been idle a while, with nothing going there.
  const idle = typeof p.dayIdleMs === 'number' ? p.dayIdleMs : DAY_IDLE_MS;
  const dayQuiet = !!u.idleAt && now - u.idleAt >= idle && p.quietMs >= idle && p.ownerMs >= idle && p.draft === '' && u.subagents === 0 && !p.back;
  if (!st || !st.askedAt) {
    if ((st && st.sending) || held) return { st, act: null };
    if (!below) return { st: { ...(st || {}), sending: true, why: 'full' }, act: 'ask' };
    return dayQuiet ? { st: { ...(st || {}), sending: true, why: 'day', dayOf: dayStart(now) }, act: 'ask' } : { st, act: null };
  }
  // Nothing is reopened while anything could still be going: every one of these holds it.
  const safe = !st.sending && !!u.ready && u.endedAt > st.askedAt && u.subagents === 0 && !p.back && !held && p.quietMs >= QUIET_MS && p.draft === '' && p.ownerMs >= OWNER_MS;
  if (safe) return { st: { ...st, reopening: true }, act: 'reopen' };
  // Whatever holds it (a subagent that never ends, a shell left running, a draft left in the box,
  // a line still queued), an asked pane neither reopened nor asked again tells the owner once.
  if (!st.gaveUp && now - st.askedAt >= MAX_ASKS * AGAIN_MS) return { st: { ...st, gaveUp: true }, act: 'giveup' };
  // Below it, a full ask is never asked again; a day ask is, while the CTO is still due.
  if (st.sending || u.ready || (below && !(st.why === 'day' && day))) return { st, act: null };
  if (st.gaveUp || !u.endedAt || u.subagents !== 0 || p.back || held || now - st.askedAt < AGAIN_MS) return { st, act: null };
  if ((st.asks || 0) >= MAX_ASKS) return { st: { ...st, gaveUp: true }, act: 'giveup' };
  if (st.why === 'day' && below && !dayQuiet) return { st, act: null };
  return { st: { ...st, sending: true }, act: 'ask' };
}
// The step state once a CONTEXT FULL or NEW DAY line went in at at (its why kept).
export const askSent = (st, at) => ({ ...(st || {}), sending: false, askedAt: at, asks: ((st && st.asks) || 0) + 1 });
