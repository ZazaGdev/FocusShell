// The recorder's transcript rules (#369): whisper.cpp's JSON to timed lines, the transcript
// Markdown, the recording folder's name, and the ffmpeg and whisper-cli arguments.

const NOISE = /^[[(][^\])]*[\])]$/; // [BLANK_AUDIO], (music) and the like

// whisper-cli -oj output to [{ at, end, text }] in seconds, spoken lines only.
export function parseWhisper(j) {
  const segs = j && Array.isArray(j.transcription) ? j.transcription : [];
  return segs.map(x => ({
    at: Number(x && x.offsets && x.offsets.from) / 1000,
    end: Number(x && x.offsets && x.offsets.to) / 1000,
    text: String((x && x.text) || '').trim(),
  })).filter(l => l.text && !NOISE.test(l.text) && Number.isFinite(l.at));
}

const two = n => String(n).padStart(2, '0');

// Seconds as mm:ss, or h:mm:ss past an hour.
export function clock(secs) {
  const t = Math.max(0, Math.floor(secs)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

// The transcript file: a title, the video's path, then one [mm:ss] line each.
export function transcriptMd(lines, { title, video }) {
  const body = lines.length ? lines.map(l => `[${clock(l.at)}] ${l.text}`).join('\n') : 'Nothing was said.';
  return `# ${title}\n\nVideo: ${video}\n\n${body}\n`;
}

// A recording's folder name from the local time it started: 2026-10-16-0930.
export function folderName(d) {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
}

// %VAR% in a settings path, from env; a variable env does not have stays as written.
export function expandEnv(p, env) {
  const keys = Object.keys(env || {});
  return String(p || '').replace(/%([^%]+)%/g, (all, name) => {
    const k = keys.find(x => x.toLowerCase() === name.toLowerCase());
    return k ? env[k] : all;
  });
}

// ffmpeg: the recording's sound as the 16 kHz mono wav whisper reads.
export const ffmpegAudioArgs = (video, wav) => ['-v', 'error', '-y', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav];

// ffmpeg: the same WebM copied stream for stream, which writes the length and the seek index a
// MediaRecorder file lacks, so a player can drag to any moment (#1017).
export const ffmpegRemuxArgs = (video, out) => ['-v', 'error', '-y', '-i', video, '-map', '0', '-c', 'copy', out];

// whisper-cli: English, timed JSON written to <out>.json, nothing printed.
export const whisperArgs = ({ model, wav, out, threads }) => ['-m', model, '-f', wav, '-l', 'en', '-t', String(threads), '-oj', '-of', out, '-np'];
