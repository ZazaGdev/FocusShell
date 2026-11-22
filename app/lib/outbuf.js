// A pane's output as the main process keeps it (#2928): the pieces as they came, with a running
// length, trimmed from the front once more than OUT_MAX characters are held, plus the last
// TAIL_MAX characters kept apart for the checks run on every piece. It replaces
// `buffer = (buffer + data).slice(-400000)`, which copied the whole buffer, up to ~800 KB, for
// every piece of output: most of the main process's garbage once the panes had printed a while.
export const OUT_MAX = 400_000, TAIL_MAX = 4000;

export function makeOut() {
  return { pieces: [], head: 0, length: 0, tail: '' };
}

export function addOut(o, data) {
  if (!data) return;
  const piece = data.length > OUT_MAX ? data.slice(-OUT_MAX) : data;
  o.pieces.push(piece);
  o.length += piece.length;
  // Whole pieces leave from the front while the rest still holds OUT_MAX; the last always stays.
  while (o.head < o.pieces.length - 1 && o.length - o.pieces[o.head].length >= OUT_MAX) {
    o.length -= o.pieces[o.head].length;
    o.pieces[o.head++] = undefined;
  }
  // The array drops its empty front now and then, not on every piece.
  if (o.head > 1024 && o.head * 2 > o.pieces.length) { o.pieces = o.pieces.slice(o.head); o.head = 0; }
  o.tail = data.length >= TAIL_MAX ? data.slice(-TAIL_MAX)
    : o.tail.length + data.length <= TAIL_MAX ? o.tail + data
    : o.tail.slice(data.length - TAIL_MAX) + data;
}

// The last n characters (n up to TAIL_MAX), from the tail. As `slice(-n)` did, n of 0 gives all of
// it: the whole tail here, where it gave the whole buffer.
export function lastOut(o, n) {
  return o.tail.slice(-n);
}

// The whole output kept: its last OUT_MAX characters, joined only when asked (a pane reopened).
export function wholeOut(o) {
  const s = o.pieces.slice(o.head).join('');
  return s.length > OUT_MAX ? s.slice(-OUT_MAX) : s;
}
