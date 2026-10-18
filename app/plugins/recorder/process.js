// The recorder's processing steps (#369): ffmpeg pulls the sound out of the recording,
// whisper-cli transcribes it, a Claude turn finds the cards and ffmpeg grabs their frames, each
// as a child process so the window never waits on them. A step may return { cards }.
// A fake run (the hidden smoke run) writes a canned transcript, reply and picture instead.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { parseWhisper, transcriptMd, expandEnv, ffmpegAudioArgs, ffmpegRemuxArgs, whisperArgs } from './lib/transcript.js';
import { namedProjects, extractPrompt, transcriptText, parseCards, shotName, ffmpegShotArgs } from './lib/extract.js';
import { videoFile, size } from './store.js';

const LIMIT_MS = 60 * 60000; // one step may take an hour on a long recording, then it is stopped

// The children running now, so a discard or a switch-off can stop them.
export const children = new Set();
export function killAll() { for (const c of children) try { c.kill(); } catch { /* gone */ } children.clear(); }

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const c = execFile(cmd, args, { windowsHide: true, timeout: LIMIT_MS, maxBuffer: 16 * 1024 * 1024 }, (err, out, errOut) => {
      children.delete(c);
      if (!err) return resolve(out);
      const tail = String(errOut || '').trim().split(/\r?\n/).slice(-3).join(' ');
      const e = new Error(err.code === 'ENOENT' ? `${cmd} was not found` : tail || err.message);
      e.stderr = String(errOut || '');
      reject(e);
    });
    children.add(c);
  });
}

// whisper-cli.exe in the Whisper folder or up to three folders below it.
export function findWhisperCli(dir, depth = 0) {
  const direct = path.join(dir, 'whisper-cli.exe');
  if (fs.existsSync(direct)) return direct;
  if (depth >= 3) return null;
  let subs = [];
  try { subs = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()); } catch { return null; }
  for (const d of subs) { const f = findWhisperCli(path.join(dir, d.name), depth + 1); if (f) return f; }
  return null;
}

const files = dir => ({ video: videoFile(dir), wav: path.join(dir, 'audio.wav'), json: path.join(dir, 'transcript.json'), md: path.join(dir, 'transcript.md') });

// The video written again with its length and seek index, so players can seek it (#1017).
// The original stays when ffmpeg fails; the recording still plays from the start.
async function seekable(ffmpeg, video, log) {
  const tmp = video.replace(/\.webm$/, '.seek.webm');
  try {
    await run(ffmpeg, ffmpegRemuxArgs(video, tmp));
    if (!size(tmp)) throw new Error('ffmpeg wrote nothing');
    fs.renameSync(tmp, video);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* none */ }
    if (log) log(`seek index not written: ${e.message}`);
  }
}

// Step audio: the video made seekable, then video.webm to a 16 kHz mono audio.wav.
// A recording made with the mic off has no sound to pull out.
export async function audioStep(dir, settings, fake, session, host) {
  const f = files(dir);
  if (fake) return;
  const ffmpeg = expandEnv(settings.ffmpeg || 'ffmpeg', process.env);
  if (size(f.video)) await seekable(ffmpeg, f.video, host && host.log);
  if (session && session.mic === false) return;
  if (!size(f.video)) throw new Error('Nothing was recorded');
  try { await run(ffmpeg, ffmpegAudioArgs(f.video, f.wav)); } catch (e) {
    if (/does not contain any stream|matches no streams/i.test(e.stderr || e.message)) throw new Error('The recording has no sound. Is a mic plugged in and allowed?');
    throw e;
  }
}

