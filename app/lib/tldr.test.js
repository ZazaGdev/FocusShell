// A card's TLDR line (#1000). Run through lib.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tldr, askOf, gist } from './tldr.js';

test('gist: whole sentences up to about four lines, never "..." (#1033, #1038)', () => {
  const long = 'The launcher pops up on start. Windows shows it when a text box gets focus. There is no per-app switch for it. A private hint would cover the whole window. Card boxes would lose Win+H then. So only the owner can switch it off.';
  const g = gist(long);
  assert.ok(g.length <= 260 && g.endsWith('.') && !g.includes('...'));
  assert.ok(g.startsWith('The launcher pops up on start. Windows shows it'));
  assert.equal(gist('One short question?'), 'One short question?');
  const one = 'x'.repeat(300) + '.';
  assert.equal(gist(one), one);
  // A dot inside a link is not the end of a sentence (#1045).
  assert.equal(gist('Which flow? Demo http://127.0.0.1:5391/groups.html (5 steps)'), 'Which flow? Demo http://127.0.0.1:5391/groups.html (5 steps)');
});

test('tldr: the task and its ask, or the question, whole and never cut with "..." (#1038)', () => {
  assert.equal(tldr({ project: 'FocusShell', n: 411, title: 'Task IDs', ask: "Needs you: OK with that rule, or would you rather pick the key yourself when there's a clash? I'd keep the rule, it is simpler." }),
    "FocusShell #411 Task IDs: OK with that rule, or would you rather pick the key yourself when there's a clash?");
  assert.equal(tldr({ project: 'Brewlog', n: 304, title: 'Prompt caching explainer visuals (LinkedIn, X, Short)', ask: 'export the 37 s video?' }),
    'Brewlog #304 Prompt caching explainer visuals (LinkedIn, X, Short): export the 37 s video?');
  assert.equal(tldr({ ask: 'Needs you: swap the "edited message" scene to editing the pinned card, meaning a changed CLAUDE.md, an added tool, or a switched model? I would.' }),
    'swap the "edited message" scene to editing the pinned card, meaning a changed CLAUDE.md, an added tool, or a switched model?');
  assert.equal(tldr({ project: 'FocusShell', n: 1022, title: 'Right click clears drawing and add shape presets: shapes in the recorder\'s drawing tool are rectangle and more' }).includes('...'), false);
  assert.equal(askOf('NEEDS YOU #901 | Which format for the export? | options: MP4'), 'Which format for the export?');
  assert.equal(tldr({ ask: 'Short one?' }), 'Short one?');
  assert.equal(tldr({ project: 'BX', n: 902, title: 'Login screen layout', ask: 'Login screen layout' }), 'BX #902 Login screen layout');
});
