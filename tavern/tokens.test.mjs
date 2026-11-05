// The chalkboard's token counting (#272).
import test from 'node:test';
import assert from 'node:assert/strict';
import { usageTotals, agentName } from '../app/lib/tavern/tokens.js';

const line = (id, req, u) => JSON.stringify({ type: 'assistant', requestId: req, message: { id, usage: u } });

test('a reply logged once per content block is counted once', () => {
  const u = { input_tokens: 2, output_tokens: 300, cache_creation_input_tokens: 1000, cache_read_input_tokens: 50000 };
  const text = [line('m1', 'r1', u), line('m1', 'r1', u), line('m1', 'r1', u), line('m2', 'r2', u), '{"type":"user"}', 'not json'].join('\n');
  const t = usageTotals(text);
  assert.equal(t.replies, 2);
  assert.equal(t.fresh, 2 * (2 + 300 + 1000));
  assert.equal(t.cacheRead, 100000);
});

test('log folders are named after their agents', () => {
  assert.equal(agentName('D--SideProjects-FocusShell-manager'), 'CTO');
  assert.equal(agentName('D--SideProjects-FocusShell-pm'), 'PM');
  assert.equal(agentName('D--SideProjects-FocusShell'), 'lead-FocusShell');
  assert.equal(agentName('D--SideProjects-FocusShell-state-worktrees-Clipper-2'), 'lead-Clipper-2');
  assert.equal(agentName('D--BX-project'), 'lead-BX-project');
});
