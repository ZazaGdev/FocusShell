import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { moveAcross } from './localdata.js';

test('localdata: an older install\'s big folders move from Roaming to Local once; a newer copy wins (#1124)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localdata-')), roam = path.join(root, 'Roaming'), local = path.join(root, 'Local');
  for (const d of ['Partitions/persist_vscode', 'Cache', 'Network']) fs.mkdirSync(path.join(roam, d), { recursive: true });
  fs.writeFileSync(path.join(roam, 'Partitions', 'persist_vscode', 'x'), 'old');
  fs.mkdirSync(path.join(local, 'Network'), { recursive: true });
  const r = moveAcross(roam, local, ['Partitions', 'Cache', 'Network', 'IndexedDB']);
  assert.deepEqual(r, { moved: ['Partitions', 'Cache'], dropped: ['Network'], left: [] });
  assert.equal(fs.readFileSync(path.join(local, 'Partitions', 'persist_vscode', 'x'), 'utf8'), 'old');
  assert.equal(fs.existsSync(path.join(roam, 'Partitions')), false);
  assert.equal(fs.existsSync(path.join(roam, 'Network')), false, 'the Local copy is newer: the Roaming one goes');
  assert.deepEqual(moveAcross(roam, local, ['Partitions']), { moved: [], dropped: [], left: [] }, 'nothing left to move');
  assert.deepEqual(moveAcross(local, local, ['Cache']), { moved: [], dropped: [], left: [] }, 'same folder: untouched');
  fs.rmSync(root, { recursive: true, force: true });
});
