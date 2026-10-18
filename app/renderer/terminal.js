// One xterm per session, created once and kept alive while its tab is hidden,
// so switching tabs or layouts never loses a session's screen.
import { Terminal } from '../node_modules/@xterm/xterm/lib/xterm.mjs';
import { FitAddon } from '../node_modules/@xterm/addon-fit/lib/addon-fit.mjs';
import { findLinks, stretchCandidates, dropText, findBareNames, folderHints, continuesRow, joinRows, crossedCuts, joinReadings, spacedReadings, wrappedUrl, opensInExplorer } from '../lib/links.js';
import { h, icon } from './dom.js';
import { paintLinks } from './linkpaint.js';
import { findBar } from './findbar.js';

const THEME = {
  background: '#0b0b0c', foreground: '#d6d6db', cursor: '#9b9bf0', cursorAccent: '#0b0b0c',
  selectionBackground: '#2c2c4a',
  black: '#1b1b1e', red: '#e06c6c', green: '#5fb88a', yellow: '#d9a54a', blue: '#7f9cf0', magenta: '#b48ef0', cyan: '#5eb3c7', white: '#d6d6db',
  brightBlack: '#6e6e76', brightRed: '#ef8a8a', brightGreen: '#7fcfa3', brightYellow: '#e6bd6a', brightBlue: '#9db5f5', brightMagenta: '#c7a8f5', brightCyan: '#86c9d8', brightWhite: '#ffffff',
};

// Windows paths and web links in terminal output become clickable. A path can wrap
// across rows, so a link is searched in the whole wrapped line, then mapped back to cells.

// Claude Code also breaks long lines into new rows itself: up to MAX_JOINS such rows on
// each side are joined on, and a link across them counts only if its path exists on disk
// or its web link looks complete (#165).
const MAX_JOINS = 4;
function unitAt(buf, r) {
  let s = r, e = r;
  while (s > 0 && buf.getLine(s) && buf.getLine(s).isWrapped) s--;
  while (buf.getLine(e + 1) && buf.getLine(e + 1).isWrapped) e++;
  return [s, e];
}
const rowText = (buf, r) => buf.getLine(r).translateToString(false);

function linkProvider(term, id) {
  return {
    provideLinks(y, cb) {
      const buf = term.buffer.active, cols = term.cols;
      if (!buf.getLine(y - 1)) { cb(undefined); return; }
      const here = unitAt(buf, y - 1), units = [here];
      for (let k = 0; k < MAX_JOINS && units[0][0] > 0; k++) {
        const prev = unitAt(buf, units[0][0] - 1);
        if (!continuesRow(rowText(buf, prev[1]), rowText(buf, units[0][0]))) break;
        units.unshift(prev);
      }
      for (let k = 0; k < MAX_JOINS && buf.getLine(units[units.length - 1][1] + 1); k++) {
        const last = units[units.length - 1], next = unitAt(buf, last[1] + 1);
        if (!continuesRow(rowText(buf, last[1]), rowText(buf, next[0]))) break;
        units.push(next);
      }
      const { text, pos, cuts } = joinRows(units.map(([s, e]) => ({ y: s + 1, rows: Array.from({ length: e - s + 1 }, (_, r) => rowText(buf, s + r)) })));
      // Links within the hovered row's own line, as before, then any that run across a join.
      const k = units.indexOf(here), from = k > 0 ? cuts[k - 1] : 0, to = k < cuts.length ? cuts[k] : text.length;
      const own = text.slice(from, to);
      stretched(own).then(found => withBareNames(buf, id, own, here[1] + 1, found))
        .then(async found => {
          const local = found.map(l => ({ ...l, index: l.index + from }));
          const joined = await acrossJoins(text, pos, cuts, cols, from, to);
          return [...joined, ...local.filter(l => !joined.some(j => l.index < j.index + j.text.length && l.index + l.text.length > j.index))];
        }).then(found => {
      const links = [];
      for (const { index: a, text: s, code, target } of found) {
        const range = { start: pos[a], end: pos[a + s.length - 1] };
        if (!range.start || !range.end || range.start.y > y || range.end.y < y) continue;
        links.push({ range, text: s, target, decorations: { underline: true, pointerCursor: true },
          activate: async () => {
            const p = target || s, file = onFile && !/^https?:/i.test(p) && !opensInExplorer(p) ? await window.deck.fileAt(p) : null;
            window.deck.linkOpened(id, p); // a result opened is not missed (#367)
            const ok = await (file ? onFile(id, file) : code ? window.deck.openInCode(null, s) : window.deck.openPath(p));
            if (!ok && onLinkFail) onLinkFail(p);
          } });
      }
      cb(links.length ? links : undefined);
      }, () => cb(undefined));
    },
  };
}

