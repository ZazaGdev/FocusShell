// Preferences shown on the Settings page, kept in state/settings.json.
import { normalizePluginsEntry } from './plugins.js';
export const DOCKS = ['left', 'right', 'bottom', 'float'];

export const DEFAULTS = {
  runPm: false,          // start the PM; off (the default), the CTO keeps the board itself (#172)
  pmDock: 'left',        // where the Home sidebar (CTO above PM) sits
  pmSize: 380,           // its width (left, right) or height (bottom), in pixels
  pmFolded: false,       // the whole sidebar folded to a thin strip
  pmStartFolded: false,  // start each run folded
  sideSplit: 0.5,        // the CTO's share of the sidebar; the PM has the rest
  foldCto: false,        // the CTO half folded to its title bar
  foldPm: false,         // the PM half folded to its title bar
  boardCompact: false,   // project board items one line each
  testBoards: [],        // boards in test view ('' is Home's all-projects board, else a project)
  models: { cto: '', pm: 'sonnet', helper: 'haiku', catchup: 'haiku' }, // Claude model of FocusShell's own sessions (#142, #174); '' is Claude's own default; catchup writes Open and catch up's recaps (#1025)
  catchUp: 'model',      // who writes Open and catch up's recaps (#1025): 'model' (one headless turn) or 'lead' (each lead itself)
  tags: ['Research'],    // the tags items can carry as badges and boards filter by (#224)
  tavernLooks: {},       // the tavern's characters the owner picked (#240): { 'cto'|'pm'|project: [col, row] }
  tavernRobots: {},      // the tavern robot each project wears (#358): { project: robot, '*': every other project }; empty picks one from the name
  remoteControl: false,  // sessions start under Claude Code's Remote Control, reachable from claude.ai (#346)
  backupPush: false,     // the hourly board backup also pushes to the data folder's git remote (#346)
  plugins: {},           // each plugin's on/off, shortcut and settings (#369): { id: { on, shortcut?, settings } }
  statusEvery: 30,       // minutes between Status refresh asks to a CTO (#1034): one of STATUS_EVERY
  theme: 'graphite',     // Preferences (#1026): the colour theme, one of THEMES
  space: 'normal',       // how roomy the app is, one of SPACES
  font: 'inter',         // the app's font, one of FONTS (terminals keep their own)
  setupDone: false,      // the first-run setup was finished or skipped (#1061)
  tourDone: false,       // the walkthrough after it was finished or skipped (#1036)
  showMissed: true,      // the Maybe missed button above each CTO pane (#1101)
  showTavern: true,      // the Tavern button and the tavern itself (#1101)
};
export const STATUS_EVERY = [5, 30, 60, 120];

// Preferences (#1026). Each theme is a token set in renderer/themes.css; light ones keep a dark
// terminal, since Claude Code's own colours are drawn for a dark one.
export const THEMES = [
  { id: 'graphite', name: 'Graphite' }, { id: 'graphite-light', name: 'Graphite Light', light: true },
  { id: 'paper', name: 'Paper', light: true }, { id: 'nord', name: 'Nord' }, { id: 'tokyo', name: 'Tokyo Night' },
  { id: 'rosepine', name: 'Rose Pine' }, { id: 'catppuccin', name: 'Catppuccin' }, { id: 'slate', name: 'Slate' },
  { id: 'sand', name: 'Sand' }, { id: 'forest', name: 'Forest' },
];
// Spacing scales the whole window, text and gaps together, as Ctrl+zoom would.
export const SPACES = [
  { id: 'compact', name: 'Compact', zoom: 0.9 }, { id: 'normal', name: 'Normal', zoom: 1 },
  { id: 'roomy', name: 'Roomy', zoom: 1.1 }, { id: 'spacious', name: 'Spacious', zoom: 1.2 },
];
export const FONTS = [
  { id: 'inter', name: 'Inter', css: '"Inter","Segoe UI",system-ui,sans-serif' },
  { id: 'segoe', name: 'Segoe UI', css: '"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif' },
  { id: 'system', name: 'System', css: 'system-ui,sans-serif' },
  { id: 'plex', name: 'IBM Plex Sans', css: '"IBM Plex Sans","Segoe UI",system-ui,sans-serif' },
  { id: 'jetbrains', name: 'JetBrains Mono', css: '"JetBrains Mono","Cascadia Mono",Consolas,monospace' },
];
const pick = (list, v, d) => (list.some(x => x.id === v) ? v : d);

