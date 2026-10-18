// Hold to talk sends on release (#415). Run through lib.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readyToSend, MAX_WAIT } from './talk.js';

test('talk: Enter goes once the pane is quiet after the release, never too soon, never stuck', () => {
  const r = 10000;
  assert.equal(readyToSend({ now: r + 200, releasedAt: r, lastOutput: 0 }), false, 'too soon after the release');
  assert.equal(readyToSend({ now: r + 900, releasedAt: r, lastOutput: r + 500 }), false, 'still writing the words');
  assert.equal(readyToSend({ now: r + 1600, releasedAt: r, lastOutput: r + 500 }), true, 'quiet for a second');
  assert.equal(readyToSend({ now: r + MAX_WAIT, releasedAt: r, lastOutput: r + MAX_WAIT - 10 }), true, 'a busy pane still gets it');
});

import { voiceBar } from './voicebar.js';
test('voice bar: starts while it is open press nothing, so the stop always closes it (#1083)', () => {
  // Win+H toggles Windows' bar: count what the screen would show after the presses.
  let shown = false;
  const b = voiceBar(), start = () => { if (b.open()) shown = !shown; }, stop = () => { if (b.close()) shown = !shown; };
  start(); start(); start(); start(); // a held talk key, or the mic clicked again
  assert.equal(shown, true, 'open after the first start');
  stop();
  assert.equal(shown, false, 'the stop closes it');
  stop();
  assert.equal(shown, false, 'a second stop presses nothing, so it does not open again');
  start(); stop();
  assert.equal(shown, false);
});
