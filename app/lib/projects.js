// projects.json (written by Windows PowerShell, so it may carry a BOM) and
// Claude Code's record of trusted folders in ~/.claude.json.

export function parseProjects(text) {
  const c = JSON.parse(String(text).replace(/^﻿/, ''));
  c.projects = c.projects || [];
  c.lastSelected = c.lastSelected || [];
  return c;
}

export function trustedPaths(claudeJsonText) {
  const d = JSON.parse(String(claudeJsonText).replace(/^﻿/, ''));
  return Object.entries(d.projects || {})
    .filter(([, v]) => v && v.hasTrustDialogAccepted === true)
    .map(([k]) => k);
}

const normPath = p => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export function isTrusted(path, trusted) {
  const want = normPath(path);
  return trusted.some(t => normPath(t) === want);
}

// Every folder under a scan root is a project, named after the folder.
// projects.json entries add settings (a test command) to a folder, matched by path.
// Folder names are the project names, so names never collide with paths.
// `real` maps a path to its real folder (links and junctions resolved), so one
// folder reached through two drive letters is still one project.
export function mergeProjects(explicit, folders, excludeDir, real = p => p) {
  const norm = p => normPath(real(p));
  const byPath = new Map(explicit.map(p => [norm(p.path), p]));
  const out = [];
  const seen = new Set();
  for (const f of folders) {
    const key = norm(f.path);
    if (key === norm(excludeDir) || seen.has(key)) continue;
    seen.add(key);
    const e = byPath.get(key);
    out.push({ name: f.name, path: f.path, test: e ? e.test || '' : '', kind: kindOf(e), model: modelOf(e) });
  }
  // Explicit entries outside the scan roots still count.
  for (const p of explicit) {
    const key = norm(p.path);
    if (seen.has(key) || key === norm(excludeDir)) continue;
    seen.add(key);
    out.push({ name: p.name, path: p.path, test: p.test || '', kind: kindOf(p), model: modelOf(p) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

// A project's kind: 'personal' for the owner's private agent (#177), else '' (code).
const kindOf = e => (e && e.kind === 'personal' ? 'personal' : '');
// A project's Claude model (#1115), kept in its projects.json entry: one of Claude Code's
// --model aliases, or '' for Claude's own default.
export const PROJECT_MODELS = ['', 'fable', 'opus', 'sonnet', 'haiku'];
const modelOf = e => (e && PROJECT_MODELS.includes(e.model) ? e.model : '');
// projects.json's entries with one project's model set ('' takes it off), adding an entry for
// a folder that only came from a projects folder. Unchanged when the model is not known.
export function withProjectModel(entries, project, model) {
  if (!PROJECT_MODELS.includes(model) || !project) return entries;
  const list = Array.isArray(entries) ? entries : [];
  const key = normPath(project.path);
  const has = list.some(e => e && normPath(e.path || '') === key);
  const set = e => { const { model: _old, ...rest } = e; return model ? { ...rest, model } : rest; };
  return has ? list.map(e => (e && normPath(e.path || '') === key ? set(e) : e)) : model ? [...list, { name: project.name, path: project.path, test: '', model }] : list;
}

// The project whose folder holds this path (the deepest one, if folders nest), or null.
export function projectForPath(projects, file) {
  const f = normPath(file);
  return projects.filter(p => f === normPath(p.path) || f.startsWith(normPath(p.path) + '/'))
    .sort((a, b) => normPath(b.path).length - normPath(a.path).length)[0] || null;
}

// A project's pane colour in a split (#333): one of `count` colours, the same every run.
export function paneColour(name, count) {
  let n = 0;
  for (const ch of String(name).toLowerCase()) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return n % count;
}
