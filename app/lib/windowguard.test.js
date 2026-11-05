// Remote pages kept out of the app's IPC (#388). Run through lib.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trustedSender, opensOutside } from './windowguard.js';

test('windowguard: only the app\'s own files may use its IPC (#388)', () => {
  const app = 'file:///D:/SideProjects/FocusShell/app/';
  assert.equal(trustedSender('file:///D:/SideProjects/FocusShell/app/renderer/index.html', app), true);
  assert.equal(trustedSender('file:///d:/sideprojects/focusshell/app/plugins/recorder/area/bar.html', app), true);
  assert.equal(trustedSender('https://evil.example/', app), false);
  assert.equal(trustedSender('http://127.0.0.1:5000/', app), false);
  assert.equal(trustedSender('file:///C:/Users/x/Downloads/page.html', app), false);
  assert.equal(trustedSender('file:///D:/SideProjects/FocusShell/app-evil/x.html', app), false);
  assert.equal(trustedSender('data:text/html,hi', app), false);
  assert.equal(trustedSender(undefined, app), false);
  assert.equal(opensOutside('https://github.com'), true);
  assert.equal(opensOutside('file:///C:/x'), false);
  assert.equal(opensOutside('javascript:alert(1)'), false);
});
