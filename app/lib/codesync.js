// The Code pane's VS Code takes the owner's Windows VS Code setup (#96), one way, each time
// FocusShell starts its server. Measured on serve-web: settings apply from the server's
// data/Machine/settings.json; keybindings and snippets live only in the page's own storage
// (IndexedDB "vscode-web-db", store "vscode-userdata-store", keys like /User/keybindings.json),
// so main.js writes those into the page with pageSyncScript() and reloads it once if they changed.
import fs from 'node:fs';
import path from 'node:path';

// A Windows folder as VS Code writes it in a file URI path: C:\a\b becomes /c:/a/b.
export const uriPath = dir => {
  const p = String(dir).replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[A-Za-z]:/.test(p) ? '/' + p[0].toLowerCase() + p.slice(1) : p;
};

// The desktop extensions worth bringing: listed in its extensions.json, folder present, not
// waiting to be deleted (.obsolete).
export function liveExtensions(manifest, present, obsolete) {
  const have = new Set(present), gone = new Set(Object.keys(obsolete || {}));
  return (Array.isArray(manifest) ? manifest : []).filter(e => e && e.relativeLocation && have.has(e.relativeLocation) && !gone.has(e.relativeLocation));
}

// Which extension folders to copy into the server, and which old ones to remove from it.
export function extensionPlan(wanted, serverDirs) {
  const want = new Set(wanted.map(e => e.relativeLocation)), there = new Set(serverDirs.filter(d => !d.startsWith('.') && d !== 'extensions.json'));
  return { copy: [...want].filter(d => !there.has(d)), remove: [...there].filter(d => !want.has(d)) };
}

// The desktop manifest, pointed at the server's own extensions folder.
export function serverManifest(wanted, serverExtDir) {
  const base = uriPath(serverExtDir);
  return wanted.map(e => ({ ...e, location: { $mid: 1, path: `${base}/${e.relativeLocation}`, scheme: 'file' } }));
}

// The files the page must hold: keybindings and every snippet file, keyed as VS Code keys them.
export function pageFiles(userDir) {
  const files = {};
  const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
  files['/User/keybindings.json'] = read(path.join(userDir, 'keybindings.json')) ?? '[]';
  let snippets = [];
  try { snippets = fs.readdirSync(path.join(userDir, 'snippets')).filter(f => /\.(json|code-snippets)$/i.test(f)); } catch { /* none */ }
  for (const f of snippets) { const t = read(path.join(userDir, 'snippets', f)); if (t != null) files[`/User/snippets/${f}`] = t; }
  return files;
}

// A script run in the Code pane's page. It writes the files into VS Code's storage, removes
// snippet files the desktop no longer has, and resolves to 'changed', 'same' or 'not-ready'
// (the workbench has not created its storage yet). It never creates the database itself.
export function pageSyncScript(files) {
  return `(() => new Promise(done => {
  const want = ${JSON.stringify(files)};
  const req = indexedDB.open('vscode-web-db');
  req.onupgradeneeded = () => req.transaction.abort();
  req.onerror = () => done('not-ready');
  req.onsuccess = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('vscode-userdata-store')) { db.close(); done('not-ready'); return; }
    const tx = db.transaction('vscode-userdata-store', 'readwrite'), st = tx.objectStore('vscode-userdata-store');
    let changed = false;
    const keys = st.getAllKeys();
    keys.onsuccess = () => {
      for (const k of keys.result) if (String(k).startsWith('/User/snippets/') && !(k in want)) { st.delete(k); changed = true; }
      for (const [k, text] of Object.entries(want)) {
        const g = st.get(k);
        g.onsuccess = () => {
          const old = g.result instanceof Uint8Array ? new TextDecoder().decode(g.result) : null;
          if (old !== text) { st.put(new TextEncoder().encode(text), k); changed = true; }
        };
      }
    };
    tx.oncomplete = () => { db.close(); done(changed ? 'changed' : 'same'); };
    tx.onerror = () => { db.close(); done('not-ready'); };
  };
}))()`;
}

