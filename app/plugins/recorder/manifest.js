// The screen recorder (#369): records an area of the screen marked on an overlay, Snipping Tool
// style (#376), and the mic if it is on, transcribes it with the local Whisper copy, turns what
// was said into cards with screenshots, and puts the accepted ones on the boards (and, if asked,
// tells the main CTO).
export default {
  id: 'recorder',
  name: 'Screen recorder',
  version: '0.4.0',
  api: 1,
  icon: 'camera', // before its name in the Plugins list (#1030)
  description: 'Records an area of the screen you mark and your voice, transcribes it with Whisper on this PC, and turns what you said into tasks, notes and reminders with screenshots.',
  // labels: what its button on the Plugins screen says in each state of the title bar button.
  button: { icon: 'dot', title: 'Record the screen', labels: { idle: 'Start recording', active: 'Stop recording', busy: 'Transcribing...', attention: 'Open the recording' } },
  shortcut: 'Control+Alt+R',
  uses: ['screen', 'mic', 'boards', 'claude', 'cto', 'sessions'],
  settings: [
    // listed: Settings shows a dropdown of what the main side's `choices` found (#407); pick adds
    // "Choose..." for another folder or file.
    { key: 'whisperDir', label: 'Whisper folder', help: 'Holds whisper-cli.exe (in a subfolder is fine) and the model files', type: 'path', default: '%APPDATA%\\editbay\\speech', listed: true, pick: 'folder' },
    { key: 'model', label: 'Whisper model', help: 'A model file found in the Whisper folder', type: 'text', default: 'ggml-medium.en-q5_0.bin', listed: true },
    { key: 'ffmpeg', label: 'ffmpeg', help: 'ffmpeg on the PATH, or an ffmpeg.exe', type: 'path', default: 'ffmpeg', listed: true, pick: 'file' },
    // #1030: old recordings go, video, sound, transcript and all; board items keep their screenshots.
    { key: 'deleteAfter', label: 'Delete recordings after', help: 'Board items keep their screenshots', type: 'choice', default: 'never', choices: ['never', '24 hours', 'a week', 'a month'] },
    { key: 'extractModel', label: 'Model for the cards', help: 'The Claude model that reads the transcript and writes the cards', type: 'choice', default: 'sonnet', choices: ['sonnet', 'opus', 'haiku'] },
  ],
};