// A path with spaces is one link only as far as the longer path exists on disk, so a
// following word is never swallowed. Links inside a stretched one are dropped.
async function stretched(text) {
  const out = [];
  for (const l of findLinks(text)) {
    const prev = out[out.length - 1];
    if (prev && l.index < prev.index + prev.text.length) continue;
    const cands = stretchCandidates(text, l);
    const best = cands.length ? await window.deck.longestPath(cands) : null;
    out.push(best ? { ...l, text: best } : l);
  }
  return out;
}

// Links in the joined rows that cross a join and touch the hovered line [from, to): a path
// keeps its longest reading that exists on disk, a web link needs full rows before each join.
async function acrossJoins(text, pos, cuts, cols, from, to) {
  const out = [];
  for (const l of findLinks(text)) {
    if (!crossedCuts(l, cuts).length || l.index >= to || l.index + l.text.length <= from) continue;
    if (/^https?:/i.test(l.text)) { const u = wrappedUrl(l, cuts, pos, cols, undefined, text); if (u) out.push(u); continue; }
    // Each reading as it is on screen (text) and the path it names (target): the same, or
    // with a space put back where Claude Code broke the line at one (#350).
    const plain = [...joinReadings(l, cuts), ...stretchCandidates(text, l)];
    const readings = [...plain.map(t => ({ text: t, target: t })), ...plain.flatMap(t => spacedReadings(t, l, cuts))]
      .sort((a, b) => a.target.length - b.target.length);
    const best = await window.deck.longestPath(readings.map(r => r.target));
    const r = best && readings.find(x => x.target === best);
    if (r && crossedCuts({ index: l.index, text: r.text }, cuts).length) out.push(r.text === r.target ? { ...l, text: r.text } : { ...l, text: r.text, target: r.target });
  }
  return out;
}

// A bare file name links when the app finds exactly one such file in the pane's folder or
// a folder named in the last few hundred rows of output up to this line.
const NEARBY_ROWS = 300;
async function withBareNames(buf, id, text, end, found) {
  const names = findBareNames(text, found);
  if (!names.length) return found;
  const rows = [];
  for (let r = Math.max(0, end - NEARBY_ROWS); r < end; r++) { const l = buf.getLine(r); if (l) rows.push(l.translateToString(true)); }
  const paths = await window.deck.resolveNames(id, names.map(n => n.text), folderHints(rows));
  const extra = names.map((n, k) => (paths[k] ? { index: n.index, text: n.text, target: paths[k] } : null)).filter(Boolean);
  return [...found, ...extra];
}

// A file dropped anywhere else must not navigate the window away to that file.
for (const ev of ['dragover', 'drop']) document.addEventListener(ev, e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });

// The clipboard into a pane's prompt (#352): text as a paste, an image through Claude Code's
// image paste (Alt+V on Windows).
function pasteClipboard(id, t) {
  const c = window.deck.clipboardKind();
  if (c.kind === 'text') t.term.paste(c.text);
  else if (c.kind === 'image') window.deck.write(id, '\x1bv');
}

let onLinkFail = null;
export function setLinkFailHandler(fn) { onLinkFail = fn; }
// Any file opens in the built-in Code pane (#69, #126), never the VS Code app:
// onFile(session id, path) -> true if opened. Folders and web links open as before.
let onFile = null;
export function setFileOpener(fn) { onFile = fn; }

const terms = new Map(); // id -> { term, fit, host, opened, pending, exited }
let keyFilter = () => true;

