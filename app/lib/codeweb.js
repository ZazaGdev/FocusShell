// VS Code in a pane (#25): the installed VS Code serves its web workbench on a local
// port (`code serve-web`), and a pane shows it for one project's folder.

// The arguments for `code-tunnel.exe serve-web`: this PC only, a free port, a secret token,
// and FocusShell's own server data folder (#96), which holds the copied settings and extensions.
// The token goes in a file of this FocusShell's own (#201): given as --connection-token, the CLI
// writes it to one file shared by every serve-web on the PC, and a server started later (a
// smoke run, a second FocusShell) then made the running one answer "Forbidden.".
// `port` is the one the server had last time (#226): VS Code keeps trusted folders and the
// rest of its web state per address, so a new port each start forgot them. 0 picks a free one.
export function serveWebArgs(tokenFile, dataDir, port = 0) {
  const args = ['serve-web', '--host', '127.0.0.1', '--port', String(port || 0), '--connection-token-file', tokenFile, '--accept-server-license-terms'];
  return dataDir ? [...args, '--server-data-dir', dataDir] : args;
}

// The port from the server's "Web UI available at http://127.0.0.1:<port>" line, or null.
export function servePort(text) {
  const m = String(text || '').match(/Web UI available at https?:\/\/127\.0\.0\.1:(\d+)/);
  return m ? Number(m[1]) : null;
}

// A Windows path as VS Code writes it in a URL: D:\a\b becomes /d:/a/b.
const urlPath = dir => {
  const p = String(dir).replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[A-Za-z]:/.test(p) ? '/' + p[0].toLowerCase() + p.slice(1) : p;
};

// The pane's trusted folders (#226) live in the workbench's browser storage, under
// "content.trust.model.key", one entry per folder and server address. Given what is stored
// there (or nothing), the same with every one of `dirs` trusted on this port; null when
// nothing is missing. Folders the owner trusted by hand stay as they are.
export const TRUST_KEY = 'content.trust.model.key';
export function withTrusted(stored, port, dirs) {
  let model = { uriTrustInfo: [] };
  try { const m = JSON.parse(stored); if (m && Array.isArray(m.uriTrustInfo)) model = m; } catch { /* nothing stored yet */ }
  const authority = `127.0.0.1:${port}`;
  const have = new Set(model.uriTrustInfo.filter(e => e && e.trusted && e.uri && e.uri.authority === authority).map(e => String(e.uri.path).toLowerCase()));
  const add = dirs.map(urlPath).filter(p => { const k = p.toLowerCase(); if (have.has(k)) return false; have.add(k); return true; });
  if (!add.length) return null;
  return JSON.stringify({ ...model, uriTrustInfo: [...model.uriTrustInfo, ...add.map(p => ({ uri: { $mid: 1, scheme: 'vscode-remote', authority, path: p }, trusted: true }))] });
}

// The address that opens one folder, ?folder=/d:/a/b. With a file (#69) it also opens that
// file in an editor: VS Code's web workbench reads an "openFile" entry from its payload.
export function codeUrl(port, token, dir, file) {
  const url = `http://127.0.0.1:${port}/?tkn=${encodeURIComponent(token)}&folder=${encodeURIComponent(urlPath(dir))}`;
  if (!file) return url;
  const open = `vscode-remote://127.0.0.1:${port}${urlPath(file).split('/').map(encodeURIComponent).join('/').replace(/^\/([a-z])%3A/, '/$1:')}`;
  return `${url}&payload=${encodeURIComponent(JSON.stringify([['openFile', open]]))}`;
}

// Only pages from our own server may load in a Code pane.
export function isCodeUrl(url, port) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && u.hostname === '127.0.0.1' && Number(u.port) === port;
  } catch { return false; }
}

// Servers left running by an FocusShell that ended without stopping them (#196): processes
// started for our server data folder whose parent is gone, or is a newer process that took
// a dead parent's id. procs: [{ pid, ppid, created, cmd }], created in ms.
export function orphanServers(procs, dataDir) {
  const dir = String(dataDir).toLowerCase(), byPid = new Map(procs.map(p => [p.pid, p]));
  return procs.filter(p => String(p.cmd || '').toLowerCase().includes(dir)).filter(p => {
    const parent = byPid.get(p.ppid);
    return !parent || parent.created > p.created;
  }).map(p => p.pid);
}
