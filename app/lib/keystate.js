// The Mac key helper (native/keystate.swift, #2562): where it lives in the app, and what its
// first line means. No Node imports beyond path.
import path from 'node:path';

export const keystatePath = appDir => path.join(appDir, 'native', 'bin', 'keystate');

// macOS asks for this permission by name; the helper reads every key as up without it.
export const INPUT_MONITORING = 'FocusShell cannot read the keyboard outside its window. Turn on FocusShell in System Settings > Privacy & Security > Input Monitoring, then restart FocusShell.';
export const ACCESSIBILITY = 'FocusShell cannot start Dictation. Turn on FocusShell in System Settings > Privacy & Security > Accessibility, and Dictation in System Settings > Keyboard.';

// The helper's first line: { ok: true } or { ok: false, why }; null for any other line.
export function helloLine(line) {
  const s = String(line).trim();
  if (s === 'ok') return { ok: true };
  if (s === 'noperm') return { ok: false, why: INPUT_MONITORING };
  return null;
}