export function setKeyFilter(fn) { keyFilter = fn; }

function entry(id) {
  let t = terms.get(id);
  if (t) return t;
  const term = new Terminal({
    fontFamily: '"JetBrains Mono","Cascadia Mono",Consolas,monospace', fontSize: 13, lineHeight: 1.15,
    cursorBlink: true, scrollback: 8000, theme: THEME, allowTransparency: true, macOptionIsMeta: false, allowProposedApi: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const links = linkProvider(term, id);
  term.registerLinkProvider(links);
  // Ctrl+V pastes the clipboard the way Windows Terminal does (#352): xterm alone sends a raw
  // Ctrl+V, which Claude Code only reads as an image paste. Text goes in as a paste; an image
  // as Claude Code's image paste (Alt+V on Windows), so it attaches as [Image #n].
  // Ctrl+Shift+F finds in the pane (#360); Ctrl+F stays with Claude Code and the shell.
  let find = null;
  term.attachCustomKeyEventHandler(e => {
    if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyF') {
      if (e.type === 'keydown') { e.preventDefault(); find.open(); }
      return false;
    }
    if (e.type === 'keydown' && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && /^v$/i.test(e.key)) {
      const c = window.deck.clipboardKind();
      if (c.kind !== 'none') { e.preventDefault(); if (c.kind === 'text') term.paste(c.text); else window.deck.write(id, '\x1bv'); return false; }
    }
    return keyFilter(e, id);
  });
  term.onData(d => {
    // While a redraw moves a held pane (#361), its focus-out and focus-in reports stay here,
    // so Claude Code never sees the pane lose focus and keeps recording.
    const held = terms.get(id) && terms.get(id).held;
    if (held && (d === '\x1b[O' || d === '\x1b[I')) { held.out = d === '\x1b[O'; return; }
    if (d === '\x1b[O') focusOuts.set(id, (focusOuts.get(id) || 0) + 1);
    if (d === '\r') notePrompt(id); typed(id, d); window.deck.write(id, d);
  });
  const host = document.createElement('div');
  host.className = 'termhost';
  host.dataset.pane = id; // the focus log (#1003) names panes by it
  // Files and folders dropped from Explorer type their full paths at the prompt.
  // While files are over the pane it shows a drop target (#216); entering and leaving
  // xterm's child elements is counted so it does not flicker.
  const isFiles = e => e.dataTransfer?.types.includes('Files');
  let over = 0;
  host.append(h('div', { class: 'dropzone', 'aria-hidden': 'true' }, h('div', { class: 'dzlabel' }, icon('download'), 'Drop to paste file paths')));
  find = findBar(term);
  host.append(find.el);
  host.addEventListener('dragenter', e => { if (isFiles(e) && ++over === 1) host.classList.add('dropping'); });
  host.addEventListener('dragleave', e => { if (isFiles(e) && over && --over === 0) host.classList.remove('dropping'); });
  host.addEventListener('dragover', e => { if (isFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  host.addEventListener('drop', e => {
    over = 0; host.classList.remove('dropping');
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    const text = dropText([...e.dataTransfer.files].map(f => window.deck.pathForFile(f)));
    if (text) { window.deck.write(id, text); term.focus(); }
  });
  // Links stand out in the link colour as soon as they are printed (#348).
  const paint = paintLinks(term, links, () => host.isConnected && host.offsetParent !== null);
  t = { term, fit, host, links, paint, find, opened: false, pending: '', exited: false };
  terms.set(id, t);
  new ResizeObserver(() => refit(id)).observe(host);
  return t;
}

export function refit(id) {
  const t = terms.get(id);
  if (!t || !t.opened || !t.host.isConnected || t.host.clientWidth < 20) return;
  try { t.fit.fit(); window.deck.resize(id, t.term.cols, t.term.rows); } catch { /* not laid out yet */ }
}

// Put a session's terminal into a pane body. Opening is deferred until the
// host is in the document, because xterm measures fonts when it opens.
// The terminal font is a web font, so opening also waits until it has loaded; a terminal
// opened earlier measures the fallback font and spaces its letters out.
const fontReady = document.fonts.load('13px "JetBrains Mono"').catch(() => {});
export function mount(id, parent) {
  const t = entry(id);
  parent.append(t.host);
  if (!t.opened && !t.opening) {
    t.opening = true;
    fontReady.then(() => {
      t.term.open(t.host);
      t.opened = true;
      // An item picked from Windows clipboard history (Win+V) arrives as an "insert from
      // paste" input, which xterm ignores (it takes only typed text and Ctrl+V). The picked
      // item is on the clipboard by then, so it goes in from there (#352). An ordinary paste
      // fires that input too, right after the paste event xterm already sent, so it is skipped.
      t.term.textarea.addEventListener('paste', e => {
        t.pastedAt = Date.now();
        const data = e.clipboardData;
        if (data && !data.getData('text/plain') && [...data.items].some(i => i.type.startsWith('image/'))) window.deck.write(id, '\x1bv');
      }, true);
      t.term.textarea.addEventListener('beforeinput', e => {
        if (e.inputType !== 'insertFromPaste') return;
        e.preventDefault();
        if (Date.now() - (t.pastedAt || 0) > 1000) pasteClipboard(id, t);
        t.pastedAt = 0;
      });
      if (t.pending) { t.term.write(t.pending); t.pending = ''; }
      requestAnimationFrame(() => refit(id));
    });
  }
  requestAnimationFrame(() => { refit(id); t.paint.refresh(); });
  return t;
}

export function write(id, data) {
  const t = entry(id);
  if (t.opened) t.term.write(data); else t.pending += data;
}

// The rows on a session's screen as text (#152), to read a prompt it stopped on. A terminal
// never shown yet holds its output unparsed, so a scratch terminal draws it first.
// With bright, faint text (Claude Code's placeholder in an empty input box) reads as spaces.
const brightText = (line, cols) => { let s = ''; for (let x = 0; x < cols; x++) { const c = line.getCell(x); s += !c || c.isDim() ? ' ' : c.getChars() || (c.getWidth() ? ' ' : ''); } return s.replace(/\s+$/, ''); };
const rowsOf = (term, bright) => { const b = term.buffer.active, out = []; for (let i = b.baseY; i < b.baseY + term.rows; i++) { const l = b.getLine(i); out.push(!l ? '' : bright ? brightText(l, term.cols) : l.translateToString(true)); } return out; };
export function screen(id, bright = false) {
  const t = terms.get(id);
  if (!t) return Promise.resolve([]);
  if (t.opened) return Promise.resolve(rowsOf(t.term, bright));
  const tmp = new Terminal({ cols: t.term.cols, rows: t.term.rows, scrollback: 200 });
  return new Promise(done => tmp.write(t.pending.slice(-200000), () => { const rows = rowsOf(tmp, bright); tmp.dispose(); done(rows); }));
}

// The owner's typing in each pane (#243): when they last typed, and whether they have typed
// since their last Enter (or Ctrl+C, which clears Claude Code's input). Mouse and focus
// reports are not typing. The mic's Space presses count too (typed(id, ' ')).
const typing = new Map(); // id -> { at, since }
export function typed(id, d) {
  if (/^\x1b\[(<|M|I$|O$)/.test(d)) return;
  typing.set(id, { at: Date.now(), since: !/[\r\x03]/.test(d) || /[^\r\x03]$/.test(d) });
}
export function typingIn(id) { const t = typing.get(id); return { ago: t ? Date.now() - t.at : Infinity, since: !!(t && t.since) }; }

// The links the pane offers on screen row r (0-based), for the smoke run: [{ text, range, activate }].
export function linksOnRow(id, r) {
  const t = terms.get(id);
  if (!t || !t.opened) return Promise.resolve([]);
  const b = t.term.buffer.active;
  return new Promise(done => t.links.provideLinks(b.baseY + r + 1, l => done((l || []).map(({ text, target, range, activate }) => ({ text, target, range, activate })))));
}
// The cells a pane coloured as links (#348), as screen rows, for the smoke run.
export function paintedRows(id) {
  const t = terms.get(id);
  if (!t || !t.opened) return [];
  const top = t.term.buffer.active.viewportY;
  return t.paint.painted().map(p => ({ row: p.y - 1 - top, x: p.x, width: p.width }));
}
// A pane's size, the screen row the cursor is on and its element, for the smoke run.
export function cursorRow(id) { const t = terms.get(id); return t ? { cols: t.term.cols, rows: t.term.rows, row: t.term.buffer.active.cursorY, el: t.term.element } : null; }

// After a layout change, re-measure every terminal that is on screen.
export function refitAll() { for (const id of terms.keys()) refit(id); }

// Claude Code's full-screen view binds Ctrl+Home to "scroll to top" (Ctrl+End to bottom).
// Outside it the history lives in xterm's own scrollback, so scroll that too.
export function jumpToTop(id) {
  const t = terms.get(id);
  if (!t || !t.opened) return;
  window.deck.write(id, '\x1b[1;5H');
  t.term.scrollToTop();
  t.term.focus();
}

// Enter typed in a pane marks the row it was pressed on, which is where Claude Code then
// prints the sent prompt. The marker moves with the scrollback and dies when its row
// scrolls out. In the full-screen view there is no scrollback, so nothing is marked.
function notePrompt(id) {
  const t = terms.get(id);
  if (!t || !t.opened || t.term.buffer.active.type !== 'normal') return;
  const m = t.term.registerMarker(0);
  if (!m) return;
  if (t.lastPrompt) t.lastPrompt.dispose();
  t.lastPrompt = m;
}
export function jumpToLastPrompt(id) {
  const t = terms.get(id);
  const m = t && t.opened && t.lastPrompt;
  if (!m || m.isDisposed || m.line < 0 || t.term.buffer.active.type !== 'normal') return false;
  t.term.scrollToLine(Math.max(0, m.line - 2));
  t.term.focus();
  return true;
}

// The pane's find bar (#360), from its header button or the smoke run.
export function openFind(id) { const t = terms.get(id); if (t && t.opened) t.find.open(); }
export function findState(id) { const t = terms.get(id); return t ? { open: t.find.isOpen(), el: t.find.el } : null; }
export function focus(id) { const t = terms.get(id); if (t && t.opened) t.term.focus(); }
// The pane that has the keyboard, if any.
export function focusedId() {
  for (const [id, t] of terms) if (t.opened && t.term.textarea === document.activeElement) return id;
  return null;
}
// A redraw the owner did not ask for moves panes around, and moving a pane takes its
// keyboard away (#361). holdFocus() before the redraw; the function it returns, called
// after, gives the keyboard back to that pane if the redraw left it nowhere. A pane that
// ends up without the keyboard still tells Claude Code it lost focus.
export function holdFocus() {
  const id = focusedId(), t = id && terms.get(id);
  if (!t) return () => {};
  t.held = { out: false };
  return Object.assign(() => {
    const a = document.activeElement;
    if (t.host.isConnected && terms.get(id) === t && (!a || a === document.body)) t.term.focus();
    const out = t.held.out;
    t.held = null;
    if (out && document.activeElement !== t.term.textarea && terms.get(id) === t) { focusOuts.set(id, (focusOuts.get(id) || 0) + 1); window.deck.write(id, '\x1b[O'); }
  }, { id });
}
// How many times each pane told its session it lost focus, for the smoke run.
const focusOuts = new Map();
export function focusOutsSent(id) { return focusOuts.get(id) || 0; }
export function markExited(id, v, shell = false) { const t = entry(id); t.exited = v; t.shell = v && shell; }
// Claude has exited but the pane's shell still takes typing (#353).
export function shellLive(id) { return !!(terms.get(id) && terms.get(id).shell); }
export function isExited(id) { return !!(terms.get(id) && terms.get(id).exited); }
export function dispose(id) { const t = terms.get(id); if (t) { t.term.dispose(); t.host.remove(); terms.delete(id); } }
export function reset(id) { const t = terms.get(id); if (t && t.opened) t.term.reset(); if (t) t.exited = false; }
