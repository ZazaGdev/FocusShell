import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { choicesFor } from './choices.js';

test('recorder settings: dropdowns list what is on this PC and mark what would not work (#407)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-choices-')), w = path.join(tmp, 'speech'), bin = path.join(tmp, 'bin');
  fs.mkdirSync(path.join(w, 'models'), { recursive: true }); fs.mkdirSync(bin);
  for (const f of ['whisper-cli.exe', 'ggml-medium.en-q5_0.bin', 'models/ggml-small.en.bin', 'readme.txt', 'ffmpeg.exe']) fs.writeFileSync(path.join(w, f), '');
  fs.writeFileSync(path.join(bin, 'ffmpeg.exe'), '');
  const findCli = d => (fs.existsSync(path.join(d, 'whisper-cli.exe')) ? path.join(d, 'whisper-cli.exe') : null);
  const d = { env: { PATH: bin, PATHEXT: '.EXE' }, defaults: { whisperDir: path.join(tmp, 'nowhere') }, findCli };
  const s = { whisperDir: w, model: 'ggml-medium.en-q5_0.bin', ffmpeg: 'ffmpeg' };

  const dirs = choicesFor('whisperDir', s, d);
  assert.deepEqual(dirs.map(c => [c.value, c.ok]), [[w, true], [path.join(tmp, 'nowhere'), false]]);
  assert.match(dirs[1].label, /no whisper-cli\.exe here/);

  const models = choicesFor('model', s, d);
  assert.deepEqual(models.map(c => c.value).sort(), ['ggml-medium.en-q5_0.bin', path.join('models', 'ggml-small.en.bin')].sort());
  assert.match(choicesFor('model', { ...s, model: 'gone.bin' }, d)[0].label, /not in the Whisper folder/);

  const ff = choicesFor('ffmpeg', s, d);
  assert.deepEqual(ff.map(c => c.label), ['ffmpeg on the PATH', path.join(w, 'ffmpeg.exe')]);
  assert.equal(choicesFor('ffmpeg', s, { ...d, env: { PATH: '' } })[0].ok, false, 'ffmpeg missing from the PATH shows as not found');
  assert.equal(choicesFor('extractModel', s, d), null);
  fs.rmSync(tmp, { recursive: true, force: true });
});