// The models a pane can start on, as Claude Code's --model aliases ('' leaves it out).
export const MODELS = ['', 'fable', 'opus', 'sonnet', 'haiku'];
const model = (v, d = '') => (MODELS.includes(v) ? v : d);

// The model a session starts on: group CTOs follow the CTO; `helper` is the AI helper.
// Leads always start on Claude's own default (#174), whatever an older file says.
export function modelFor(settings, id) {
  const s = normalizeSettings(settings), sid = String(id);
  if (sid === 'cto' || sid.startsWith('cto-')) return s.models.cto;
  if (sid === 'pm') return s.models.pm;
  if (sid === 'helper') return s.models.helper;
  return '';
}

// Whatever is in the file, kept to known keys and sane values.
export function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const size = Number(s.pmSize), split = Number(s.sideSplit);
  const m = s.models && typeof s.models === 'object' ? s.models : {};
  return {
    runPm: s.runPm === true,
    pmDock: DOCKS.includes(s.pmDock) ? s.pmDock : DEFAULTS.pmDock,
    pmSize: Number.isFinite(size) ? Math.min(900, Math.max(240, Math.round(size))) : DEFAULTS.pmSize,
    pmFolded: s.pmFolded === true,
    pmStartFolded: s.pmStartFolded === true,
    sideSplit: Number.isFinite(split) ? Math.min(0.85, Math.max(0.15, split)) : DEFAULTS.sideSplit,
    foldCto: s.foldCto === true,
    foldPm: s.foldPm === true,
    boardCompact: s.boardCompact === true,
    testBoards: Array.isArray(s.testBoards) ? [...new Set(s.testBoards.filter(b => typeof b === 'string'))] : [],
    models: { cto: model(m.cto), pm: model(m.pm, DEFAULTS.models.pm), helper: model(m.helper, DEFAULTS.models.helper), catchup: model(m.catchup, DEFAULTS.models.catchup) || DEFAULTS.models.catchup },
    catchUp: s.catchUp === 'lead' ? 'lead' : 'model',
    tags: Array.isArray(s.tags) ? cleanTags(s.tags) : [...DEFAULTS.tags],
    tavernLooks: Object.fromEntries(Object.entries(s.tavernLooks && typeof s.tavernLooks === 'object' ? s.tavernLooks : {})
      .filter(([k, v]) => k && Array.isArray(v) && v.length === 2 && v.every(Number.isInteger))),
    tavernRobots: Object.fromEntries(Object.entries(s.tavernRobots && typeof s.tavernRobots === 'object' ? s.tavernRobots : {})
      .filter(([k, v]) => k && typeof v === 'string' && /^[a-z0-9-]+$/.test(v))),
    remoteControl: s.remoteControl === true,
    backupPush: s.backupPush === true,
    plugins: normalizePluginsEntry(s.plugins),
    statusEvery: STATUS_EVERY.includes(Number(s.statusEvery)) ? Number(s.statusEvery) : DEFAULTS.statusEvery,
    theme: pick(THEMES, s.theme, DEFAULTS.theme),
    space: pick(SPACES, s.space, DEFAULTS.space),
    font: pick(FONTS, s.font, DEFAULTS.font),
    setupDone: s.setupDone === true,
    tourDone: s.tourDone === true,
    showMissed: s.showMissed !== false,
    showTavern: s.showTavern !== false,
  };
}

// A settings file from before #346 had Remote Control and the backup push always on: keep
// them on for it, so its owner's app behaves as before; a new install starts with both off.
// The file's contents with the missing keys added, or null when nothing changes.
export function upgradeSettings(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const s = { ...raw }, missing = ['remoteControl', 'backupPush'].filter(k => !(k in s));
  for (const k of missing) s[k] = true;
  return missing.length ? s : null;
}

// Tags as written: trimmed, no commas, at most 30 characters, each once whatever its case.
export function cleanTags(list) {
  const out = [];
  for (const t of list) {
    const v = String(t ?? '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
    if (v && !out.some(o => o.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out;
}
