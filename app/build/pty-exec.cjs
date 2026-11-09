// node-pty's Mac helper, spawn-helper, comes from npm without its execute bit, and without it
// no pane can start on a Mac: "posix_spawnp failed" (#2562). Runs after npm install, and as
// electron-builder's afterPack for the packaged app. Does nothing on Windows.
const fs = require('fs');
const path = require('path');

function fix(root) {
  const base = path.join(root, 'node_modules', 'node-pty', 'prebuilds');
  let fixed = 0;
  for (const d of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    const f = path.join(base, d, 'spawn-helper');
    if (d.startsWith('darwin') && fs.existsSync(f)) { fs.chmodSync(f, 0o755); fixed++; }
  }
  return fixed;
}

// electron-builder: the packed app's own copy, inside FocusShell.app/Contents/Resources/app.
exports.default = async ctx => {
  if (ctx.electronPlatformName !== 'darwin') return;
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'app');
  console.log(`pty-exec: spawn-helper made executable in ${fix(app)} folder(s) of the packed app`);
};

if (require.main === module && process.platform !== 'win32') console.log(`pty-exec: spawn-helper made executable in ${fix(path.join(__dirname, '..'))} folder(s)`);
