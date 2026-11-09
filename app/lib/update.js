// In-app updates (#1088): when the installed app looks for a new version. No Node imports.

export const CHECK_EVERY_MS = 6 * 3600e3; // and once shortly after start

// Only the installed app updates itself: never a development run, a smoke or try run, or the Demo.
export function updatesOn({ packaged, smoke, tryRun, demo }) {
  return packaged === true && !smoke && !tryRun && !demo;
}

// The title bar's words for an update, or '' when there is nothing to show. On a Mac the
// unsigned app cannot install an update (#2562): it only says a new version is out, and the
// button opens the release page to download it.
export function updateLabel(state) {
  if (state && state.manual && state.latest) return `New version: v${state.latest}`;
  return state && state.ready && state.latest ? `Update ready: v${state.latest}` : '';
}
export const RELEASES_URL = 'https://github.com/ZazaGdev/FocusShell/releases/latest';
