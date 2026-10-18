// A question card's links and files (#416). Run through lib.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardLinks } from './links.js';

test('cardlinks: newest first, one per page across localhost and Tailscale, files too', () => {
  const task = {
    result: 'export the 37 s video? http://100.101.102.103:8731/tmp/caching-short/linkedin-review-draft.mp4',
    details: [
      'Review: http://localhost:8731/tmp/caching-preview/ and http://100.101.102.103:8731/tmp/caching-preview/',
      'Docs: https://code.claude.com/docs/en/prompt-caching: says 5 minutes',
      'Phone: http://100.101.102.103:8731/tmp/caching-short/linkedin-review-draft.mp4 PC: http://localhost:8731/tmp/caching-short/linkedin-review-draft.mp4 file D:\\SideProjects\\Brewlog\\tmp\\caching-short\\linkedin-review-draft.mp4',
    ],
  };
  const l = cardLinks(task);
  assert.deepEqual(l.map(x => x.label), ['linkedin-review-draft.mp4', 'linkedin-review-draft.mp4', 'prompt-caching', 'caching-preview']);
  assert.equal(l[0].href, 'http://localhost:8731/tmp/caching-short/linkedin-review-draft.mp4', 'the PC address wins');
  assert.equal(l[1].file, true);
  assert.equal(l[2].href, 'https://code.claude.com/docs/en/prompt-caching');
  assert.equal(l[3].href, 'http://localhost:8731/tmp/caching-preview/');
  assert.deepEqual(cardLinks({ text: 'no links', details: [] }), []);
  // Only a phone address: shown as the PC one. Asked for the phone: kept as it is.
  assert.equal(cardLinks({ result: 'see http://100.101.102.103:8731/a.mp4' })[0].href, 'http://localhost:8731/a.mp4');
  assert.deepEqual(cardLinks({ result: 'see http://100.101.102.103:8731/a.mp4', details: ['the owner asked for a phone link'] }).map(x => x.href), ['http://100.101.102.103:8731/a.mp4']);
});
