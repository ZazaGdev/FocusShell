// In-app updates (#1088): when the installed app looks for a new version. No Node imports.

export const CHECK_EVERY_MS = 6 * 3600e3; // and once shortly after start

// Only the installed app updates itself: never a development run, a smoke or try run, or the Demo.
export function updatesOn({ packaged, smoke, tryRun, demo }) {
  return packaged === true && !smoke && !tryRun && !demo;
}

// The title bar's words for an update, or '' when there is nothing to show.
export function updateLabel(state) {
  return state && state.ready && state.latest ? `Update ready: v${state.latest}` : '';
}
