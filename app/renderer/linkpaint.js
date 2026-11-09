// Links in a pane stand out as soon as they are printed, not only on hover (#348). The rows
// on screen go through the pane's own link provider, the one that makes them clickable, so
// what is coloured is exactly what a click opens: web links, Windows paths, a link wrapped
// over two rows, a bare file name the pane resolved. Each link gets one xterm decoration per
// row it covers; decorations sit on buffer lines, so they scroll with their text, and a
// resize scans again because the text reflows.
// Claude Code redraws rows in place while it works, so paint whose row no longer holds the
// text it was put on goes at once, and a scan paints only rows still as it read them (#1886).
import { stillPainted } from '../lib/links.js';
export const LINK_COLOUR = '#7fb2ff';
const EVERY = 250;    // at most one scan this often while output keeps coming
const JOINS = 5;      // rows above and below that can change a row's links (MAX_JOINS + 1)
const KEEP = 2000;    // rows' results remembered
const SPAN = 60;      // rows read around the screen, enough for any link a row on it touches

export function paintLinks(term, provider, isShown) {
  let decos = [], painted = [], timer = 0, lastSig = '', busy = false, dirty = false;
  const cache = new Map(); // the text around a row -> the link ranges the provider gave it, and the text of the rows they cover
  const text = (buf, r) => { const l = buf.getLine(r); return l ? l.translateToString(false) : ''; };
  // xterm draws a decoration's colour only when its row is next drawn, so rows are redrawn
  // whenever paint comes or goes, or what shows would lag behind (#1886).
  const redraw = () => term.refresh(0, term.rows - 1);
  const clear = () => { for (const d of decos) d.dispose(); decos = []; painted = []; };

  // The links the provider finds on row y (1-based), from the cache when the rows that can
  // change them, and the rows the links cover, are the same as last time.
  const linksOn = (buf, y) => {
    const around = [];
    for (let r = y - 1 - JOINS; r <= y - 1 + JOINS; r++) around.push(text(buf, r));
    const key = `${y}|${term.cols}|${around.join('\n')}`, hit = cache.get(key);
    if (hit && hit.rows.every(([r, s]) => text(buf, r) === s)) return Promise.resolve(hit.ranges);
    const rows = new Map();
    for (let r = y - 1 - SPAN; r <= y - 1 + SPAN; r++) rows.set(r, text(buf, r));
    return new Promise(res => provider.provideLinks(y, links => {
      const ranges = (links || []).map(l => l.range);
      cache.set(key, { ranges, rows: ranges.flatMap(g => Array.from({ length: g.end.y - g.start.y + 1 }, (_, k) => [g.start.y - 1 + k, rows.get(g.start.y - 1 + k)])) });
      if (cache.size > KEEP) cache.delete(cache.keys().next().value);
      res(ranges);
    }));
  };

  // Paint whose row now holds other text goes (#1886).
  const prune = () => {
    const buf = term.buffer.active, keep = [];
    for (const d of decos) {
      if (!d.marker.isDisposed && text(buf, d.marker.line) === d.text) keep.push(d);
      else d.dispose();
    }
    if (keep.length === decos.length) return;
    decos = keep; painted = keep.map(d => d.at);
    redraw();
  };

  const scan = async () => {
    timer = 0;
    // One scan at a time: a newer one waits for it, so a pane that keeps printing still gets
    // its paint instead of every scan giving way to the next.
    if (busy) { dirty = true; return; }
    const buf = term.buffer.active;
    if (buf.type !== 'normal' || !isShown()) return;
    const top = buf.viewportY, rows = [];
    for (let r = top; r < top + term.rows; r++) rows.push(text(buf, r));
    const sig = `${top}|${term.cols}|${rows.join('\n')}`;
    if (sig === lastSig) return;
    lastSig = sig; busy = true;
    try {
      // The rows as read now, to paint only those still the same once the links are back.
      const before = new Map();
      for (let r = top - SPAN; r < top + term.rows + SPAN; r++) before.set(r, text(buf, r));
      // Once the scrollback is full, each new line drops the oldest and every row's index
      // moves up by one. The links come back after disk lookups, so a marker on the cursor's
      // line tells how far the rows moved meanwhile (#374).
      const anchor = term.registerMarker(0), was = anchor ? anchor.line : -1;
      const per = await Promise.all(rows.map((_, k) => linksOn(buf, top + k + 1)));
      const lost = !anchor || anchor.isDisposed, moved = lost ? 0 : was - anchor.line;
      if (anchor) anchor.dispose();
      // The scrollback was cleared meanwhile: nothing read can be placed, so read again.
      if (lost) { lastSig = ''; dirty = true; return; }
      const found = new Map();
      for (const ranges of per) for (const g of ranges) found.set(`${g.start.x},${g.start.y},${g.end.x},${g.end.y}`, g);
      const now = r => text(buf, r - moved);
      // Rows rewritten meanwhile printed something, so the scan after this one reads them again.
      const keep = [...found.values()].filter(g => stillPainted(g, before, now));
      clear();
      const cursor = buf.baseY + buf.cursorY + moved;
      for (const g of keep) {
        for (let y = g.start.y; y <= g.end.y; y++) {
          const x0 = y === g.start.y ? g.start.x - 1 : 0, x1 = y === g.end.y ? g.end.x : term.cols;
          if (x1 <= x0) continue;
          const marker = term.registerMarker(y - 1 - cursor);
          if (!marker) continue;
          const deco = term.registerDecoration({ marker, x: x0, width: x1 - x0, foregroundColor: LINK_COLOUR, layer: 'top' });
          if (!deco) { marker.dispose(); continue; }
          deco.onRender(el => el.classList.add('tlinkpaint'));
          const at = { y: y - moved, x: x0, width: x1 - x0 };
          decos.push({ marker, text: text(buf, marker.line), at, dispose: () => { deco.dispose(); marker.dispose(); } });
          painted.push(at);
        }
      }
      redraw();
    } finally {
      busy = false;
      if (dirty) { dirty = false; soon(); }
    }
  };
  const soon = () => { if (!timer) timer = setTimeout(scan, EVERY); };
  const again = () => { lastSig = ''; soon(); };
  const subs = [term.onWriteParsed(() => { prune(); soon(); }), term.onScroll(soon), term.onResize(again)];
  // painted(): the cells coloured by the last scan, [{ y (1-based buffer row), x, width }], for the smoke run.
  return { refresh: again, painted: () => painted, dispose: () => { clearTimeout(timer); clear(); for (const s of subs) s.dispose(); } };
}
