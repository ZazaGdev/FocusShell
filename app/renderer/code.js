// The Code pane (#25): real VS Code beside a lead, opened from the </> button on a
// project's tab. Each project's VS Code lives in a webview on a layer above the stage,
// never moved in the page, because moving a webview reloads it. The pane itself only
// holds a slot, and place() lays each webview over its slot after every render.

import { withTrusted, TRUST_KEY } from '../lib/codeweb.js';
import { codeWait, DOWNLOADING } from './codewait.js';
const open = new Map(); // project -> { view, ready, error }
// The server's start steps from main (#1114); a pane still waiting redraws as they change.
let serverSteps = {};
if (window.deck && window.deck.onCodeSteps) window.deck.onCodeSteps(s => { serverSteps = s || {}; for (const st of open.values()) if (!st.painted && !st.error && st.rerender) st.rerender(); });
let layer = null;
const watch = new ResizeObserver(() => place());
addEventListener('resize', () => place());

function getLayer() {
  if (!layer) { layer = document.createElement('div'); layer.id = 'codelayer'; document.getElementById('main').append(layer); }
  return layer;
}

export function isOpen(name) { return open.has(name); }

// The smoke run keeps VS Code's storage in memory: the saved one is held by the real
// FocusShell when it runs, and a page that cannot open it never starts.
let partition = 'persist:vscode';
export function setPartition(p) { partition = p; }

// Starts VS Code for a project; rerender() redraws the app once it is ready or failed.
// With a file (#69) it opens that file too. An open pane on the same folder adds it as a new
// tab (#365); otherwise, or when that fails, the pane reloads to show it.
// A start that does not show VS Code within START_MS is tried again, saying so with the try's
// number, every START_MS up to TRIES tries, then an error with Retry and Open in VS Code
// (#1114): the pane never sits on "Starting" for good. A retry skips the folder-trust step,
// whose page scripts were one way a start could wait for ever. Each step goes to the start log
// (state/code-log.txt), so a start that hangs names its step. A smoke run shortens START_MS.
let START_MS = 60000;
export const TRIES = 4; // the first try and three more
export function setStartTimeout(ms) { START_MS = ms; }
const log = (deck, name, st, step) => { try { deck.codeLog(`${name} try ${st.tries}: ${step}`); } catch { /* best effort */ } };

export async function openCode(name, deck, rerender, file, sessionId) {
  const had = open.get(name);
  if (had && file && had.view) {
    if (had.ready && await deck.codeOpen(name, file, sessionId)) return;
    if (open.get(name) !== had || !had.view) return;
    const r = await deck.codeUrl(name, file, sessionId);
    if (r && r.url && open.get(name) === had) { had.ready = false; place(); had.view.setAttribute('src', r.url); }
    return;
  }
  if (had) return;
  const st = { view: null, ready: false, painted: false, theme: null, error: '', rerender, tries: 1 };
  st.log = step => log(deck, name, st, step);
  st.deck = deck;
  open.set(name, st);
  await startView(name, st, deck, file, sessionId);
}

// One try at showing VS Code in st, with its watchdog.
async function startView(name, st, deck, file, sessionId) {
  const watchdog = setTimeout(() => {
    if (open.get(name) !== st || st.painted || st.error) return;
    log(deck, name, st, `no VS Code after ${Math.round(START_MS / 1000)} s (stopped at: ${st.step || 'asking for the server'})`);
    if (st.view) { st.view.remove(); st.view = null; }
    st.ready = false; st.poll = (st.poll || 0) + 1;
    if (st.tries < TRIES) { st.tries++; st.retrying = true; st.rerender(); startView(name, st, deck, file, sessionId); return; }
    st.retrying = false;
    st.error = `VS Code did not start for ${name} after ${TRIES} tries (it stopped at: ${st.step || 'asking for the server'}). Retry, or open it in your normal VS Code window.`;
    st.rerender();
  }, START_MS);
  st.watchdog = watchdog;
  st.step = 'asking for the server'; log(deck, name, st, st.step);
  const r = await deck.codeUrl(name, file, sessionId);
  if (open.get(name) !== st || st.watchdog !== watchdog || st.error) return;
  if (!r || r.error) { clearTimeout(watchdog); st.error = (r && r.error) || 'Could not start VS Code.'; st.rerender(); return; }
  st.theme = r.theme || null;
  const v = document.createElement('webview');
  v.className = 'codeview';
  v.setAttribute('partition', partition);
  st.view = v;
  getLayer().append(v);
  st.rerender();
  if (st.tries === 1) { st.step = 'trusting the project folders'; log(deck, name, st, st.step); await trustFolders(v, r.trust); }
  if (open.get(name) !== st || !v.isConnected || st.view !== v) return;
  v.addEventListener('did-start-navigation', e => { if (e.isMainFrame && !e.isInPlace) { st.painted = false; place(); } });
  v.addEventListener('dom-ready', () => {
    if (st.step !== DOWNLOADING) { st.step = 'drawing VS Code'; log(deck, name, st, 'page loaded'); }
    st.ready = true; place(); waitPainted(st);
  });
  v.addEventListener('did-fail-load', e => { if (e.isMainFrame) log(deck, name, st, `page failed: ${e.errorDescription || e.errorCode}`); });
  v.addEventListener('did-start-loading', () => log(deck, name, st, 'page loading'));
  v.addEventListener('did-finish-load', () => log(deck, name, st, 'page finished loading'));
  st.step = 'loading VS Code'; log(deck, name, st, st.step);
  v.setAttribute('src', r.url);
}

