// The recorder's extraction rules (#369): the prompt that asks Claude for cards from a timed
// transcript, and the checking of its reply into cards the review can trust. Also the frame
// grab's file name and ffmpeg arguments.
import { clock } from './transcript.js';

const KINDS = ['task', 'note', 'reminder'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MAX_SHOTS = 3, OPEN_CAP = 60;
const squash = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const two = n => String(n).padStart(2, '0');

// The projects the talk names. Whisper splits names ("focus shell"), so both sides are compared
// without spaces or punctuation; names under four letters would match by chance, so not those.
export function namedProjects(lines, projects) {
  const said = squash((lines || []).map(l => l.text).join(' '));
  return (projects || []).filter(p => squash(p).length >= 4 && said.includes(squash(p)));
}

// Each line with its start and, when known, its end: Whisper's start takes in the pause before
// the words, so the screenshots are picked from inside the span.
export const transcriptText = lines => (lines || []).map(l => `[${clock(l.at)}${Number.isFinite(l.end) && l.end > l.at ? `-${clock(l.end)}` : ''}] ${l.text}`).join('\n');

// The system prompt. ctx: { projects: [names], open: { project: [{ n, title }] }, now: Date }
export function extractPrompt({ projects, open, now }) {
  const d = now || new Date();
  const stamp = `${DAYS[d.getDay()]} ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
  const out = [
    'You turn a spoken screen recording into work items for the owner\'s boards in FocusShell.',
    'The owner talked while working on screen. The message holds the transcript, each line with its [mm:ss-mm:ss] start and end. Whisper wrote it, so names may be split or misspelled ("focus shell" is FocusShell), and a line\'s start often falls a second or more before its words, in the pause before them, while the screen may still show what came before.',
    `Now: ${stamp} (the owner's local time).`,
    '',
    'Make one card for each separate thing the owner wants done, wants kept as a note, or wants to be reminded of. Rules:',
    '- kind: "task" for work on a project that a developer agent will carry out; "note" for something to keep with no action; "reminder" for something the owner must do themselves at a time.',
    '- project: one of the project names below, exactly as written, when the owner names it or the talk is clearly about it; otherwise "Me". Reminders are always "Me".',
    '- title: one plain line, an imperative for tasks, at most 80 characters, no full stop at the end.',
    '- description: 2 to 6 short lines that someone who never heard the recording can act on: what is wrong or wanted, where (project, page, screen, file or feature), and what done looks like. Use only what was said and what the talk says is on screen; never invent details.',
    '- quote: the owner\'s own words the card comes from, shortened when long.',
    '- at: the second where the talk about this card starts.',
    '- shots: 1 to 3 seconds where the screen best shows what the card is about, such as when the owner says "this", "here" or "look at", or describes what is on screen. Pick them from the middle of the lines about this card, at least two seconds after a line\'s start and before its end, never at a line\'s start second.',
    '- due: for reminders, "YYYY-MM-DD HH:MM" worked out from what was said and the time now ("tomorrow at ten" is tomorrow at 10:00); otherwise null.',
    '- mergeInto: the number of an open item below when the card only adds to that item; otherwise null.',
    '- No cards for filler, thinking aloud, or things finished during the recording. Two mentions of one thing are one card.',
    '- Never use the em dash or the en dash; use a comma, a colon or a full stop.',
    'Answer with only this JSON and nothing else:',
    '{"cards": [{"kind": "task", "project": "<name or Me>", "title": "<title>", "description": ["<line>", "<line>"], "quote": "<words>", "at": 12, "shots": [14, 20], "due": null, "mergeInto": null}]}',
    'When nothing in the talk is worth a card, answer {"cards": []}.',
    '',
    `Projects: ${(projects || []).join(', ') || '(none)'}`,
  ];
  for (const [p, items] of Object.entries(open || {})) {
    if (!items || !items.length) continue;
    out.push('', `Open items in ${p}:`, ...items.slice(0, OPEN_CAP).map(t => `- #${t.n} ${t.title}`));
  }
  return out.join('\n');
}

// Text for a board: one line, dashes as commas, no control characters.
const line = s => String(s ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s*[–—]\s*/g, ', ').replace(/\s+/g, ' ').trim();
const title = s => line(s).replace(/[.\s]+$/, '').slice(0, 120);
const DUE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

// A screenshot second in the first half of a transcript line moves to the line's middle: the
// line's start takes in the pause before the words, while the screen may still show what came
// before (measured on a spoken test recording, #369).
export function settleShot(t, lines) {
  const l = (lines || []).find(x => Number.isFinite(x.end) && x.at <= t && t < x.end);
  if (!l) return t;
  const mid = Math.round(((l.at + l.end) / 2) * 10) / 10;
  return t < mid ? mid : t;
}

// Claude's reply into cards. Throws when the reply holds no {"cards": [...]}; anything odd in
// a card is mended: an unknown project is Me, an unknown kind a task, shots kept inside the
// recording and out of the start of their transcript line. o: { projects, open, duration
// (seconds), lines (the timed transcript) }
export function parseCards(text, o) {
  const s = String(text ?? ''), a = s.indexOf('{'), b = s.lastIndexOf('}');
  let j = null;
  if (a >= 0 && b > a) try { j = JSON.parse(s.slice(a, b + 1)); } catch { j = null; }
  if (!j || !Array.isArray(j.cards)) throw new Error('The extraction reply was not the JSON asked for');
  const dur = Math.max(0, Number(o.duration) || 0), clamp = t => Math.min(dur, Math.max(0, t));
  const byName = new Map((o.projects || []).map(p => [squash(p), p]));
  const out = [];
  for (const c of j.cards) {
    if (!c || typeof c !== 'object' || !title(c.title)) continue;
    const kind = KINDS.includes(c.kind) ? c.kind : 'task';
    const project = kind === 'reminder' ? 'Me' : byName.get(squash(c.project)) || 'Me';
    const at = clamp(Number(c.at) || 0);
    const seen = new Set(), shotAt = [];
    for (const t of Array.isArray(c.shots) ? c.shots : []) {
      if (!Number.isFinite(Number(t))) continue;
      const v = clamp(settleShot(Number(t), o.lines));
      if (seen.has(Math.floor(v))) continue;
      seen.add(Math.floor(v)); shotAt.push(v);
      if (shotAt.length === MAX_SHOTS) break;
    }
    if (!shotAt.length) shotAt.push(at);
    const desc = (Array.isArray(c.description) ? c.description : String(c.description ?? '').split(/\r?\n/)).map(line).filter(Boolean);
    const merge = project === 'Me' ? null : ((o.open || {})[project] || []).find(t => t.n === Number(c.mergeInto)) || null;
    out.push({ id: `c${out.length + 1}`, kind, project, title: title(c.title), description: desc.join('\n'), quote: line(c.quote),
      at, shotAt, shots: [], due: kind === 'reminder' && DUE.test(String(c.due)) ? String(c.due) : '',
      mergeInto: merge ? merge.n : null, mergeTitle: merge ? merge.title : '', status: 'open', placed: null, mark: null, before: null });
  }
  return out;
}

// A frame's file name from its second: 0123.png, or 010205.png past an hour.
export const shotName = secs => `${clock(secs).replace(/:/g, '').padStart(4, '0').replace(/^(\d{5})$/, '0$1')}.png`;

// ffmpeg: one frame at secs. Seeking before the input is fast; after it (late) decodes up to
// the time, the fallback when a WebM without cues seeks badly.
export const ffmpegShotArgs = (video, secs, out, late = false) => late
  ? ['-v', 'error', '-y', '-i', video, '-ss', String(secs), '-frames:v', '1', out]
  : ['-v', 'error', '-y', '-ss', String(secs), '-i', video, '-frames:v', '1', out];