// The theme desktop VS Code shows. With no "workbench.colorTheme" in settings.json it shows
// its default (Dark 2026 today), while the web workbench defaults to a light one, so the name
// is read from desktop's state database. Null when it cannot be read.
async function themeData(userDir) {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.join(userDir, 'globalStorage', 'state.vscdb'), { readOnly: true });
    try { return JSON.parse(db.prepare("select value from ItemTable where key='colorThemeData'").get().value); }
    finally { db.close(); }
  } catch { return null; }
}
export async function desktopTheme(userDir) { const d = await themeData(userDir); return (d && d.settingsId) || null; }

// Whether that theme is light, dark or high contrast, as the class VS Code puts on its
// workbench: the first word of the theme's id. Null when it cannot be read.
export function themeBase(data) {
  const b = String((data && data.id) || '').split(' ')[0];
  return ['vs', 'vs-dark', 'hc-black', 'hc-light'].includes(b) ? b : null;
}
export async function desktopThemeBase(userDir) { return themeBase(await themeData(userDir)); }

// The server's settings: desktop's settings.json as written (comments and all), plus the theme
// desktop shows when settings.json does not name one.
export function machineSettings(text, theme) {
  const src = String(text || '').trim() || '{}';
  if (!theme || /"workbench\.colorTheme"\s*:/.test(src) || !src.startsWith('{')) return src;
  return `{ "workbench.colorTheme": ${JSON.stringify(theme)},${src.slice(1)}`;
}

// Settings and extensions into the server's data folder. Extensions are copied only when a
// folder is new (a new version has a new folder), and old ones are removed.
// FocusShell's own extensions (`own`: folders holding a package.json) are copied fresh each
// start and listed too (#365).
export async function syncServer({ userDir, desktopExtDir, serverDir, own = [] }) {
  const extDir = path.join(serverDir, 'extensions');
  await fs.promises.mkdir(path.join(serverDir, 'data', 'Machine'), { recursive: true });
  await fs.promises.mkdir(extDir, { recursive: true });
  let settings = '{}';
  try { settings = await fs.promises.readFile(path.join(userDir, 'settings.json'), 'utf8'); } catch { /* none */ }
  await fs.promises.writeFile(path.join(serverDir, 'data', 'Machine', 'settings.json'), machineSettings(settings, await desktopTheme(userDir)));
  const json = async f => { try { return JSON.parse(await fs.promises.readFile(f, 'utf8')); } catch { return null; } };
  let present = [];
  try { present = await fs.promises.readdir(desktopExtDir); } catch { /* no desktop extensions */ }
  const wanted = liveExtensions(await json(path.join(desktopExtDir, 'extensions.json')), present, await json(path.join(desktopExtDir, '.obsolete')));
  const ours = [];
  for (const src of own) {
    const pkg = await json(path.join(src, 'package.json'));
    if (!pkg || !pkg.publisher || !pkg.name || !pkg.version) continue;
    const id = `${pkg.publisher}.${pkg.name}`.toLowerCase(), rel = `${id}-${pkg.version}`;
    ours.push({ src, entry: { identifier: { id }, version: pkg.version, relativeLocation: rel, metadata: { installedTimestamp: 0, source: 'vsix' } } });
  }
  const ourDirs = new Set(ours.map(o => o.entry.relativeLocation));
  const plan = extensionPlan(wanted, (await fs.promises.readdir(extDir)).filter(d => !ourDirs.has(d)));
  for (const d of plan.remove) await fs.promises.rm(path.join(extDir, d), { recursive: true, force: true });
  // Copied under a temporary name first, so a copy cut short is never taken for a whole one
  // (the leftover is not wanted, so the next start removes it).
  for (const d of plan.copy) {
    const part = path.join(extDir, `${d}.part`);
    await fs.promises.rm(part, { recursive: true, force: true });
    await fs.promises.cp(path.join(desktopExtDir, d), part, { recursive: true });
    await fs.promises.rename(part, path.join(extDir, d));
  }
  for (const o of ours) {
    const to = path.join(extDir, o.entry.relativeLocation);
    await fs.promises.rm(to, { recursive: true, force: true });
    await fs.promises.cp(o.src, to, { recursive: true });
  }
  await fs.promises.writeFile(path.join(extDir, 'extensions.json'), JSON.stringify(serverManifest([...wanted, ...ours.map(o => o.entry)], extDir)));
  return { copied: plan.copy.length, removed: plan.remove.length, total: wanted.length };
}
