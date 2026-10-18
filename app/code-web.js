// VS Code from FocusShell: a project opened in the VS Code app, and the Code pane (#25), one
// `code serve-web` serving every project inside the window. Kept out of main.js.
import { execFile, execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { projectForPath } from './lib/projects.js';
import { serveWebArgs, servePort, codeUrl, isCodeUrl, orphanServers } from './lib/codeweb.js';
import { syncServer, pageFiles, pageSyncScript, desktopThemeBase } from './lib/codesync.js';

// Whether a file's path is inside a folder (both real paths), ignoring case as Windows does.
const inside = (file, dir) => { const r = path.relative(dir.toLowerCase(), file.toLowerCase()); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };

// d: { ipcMain, app, shell, P, SMOKE, sessions, findProject, loadProjects }
export function registerCodeWeb(d) {
  const { ipcMain, app, shell, P, SMOKE, sessions, findProject, loadProjects } = d;
  // A project, or a file inside its project, opens in a VS Code window on that project's
  // folder (VS Code reuses the window if the folder is already open). A file outside every
  // project opens with its own folder. Without the `code` command, the vscode:// link is used.
  ipcMain.handle('project:code', async (_e, name, file) => {
    const f = file && /^[A-Za-z]:[\\/]/.test(file) && fs.existsSync(path.normalize(file)) ? path.normalize(file) : null;
    if (file && !f) return false;
    const p = name ? findProject(name) : projectForPath(loadProjects().projects, f);
    const folder = p ? p.path : f && (fs.statSync(f).isDirectory() ? f : path.dirname(f));
    if (!folder) return false;
    const exe = codeExe();
    // Started directly, never through cmd, so a path holding & or ^ cannot run anything.
    if (exe) spawn(exe, f && f !== folder ? [folder, f] : [folder], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    else shell.openExternal('vscode://file/' + (f || folder).split(path.sep).join('/'));
    return true;
  });
  // VS Code's own program: the usual install folders, then next to the `code` command on PATH.
  function codeExe() {
    const dirs = [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code'), path.join(process.env.ProgramFiles || '', 'Microsoft VS Code')];
    for (const d of (process.env.PATH || '').split(path.delimiter)) if (d && fs.existsSync(path.join(d, 'code.cmd'))) dirs.push(path.dirname(d));
    return dirs.map(d => path.join(d, 'Code.exe')).find(p => fs.existsSync(p)) || null;
  }

  // The Code pane (#25): one `code serve-web` from the installed VS Code serves every
  // project, on a free local port with a secret token. It starts on first use and stops
  // when FocusShell quits.
  let codeWeb = null;
  // The server's start steps (#1114), shown in every Code pane that is waiting: copy (old
  // servers ended, settings and extensions copied), start (until it prints its address), check
  // (it answers over HTTP). Each is '', 'now', 'done' or 'failed', with the time it took.
  let steps = {};
  const watchers = new Set();
  const tellSteps = () => { for (const wc of watchers) if (!wc.isDestroyed()) wc.send('code:steps', steps); };
  const step = (key, status) => { const t = Date.now(), was = steps[key]; steps = { ...steps, [key]: { status, ms: status === 'now' ? 0 : t - ((was && was.since) || t), since: status === 'now' ? t : (was && was.since) } }; tellSteps(); };
  function startCodeWeb() {
    if (codeWeb) return codeWeb.ready;
    const exe = codeExe(), cli = exe && path.join(path.dirname(exe), 'bin', 'code-tunnel.exe');
    if (!cli || !fs.existsSync(cli)) return Promise.resolve(null);
    const token = randomUUID();
    codeWeb = { child: null, token, port: 0 };
    steps = {};
    // A step that never finishes left every later click on "Starting" until a restart (#196):
    // the copy from desktop gets 20 seconds and then the server starts anyway, and a start
    // that fails is forgotten, so Retry starts afresh.
    const limit = (work, ms) => Promise.race([work, new Promise(r => setTimeout(r, ms))]);
    step('copy', 'now');
    codeWeb.ready = limit(stopOrphans(), 15000).then(() => limit(syncFromDesktop(), 20000))
      .then(() => { step('copy', 'done'); return codeWeb && codeWeb.token === token ? spawnCodeWeb(cli, token) : null; })
      .catch(() => null)
      .then(r => { if (!r && codeWeb && codeWeb.token === token) stopCodeWeb(); return r; });
    return codeWeb.ready;
  }
  // Whether the server really answers (#1114), not only that it printed its address: any HTTP
  // answer within ten seconds counts.
  const answers = port => new Promise(res => {
    const r = http.get({ host: '127.0.0.1', port, path: '/' }, s => { s.resume(); res(true); });
    r.on('error', () => res(false)); r.setTimeout(10000, () => { r.destroy(); res(false); });
  });
  // Ends servers for our data folder that an FocusShell which quit without stopping them left
  // running (#196); the server of an FocusShell still running keeps its parent and is left alone.
  function stopOrphans() {
    const ps = "Get-CimInstance Win32_Process | % { [pscustomobject]@{ pid = $_.ProcessId; ppid = $_.ParentProcessId; created = if ($_.CreationDate) { [long]($_.CreationDate.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds } else { 0 }; cmd = $_.CommandLine } } | ConvertTo-Json -Compress";
    return new Promise(resolve => execFile('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 15000, maxBuffer: 64 * 1024 * 1024 }, (err, out) => {
      let procs = [];
      try { procs = err ? [] : JSON.parse(String(out)); } catch { /* none */ }
      for (const pid of orphanServers(procs, CODE_SERVER)) { try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* gone */ } }
      resolve();
    }));
  }
  // The owner's Windows VS Code settings and extensions, copied one way before each start (#96).
  const CODE_USER = path.join(process.env.APPDATA || '', 'Code', 'User');
  // A smoke or try run from the same data folder as the running app (the main checkout) gets a
  // folder of its own (#1114): two servers on one folder, and an extension copy into the live
  // server's folder, are what the live server's log showed going wrong.
  const CODE_SERVER = path.join(P.state, SMOKE ? path.join('smoke', 'vscode-server') : 'vscode-server');
  let codeTheme = null; // the desktop theme's kind (vs, vs-dark, ...), so the pane waits for it
  // A file clicked while its pane is open goes to the pane as a request in CODE_OPEN, which
  // FocusShell's own extension in that pane opens as a new tab (#365).
  const CODE_EXT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'code-ext', 'focusshell-open');
  const CODE_OPEN = path.join(P.state, `vscode-open-${process.pid}`);
  async function syncFromDesktop() {
    codeTheme = await desktopThemeBase(CODE_USER);
    try { await syncServer({ userDir: CODE_USER, desktopExtDir: path.join(os.homedir(), '.vscode', 'extensions'), serverDir: CODE_SERVER, own: [CODE_EXT] }); }
    catch (e) { console.error('VS Code sync:', e.message); }
  }
  const CODE_TOKEN = path.join(P.state, `vscode-token-${process.pid}`); // this FocusShell's own (#201)
  // The server keeps its port from one start to the next (#226), so folders trusted in the
  // pane stay trusted. When that port is taken (a second FocusShell), a free one is used for
  // this run only; the first start picks one and remembers it.
  const CODE_PORT = path.join(P.state, 'vscode-port.json');
  const portFree = port => new Promise(resolve => {
    const s = net.createServer().once('error', () => resolve(false)).once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
  async function codePort() {
    if (SMOKE) return { port: 0, remember: false };
    let kept = 0;
    try { kept = Number(JSON.parse(fs.readFileSync(CODE_PORT, 'utf8')).port) || 0; } catch { /* first start */ }
    return { port: kept && await portFree(kept) ? kept : 0, remember: !kept };
  }
  async function spawnCodeWeb(cli, token) {
    fs.writeFileSync(CODE_TOKEN, token);
    const want = await codePort();
    try { fs.rmSync(CODE_OPEN, { recursive: true, force: true }); fs.mkdirSync(CODE_OPEN, { recursive: true }); } catch { /* clicks reload the pane instead */ }
    // FOCUSSHELL_CODE_CLI_DIR gives the CLI an empty cache of its own, so a test sees a new PC's
    // first start, server download and all (#1114).
    const cliDir = process.env.FOCUSSHELL_CODE_CLI_DIR ? ['--cli-data-dir', process.env.FOCUSSHELL_CODE_CLI_DIR] : [];
    const child = spawn(cli, [...serveWebArgs(CODE_TOKEN, CODE_SERVER, want.port), ...cliDir], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FOCUSSHELL_OPEN_DIR: CODE_OPEN } });
    codeWeb.child = child;
    step('start', 'now');
    const port = await new Promise(resolve => {
      let out = '', found = false;
      const seen = b => { out += b; const p = servePort(out); if (p && !found && codeWeb && codeWeb.child === child) { found = true; resolve(p); } };
      child.stdout.on('data', seen); child.stderr.on('data', seen);
      child.on('error', () => { if (codeWeb && codeWeb.child === child) codeWeb = null; resolve(0); });
      child.on('exit', () => { if (codeWeb && codeWeb.child === child) codeWeb = null; resolve(0); });
      setTimeout(() => resolve(0), 60000);
    });
    if (!port || !codeWeb || codeWeb.child !== child) { step('start', 'failed'); if (codeWeb && codeWeb.child === child) stopCodeWeb(); return null; }
    step('start', 'done'); step('check', 'now');
    if (!await answers(port)) { step('check', 'failed'); if (codeWeb && codeWeb.child === child) stopCodeWeb(); return null; }
    step('check', 'done');
    if (want.remember && !SMOKE) { try { fs.writeFileSync(CODE_PORT, JSON.stringify({ port })); } catch { /* next start */ } }
    codeWeb.port = port;
    return { port, token };
  }
  // code-tunnel starts the server as a child of its own, so the whole tree is ended.
  function stopCodeWeb() {
    if (!codeWeb) return;
    if (codeWeb.child) try { execFileSync('taskkill', ['/PID', String(codeWeb.child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* gone */ }
    try { fs.rmSync(CODE_TOKEN, { force: true }); } catch { /* gone */ }
    try { fs.rmSync(CODE_OPEN, { recursive: true, force: true }); } catch { /* gone */ }
    codeWeb = null;
  }
  // With a file inside the project (#69), that file opens in an editor too.
  // The workspace is the folder of the session the file was clicked in, when one is given (a
  // second lead's worktree, #126); a file outside it opens too, on its own.
  const real = d => { try { return fs.realpathSync.native(d); } catch { return d; } };
  async function paneDir(p, file, sessionId) {
    const f = file ? path.normalize(String(file)) : null;
    const ok = !!f && /^[A-Za-z]:[\\/]/.test(f) && fs.existsSync(f) && fs.statSync(f).isFile();
    const sess = sessionId ? sessions.get(sessionId) : null;
    let dir = sess && sess.cwd && fs.existsSync(sess.cwd) ? sess.cwd : p.path;
    // A file outside that folder (#292), such as one in a worktree elsewhere, opens with its own
    // git root as the workspace, or its folder when it is in no repository.
    if (ok && !inside(real(f), real(dir))) {
      const top = await new Promise(res => execFile('git', ['-C', path.dirname(f), 'rev-parse', '--show-toplevel'], { timeout: 5000, windowsHide: true }, (err, out) => res(err ? '' : String(out).trim())));
      dir = top ? path.normalize(top) : path.dirname(f);
    }
    return { f: ok ? f : null, dir };
  }
  const paneDirs = new Map(); // project -> the folder its open pane was given
  // A file for a pane already open on the same folder opens there as a new tab, without
  // reloading it (#365): true once the pane's extension took the request, false to reload.
  ipcMain.handle('code:open', async (_e, name, file, sessionId) => {
    const p = findProject(name);
    if (!p || !codeWeb || !codeWeb.port || !paneDirs.has(name)) return false;
    const { f, dir } = await paneDir(p, file, sessionId);
    if (!f || real(dir).toLowerCase() !== real(paneDirs.get(name)).toLowerCase()) return false;
    const req = path.join(CODE_OPEN, `${randomUUID()}.json`);
    try { fs.writeFileSync(req, JSON.stringify({ folder: dir, file: f })); } catch { return false; }
    for (let i = 0; i < 40; i++) {
      if (!fs.existsSync(req)) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    try { fs.rmSync(req, { force: true }); } catch { /* taken just now */ }
    return false;
  });
  // What VS Code needs to work in the Code pane (#1114), checked where it can be: installed,
  // its version, the internet its first start downloads the server over, and the local port.
  ipcMain.handle('code:requirements', async () => {
    if (SMOKE) return { installed: 'C:\\Program Files\\Microsoft VS Code', version: '1.141.1', internet: true, port: true };
    const exe = codeExe(), dir = exe ? path.dirname(exe) : '';
    let version = '';
    try { version = JSON.parse(fs.readFileSync(path.join(dir, 'resources', 'app', 'package.json'), 'utf8')).version || ''; } catch { /* a newer layout keeps it elsewhere */ }
    // A newer VS Code keeps each version in a folder named after its commit; the newest is in use.
    if (!version && dir) {
      try {
        const sub = fs.readdirSync(dir).filter(n => /^[0-9a-f]{10}$/.test(n)).map(n => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
        if (sub) version = JSON.parse(fs.readFileSync(path.join(dir, sub.n, 'resources', 'app', 'package.json'), 'utf8')).version || '';
      } catch { /* unknown */ }
    }
    const internet = await new Promise(res => { const r = https.get('https://update.code.visualstudio.com/', s => { s.resume(); res(true); }); r.on('error', () => res(false)); r.setTimeout(5000, () => { r.destroy(); res(false); }); });
    // A running server answers on its port; before one runs, a local port can be opened at all.
    const port = codeWeb && codeWeb.port ? await answers(codeWeb.port) : await portFree(0);
    return { installed: dir, version, internet, port };
  });
  // The Code pane's start log (#1114): one line per step of each try, so a start that hangs
  // shows where. Kept short: the newest 300 lines.
  const CODE_LOG = path.join(P.state, SMOKE ? 'smoke-code-log.txt' : 'code-log.txt');
  ipcMain.on('code:log', (_e, line) => {
    try {
      const d = new Date(), p = n => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
      const old = fs.existsSync(CODE_LOG) ? fs.readFileSync(CODE_LOG, 'utf8').split('\n').filter(Boolean).slice(-299) : [];
      fs.writeFileSync(CODE_LOG, [...old, `${stamp} ${String(line).slice(0, 300)}`].join('\n') + '\n');
    } catch { /* best effort */ }
  });
  // A smoke run's hung start (#1114): the pane is pointed at a local server that answers the
  // way VS Code's does while its server download never finishes (the "is downloading" page
  // that reloads itself), so the step shown, the retries and the error can be checked.
  let hang = null;
  if (SMOKE) ipcMain.handle('code:hang', async (_e, on) => {
    if (hang) { hang.closeAllConnections?.(); hang.close(); hang = null; }
    if (!on) return 0;
    hang = http.createServer((_req, res) => {
      res.writeHead(202, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>Visual Studio Code</title><body>The latest version of the Visual Studio Code Server is downloading, please wait a moment...<script>setTimeout(()=>location.reload(),1500)</script></body>');
    });
    await new Promise(r => hang.listen(0, '127.0.0.1', r));
    return hang.address().port;
  });
  ipcMain.handle('code:url', async (e, name, file, sessionId) => {
    const p = findProject(name);
    if (!p) return { error: `No project named ${name}` };
    watchers.add(e.sender); e.sender.send('code:steps', steps);
    if (hang) { steps = { copy: { status: 'done', ms: 0 }, start: { status: 'done', ms: 0 }, check: { status: 'done', ms: 0 } }; tellSteps(); return { url: `http://127.0.0.1:${hang.address().port}/`, theme: null, trust: null }; }
    const { f, dir } = await paneDir(p, file, sessionId);
    paneDirs.set(name, dir);
    const s = await startCodeWeb();
    if (!s) {
      const failed = Object.keys(steps).find(k => steps[k].status === 'failed');
      return { error: !codeExe() ? 'VS Code is not installed on this PC.'
        : failed === 'check' ? 'The VS Code server started but does not answer. A firewall or antivirus may be blocking code-tunnel.exe.'
        : failed === 'start' ? 'The VS Code server did not start within a minute.'
        : 'Could not start VS Code.', missing: !codeExe() };
    }
    // Every listed project's folder is trusted in the pane from the start (#226), as is the
    // folder it opens (a lead's worktree); a folder reached through a link both ways.
    const dirs = [...loadProjects().projects.map(x => x.path), dir].filter(Boolean).flatMap(d => [d, real(d)]);
    return { url: codeUrl(s.port, s.token, dir, f), theme: codeTheme, trust: { port: s.port, dirs } };
  });
  // A clicked path that is a file on disk, normalised, or null (a folder, or not there).
  ipcMain.handle('path:file', (_e, file) => {
    const f = /^[A-Za-z]:[\\/]/.test(String(file || '')) ? path.normalize(String(file)) : null;
    try { return f && fs.statSync(f).isFile() ? f : null; } catch { return null; }
  });
  // The project a file belongs to (the deepest folder that holds it), or null. A path through
  // a link (G:\SideProjects is a link to D:\SideProjects) is matched by real path too.
  ipcMain.handle('project:forFile', (_e, file) => {
    const f = /^[A-Za-z]:[\\/]/.test(String(file || '')) ? path.normalize(String(file)) : null;
    const real = p => { try { return fs.realpathSync.native(p); } catch { return p; } };
    const list = loadProjects().projects;
    const p = f && fs.existsSync(f) ? projectForPath(list, f) || projectForPath(list.map(x => ({ ...x, path: real(x.path) })), real(f)) : null;
    return p ? p.name : null;
  });
  // A Code pane may only show our own server; links it opens go to the browser.
  app.on('web-contents-created', (_e, wc) => {
    wc.on('will-attach-webview', (ev, prefs, params) => {
      delete prefs.preload;
      prefs.nodeIntegration = false; prefs.contextIsolation = true; prefs.sandbox = true;
      if (!codeWeb || !isCodeUrl(params.src, codeWeb.port)) ev.preventDefault();
    });
    if (wc.getType() !== 'webview') return;
    wc.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    wc.on('will-navigate', (ev, url) => { if (!codeWeb || !isCodeUrl(url, codeWeb.port)) ev.preventDefault(); });
    wc.on('dom-ready', () => syncPage(wc, 0));
  });
  // Keybindings and snippets live in the page's own storage, so they are written there; the
  // page reloads once when they changed. Its storage appears a moment after the page starts.
  async function syncPage(wc, tries) {
    if (wc.isDestroyed() || !codeWeb || !isCodeUrl(wc.getURL(), codeWeb.port)) return;
    let r = 'not-ready';
    try { r = await wc.executeJavaScript(pageSyncScript(pageFiles(CODE_USER))); } catch { /* page went away */ }
    if (r === 'changed' && !wc.isDestroyed()) wc.reload();
    else if (r === 'not-ready' && tries < 10) setTimeout(() => syncPage(wc, tries + 1), 2000);
  }
  return { stopCodeWeb };
}
