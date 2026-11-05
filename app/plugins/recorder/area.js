// The recorder's overlay windows (#376), Snipping Tool style: the pick windows dim every display
// (#1481) and let the owner drag the area, toggle the mic and press Record; while
// recording a border marks the area and a small bar shows the time and Stop, with the drawing
// tools and Clear on a row of their own (#1021).
// Those are left out of the screen capture (content protection), so none of them ends up in the
// video. The drawing layer over the area (#380) is the one window that is recorded: with the pen
// off it lets every click through to the apps underneath, with it on the mouse draws.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, ipcMain, screen, globalShortcut } from 'electron';
import { bigEnough, onDesktop, borderBounds, barSpot } from './lib/area.js';
import { ctrlHold } from './lib/ctrl.js';
import { watchCtrl } from './ctrlkey.js';
import { guardWindow } from '../../window-guard.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'area');
const BAR = { width: 300, height: 80 };
const TOOLS = ['pen', 'rect', 'circle', 'arrow'];
export const PEN_KEY = 'Control+Alt+D';
// Clear's shortcut (#1908): no common app uses Ctrl+Alt+Backspace on Windows.
export const CLEAR_KEY = 'Control+Alt+Backspace';

// quiet: the windows open but stay invisible and never take focus (the smoke run's real check,
// so the owner's screen is not dimmed while they work); the drawing layer still shows, since it
// is what gets recorded. keys: the pen's and Clear's shortcuts may be taken, and Ctrl held on its
// own draws, while recording. watch: what reads Ctrl (a stand-in in a test).
export function areaWindows({ log, quiet = false, keys = true, watch = watchCtrl }) {
  const wins = new Map(); // webContents id: { win, kind, init, onSend }
  let pick = null /* the overlay's windows, one per display */, rec = [], draw = null, bar = null, pen = false, tool = 'pen', penOwned = false, disposed = false;
  let clearOwned = false, stopCtrl = () => {}, hold = null, armed = false, byCtrl = null; // byCtrl: the tool before Ctrl turned the pen on

  const open = (kind, bounds, init, onSend, o = {}) => {
    const win = new BrowserWindow({
      ...bounds, frame: false, transparent: true, resizable: false, movable: o.movable === true, minimizable: false, maximizable: false,
      skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false, focusable: o.focusable !== false, backgroundColor: '#00000000',
      webPreferences: { preload: path.join(DIR, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    guardWindow(win);
    win.setAlwaysOnTop(true, 'screen-saver');
    if (o.recorded !== true) win.setContentProtection(true);
    if (o.clickThrough) win.setIgnoreMouseEvents(true);
    const id = win.webContents.id;
    wins.set(id, { win, kind, init, onSend });
    win.on('closed', () => { const w = wins.get(id); wins.delete(id); if (w && w.onClosed) w.onClosed(); });
    win.loadFile(path.join(DIR, `${kind}.html`));
    if (quiet && o.recorded !== true) win.setOpacity(0);
    win.once('ready-to-show', () => { if (quiet || o.focusable === false || o.quietFocus) win.showInactive(); else { win.show(); win.focus(); } });
    return win;
  };

  const onInit = e => (wins.get(e.sender.id) || {}).init || null;
  const onMsg = (e, what, data) => { const w = wins.get(e.sender.id); if (w && w.onSend) w.onSend(what, data); };
  ipcMain.handle('recorder:win-init', onInit);
  ipcMain.on('recorder:win', onMsg);

  // Opens the overlay on every display (#1481), so the area can be marked on any of them; the one
  // under the mouse takes the focus. A drag on one clears the area marked on another. Resolves
  // { display, rect, mic } (rect in that display's DIP) on Record, or null on Cancel, Esc or a
  // window closing. auto: { rect, mic, display? } answers by itself a moment after the overlay
  // shows, on the display with that id or else the one under the mouse (the smoke run's real
  // check, which cannot drag a mouse).
  function pickArea({ mic, auto = null }) {
    if (disposed) return Promise.resolve(null);
    const under = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const all = screen.getAllDisplays();
    const displays = [under, ...all.filter(d => d.id !== under.id)];
    return new Promise(resolve => {
      let answered = false;
      const closeAll = () => { for (const w of pick || []) if (!w.isDestroyed()) w.close(); };
      const end = v => { if (answered) return; answered = true; closeAll(); pick = null; resolve(v); };
      pick = displays.map((d, i) => {
        const win = open('pick', d.bounds, { mic }, (what, data) => {
          if (what === 'drag') { for (const w of pick || []) if (w !== win) tellWin(w, { clear: true }); return; }
          if (what === 'mic') { for (const w of pick || []) if (w !== win) tellWin(w, { mic: data !== false }); return; }
          if (what === 'record') {
            if (!data || !bigEnough(data.rect)) return;
            end({ display: d, rect: data.rect, mic: data.mic !== false });
          } else end(null);
        }, { quietFocus: i > 0 });
        wins.get(win.webContents.id).onClosed = () => end(null);
        return win;
      });
      if (auto) {
        const at = Math.max(0, displays.findIndex(d => String(d.id) === String(auto.display)));
        pick[at].once('ready-to-show', () => setTimeout(() => wins.get(pick[at].webContents.id)?.onSend('record', auto), 1500));
      }
    });
  }

  // The overlay is open: the shortcut or the dot pressed again closes it, as Esc would.
  const picking = () => !!pick;
  const cancelPick = () => { for (const w of pick || []) if (!w.isDestroyed()) w.close(); };

  // Tells the drawing layer and the bar something: the pen's state, a clear, a stroke.
  const tellWin = (w, s) => { if (w && !w.isDestroyed()) w.webContents.send('recorder:win-state', s); };

  // Drawing on or off: on, the drawing layer takes the mouse; off, clicks go through it.
  function setPen(on) {
    if (!draw || draw.isDestroyed()) return;
    pen = !!on;
    draw.setIgnoreMouseEvents(!pen);
    tellWin(draw, { pen, tool });
    tellWin(bar, { pen, tool });
  }
  // A tool picked on the bar (#1022): drawing turns on with it; the lit one again turns it off.
  function pickTool(t) {
    if (!TOOLS.includes(t)) return;
    byCtrl = null; // a button while Ctrl is held takes over: letting Ctrl go leaves it as picked
    if (pen && tool === t) return setPen(false);
    tool = t;
    setPen(true);
  }
  const clear = () => tellWin(draw, { clear: true });
  // Ctrl held on its own draws with the pen; let go, the pen goes back to how it was, and the
  // lines stay until Clear (#1908). Already on (its button, Ctrl+Alt+D), a hold changes nothing.
  function onKeys(k) {
    const r = ctrlHold(hold, k);
    hold = r.state;
    if (r.pen && !armed) {
      armed = true;
      if (!pen) { byCtrl = { tool }; tool = 'pen'; setPen(true); }
    } else if (!r.pen && armed) {
      armed = false;
      if (byCtrl) { tool = byCtrl.tool; byCtrl = null; setPen(false); }
    }
  }

  // The drawing layer, the border and the floating bar for a recording of rect (DIP) on display
  // d. The bar opens last, so it stays above the drawing layer.
  function showRecording({ display, rect, mic, startedAt, onStop }) {
    closeRecording();
    if (disposed) return; // switched off meanwhile: nothing would ever close these
    const r = onDesktop(rect, display.bounds);
    const spot = barSpot(r, display.workArea, BAR);
    pen = false; tool = 'pen';
    draw = open('draw', r, {}, null, { focusable: false, clickThrough: true, recorded: true });
    bar = open('bar', { ...spot, ...BAR }, { startedAt, mic, penKey: keys ? PEN_KEY : '', clearKey: keys ? CLEAR_KEY : '', holdCtrl: keys }, (what, data) => {
      if (what === 'stop') onStop();
      else if (what === 'tool') pickTool(data);
      else if (what === 'clear') clear();
    }, { focusable: false, movable: true });
    rec = [draw, open('border', borderBounds(r), {}, null, { focusable: false, clickThrough: true }), bar];
    if (keys) {
      try { penOwned = globalShortcut.register(PEN_KEY, () => setPen(!pen)); } catch (e) { log(`${PEN_KEY}: ${e.message}`); }
      if (!penOwned) log(`${PEN_KEY} is taken, so only the Pen button turns drawing on`);
      try { clearOwned = globalShortcut.register(CLEAR_KEY, clear); } catch (e) { log(`${CLEAR_KEY}: ${e.message}`); }
      if (!clearOwned) log(`${CLEAR_KEY} is taken, so only the Clear button clears`);
      stopCtrl = watch(onKeys, log);
    }
  }

  function closeRecording() {
    // Only a key this took is given back: the owner may use the same one elsewhere.
    if (penOwned) try { globalShortcut.unregister(PEN_KEY); } catch { /* gone */ }
    if (clearOwned) try { globalShortcut.unregister(CLEAR_KEY); } catch { /* gone */ }
    penOwned = clearOwned = false;
    stopCtrl(); stopCtrl = () => {};
    hold = null; armed = false; byCtrl = null;
    for (const w of rec) try { if (!w.isDestroyed()) w.close(); } catch (e) { log(`close: ${e.message}`); }
    rec = [];
    draw = bar = null;
    pen = false; tool = 'pen';
  }

  // The smoke run's real check cannot move a mouse: it turns the pen on, draws an outline round
  // the middle of the area with the same stroke a drag makes, and turns the pen off.
  function drawTest() {
    if (!draw || draw.isDestroyed()) return false;
    setPen(true);
    const [w, h] = draw.getContentSize(), pts = [];
    for (let i = 0; i <= 48; i++) { const a = (i / 48) * 2 * Math.PI; pts.push({ x: w / 2 + Math.cos(a) * w / 4, y: h / 2 + Math.sin(a) * h / 4 }); }
    tellWin(draw, { stroke: pts });
    setPen(false);
    return true;
  }

  // The kinds of overlay window open now, for the smoke run.
  const openKinds = () => [...wins.values()].map(w => w.kind);
  const owns = win => [...wins.values()].some(w => w.win === win);

  return {
    pickArea, picking, cancelPick, showRecording, closeRecording, openKinds, owns, drawTest, penOn: () => pen,
    voice: state => tellWin(bar, { voice: state }),
    dispose() {
      disposed = true;
      closeRecording();
      for (const { win } of wins.values()) try { win.destroy(); } catch { /* gone */ }
      ipcMain.removeHandler('recorder:win-init');
      ipcMain.removeListener('recorder:win', onMsg);
    },
  };
}
