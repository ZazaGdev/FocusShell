import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, newSession, next, buttonFor, pickCurrent } from './session.js';
import { parseWhisper, clock, transcriptMd, folderName, expandEnv, ffmpegAudioArgs, ffmpegRemuxArgs, whisperArgs } from './transcript.js';
import { rectOf, bigEnough, cropFor, onDesktop, borderBounds, barSpot } from './area.js';

const T0 = 1_000_000;
const rec = () => newSession('2026-10-16-0930', T0);

test('recorder: a new session is recording', () => {
  const s = rec();
  assert.equal(s.state, 'recording');
  assert.equal(s.startedAt, T0);
  assert.deepEqual(s.done, []);
});

test('recorder: stop, each step, then review', () => {
  let s = next(rec(), { type: 'stop', at: T0 + 5000 });
  assert.equal(s.state, 'processing');
  assert.equal(s.step, STEPS[0]);
  assert.equal(s.stoppedAt, T0 + 5000);
  for (const step of STEPS) s = next(s, { type: 'stepDone', step });
  assert.equal(s.state, 'review');
  assert.equal(s.step, null);
  assert.deepEqual(s.done, STEPS);
});

test('recorder: a step done out of turn changes nothing', () => {
  const s = next(rec(), { type: 'stop', at: T0 });
  assert.equal(next(s, { type: 'stepDone', step: 'nope' }), s);
});

test('recorder: a failed step, then retry from it', () => {
  let s = next(rec(), { type: 'stop', at: T0 });
  s = next(s, { type: 'stepDone', step: STEPS[0] });
  s = next(s, { type: 'stepFailed', step: STEPS[1], error: 'whisper is missing' });
  assert.equal(s.state, 'failed');
  assert.deepEqual([s.step, s.error], [STEPS[1], 'whisper is missing']);
  s = next(s, { type: 'retry' });
  assert.equal(s.state, 'processing');
  assert.equal(s.step, STEPS[1]);
  assert.equal(s.error, null);
});

test('recorder: discard from recording, review and failed; done from review', () => {
  assert.equal(next(rec(), { type: 'discard' }).state, 'discarded');
  let r = next(rec(), { type: 'stop', at: T0 });
  for (const step of STEPS) r = next(r, { type: 'stepDone', step });
  assert.equal(next(r, { type: 'discard' }).state, 'discarded');
  assert.equal(next(r, { type: 'done' }).state, 'done');
  const f = next(next(rec(), { type: 'stop', at: T0 }), { type: 'stepFailed', step: STEPS[0], error: 'x' });
  assert.equal(next(f, { type: 'discard' }).state, 'discarded');
});

test('recorder: events that do not fit the state leave it as is', () => {
  const s = rec();
  for (const type of ['retry', 'done', 'stepDone', 'stepFailed', 'nonsense']) assert.equal(next(s, { type }), s, type);
  const d = next(s, { type: 'discard' });
  assert.equal(next(d, { type: 'stop', at: T0 }), d);
  assert.equal(next(s, null), s);
});

test('recorder: resume stops a recording left open and keeps processing', () => {
  const r = next(rec(), { type: 'resume', at: T0 + 9000 });
  assert.equal(r.state, 'processing');
  assert.equal(r.stoppedAt, T0 + 9000);
  const p = next(rec(), { type: 'stop', at: T0 });
  assert.equal(next(p, { type: 'resume', at: T0 }), p);
});

test('recorder: buttonFor each state', () => {
  assert.deepEqual(buttonFor(null, T0), { state: 'idle', label: '' });
  assert.deepEqual(buttonFor(rec(), T0 + 83_400), { state: 'active', label: '1:23' });
  const p = next(rec(), { type: 'stop', at: T0 });
  assert.equal(buttonFor(p, T0).state, 'busy');
  const f = next(p, { type: 'stepFailed', step: STEPS[0], error: 'x' });
  assert.deepEqual(buttonFor(f, T0), { state: 'attention', label: '!' });
  let r = p;
  for (const step of STEPS) r = next(r, { type: 'stepDone', step });
  assert.equal(buttonFor(r, T0).state, 'attention');
  assert.equal(buttonFor(next(r, { type: 'done' }), T0).state, 'idle');
});

test('recorder: pickCurrent is the newest open session', () => {
  const a = { ...rec(), id: 'a', startedAt: 1 }, b = { ...rec(), id: 'b', startedAt: 3, state: 'done' }, c = { ...rec(), id: 'c', startedAt: 2, state: 'review' };
  assert.equal(pickCurrent([a, b, c]).id, 'c');
  assert.equal(pickCurrent([b]), null);
  assert.equal(pickCurrent([]), null);
});

