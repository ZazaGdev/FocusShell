// The Mac key helper (native/keystate.swift, #2562): where it lives in the app, and what its
// first line means. No Node imports beyond path.
import path from 'node:path';

export const keystatePath = appDir => path.join(appDir, 'native', 'bin', 'keystate');

// macOS asks for this permission by name; the helper reads every key as up without it.
export const INPUT_MONITORING = 'FocusShell cannot read the keyboard outside its window. Turn on FocusShell in System Settings > Privacy & Security > Input Monitoring, then restart FocusShell.';
export const ACCESSIBILITY = 'FocusShell cannot start Dictation. Turn on FocusShell in System Settings > Privacy & Security > Accessibility, and Dictation in System Settings > Keyboard.';

// The card mic's Dictation on a Mac: the Edit menu's item clicked through System Events, start
// only starting and stop only stopping, so a stop after Dictation ended by itself starts nothing.
export function dictateScript(pid, start) {
  const items = start ? ['Start Dictation…', 'Start Dictation...'] : ['Stop Dictation'];
  const tries = items.map((n, i) => `${i ? 'else if' : 'if'} exists menu item "${n}" then\n      click menu item "${n}"`).join('\n    ');
  return `tell application "System Events" to tell (first process whose unix id is ${Number(pid)})
  tell menu "Edit" of menu bar item "Edit" of menu bar 1
    ${tries}
    end if
  end tell
end tell`;
}

// The helper's first line: { ok: true } or { ok: false, why }; null for any other line.
export function helloLine(line) {
  const s = String(line).trim();
  if (s === 'ok') return { ok: true };
  if (s === 'noperm') return { ok: false, why: INPUT_MONITORING };
  return null;
}
