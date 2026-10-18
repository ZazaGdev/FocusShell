// Talk to the CTO from any app (#253): a system-wide shortcut starts Claude Code's own
// dictation in the main CTO's pane while FocusShell stays in the background. It is the same
// Space presses the in-app key sends. The shortcut is only taken while FocusShell's window
// is not focused, so inside the app the existing key handler keeps routing the voice
// (cards, the helper, the whiteboard, a group's CTO).
import { globalShortcut, BrowserWindow, screen } from 'electron';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { readyToSend } from './lib/talk.js';

// Letting go outside the app sends what was said (#415): Enter once the pane has gone quiet, so
// Claude Code's dictation has written the words into the prompt first. Inside the app the words
// wait for the owner to send them.
function sendWhenQuiet(s, done) {
  const releasedAt = Date.now();
  const t = setInterval(() => {
    if (!s.alive) { clearInterval(t); return; }
    if (!readyToSend({ now: Date.now(), releasedAt, lastOutput: s.lastOutput })) return;
    clearInterval(t);
    s.typedAt = s.total; s.used = true; s.pty.write('\r');
    if (done) done();
  }, 100);
}

export const TALK_KEY = 'Control+Shift+Space';
const CTO = 'cto';
const MAX_HOLD = 5 * 60 * 1000;

// A global shortcut reports the press but never the release, so one PowerShell stays open
// and, for each line it is sent, waits until Space is let go and answers "up".
const WATCH_PS = `Add-Type -Namespace FocusShell -Name KeyState -MemberDefinition '[DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);'
while ($null -ne [Console]::In.ReadLine()) {
  while ([FocusShell.KeyState]::GetAsyncKeyState(0x20) -band 0x8000) { Start-Sleep -Milliseconds 25 }
  [Console]::Out.WriteLine('up'); [Console]::Out.Flush()
}`;

// While the key is held outside FocusShell, a small pill at the bottom centre of the screen says
// it is listening (#415). It never takes focus and goes on release.
const PILL_W = 330, PILL_H = 44;
const PILL_HTML = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden;font:600 13px "Inter","Segoe UI",system-ui,sans-serif;user-select:none}
.p{position:absolute;inset:4px;display:flex;align-items:center;justify-content:center;gap:10px;border-radius:18px;background:#151517f2;color:#ededef;border:1px solid #9b9bf0}
.d{width:9px;height:9px;border-radius:50%;background:#e06c6c;animation:b 1s ease-in-out infinite alternate}
@keyframes b{from{opacity:.35}to{opacity:1}}
</style><div class="p"><span class="d"></span>Listening to the CTO... release to send</div>`;
let pill = null;
function showPill() {
  try {
    if (!pill || pill.isDestroyed()) {
      pill = new BrowserWindow({ width: PILL_W, height: PILL_H, frame: false, transparent: true, resizable: false, movable: false, focusable: false,
        skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: false, webPreferences: { sandbox: true, javascript: false } });
      pill.setAlwaysOnTop(true, 'screen-saver');
      pill.setIgnoreMouseEvents(true);
      pill.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PILL_HTML));
    }
    const a = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    pill.setBounds({ x: Math.round(a.x + (a.width - PILL_W) / 2), y: a.y + a.height - PILL_H - 24, width: PILL_W, height: PILL_H });
    pill.showInactive();
  } catch { /* the sign is a nicety; talking still works */ }
}
const hidePill = () => { try { if (pill && !pill.isDestroyed()) pill.hide(); } catch { /* gone */ } };

// d: { app, sessions, send, voiceMode }
export function registerGlobalTalk(d) {
  const { app, sessions, send, voiceMode } = d;
  let watcher = null, onUp = null, held = null, cap = null;
  function startWatcher() {
    if (watcher && watcher.exitCode === null) return watcher;
    watcher = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WATCH_PS, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    watcher.on('error', () => { watcher = null; });
    readline.createInterface({ input: watcher.stdout }).on('line', () => { const f = onUp; onUp = null; if (f) f(); });
    return watcher;
  }
  const space = () => {
    const s = sessions.get(CTO);
    if (!s || !s.alive) return false;
    s.typedAt = s.total; s.pty.write(' ');
    send('talk:global', CTO);
    return true;
  };
  function stop() { clearInterval(held); clearTimeout(cap); held = cap = null; onUp = null; hidePill(); }
  function pressed() {
    // Key repeat while the key is still down from this press is ignored.
    if (onUp) return;
    if (!space()) return;
    const w = startWatcher();
    // Hold mode needs Space repeating for as long as the key is down, as the mic button does.
    if (voiceMode() !== 'tap') { held = setInterval(space, 45); cap = setTimeout(stop, MAX_HOLD); showPill(); }
    // Hold mode: letting go sends it (#415). Tap mode's second press ends the dictation itself.
    onUp = () => {
      stop();
      const s = sessions.get(CTO);
      if (voiceMode() !== 'tap' && s && s.alive) sendWhenQuiet(s, () => send('talk:sent', CTO));
    };
    try { w.stdin.write('watch\n'); } catch { stop(); }
  }
  const take = () => { if (!globalShortcut.isRegistered(TALK_KEY)) { globalShortcut.register(TALK_KEY, pressed); startWatcher(); } };
  const give = () => { if (globalShortcut.isRegistered(TALK_KEY)) globalShortcut.unregister(TALK_KEY); };
  app.on('will-quit', () => { give(); stop(); if (watcher) try { watcher.kill(); } catch { /* gone */ } try { if (pill && !pill.isDestroyed()) pill.destroy(); } catch { /* gone */ } });
  // Call once the window exists.
  return function attach(win) {
    win.on('blur', take);
    win.on('focus', give);
    if (!win.isFocused()) take();
  };
}
