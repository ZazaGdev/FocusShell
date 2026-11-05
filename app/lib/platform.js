// Which system FocusShell runs on (#2562), the same answer in the main process and the page.
// The page has no process object, so it asks the browser.
export const MAC = typeof process !== 'undefined' && process && process.platform
  ? process.platform === 'darwin'
  : typeof navigator !== 'undefined' && /^Mac/i.test(navigator.platform || '');

// An absolute file path FocusShell may open: a drive path on Windows ("D:\x", "D:/x"); on a
// Mac a path from the root or the home folder ("/Users/x", "~/x").
export const isAbsPath = (p, mac = MAC) => (mac ? /^(?:\/|~\/)/ : /^[A-Za-z]:[\\/]/).test(String(p || ''));

// "~/x" as a full path under home; anything else as it is.
export const expandHome = (p, home) => (/^~\//.test(String(p)) ? `${String(home).replace(/\/+$/, '')}/${String(p).slice(2)}` : String(p));

// The app's own shortcuts use Cmd on a Mac and Ctrl elsewhere; keys typed into a pane keep
// Ctrl everywhere, so Ctrl+C still reaches Claude Code (#2562).
export const MOD_PROP = MAC ? 'metaKey' : 'ctrlKey';
export const MOD_NAME = MAC ? 'Cmd' : 'Ctrl';
// The shortcut key alone held (not the other of Ctrl and Cmd).
export const modKey = (e, mac = MAC) => (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);

// What types the owner's voice into a box: Windows voice typing, or macOS Dictation.
export const VOICE_NAME = MAC ? 'Dictation' : 'Windows voice typing';

// Paths written in text on a Mac start at one of these folders (or the home folder), so a
// slash command such as "/compact" or "and/or" is never read as a path.
export const MAC_ROOTS = 'Users|Volumes|Applications|private|tmp|opt|var|home|Library|System|usr|etc';
export const MAC_PATH = `(?<![\\w.:/~-])(?:~|/(?:${MAC_ROOTS}))/[^\\s"'<>|*?\`]+`;
