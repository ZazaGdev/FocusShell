// Plugins (#369): the pure rules of the plugin system. A plugin is a folder in app/plugins/
// with a manifest (plain data), a main side and a page side; see app/plugins/README.md.
// These rules check a manifest, clean what Settings saved for a plugin, and find shortcut
// clashes. The host (plugins-host.js) and the page (renderer/plugins.js) use them.

export const API = 1; // the host API this FocusShell runs; a manifest asks for one
export const ID_RE = /^[a-z][a-z0-9-]{1,30}$/;
export const SETTING_TYPES = ['toggle', 'text', 'choice', 'path'];
export const USES = ['screen', 'mic', 'boards', 'claude', 'sessions', 'cto'];
// FocusShell's own keys (talk, the PM drawer, find, search): a plugin cannot take them.
export const RESERVED_KEYS = ['Control+Shift+Space', 'Control+Shift+P', 'Control+Shift+F', 'Control+K', 'Control+Shift+K'];

const MODS = ['Control', 'Alt', 'Shift', 'Super'];
const KEY_ONLY = /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space)$/;
const SET_KEY = /^[a-zA-Z][a-zA-Z0-9]*$/;
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

// A shortcut with its modifiers in the fixed order Control, Alt, Shift, Super, then the key.
export function canonicalShortcut(k) {
  const parts = String(k).split('+'), key = parts.pop();
  const mods = parts.map(p => MODS.find(m => m.toLowerCase() === p.toLowerCase()) || p);
  const rank = m => (MODS.includes(m) ? MODS.indexOf(m) : MODS.length);
  return [...mods.sort((a, b) => rank(a) - rank(b)), key].join('+');
}

// An Electron accelerator a global shortcut may use, such as Control+Alt+R. It needs Control,
// Alt or Super (Shift alone would steal typing); a letter or digit needs two modifiers, while
// Space and F1-F24 may take one. A modifier may not repeat.
export function validShortcut(k) {
  if (typeof k !== 'string') return false;
  const parts = k.split('+'), key = parts.pop();
  if (!KEY_ONLY.test(key) || !parts.length) return false;
  if (!parts.every(p => MODS.includes(p)) || new Set(parts).size !== parts.length) return false;
  if (!parts.some(p => p !== 'Shift')) return false;
  return /^[A-Z0-9]$/.test(key) ? parts.length >= 2 : true;
}

// What a person typed in the shortcut field, tidied: any case, Ctrl for Control, modifiers in the
// fixed order. Returns '' for an empty field (no shortcut), the shortcut when it is valid, and
// null when it is not.
export function parseShortcutInput(raw) {
  const t = String(raw == null ? '' : raw).trim();
  if (!t) return '';
  const parts = t.split('+').map(p => p.trim()), key = parts.pop();
  const mods = parts.map(p => (p.toLowerCase() === 'ctrl' ? 'Control' : p));
  const k = /^(space|f\d+)$/i.test(key) ? key[0].toUpperCase() + key.slice(1).toLowerCase() : key.toUpperCase();
  const s = canonicalShortcut([...mods, k].join('+'));
  return validShortcut(s) ? s : null;
}

// What is wrong with a manifest, one line each; empty when it is fine.
export function checkManifest(m) {
  if (!m || typeof m !== 'object') return ['not an object'];
  const errs = [];
  if (!ID_RE.test(String(m.id))) errs.push('id must be lower case letters, digits and -');
  if (typeof m.name !== 'string' || !m.name.trim()) errs.push('name is missing');
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(m.version)) errs.push('version must look like 1.0.0');
  if (m.api !== API) errs.push(`api ${m.api} is not supported (this FocusShell runs api ${API})`);
  if (m.shortcut != null && !validShortcut(m.shortcut)) errs.push(`shortcut ${m.shortcut} is not a key FocusShell can take`);
  if (!m.button || typeof m.button.icon !== 'string' || typeof m.button.title !== 'string') errs.push('button needs icon and title');
  if (m.uses != null && !Array.isArray(m.uses)) errs.push('uses must be a list');
  else for (const u of m.uses || []) if (!USES.includes(u)) errs.push(`uses ${u}, which is not a service`);
  const keys = new Set();
  if (m.settings != null && !Array.isArray(m.settings)) errs.push('settings must be a list');
  else for (const s of m.settings || []) {
    if (!s || !SET_KEY.test(String(s.key))) { errs.push('a setting has no key'); continue; }
    if (keys.has(s.key)) errs.push(`setting ${s.key} is listed twice`);
    keys.add(s.key);
    if (!SETTING_TYPES.includes(s.type)) errs.push(`setting ${s.key} has type ${s.type}`);
    else if (s.type === 'choice') {
      if (Array.isArray(s.choices) && !s.choices.every(c => typeof c === 'string')) errs.push(`setting ${s.key} choices must be text`);
      else if (!(Array.isArray(s.choices) && s.choices.includes(s.default))) errs.push(`setting ${s.key} needs choices holding its default`);
    }
  }
  return errs;
}

// A plugin's saved settings, kept to its manifest's keys; a missing or wrong value is the default.
export function cleanPluginSettings(manifest, saved) {
  const src = obj(saved), out = {};
  for (const s of manifest.settings || []) {
    const v = src[s.key];
    if (s.type === 'toggle') out[s.key] = typeof v === 'boolean' ? v : s.default === true;
    else if (s.type === 'choice') out[s.key] = s.choices.includes(v) ? v : s.default;
    else out[s.key] = typeof v === 'string' ? v.slice(0, 1000) : String(s.default ?? '');
  }
  return out;
}

// Each plugin's state from Settings' `plugins` entry: on (off unless switched on), its
// shortcut (the manifest's unless changed; null when cleared) and its cleaned settings.
export function pluginStates(manifests, saved) {
  const src = obj(saved);
  return Object.fromEntries(manifests.map(m => {
    const p = obj(src[m.id]);
    const shortcut = p.shortcut === null ? null : validShortcut(p.shortcut) ? p.shortcut : (m.shortcut ?? null);
    return [m.id, { on: p.on === true, shortcut, settings: cleanPluginSettings(m, p.settings) }];
  }));
}

// Switched-on plugins whose shortcut FocusShell keeps or an earlier plugin already has: { id: why }.
export function shortcutClashes(states) {
  const out = {}, seen = new Map();
  for (const [id, s] of Object.entries(states)) {
    if (!s.on || !s.shortcut) continue;
    const k = canonicalShortcut(s.shortcut).toLowerCase();
    if (RESERVED_KEYS.some(r => canonicalShortcut(r).toLowerCase() === k)) out[id] = `${s.shortcut} is FocusShell's own key`;
    else if (seen.has(k)) out[id] = `${s.shortcut} is also ${seen.get(k)}'s shortcut`;
    else seen.set(k, id);
  }
  return out;
}

// Settings' `plugins` entry as saved: { id: { on, shortcut?, settings } }, plain values only.
// A plugin's own rules (cleanPluginSettings) apply later, when its manifest is known.
export function normalizePluginsEntry(raw) {
  const out = {};
  for (const [id, v] of Object.entries(obj(raw))) {
    if (!ID_RE.test(id) || !v || typeof v !== 'object') continue;
    const settings = Object.fromEntries(Object.entries(obj(v.settings)).filter(([k, x]) => SET_KEY.test(k) && ['string', 'boolean'].includes(typeof x)));
    out[id] = { on: v.on === true, ...(v.shortcut === null || validShortcut(v.shortcut) ? { shortcut: v.shortcut } : {}), settings };
  }
  return out;
}
