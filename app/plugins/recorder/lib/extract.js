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

// A project's own words about itself in one line (#2185): the first lines of its CLAUDE.md or
// README.md that are not headings, front matter, code or lists, cut at about 200 characters.
export function aboutLine(md) {
  const out = [];
  let fence = false, front = false;
  for (const [i, raw] of String(md || '').split(/\r?\n/).entries()) {
    const l = raw.trim();
    if (i === 0 && l === '---') { front = true; continue; }
    if (front) { if (l === '---') front = false; continue; }
    if (l.startsWith('```')) { fence = !fence; continue; }
    if (fence || !l || /^(#|>|[-*+|]\s|\d+\.\s|<|!\[)/.test(l)) { if (out.length && !l) break; continue; }
    out.push(l);
  }
  const s = line(out.join(' ').replace(/[*_`]/g, ''));
  return s.length > 200 ? `${s.slice(0, 200).replace(/\s+\S*$/, '')}...` : s;
}

// The seconds to take a picture of the screen at, for the card step to see which project is on
// screen (#2185): one every 15 seconds, at most 16 spread over a longer recording.
export function frameTimes(duration) {
  const d = Math.max(0, Number(duration) || 0);
  if (!d) return [];
  const gap = Math.max(15, d / 16), out = [];
  for (let t = Math.min(3, d / 2); t < d && out.length < 16; t += gap) out.push(Math.round(t));
  return out;
}
export const frameName = secs => shotName(secs).replace(/\.png$/, '.jpg');

// The message for the card step: the timed transcript, then the screen frames when there are.
// frames: [{ at, path }]
export function extractText(lines, frames) {
  const f = (frames || []).map(x => `[${clock(x.at)}] ${x.path}`);
  return transcriptText(lines) + (f.length ? `\n\nScreen frames (read each one with the Read tool):\n${f.join('\n')}` : '');
}

// The system prompt. ctx: { projects: [names], about: { project: its CLAUDE.md or README.md },
// open: { project: [{ n, title }] }, now: Date, frames: whether the message lists screen frames }
export function extractPrompt({ projects, about, open, now, frames }) {
  const d = now || new Date();
  const stamp = `${DAYS[d.getDay()]} ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
  const out = [
    'You turn a spoken screen recording into work items for the owner\'s boards in FocusShell.',
    'The owner talked while working on screen. The message holds the transcript, each line with its [mm:ss-mm:ss] start and end. Whisper wrote it, so names may be split or misspelled ("focus shell" is FocusShell), and a line\'s start often falls a second or more before its words, in the pause before them, while the screen may still show what came before.',
    `Now: ${stamp} (the owner's local time).`,
    ...(frames ? ['After the transcript the message lists screen frames: a picture of the screen at that second. Read every frame with the Read tool before answering. They show which app, site, page or file the owner is talking about, since the owner often says only "this page" or "here".'] : []),
    '',
    'Make one card for each separate thing the owner wants done, wants kept as a note, or wants to be reminded of. Rules:',
    '- kind: "task" for work on a project that a developer agent will carry out; "note" for something to keep with no action; "reminder" for something the owner must do themselves at a time.',
    '- project: the project the card is about, one of the project names below exactly as written. Work it out from the words and from what is on screen (the app, site, domain, page, window title or file shown), using what each project is. "Me" only for the owner\'s personal things that are no project\'s work, and reminders are always "Me". When a card is about project work but you cannot tell which project, "?"; never "Me" for project work.',
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
  const known = (projects || []).map(p => [p, aboutLine((about || {})[p])]).filter(([, a]) => a);
  if (known.length) out.push('', 'What each project is:', ...known.map(([p, a]) => `- ${p}: ${a}`));
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
// a card is mended: an unknown project is '' (the review asks for one, #2185; it was Me, which
// sent no project work to the CTO), an unknown kind a task, shots kept inside the
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
    const project = kind === 'reminder' || squash(c.project) === 'me' ? 'Me' : byName.get(squash(c.project)) || '';
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
    const merge = project === 'Me' || !project ? null : ((o.open || {})[project] || []).find(t => t.n === Number(c.mergeInto)) || null;
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
