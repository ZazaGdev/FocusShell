import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trustQuestion, trustKeys, joined } from './joined.js';

test('joined: the trust question is spotted on screen, and a session has joined once its file names it (#1113)', () => {
  assert.equal(trustQuestion('Quick safety check: Is this a project you created or one you trust?\n> No, exit\n Yes, I trust this folder\n Enter to confirm · Esc to cancel'), true);
  assert.equal(trustQuestion('Yes,Itrustthisfolder\r\n\r\nEntertoconfirm'), true, 'ConPTY drops the spaces');
  assert.equal(trustQuestion('Do you want to proceed?\n 1. Yes\n 2. No'), false);
  // As Claude Code 2.1.302 draws it: No highlighted first, so Down then Enter.
  const shown = 'Security guide\r\n\r\n>No,exit\r\nYes,Itrustthisfolder\r\n\r\nEntertoconfirm·Esctocancel';
  assert.equal(trustKeys(shown), '\x1b[B\r');
  assert.equal(trustKeys('> 1. Yes, I trust this folder\n  2. No, exit\nEnter to confirm'), '\r');
  assert.equal(trustKeys('  1. Yes, I trust this folder\n❯ 2. No, exit\nEnter to confirm'), '\x1b[A\r');
  assert.equal(trustKeys('Yes, I trust this folder\nNo, exit'), null, 'no highlight to read: no answer');
  const since = 1_000_000;
  const files = [
    { name: 'cto', messagingSocketPath: '\\\\.\\pipe\\LOCAL\\cc-msg-a', startedAt: since - 500e3 },
    { name: 'lead-Habitly', messagingSocketPath: '\\\\.\\pipe\\LOCAL\\cc-msg-b', startedAt: since + 4e3 },
  ];
  assert.equal(joined(files, 'lead-Habitly', since), true);
  assert.equal(joined(files, 'lead-NoteNest', since), false, 'not there: not joined');
  assert.equal(joined(files, 'cto', since), false, 'an older session of that name is not this one');
  assert.equal(joined([{ pid: 1 }], 'lead-Habitly', since), null, 'files of another shape: unknown, no warning');
  assert.equal(joined([], 'lead-Habitly', since), null);
});