// Step transcript: audio.wav to transcript.json with whisper-cli, then transcript.md. With the
// mic off the transcript is empty, so the review opens with no cards.
export async function transcriptStep(dir, settings, fake, session) {
  const f = files(dir);
  if (fake) fs.writeFileSync(f.json, JSON.stringify(CANNED));
  else if (session.mic === false) fs.writeFileSync(f.json, JSON.stringify({ transcription: [] }));
  else {
    const wdir = expandEnv(settings.whisperDir, process.env);
    const cli = findWhisperCli(wdir);
    if (!cli) throw new Error(`whisper-cli.exe is not in ${wdir}. Set the Whisper folder in Settings`);
    const model = path.isAbsolute(expandEnv(settings.model, process.env)) ? expandEnv(settings.model, process.env) : path.join(wdir, settings.model);
    if (!fs.existsSync(model)) throw new Error(`The Whisper model ${model} is missing`);
    const threads = Math.max(4, os.cpus().length - 2);
    await run(cli, whisperArgs({ model, wav: f.wav, out: f.json.replace(/\.json$/, ''), threads }));
  }
  const lines = parseWhisper(JSON.parse(fs.readFileSync(f.json, 'utf8')));
  const d = new Date(session.startedAt), p = n => String(n).padStart(2, '0');
  const title = `Recording ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  fs.writeFileSync(f.md, transcriptMd(lines, { title, video: f.video }));
}

// The timed lines of a recording's transcript, for the screen.
export function readLines(dir) {
  try { return parseWhisper(JSON.parse(fs.readFileSync(files(dir).json, 'utf8'))); } catch { return []; }
}

// The recording's length in seconds: from start to stop, or to the last word when longer.
function duration(session, lines) {
  const ran = session.stoppedAt ? (session.stoppedAt - session.startedAt) / 1000 : 0;
  return Math.max(ran, ...lines.map(l => l.end || l.at || 0), 0);
}

// Step items: one Claude turn reads the timed transcript, every project's name and the open
// items of the projects the talk names, and answers with the cards. The raw reply is kept in
// items.txt to check a bad extraction against.
export async function itemsStep(dir, settings, fake, session, host) {
  const lines = readLines(dir);
  if (!lines.length) return { cards: [] };
  const projects = host.boards.projects();
  const open = {};
  for (const p of namedProjects(lines, projects)) try { open[p] = host.boards.open(p); } catch { /* no board yet */ }
  const text = fake ? cannedReply(projects) : await host.claude.turn({
    system: extractPrompt({ projects, open, now: new Date(session.startedAt) }), text: transcriptText(lines), model: settings.extractModel || 'sonnet' });
  fs.writeFileSync(path.join(dir, 'items.txt'), text);
  return { cards: parseCards(text, { projects, open, duration: duration(session, lines), lines }) };
}

// One frame of the video at secs into file: a fast seek first, then a slow one when that wrote
// nothing (a MediaRecorder WebM has no seek index). False when neither gave a frame.
async function grab(ffmpeg, video, secs, file) {
  for (const late of [false, true]) {
    try { await run(ffmpeg, ffmpegShotArgs(video, secs, file, late)); } catch (e) {
      if (/was not found/.test(e.message)) throw e;
    }
    if (size(file)) return true;
  }
  return false;
}

// Step screenshots: a PNG in shots/ for each second a card asked for; a card keeps the ones
// that came out. A fake run writes a canned picture.
export async function screenshotsStep(dir, settings, fake, session, host) {
  const shots = path.join(dir, 'shots'), video = videoFile(dir), made = new Map();
  fs.mkdirSync(shots, { recursive: true });
  const ffmpeg = expandEnv(settings.ffmpeg || 'ffmpeg', process.env);
  for (const c of session.cards || []) {
    for (const t of c.shotAt || []) {
      const file = path.join(shots, shotName(t));
      if (made.has(file)) continue;
      if (fake) fs.writeFileSync(file, Buffer.from(CANNED_PNG, 'base64'));
      made.set(file, fake || await grab(ffmpeg, video, t, file));
      if (!made.get(file)) host.log(`${session.id}: no frame at ${t}s`);
    }
  }
  const cards = (session.cards || []).map(c => ({ ...c, shots: [...new Set((c.shotAt || []).map(t => path.join(shots, shotName(t))))].filter(f => made.get(f)) }));
  return { cards };
}

export const STEP_RUN = { audio: audioStep, transcript: transcriptStep, items: itemsStep, screenshots: screenshotsStep };

// The fake run's Claude answer, for the canned transcript below: its two tasks go to the first
// two projects there are, so a smoke run passes on any PC (#1063).
const cannedReply = ([one = 'FocusShell', two = 'Habitly'] = []) => JSON.stringify({ cards: [
  { kind: 'task', project: one, title: 'Show the weekly change on the crypto widget', description: ['The Dashboard\'s crypto widget shows only the price.', 'Add the change over the last seven days beside it.', 'Done when each coin shows its weekly change in green or red.'], quote: 'the crypto widget should show the weekly change', at: 1.2, shots: [2, 5], due: null, mergeInto: null },
  { kind: 'task', project: two, title: 'Keep the workout timer running when the phone locks', description: ['The workout timer resets to zero when the phone locks.', 'It should keep counting and show the right time after unlocking.'], quote: 'the workout timer resets when the phone locks', at: 9.8, shots: [11], due: null, mergeInto: null },
  { kind: 'reminder', project: 'Me', title: 'Call the bank', description: ['Call the bank.'], quote: 'Remind me tomorrow at ten to call the bank', at: 16, shots: [16], due: '2026-10-17 10:00', mergeInto: null },
] });
const CANNED_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAIAAACwpMoFAAAACXBIWXMAAAABAAAAAQBPJcTWAAABJ0lEQVR4nO3csQ1BYRiGURK1HZQaqyjUZhGlYRRWsYAdTGAEfyT3ksc59V98yZO3ucVdbo+XBV2rbx/AtASOEzhO4DiB4wSOEzhO4DiB4wSOEzhuKPDtdJj6jpntz9dvnzATC44TOE7gOIHjBI4TOE7gOIHjBI4bCvw/3316LDhO4DiB4wSOEzhO4DiB44YCPx/3qe/gA+vN7u0bC44TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7gOIHjBI4TOE7guKHAI/8l5jdZcJzAcQLHCRwncJzAcQLHCRwncJzAcQLHvQBuvQpPO0GbrQAAAABJRU5ErkJggg==';

const CANNED = { transcription: [
  { offsets: { from: 1200, to: 6400 }, text: ' Okay, this is the FocusShell dashboard, and the crypto widget should show the weekly change.' },
  { offsets: { from: 6400, to: 7000 }, text: ' [BLANK_AUDIO]' },
  { offsets: { from: 9800, to: 15100 }, text: ' On the gym app the workout timer resets when the phone locks.' },
  { offsets: { from: 16000, to: 19500 }, text: ' Remind me tomorrow at ten to call the bank.' },
] };
