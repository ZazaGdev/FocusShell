// What a data watcher's event changed (#2928), so a board write sends only that board. kind is
// the watcher: 'tasks' (the boards folder), 'notes' (the notes file), 'ideas' or 'goals' (their
// folders), or anything else (always everything). name is the file name fs.watch gave, if any.
// lib/boardio.js writes a board as `<board>.md.<pid>.tmp` and renames it over the board, and
// the watcher sees that name first, so it counts as its board. Returns { board } for one board,
// { file: 'notes'|'ideas'|'goals' }, or { all: true } for an event with no name or any other name.
export function changeOf(kind, name) {
  const f = String(name || '').replace(/\.\d+\.tmp$/, '');
  if (!f) return { all: true };
  if (kind === 'tasks' && f.endsWith('.md') && !/[\\/]/.test(f)) return { board: f.slice(0, -3) };
  if (kind === 'notes') return { file: 'notes' };
  if ((kind === 'ideas' || kind === 'goals') && f === 'Me.md') return { file: kind };
  return { all: true };
}

// Whether a changed board's name differs only in case from another board name known (a file in
// the boards folder or a board already held): Windows lets `alphaboard.md` replace
// `AlphaBoard.md`, and a partial change would then keep both. Such a change reads everything.
export function caseClash(board, names) {
  const low = String(board).toLowerCase();
  return [...names].some(n => n !== board && String(n).toLowerCase() === low);
}
