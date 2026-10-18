// Windows' voice typing bar as FocusShell sees it (#1083). Win+H toggles the bar, so a second
// "open" while it is open would close it, and a later "close" would open it again and leave it
// floating. Each call says whether to press Win+H: an open presses only when the bar is closed,
// a close only when FocusShell opened it.
export function voiceBar() {
  let open = false;
  return {
    open() { if (open) return false; open = true; return true; },
    close() { if (!open) return false; open = false; return true; },
    get isOpen() { return open; },
  };
}
