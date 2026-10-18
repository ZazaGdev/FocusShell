// Saved presets were replaced by groups (lib/groups.js).
// Recent: when each project was last opened, for the Home "Recent" row.

export function touchRecent(recent, name, now) {
  return { ...recent, [name]: now };
}

export function recentList(recent, n, exists = () => true) {
  return Object.entries(recent).filter(([k]) => exists(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

// The snapshot of the previous run's tabs, if it had any project open.
export function lastSession(ui) {
  if (!ui || !Array.isArray(ui.openTabs) || !ui.openTabs.length) return null;
  return { name: 'Last session', projects: ui.openTabs, layoutId: ui.layoutId || null, pinMgr: ui.pinMgr !== false };
}
