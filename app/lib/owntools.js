// Programs of the owner's own that this build knows (#317, #2562): file types that belong to
// such a program, so a click opens them there rather than in the Code pane, and where such a
// program already keeps a Whisper copy for the screen recorder. The public copy knows none and
// keeps its Whisper folder in its own app folder (tools/publish-leaveout.mjs sets that).
export const OWN_APP_FILES = [];
export const WHISPER_HOME = { win: '%APPDATA%\\FocusShell\\speech', mac: '~/Library/Application Support/FocusShell/speech' };
export const MAC_WHISPER_APPS = [];
