import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTasks } from './tasks.js';
import { sortCmp, byAdded, normalizeSort, tagMatch, normalizeTagFilter } from './boardsort.js';

const md = ['- [ ] #1 Old (2026-10-01, user)', '  > Priority: 1', '  > Tags: Research, apk',
  '- [ ] #2 New (2026-10-09, user)', '  > Tags: Research',
  '- [ ] #3 Middle (2026-10-05, user)', '  > Priority: 2',
  '- [ ] #4 Same day, later number (2026-10-09, user)'].join('\n');

test('board sort: priority by default, date added newest first, flipped oldest first', () => {
  const ts = parseTasks(md);
  assert.deepEqual([...ts].sort(sortCmp(null)).map(t => t.n), [1, 3, 2, 4]);
  assert.deepEqual([...ts].sort(sortCmp({ by: 'added' })).map(t => t.n), [4, 2, 3, 1]);
  assert.deepEqual([...ts].sort(sortCmp({ by: 'added', old: true })).map(t => t.n), [1, 3, 2, 4]);
  assert.deepEqual([{ n: 1, date: '' }, { n: 2, date: '2026-10-01' }].sort(byAdded()).map(t => t.n), [2, 1]); // undated last
  assert.deepEqual(normalizeSort({ by: 'nope', old: 1 }), { by: 'priority', old: true });
});

test('board tag filter: Or shows any picked tag, And only all of them', () => {
  const ts = parseTasks(md);
  const pass = f => ts.filter(t => tagMatch(t, f)).map(t => t.n);
  assert.deepEqual(pass(null), [1, 2, 3, 4]);
  assert.deepEqual(pass({ tags: ['research', 'apk'] }), [1, 2]);
  assert.deepEqual(pass({ tags: ['Research', 'apk'], mode: 'and' }), [1]);
  assert.deepEqual(normalizeTagFilter({ tags: ['a', 3], mode: 'x' }), { tags: ['a'], mode: 'or' });
});