test('recorder: parseWhisper gives timed lines, drops blanks', () => {
  const j = { transcription: [
    { offsets: { from: 0, to: 2500 }, text: ' Okay, so this is the dashboard.' },
    { offsets: { from: 2500, to: 4000 }, text: ' [BLANK_AUDIO]' },
    { offsets: { from: 4000, to: 8200 }, text: '   ' },
    { offsets: { from: 8200, to: 9900 }, text: ' Add a task.' },
  ] };
  assert.deepEqual(parseWhisper(j), [{ at: 0, end: 2.5, text: 'Okay, so this is the dashboard.' }, { at: 8.2, end: 9.9, text: 'Add a task.' }]);
  assert.deepEqual(parseWhisper(null), []);
  assert.deepEqual(parseWhisper({ transcription: 'x' }), []);
});

test('recorder: clock', () => {
  assert.equal(clock(0), '00:00');
  assert.equal(clock(83.9), '01:23');
  assert.equal(clock(3725), '1:02:05');
});

test('recorder: transcriptMd', () => {
  const md = transcriptMd([{ at: 3, end: 5, text: 'Hello.' }, { at: 83, end: 90, text: 'A task.' }], { title: 'Recording 2026-10-16 09:30', video: 'D:\\r\\video.webm' });
  assert.equal(md, '# Recording 2026-10-16 09:30\n\nVideo: D:\\r\\video.webm\n\n[00:03] Hello.\n[01:23] A task.\n');
  assert.match(transcriptMd([], { title: 'R', video: 'v' }), /Nothing was said\.\n$/);
});

test('recorder: folderName from a local date', () => {
  assert.equal(folderName(new Date(2026, 9, 16, 9, 30)), '2026-10-16-0930');
});

test('recorder: expandEnv', () => {
  assert.equal(expandEnv('%APPDATA%\\editbay\\speech', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }), 'C:\\Users\\a\\AppData\\Roaming\\editbay\\speech');
  assert.equal(expandEnv('%NOPE%\\x', {}), '%NOPE%\\x');
  assert.equal(expandEnv('%appdata%', { APPDATA: 'R' }), 'R');
});

test('recorder: a drag gives the area whichever way it went, and a click is no area (#376)', () => {
  assert.deepEqual(rectOf({ x: 300, y: 200 }, { x: 100.4, y: 50 }), { x: 100, y: 50, width: 200, height: 150 });
  assert.equal(bigEnough({ x: 0, y: 0, width: 31, height: 200 }), false);
  assert.equal(bigEnough({ x: 0, y: 0, width: 32, height: 32 }), true);
  assert.equal(bigEnough(null), false);
});

test('recorder: the crop is in the display\'s pixels, even, and inside it (#376)', () => {
  const full = { width: 3840, height: 2160 };
  assert.deepEqual(cropFor({ x: 101, y: 51, width: 401, height: 301 }, 1.5, full), { x: 150, y: 76, width: 600, height: 450 });
  assert.deepEqual(cropFor({ x: 2500, y: 1400, width: 500, height: 500 }, 1.5, full), { x: 3750, y: 2100, width: 90, height: 60 });
  assert.deepEqual(cropFor({ x: 0, y: 0, width: 1920, height: 1080 }, 2, full), { x: 0, y: 0, width: 3840, height: 2160 });
});

test('recorder: the border sits outside the area and the bar above it, else below, else inside (#376)', () => {
  const d = { x: 1920, y: 0, width: 1920, height: 1040 }, bar = { width: 236, height: 40 };
  const r = onDesktop({ x: 100, y: 200, width: 400, height: 300 }, d);
  assert.deepEqual(r, { x: 2020, y: 200, width: 400, height: 300 });
  assert.deepEqual(borderBounds(r), { x: 2017, y: 197, width: 406, height: 306 });
  assert.deepEqual(barSpot(r, d, bar), { x: 2102, y: 152 });
  assert.deepEqual(barSpot({ x: 1920, y: 10, width: 400, height: 300 }, d, bar), { x: 2002, y: 318 });
  assert.deepEqual(barSpot({ x: 3700, y: 0, width: 140, height: 1040 }, d, bar), { x: 3604, y: 8 });
});

test('recorder: ffmpeg and whisper arguments', () => {
  assert.deepEqual(ffmpegAudioArgs('v.webm', 'a.wav'), ['-v', 'error', '-y', '-i', 'v.webm', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', 'a.wav']);
  assert.deepEqual(ffmpegRemuxArgs('v.webm', 'v.seek.webm'), ['-v', 'error', '-y', '-i', 'v.webm', '-map', '0', '-c', 'copy', 'v.seek.webm']);
  assert.deepEqual(whisperArgs({ model: 'm.bin', wav: 'a.wav', out: 'D:\\r\\transcript', threads: 8 }),
    ['-m', 'm.bin', '-f', 'a.wav', '-l', 'en', '-t', '8', '-oj', '-of', 'D:\\r\\transcript', '-np']);
});
