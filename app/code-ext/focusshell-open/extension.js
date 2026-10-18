// A file clicked in FocusShell while its Code pane is open (#365): FocusShell writes a request
// { folder, file } into the folder named by FOCUSSHELL_OPEN_DIR, and the pane whose workspace is
// that folder opens the file as a new tab and removes the request. A request no pane takes is
// left for FocusShell, which then reloads the pane as before.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const key = p => { let r = p; try { r = fs.realpathSync.native(p); } catch { /* as given */ } return path.normalize(r).replace(/[\\/]+$/, '').toLowerCase(); };

function activate(context) {
  const dir = process.env.FOCUSSHELL_OPEN_DIR;
  if (!dir || !fs.existsSync(dir)) return;
  const mine = () => new Set((vscode.workspace.workspaceFolders || []).filter(f => f.uri.scheme === 'file').map(f => key(f.uri.fsPath)));
  let busy = false, again = false;
  const check = async () => {
    if (busy) { again = true; return; }
    busy = true;
    try {
      const roots = mine();
      let names = [];
      try { names = fs.readdirSync(dir).filter(n => n.endsWith('.json')); } catch { return; }
      for (const n of names) {
        const f = path.join(dir, n);
        let req = null;
        try { req = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
        if (!req || !req.folder || !req.file || !roots.has(key(req.folder))) continue;
        // Taken by renaming, so a second window on the same folder cannot open it again.
        const taken = `${f}.${process.pid}`;
        try { fs.renameSync(f, taken); } catch { continue; }
        try { await vscode.window.showTextDocument(vscode.Uri.file(req.file), { preview: false }); }
        catch { /* the file went away; FocusShell has already moved on */ }
        try { fs.rmSync(taken, { force: true }); } catch { /* gone */ }
      }
    } finally {
      busy = false;
      if (again) { again = false; check(); }
    }
  };
  let watcher = null;
  try { watcher = fs.watch(dir, () => check()); } catch { /* the timer below still sees requests */ }
  const timer = setInterval(check, 1000);
  context.subscriptions.push({ dispose: () => { clearInterval(timer); if (watcher) watcher.close(); } });
  check();
}

function deactivate() {}

module.exports = { activate, deactivate };
