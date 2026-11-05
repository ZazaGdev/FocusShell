// Open and catch up's recap input (#1025). Run through lib.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardDigest, sessionDigest, yesterday, leadLine, ctoLine, catchupInput } from './catchup.js';

const MD = `# FocusShell tasks

- [~] #1025 Open and catch up (2026-10-18, lead-FocusShell-2)
  > Stopped at: renderer flow written, rules next
- [?] #1024 Simpler presets (2026-10-18, lead-FocusShell-2) -> NEEDS YOU #1024 | which flow?
- [ ] #1030 Recorder auto-delete (2026-10-18, user)
- [x] #1020 Remove the Personal strip (2026-10-18, lead-FocusShell-2) -> removed
  > Done: 2026-10-18 05:50
- [x] #900 Old work (2026-10-01, user)
  > Done: 2026-10-01 10:00
`;

test('catchup: the board part lists open work with where it stopped, and only recent Done', () => {
  const since = yesterday(new Date(2026, 9, 18, 9, 0));
  const d = boardDigest(MD, since);
  assert.ok(d.includes('#1025 Open and catch up (in progress)'));
  assert.ok(d.includes('Stopped at: renderer flow written, rules next'));
  assert.ok(d.includes('#1024 Simpler presets (waiting on the owner)'));
  assert.ok(!d.includes('#1030'), 'an open item nobody works on is left out');
  assert.ok(d.includes('#1020 Remove the Personal strip -> removed'));
  assert.ok(!d.includes('#900'));
  assert.equal(boardDigest('', since), 'Nothing in progress, waiting or blocked, and nothing done since yesterday.');
});

test('catchup: the session part keeps what was said since yesterday, never tool output', () => {
  const at = h => new Date(Date.UTC(2026, 9, 18, h)).toISOString();
  const log = [
    JSON.stringify({ type: 'user', timestamp: at(1), message: { content: 'old task' } }),
    JSON.stringify({ type: 'user', timestamp: at(9), message: { content: 'TASK #1025: catch up button' } }),
    JSON.stringify({ type: 'assistant', timestamp: at(10), message: { content: [{ type: 'text', text: 'Built the button.' }, { type: 'tool_use', name: 'Bash' }] } }),
    JSON.stringify({ type: 'user', timestamp: at(10), message: { content: [{ type: 'tool_result', content: 'secret output' }] } }),
  ].join('\n');
  const d = sessionDigest(log, Date.UTC(2026, 9, 18, 5));
  assert.equal(d, 'To the lead: TASK #1025: catch up button\nLead: Built the button.');
  assert.equal(sessionDigest(log, 0, 20).length, 20);
});

test('catchup: the lines for the lead and the CTO', () => {
  assert.equal(leadLine('D:\\x\\FocusShell-2026-10-18-0900.md'), 'CATCH UP: D:\\x\\FocusShell-2026-10-18-0900.md');
  assert.equal(leadLine(null), 'CATCH UP: write your own recap');
  assert.equal(ctoLine('FocusShell', 'D:\\x.md'), 'CATCH UP FocusShell: D:\\x.md');
  assert.ok(catchupInput({ project: 'A', board: 'b', git: '', sessions: '' }).includes('Git commits since yesterday:\nnone'));
});
