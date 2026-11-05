// Names the dev run's electron.exe "FocusShell" (#191). Windows names a notification's
// sender after the Start Menu shortcut Electron keeps for it, and Electron names that
// shortcut after its exe's product name, so from node_modules it was "Electron.lnk" and
// every notification said Electron. Runs after npm install and from install.ps1.
// A running electron.exe cannot be written, but it can be renamed: the patched copy takes
// its place and the old one is deleted on a later run.
const fs = require('fs');
const path = require('path');
const ResEdit = require('resedit');

const NAME = 'FocusShell';
const exe = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
if (process.platform !== 'win32' || !fs.existsSync(exe)) process.exit(0);
const dir = path.dirname(exe);
for (const f of fs.readdirSync(dir).filter(f => f.startsWith('electron.exe.old'))) {
  try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* still running */ }
}

const pe = ResEdit.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(pe);
const infos = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
if (!infos.length) { console.log('name-electron: no version info, left as it is'); process.exit(0); }
const named = v => v.getAllLanguagesForStringValues().every(l => v.getStringValues(l).ProductName === NAME);
if (infos.every(named)) {
  console.log(`name-electron: already ${NAME}`); process.exit(0);
}
for (const v of infos) {
  for (const lang of v.getAllLanguagesForStringValues()) v.setStringValues(lang, { ProductName: NAME, FileDescription: NAME });
  v.outputToResourceEntries(res.entries);
}
res.outputResource(pe);
const next = exe + '.new';
fs.writeFileSync(next, Buffer.from(pe.generate()));
fs.renameSync(exe, `${exe}.old-${Date.now()}`);
fs.renameSync(next, exe);
console.log(`name-electron: ${exe} is now ${NAME}`);