// The project folders are put on VS Code's trusted list before its workbench loads (#226).
// The list is in the browser storage of the server's address, so the view first opens a
// page of the same address (the server answers it "Forbidden", which is all it needs),
// adds the missing folders there, then goes on to the workbench. Storage VS Code has not
// made yet (its very first start) is left alone; the next pane adds them.
const TRUST_DB = 'vscode-web-state-db-global-shared';
async function trustFolders(v, trust) {
  if (!trust || !trust.dirs.length) return;
  const loaded = new Promise(res => { v.addEventListener('dom-ready', res, { once: true }); setTimeout(res, 5000); });
  v.setAttribute('src', `http://127.0.0.1:${trust.port}/focusshell-trust`);
  await loaded;
  const db = `(async () => { const has = (await indexedDB.databases()).some(d => d.name === ${JSON.stringify(TRUST_DB)}); if (!has) return null;
    return await new Promise(res => { const q = indexedDB.open(${JSON.stringify(TRUST_DB)}); q.onerror = () => res(null); q.onsuccess = () => res(q.result); }); })()`;
  // A page script that never answers (a page that never loaded, a store kept busy) would hold
  // the start here for good (#1114): each gets five seconds.
  const run = js => Promise.race([v.executeJavaScript(js), new Promise((_r, no) => setTimeout(() => no(new Error('no answer')), 5000))]);
  try {
    const stored = await run(`${db}.then(d => d && d.objectStoreNames.contains('ItemTable') ? new Promise(res => { const g = d.transaction('ItemTable').objectStore('ItemTable').get(${JSON.stringify(TRUST_KEY)}); g.onsuccess = () => { d.close(); res({ value: g.result ?? '' }); }; g.onerror = () => { d.close(); res(null); }; }) : (d && d.close(), null))`);
    if (!stored) return;
    const next = withTrusted(stored.value, trust.port, trust.dirs);
    if (!next) return;
    await run(`${db}.then(d => new Promise(res => { const t = d.transaction('ItemTable', 'readwrite'); t.objectStore('ItemTable').put(${JSON.stringify(next)}, ${JSON.stringify(TRUST_KEY)}); t.oncomplete = () => { d.close(); res(true); }; t.onerror = () => { d.close(); res(false); }; }))`);
  } catch { /* the pane opens as before; VS Code asks */ }
}

// VS Code first draws in its own light theme until the synced one loads (#116), so the
// view stays see-through over the dark slot until its workbench shows the desktop theme's
// kind. It is laid out all along, because a hidden page would not get on with starting.
const BASES = ['vs', 'vs-dark', 'hc-black', 'hc-light'];
// A page opened while the server was still starting can stall with no workbench at all
// (#122, measured with quick </> clicks on three projects); it is reloaded, at most three times.
// On a first start (a new PC, or a new VS Code release) the server first answers with a
// "Visual Studio Code Server is downloading" page that reloads itself every 1.5 seconds until
// the download is done (#1114: measured 30 s here, longer on a slow line). Each of those reloads
// used to start this wait afresh, so a slow or stuck download kept the pane on "Starting" for
// good. Now that page is named as the step and left to reload itself; the watchdog bounds it.
const PAGE = "JSON.stringify({ cls: (document.querySelector('.monaco-workbench') || {}).className || '', dl: /Server is downloading/i.test((document.body && document.body.innerText) || '') })";
async function waitPainted(st) {
  const me = st.poll = (st.poll || 0) + 1, until = Date.now() + 8000;
  while (st.poll === me && st.view && st.view.isConnected && !st.painted) {
    let cls = '', dl = false;
    try { ({ cls, dl } = JSON.parse(await Promise.race([st.view.executeJavaScript(PAGE), new Promise(res => setTimeout(() => res('{}'), 2000))]))); } catch { /* reloading */ }
    if (dl) {
      if (st.step !== DOWNLOADING) { st.step = DOWNLOADING; st.log(DOWNLOADING); st.rerender(); }
      return; // the page reloads itself; its next load runs this again
    }
    if (st.step === DOWNLOADING) { st.step = 'drawing VS Code'; st.downloaded = true; st.log('server downloaded, page loaded'); st.rerender(); }
    const words = String(cls || '').split(' ');
    if (Date.now() > until && !cls && (st.reloads || 0) < 3) { st.reloads = (st.reloads || 0) + 1; st.view.reload(); return; }
    // Still no workbench after the reloads (#196): say so, with Retry, rather than a blank pane.
    if (Date.now() > until && !cls) { clearTimeout(st.watchdog); st.view.remove(); st.view = null; st.error = 'VS Code did not start.'; st.rerender(); return; }
    if (words.some(c => (st.theme ? c === st.theme : BASES.includes(c))) || Date.now() > until) { clearTimeout(st.watchdog); st.painted = true; st.retrying = false; st.step = 'shown'; place(); return; }
    await new Promise(res => setTimeout(res, 100));
  }
}

