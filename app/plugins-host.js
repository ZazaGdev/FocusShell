// The plugin host (#369): activates the switched-on plugins, gives each a `host` object (its
// settings, its data folder, its IPC handlers and events, its global shortcut, and the services
// its manifest lists), and switches off a plugin that throws, showing why in Settings, while
// FocusShell keeps running. The page reaches plugins only through plugin:list, plugin:invoke
// and the plugin:event and plugin:changed messages. Kept out of main.js.
import fs from 'node:fs';
import path from 'node:path';
import { globalShortcut } from 'electron';
import { checkManifest, pluginStates, shortcutClashes } from './lib/plugins.js';
import { MANIFESTS } from './plugins/manifests.js';
import { MAINS } from './plugins/index.js';

// d: { ipcMain, P, SMOKE, send, services: { name: id => service }, fake, keys }
// fake: a plugin should fake what it records and runs (the hidden smoke run); keys: global
// shortcuts may be taken (never in smoke and try runs unless a test asks).
export function registerPlugins(d) {
  const { ipcMain, P, SMOKE, send, services = {}, fake = false, keys = !SMOKE } = d;
  const root = path.join(P.state, SMOKE ? path.join('smoke', 'plugins') : 'plugins');
  const known = MANIFESTS.filter(m => SMOKE || !m.smokeOnly);
  const bad = Object.fromEntries(known.map(m => [m.id, checkManifest(m).join('; ') || (MAINS[m.id] ? '' : 'no main side')]).filter(([, e]) => e));
  const live = new Map(); // id: { handlers, shortcutFn, deactivate, key, onSettings }
  const errors = {};      // id: why it was switched off this run
  let states = {}, clashes = {}, taken = {};

  const list = () => known.map(m => ({
    manifest: m, ...(states[m.id] || { on: false, shortcut: m.shortcut ?? null, settings: {} }),
    live: live.has(m.id), fake, error: bad[m.id] || errors[m.id] || '', clash: clashes[m.id] || taken[m.id] || '',
  }));
  const changed = () => send('plugin:changed', list());

  function fail(id, e) {
    const msg = (e && e.message) || String(e);
    errors[id] = msg;
    try { fs.mkdirSync(path.join(root, id), { recursive: true }); fs.appendFileSync(path.join(root, id, 'error.log'), `${new Date().toISOString()} ${(e && e.stack) || msg}\n`); } catch { /* Settings still shows it */ }
    stop(id);
    changed();
  }
  // Runs fn for the plugin instance live now. A failure switches that instance off, but one that
  // arrives after the instance was stopped (or replaced by a new start) is ignored.
  async function guard(id, fn) {
    const entry = live.get(id);
    try { return await fn(); } catch (e) { if (entry && live.get(id) === entry) fail(id, e); return undefined; }
  }

  function start(m) {
    const id = m.id, dir = path.join(root, id);
    const entry = { handlers: new Map(), shortcutFn: null, deactivate: null, key: null, onSettings: [] };
    live.set(id, entry);
    const host = {
      id, dir, smoke: SMOKE, fake, keys, // keys: global shortcuts of its own may be taken
      settings: () => (states[id] || {}).settings || {},
      onSettings: fn => { entry.onSettings.push(fn); },
      handle: (name, fn) => { entry.handlers.set(String(name), fn); },
      emit: (event, data) => send('plugin:event', { id, event, data }),
      shortcut: fn => { entry.shortcutFn = fn; },
      log: text => { try { fs.appendFileSync(path.join(dir, 'plugin.log'), `${new Date().toISOString()} ${text}\n`); } catch { /* best effort */ } },
    };
    const keep = r => {
      const d = r && typeof r.deactivate === 'function' ? r.deactivate : null;
      if (live.get(id) === entry) entry.deactivate = d;
      else if (d) try { d(); } catch { /* already stopped */ } // stopped while still activating
    };
    try {
      for (const u of m.uses || []) if (services[u]) host[u] = services[u](id);
      fs.mkdirSync(dir, { recursive: true });
      const r = MAINS[id].activate(host);
      if (r && typeof r.then === 'function') {
        r.then(keep, e => { if (live.get(id) === entry) fail(id, e); });
      } else keep(r);
    } catch (e) { fail(id, e); return; }
    bindKey(id);
  }

  function stop(id) {
    const entry = live.get(id);
    if (!entry) return;
    live.delete(id);
    delete taken[id];
    if (entry.key) try { globalShortcut.unregister(entry.key); } catch { /* gone */ }
    if (entry.deactivate) try { entry.deactivate(); } catch (e) { errors[id] = errors[id] || `could not stop: ${e.message}`; }
  }

  // A switched-on plugin's shortcut, taken system wide. Smoke and try runs take no keys (unless
  // a test sets keys), so they cannot steal the real FocusShell's.
  function bindKey(id) {
    const entry = live.get(id), s = states[id];
    if (!entry) return;
    if (entry.key) { try { globalShortcut.unregister(entry.key); } catch { /* gone */ } entry.key = null; }
    delete taken[id];
    if (!keys || !s || !s.shortcut || clashes[id] || !entry.shortcutFn) return;
    let ok = false;
    try { ok = globalShortcut.register(s.shortcut, () => { guard(id, entry.shortcutFn); }); } catch { ok = false; }
    if (ok) entry.key = s.shortcut;
    else taken[id] = `${s.shortcut} is taken by another app`;
  }

  // Settings changed (or the app started): start, stop and rebind to match.
  function apply(settings) {
    const prev = states;
    states = pluginStates(known, settings && settings.plugins);
    clashes = shortcutClashes(states);
    for (const m of known) {
      const id = m.id, s = states[id];
      if (!s.on) delete errors[id]; // switching it off and on again retries it
      const want = s.on && !bad[id] && !errors[id];
      if (want && !live.has(id)) start(m);
      else if (!want && live.has(id)) stop(id);
      else if (want) {
        bindKey(id);
        if (JSON.stringify(prev[id] && prev[id].settings) !== JSON.stringify(s.settings)) for (const fn of live.get(id).onSettings) guard(id, () => fn(s.settings));
      }
    }
    changed();
  }

  function stopAll() { for (const id of [...live.keys()]) stop(id); }

  ipcMain.handle('plugin:list', () => list());
  ipcMain.handle('plugin:invoke', (_e, id, name, ...args) => {
    const entry = live.get(String(id)), fn = entry && entry.handlers.get(String(name));
    if (!fn) return Promise.resolve({ error: `${id} has no ${name}` });
    // A handler that throws switches the plugin off and answers { error }, like a missing one.
    return (async () => {
      try { return await fn(...args); } catch (e) {
        if (live.get(String(id)) === entry) fail(String(id), e);
        return { error: (e && e.message) || String(e) };
      }
    })();
  });
  // The smoke run presses a plugin's shortcut this way, since it takes no real keys.
  if (SMOKE) ipcMain.handle('plugin:smoke-key', (_e, id) => {
    const entry = live.get(String(id));
    return entry && entry.shortcutFn ? guard(String(id), entry.shortcutFn) : false;
  });

  return { apply, stopAll };
}
