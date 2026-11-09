// The recorder's processing with the real programs (#2562), for the Mac runner: a short test
// video with speech goes through the audio and transcript steps (ffmpeg, whisper-cli) and a frame
// is grabbed from it. The cards need a signed-in Claude, which a runner has not, so they stay
// with the smoke run's canned ones.
//   node plugins/recorder/check-process.mjs <recording folder> <whisper model file> '<words to hear>'
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { audioStep, transcriptStep, whisperCli } from './process.js';
import { ffmpegShotArgs } from './lib/extract.js';
import { videoFile } from './store.js';

const [dir, model, words] = process.argv.slice(2);
const settings = { ffmpeg: 'ffmpeg', whisperDir: path.dirname(model), model: path.resolve(model) };
const fail = why => { console.error(`recorder check: ${why}`); process.exit(1); };
console.log(`recorder check: whisper-cli is ${whisperCli(settings.whisperDir) || '(not found)'}`);
const session = { id: 'check', mic: true, startedAt: Date.now() };
await audioStep(dir, settings, false, session, { log: console.log });
await transcriptStep(dir, settings, false, session);
const md = fs.readFileSync(path.join(dir, 'transcript.md'), 'utf8');
console.log(md);
if (!md.toLowerCase().includes(String(words).toLowerCase())) fail(`the transcript does not hold "${words}"`);
const shot = path.join(dir, 'frame.jpg');
execFileSync('ffmpeg', ffmpegShotArgs(videoFile(dir), 1, shot), { stdio: 'ignore' });
if (!fs.existsSync(shot) || !fs.statSync(shot).size) fail('no frame was grabbed');
console.log('recorder check: transcript and frame grab work');