export function closeCode(name) {
  const st = open.get(name);
  if (st) clearTimeout(st.watchdog);
  if (st && st.view) st.view.remove();
  open.delete(name);
}

export function reloadCode(name) {
  const st = open.get(name);
  if (st && st.view && st.ready) st.view.reload();
}

// The pane beside the lead: a header and the slot the webview is laid over.
// A start that failed or timed out (#196) shows why, with Retry and Open in VS Code (#1114).
export function codePane(name, { h, icon, onClose, onExternal, onRetry }) {
  const st = open.get(name) || {};
  // The requirements are checked once a pane shows them: open in the error, or unfolded.
  const getReq = () => { if (!st.reqAsked && st.deck) { st.reqAsked = true; st.deck.codeRequirements().then(r => { st.req = r; if (open.get(name) === st) st.rerender(); }, () => {}); } };
  if (st.error) getReq();
  const slot = h('div', { class: 'codeslot', 'data-code': name },
    codeWait({ h, name, st, server: serverSteps, req: st.req || null, tries: TRIES, onRetry, onExternal, onGet: getReq }));
  watch.observe(slot);
  return h('div', { class: 'pane codepane' },
    h('div', { class: 'ph' }, icon('code'), h('span', { class: 'pn' }, 'Code'), h('span', { class: 'lbl' }, name),
      h('span', { class: 'pa' },
        h('button', { title: 'Open in your normal VS Code window', onclick: onExternal }, icon('popout')),
        h('button', { title: 'Close VS Code', onclick: onClose }, icon('x')))),
    slot);
}

// The lead on the left and its Code pane on the right, split by a gutter that remembers
// where it was dragged to.
const leadShare = new Map();
export function beside(name, leadEl, { h, icon, dragGutter, onClose, onExternal, onRetry }) {
  const f = leadShare.get(name) || 0.4;
  const a = h('div', { class: 'cell', style: `flex:${f * 100} 1 0` }, leadEl);
  const b = h('div', { class: 'cell', style: `flex:${(1 - f) * 100} 1 0` }, codePane(name, { h, icon, onClose, onExternal, onRetry }));
  const g = h('div', { class: 'gutter' });
  const wrap = h('div', { class: 'split codewrap' }, a, g, b);
  dragGutter(g, 'h');
  g.addEventListener('mousedown', () => addEventListener('mouseup', () => {
    const wa = a.getBoundingClientRect().width, wb = b.getBoundingClientRect().width;
    if (wa + wb > 0) leadShare.set(name, wa / (wa + wb));
  }, { once: true }));
  return wrap;
}

// Lays each ready webview over its slot, and hides the ones whose slot is not on screen.
export function place() {
  if (!layer) return;
  const base = layer.getBoundingClientRect();
  for (const [name, st] of open) {
    if (!st.view) continue;
    const slot = document.querySelector(`.codeslot[data-code="${CSS.escape(name)}"]`);
    const r = slot && slot.isConnected ? slot.getBoundingClientRect() : null;
    const show = st.ready && r && r.width > 0 && r.height > 0;
    st.view.style.visibility = show ? 'visible' : 'hidden';
    st.view.style.opacity = st.painted ? '' : '0';
    if (!show) continue;
    Object.assign(st.view.style, { left: `${r.left - base.left}px`, top: `${r.top - base.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }
}
