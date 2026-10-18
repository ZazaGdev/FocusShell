// Which pages may use FocusShell's IPC (#388): only the app's own files. A remote page that got
// into a window (a dropped link, a window.open) must never reach window.deck's handlers.

// frameUrl: the sender frame's URL; appUrl: the app folder as a file: URL ending in '/'.
export function trustedSender(frameUrl, appUrl) {
  if (typeof frameUrl !== 'string' || !frameUrl.startsWith('file:')) return false;
  let u;
  try { u = new URL(frameUrl); } catch { return false; }
  const base = String(appUrl).toLowerCase();
  return (u.protocol + '//' + u.host + u.pathname).toLowerCase().startsWith(base) && !/\/\.\.(\/|$)/.test(u.pathname);
}

// A window.open from one of the app's pages: web links go to the default browser, nothing opens
// inside the app.
export const opensOutside = url => /^https?:\/\//i.test(String(url));
