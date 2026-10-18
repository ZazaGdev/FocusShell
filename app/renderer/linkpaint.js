// Links in a pane stand out as soon as they are printed, not only on hover (#348). The rows
// on screen go through the pane's own link provider, the one that makes them clickable, so
// what is coloured is exactly what a click opens: web links, Windows paths, a link wrapped
// over two rows, a bare file name the pane resolved. Each link gets one xterm decoration per
// row it covers; decorations sit on buffer lines, so they scroll with their text, and a
// resize scans again because the text reflows.
export const LINK_COLOUR = '#7fb2ff';
const EVERY = 250;    // at most one scan this often while output keeps coming
const JOINS = 5;      // rows above and below that can change a row's links (MAX_JOINS + 1)
const KEEP = 2000;    // rows' results remembered

export function paintLinks(term, provider, isShown) {
  let decos = [], painted = [], timer = 0, lastSig = '', run = 0;
  const cache = new Map(); // the text around a row -> the link ranges the provider gave it
  const clear = () => { for (const d of decos) d.dispose(); decos = []; painted = []; };
  const text = (buf, r) => { const l = buf.getLine(r); return l ? l.translateToString(false) : ''; };

  // The links the provider finds on row y (1-based), from the cache when the rows that can
  // change them are the same as last time.
  const linksOn = (buf, y) => {
    const around = [];
    for (let r = y - 1 - JOINS; r <= y - 1 + JOINS; r++) around.push(text(buf, r));
    const key = `${y}|${term.cols}|${around.join('\n')}`;
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    return new Promise(res => provider.provideLinks(y, links => {
      const ranges = (links || []).map(l => l.range);
      cache.set(key, ranges);
      if (cache.size > KEEP) cache.delete(cache.keys().next().value);
      res(ranges);
    }));
  };

  const scan = async () => {
    timer = 0;
    const buf = term.buffer.active;
    if (buf.type !== 'normal' || !isShown()) return;
    const top = buf.viewportY, rows = [];
    for (let r = top; r < top + term.rows; r++) rows.push(text(buf, r));
    const sig = `${top}|${term.cols}|${rows.join('\n')}`;
    if (sig === lastSig) return;
    lastSig = sig;
    const mine = ++run, found = new Map();
    // Once the scrollback is full, each new line drops the oldest and every row's index
    // moves up by one. The links come back after disk lookups, so a marker on the cursor's
    // line tells how far the rows moved meanwhile (#374).
    const anchor = term.registerMarker(0), was = anchor ? anchor.line : -1;
    const per = await Promise.all(rows.map((_, k) => linksOn(buf, top + k + 1)));
    const moved = anchor && !anchor.isDisposed ? was - anchor.line : 0;
    if (anchor) anchor.dispose();
    if (mine !== run) return; // a newer scan started meanwhile
    for (const ranges of per) for (const g of ranges) found.set(`${g.start.x},${g.start.y},${g.end.x},${g.end.y}`, g);
    clear();
    const cursor = buf.baseY + buf.cursorY + moved;
    for (const g of found.values()) {
      for (let y = g.start.y; y <= g.end.y; y++) {
        const x0 = y === g.start.y ? g.start.x - 1 : 0, x1 = y === g.end.y ? g.end.x : term.cols;
        if (x1 <= x0) continue;
        const marker = term.registerMarker(y - 1 - cursor);
        if (!marker) continue;
        const deco = term.registerDecoration({ marker, x: x0, width: x1 - x0, foregroundColor: LINK_COLOUR, layer: 'top' });
        if (!deco) { marker.dispose(); continue; }
        deco.onRender(el => el.classList.add('tlinkpaint'));
        decos.push({ dispose: () => { deco.dispose(); marker.dispose(); } });
        painted.push({ y: y - moved, x: x0, width: x1 - x0 });
      }
    }
  };
  const soon = () => { if (!timer) timer = setTimeout(scan, EVERY); };
  const again = () => { lastSig = ''; soon(); };
  const subs = [term.onWriteParsed(soon), term.onScroll(soon), term.onResize(again)];
  // painted(): the cells coloured by the last scan, [{ y (1-based buffer row), x, width }], for the smoke run.
  return { refresh: again, painted: () => painted, dispose: () => { clearTimeout(timer); clear(); for (const s of subs) s.dispose(); } };
}
