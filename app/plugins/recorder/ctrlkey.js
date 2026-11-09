// Hold Ctrl to draw (#1908): the overlay never has the keyboard while recording, so a small
// PowerShell loop reads Ctrl, and whether any other key is down with it, from Windows itself and
// prints a line each time that changes ("10": Ctrl alone, "11": Ctrl and another key, "00").
// It quits with the app, or when the recording ends.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keysLine } from './lib/ctrl.js';
import { keystatePath, helloLine } from '../../lib/keystate.js';
import { tellOnce } from '../../permission-note.js';

const SCRIPT = `
$k = Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern short GetAsyncKeyState(int k);' -Name Keys -Namespace FocusShellRec -PassThru
$skip = @(0x10, 0x11, 0x12, 0x5B, 0x5C) + (0xA0..0xA5)
$last = ''; $n = 0
while ($true) {
  $c = [int](($k::GetAsyncKeyState(0x11) -band 0x8000) -ne 0); $o = 0
  if ($c) { foreach ($v in 8..254) { if ($skip -contains $v) { continue }; if ($k::GetAsyncKeyState($v) -band 0x8000) { $o = 1; break } } }
  $s = "$c$o"
  if ($s -ne $last) { [Console]::Out.WriteLine($s); [Console]::Out.Flush(); $last = $s }
  if ((++$n % 60) -eq 0 -and -not (Get-Process -Id $env:FOCUSSHELL_PID -ErrorAction SilentlyContinue)) { exit }
  Start-Sleep -Milliseconds 30
}`;

// On a Mac the app's key helper does the same (#2562), and says first whether macOS lets it
// read the keyboard.
const WIN = process.platform === 'win32';
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// onKeys({ ctrl, other }) on every change. Returns stop().
export function watchCtrl(onKeys, log = () => {}) {
  let child, buf = '';
  try {
    child = WIN
      ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], { windowsHide: true, env: { ...process.env, FOCUSSHELL_PID: String(process.pid) } })
      : spawn(keystatePath(APP_DIR), ['ctrl']);
  } catch (e) { log(`Ctrl watcher: ${e.message}`); return () => {}; }
  child.on('error', e => log(`Ctrl watcher: ${e.message}`));
  child.stdout.on('data', d => {
    buf += d;
    const lines = buf.split(/\r?\n/); buf = lines.pop();
    for (const l of lines) {
      const hello = WIN ? null : helloLine(l);
      if (hello) { if (!hello.ok) { log(`Ctrl watcher: ${hello.why}`); tellOnce(hello.why); } continue; }
      const k = keysLine(l); if (k) onKeys(k);
    }
  });
  return () => { try { child.kill(); } catch { /* gone */ } };
}
