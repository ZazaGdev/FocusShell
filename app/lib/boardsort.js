// The Board's sort and tag filter (#293). Sort: by priority (the default) or by date added,
// newest first or flipped to oldest first. Tags: any of the picked tags (Or) or all of them
// (And), as Azure Boards' Tags filter does. Pure logic, shared by the Board and project boards.
import { byPriority } from './plan.js';
import { hasTag } from './tasks.js';

export const SORTS = [['priority', 'Priority'], ['added', 'Date added']];
export const normalizeSort = s => ({ by: s && s.by === 'added' ? 'added' : 'priority', old: !!(s && s.old) });

// Items without a date sort after dated ones; the same date falls back to the item number.
export const byAdded = (old = false) => (a, b) => {
  const da = a.date || '', db = b.date || '';
  if (da !== db) { if (!da) return 1; if (!db) return -1; return old ? da.localeCompare(db) : db.localeCompare(da); }
  return old ? a.n - b.n : b.n - a.n;
};
// The comparator for a sort setting.
export const sortCmp = s => (normalizeSort(s).by === 'added' ? byAdded(normalizeSort(s).old) : byPriority);

export const normalizeTagFilter = f => ({ tags: Array.isArray(f && f.tags) ? f.tags.filter(x => typeof x === 'string') : [], mode: f && f.mode === 'and' ? 'and' : 'or' });
// Whether an item passes the tag filter; nothing picked passes everything.
export function tagMatch(t, f) {
  const { tags, mode } = normalizeTagFilter(f);
  if (!tags.length) return true;
  return mode === 'and' ? tags.every(x => hasTag(t, x)) : tags.some(x => hasTag(t, x));
}
