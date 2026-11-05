// The installer's file list (#287): every file the app imports must be in package.json's
// build.files, or a packaged FocusShell fails to start with a missing module. Follows the local
// imports from main.js, preload.cjs and deck.mjs, and from every page script, and checks each
// file is covered (named, or under lib/, renderer/ or plugins/). Imported by lib.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = f => path.relative(APP, f).split(path.sep).join('/');

test('every file the app imports is in the installer file list (#287)', () => {
  const files = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')).build.files;
  const covered = f => files.includes(f) || /^(lib|renderer|plugins|node_modules)\//.test(f);
  const pages = [];
  const walk = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) { if (!/^(room|sketch)$/.test(e.name)) walk(f); } else if (/\.(js|mjs|cjs)$/.test(e.name)) pages.push(f); } };
  walk(path.join(APP, 'renderer'));
  const queue = [...['main.js', 'preload.cjs', 'deck.mjs'].map(f => path.join(APP, f)), ...pages], seen = new Set(), missing = [];
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    if (!covered(rel(f))) missing.push(rel(f));
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?:\bfrom|\bimport\(|\brequire\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const to = path.resolve(path.dirname(f), m[1]);
      if (fs.existsSync(to) && fs.statSync(to).isFile() && rel(to) !== '' && !rel(to).startsWith('..')) queue.push(to);
    }
  }
  assert.deepEqual(missing, [], `not in build.files: ${missing.join(', ')}`);
});

// #388: the CTO's rules run these from the data folder, so an installed copy needs them.
test('the installer seed ships the pane scripts and their module (#388)', () => {
  const seed = fs.readFileSync(path.join(APP, 'build', 'seed.mjs'), 'utf8');
  for (const f of ['open-pane.ps1', 'close-pane.ps1', 'ask-owner.ps1', 'src/FocusShell.psm1']) assert.ok(seed.includes(`'${f}'`), `seed.mjs does not ship ${f}`);
});
