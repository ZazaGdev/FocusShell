import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { keepPid, releasePid } from './pidfile.js';

test('pidfile: a second instance quitting leaves the first one\'s record; a missing record comes back (#1074)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focusshell-pid-')), f = path.join(dir, 'app.pid');
  assert.equal(keepPid(f, 100), true, 'the first instance writes its record');
  assert.equal(keepPid(f, 200), false, 'a second instance never overwrites it');
  assert.equal(releasePid(f, 200), false, 'the second instance quitting leaves it');
  assert.equal(fs.readFileSync(f, 'utf8'), '100');
  fs.unlinkSync(f);
  assert.equal(keepPid(f, 100), true, 'gone, the running instance puts it back');
  assert.equal(releasePid(f, 100), true, 'its own instance removes it on quit');
  assert.equal(fs.existsSync(f), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
