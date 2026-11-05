import { MAC, MAC_PATH } from './platform.js';

// Clickable text in terminal output: Windows paths (either slash) and web links, and on a Mac
// paths from the root or home folder (#2562).
const WIN_LINK = String.raw`[A-Za-z]:[\\/][^\s"'<>|*?` + '`' + String.raw`]+|https?:\/\/[^\s"'<>` + '`' + ']+';
export const linkRe = (mac = MAC) => new RegExp(mac ? `(?:${MAC_PATH}|${WIN_LINK})` : `(?:${WIN_LINK})`, 'g');
export let LINK_RE = linkRe();
// Where a path in text starts: a drive, or on a Mac "/" or "~/".
let PATH_START = MAC ? /^(?:[A-Za-z]:[\\/]|\/|~\/|https?:)/i : /^(?:[A-Za-z]:[\\/]|https?:)/i;
// Tests read Mac and Windows output on any system.
export function useMacLinks(mac) {
  LINK_RE = linkRe(mac);
  PATH_START = mac ? /^(?:[A-Za-z]:[\\/]|\/|~\/|https?:)/i : /^(?:[A-Za-z]:[\\/]|https?:)/i;
}

// Sentence punctuation after a path is not part of it. A closing bracket stays when the link
// has its opening one, as in "wiki/Mercury_(planet)" (#2243).
export function trimLink(s) {
  let t = String(s);
  for (;;) {
    t = t.replace(/[.,;:}'"]+$/, '');
    const c = t[t.length - 1], o = c === ')' ? '(' : c === ']' ? '[' : null;
    if (!o || t.split(o).length > t.split(c).length - 1) return t;
    t = t.slice(0, -1);
  }
}

// Files dropped on a terminal go in as typed text: space-separated, quoted when a path has a space.
export function dropText(paths) {
  return paths.filter(Boolean).map(p => (/\s/.test(p) ? `"${p}"` : p)).join(' ');
}

// A path in quotes links whole, spaces and all; otherwise a path stops at the first space
// and stretchCandidates offers longer readings for the app to check on disk.
export function findLinks(text) {
  const s = String(text), out = [];
  for (const m of s.matchAll(LINK_RE)) {
    const q = s[m.index - 1];
    if ((q === '"' || q === "'" || q === '`') && !m[0].startsWith('http')) {
      const close = s.indexOf(q, m.index);
      if (close > m.index) { out.push({ index: m.index, text: s.slice(m.index, close), quoted: true }); continue; }
    }
    out.push({ index: m.index, text: spacedPath(s, m.index, m[0]) });
  }
  // A quoted path can contain what looked like a second link; keep only the outer one.
  // A path after "Open in VS Code:" (how leads offer a file) opens in VS Code when clicked.
  return out.filter((l, i) => !out.some((o, j) => j !== i && o.quoted && l.index > o.index && l.index < o.index + o.text.length))
    .map(l => CODE_RE.test(s.slice(Math.max(0, l.index - 24), l.index)) ? { ...l, code: true } : l);
}
const CODE_RE = /open in vs ?code:\s*["']?$/i;

// A path with spaces outside quotes (#1528): "D:\Claude" in "D:\Claude Setup\x\2026-10-22.md
// is ready" runs on to the first word ending in a file extension, as long as a word on the way
// has a slash, so it reads as one path and the prose after it stays out. A folder path with
// spaces still stops at its first space; panes and item text stretch it further on disk.
const EXT_END = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;
function spacedPath(s, index, raw) {
  const text = trimLink(raw);
  if (/^https?:/i.test(text) || text !== raw || EXT_END.test(text)) return text;
  let end = index + raw.length, slash = false;
  for (let k = 0; k < 6; k++) {
    const m = s.slice(end).match(/^ ([^\s"'<>|*?`]+)/);
    if (!m || PATH_START.test(m[1])) break;
    end += m[0].length;
    const word = trimLink(m[1]);
    slash ||= /[\\/]/.test(word);
    if (EXT_END.test(word)) return slash ? trimLink(s.slice(index, end)) : text;
    if (word !== m[1]) break;
  }
  return text;
}

// Longer readings of a path that may continue past a space, shortest first, up to `max`
// more words: "D:\Claude" in "D:\Claude Setup\x.json: done" gives "D:\Claude Setup\x.json"
// and "D:\Claude Setup\x.json: done". The app keeps the longest one that exists on disk.
export function stretchCandidates(text, link, max = 6) {
  if (link.quoted || /^https?:/i.test(link.text)) return [];
  const s = String(text), out = [];
  let end = link.index + link.text.length;
  while (end < s.length && !/\s/.test(s[end])) end++;
  for (let k = 0; k < max; k++) {
    const m = s.slice(end).match(/^ +([^\s"'<>|*?`]+)/);
    if (!m) break;
    end += m[0].length;
    const c = trimLink(s.slice(link.index, end));
    if (c.length > link.text.length) out.push(c);
  }
  return out;
}

// Claude Code wraps long lines itself, so a long path or URL can go on as a new row
// (not a terminal soft wrap). Row b continues row a when a ends in link characters and b
// starts with one at a's text indent, the indent after any bullet such as "● " or "- ".
// A row that starts a list item ("- A) ...", "1. ...", "b) ...") at that indent is a new line,
// never the rest of a link that happened to end near the right edge (#1822).
const LINK_CH = /[^\s"'<>|*?`]/;
const LIST_START = /^(?:[●•⎿*+-]|\d+[.)]|[A-Za-z][.)]) /;
export function textIndent(row) { return String(row).match(/^ *(?:(?:[●•⎿*+-]|\d+[.)]) +)?/)[0].length; }
export function continuesRow(a, b) {
  a = String(a).replace(/\s+$/, ''); b = String(b);
  const ind = b.length - b.trimStart().length;
  return a.length > 0 && LINK_CH.test(a[a.length - 1]) && ind === textIndent(a) && LINK_CH.test(b[ind] || ' ') && !LIST_START.test(b.slice(ind));
}

// Rows as one string: units are soft-wrapped lines ({ y: first row, 1-based; rows: row
// strings }), each later unit hard-joined on at its indent. pos gives each character's
// cell (1-based x, y); cuts are the indexes where a unit was joined on.
export function joinRows(units) {
  let text = ''; const pos = [], cuts = [];
  units.forEach((u, k) => u.rows.forEach((row, r) => {
    let s = String(row), x0 = 0;
    if (k > 0 && r === 0) { x0 = s.length - s.trimStart().length; s = s.slice(x0); cuts.push(text.length); }
    if (k < units.length - 1 && r === u.rows.length - 1) s = s.replace(/\s+$/, '');
    for (let i = 0; i < s.length; i++) pos.push({ x: x0 + i + 1, y: u.y + r });
    text += s;
  }));
  return { text, pos, cuts };
}

// A link found on rows that may have been redrawn since (#1886) is painted only when every row it
// covers still holds the text read before the lookup: range { start: { y }, end: { y } } (1-based),
// before: Map of 0-based row -> text then, now(row) -> its text now.
export function stillPainted(range, before, now) {
  for (let r = range.start.y - 1; r <= range.end.y - 1; r++) if (!before.has(r) || before.get(r) !== now(r)) return false;
  return true;
}

export function crossedCuts(link, cuts) { return cuts.filter(c => c > link.index && c < link.index + link.text.length); }

// A joined link can run on into the next line of prose, so it is also read cut short at
// each join it crosses, shortest first; the app keeps the longest path that exists. A cut
// reading drops punctuation before the join, as in "x.png," then the next path (#1339).
export function joinReadings(link, cuts) {
  return [...crossedCuts(link, cuts).slice(1).map(c => trimLink(link.text.slice(0, c - link.index))), link.text];
}

// Claude Code also breaks a line where a space was, so "D:\Claude Setup\x.mp4" can arrive
// as "D:\Claude" and "Setup\x.mp4" on two rows, joined without the space (#350). Every
// reading of a candidate with the space put back at some of the joins it crosses (at most
// `max` of them): text is the candidate as it is on screen, target the path to look for.
export function spacedReadings(candidate, link, cuts, max = 4) {
  const c = { index: link.index, text: candidate }, crossed = crossedCuts(c, cuts).slice(0, max), out = [];
  for (let mask = 1; mask < (1 << crossed.length); mask++) {
    let target = '', from = 0;
    crossed.forEach((cut, k) => { const at = cut - link.index; target += candidate.slice(from, at) + (mask & (1 << k) ? ' ' : ''); from = at; });
    out.push({ text: candidate, target: target + candidate.slice(from) });
  }
  return out;
}

// A web link goes on past a join only where the row it leaves was full (within `slack`
// columns of the width): Claude Code broke it for length, not at its real end. A full row is
// not enough when the next row starts a sentence (#1002): a word with an apostrophe ("I'd"), or
// a capitalised word after a link that already ends in a file name or a slash. text is the
// joined rows. Null when it stops at its first join.
// A row that ends in sentence punctuation before a capitalised word is a sentence end too (#2243):
// "http://127.0.0.1:8236/." then "It shows ..." never opens ".../.It".
const PROSE_ON = (before, next) => /['’]/.test(next) || (/^[A-Z][a-z]*[.,;:!?]?$/.test(next) && /(\.[A-Za-z0-9]{1,5}|\/|[.,;:!?)\]'"])$/.test(before));
export function wrappedUrl(link, cuts, pos, cols, slack = 8, text = '') {
  const crossed = crossedCuts(link, cuts), next = c => (String(text).slice(c).match(/^\S*/) || [''])[0];
  const stop = crossed.find(c => pos[c - 1].x < cols - slack || PROSE_ON(link.text.slice(0, c - link.index), next(c)));
  if (stop === crossed[0]) return null;
  return stop === undefined ? link : { ...link, text: trimLink(link.text.slice(0, stop - link.index)) };
}

// Files the Code pane cannot usefully open (#166): a click shows them selected in Explorer.
// A video editor's project file (.editbay, #317) belongs to its own app, so it goes there too, and so does
// a web page (.html, #318), opened from Explorer in a browser.
const BINARY_RE = /\.(editbay|html?|apk|aab|ipa|exe|msi|msix|appx|dll|so|dylib|bin|dmg|iso|img|zip|7z|rar|tar|gz|tgz|bz2|xz|jar|aar|class|png|jpe?g|gif|bmp|webp|ico|tiff?|heic|psd|mp4|mov|mkv|avi|webm|wmv|m4v|mp3|wav|flac|ogg|m4a|aac|pdf|docx?|xlsx?|pptx?|ttf|otf|woff2?|db|sqlite|keystore|jks|p12)$/i;
export function opensInExplorer(file) { return BINARY_RE.test(String(file)); }

// A bare file name with an extension, such as "thumbnail-final.jpg", not part of a path or
// web link. The app links it only when it names exactly one existing file nearby.
const NAME_RE = /(?<![\w.\/:@~-])[\w][\w.-]*\.[A-Za-z][A-Za-z0-9]{0,7}(?![\w\/])/g;
export function findBareNames(text, links = findLinks(text)) {
  const s = String(text), out = [];
  for (const m of s.matchAll(NAME_RE)) {
    const end = m.index + m[0].length;
    if (links.some(l => m.index < l.index + l.text.length && end > l.index)) continue;
    out.push({ index: m.index, text: m[0] });
  }
  return out;
}

// Folders named in recent output, newest first, where a bare file name may live. A path to
// a file stands for its folder; the app checks on disk which ones are folders.
export function folderHints(lines, max = 40) {
  const out = [];
  for (const line of [...lines].reverse()) {
    for (const l of findLinks(line).reverse()) {
      if (/^https?:/i.test(l.text) || out.includes(l.text)) continue;
      out.push(l.text);
      if (out.length >= max) return out;
    }
  }
  return out;
}

// Text cut into plain runs and links, for an item's details and result (#207). A link that
// starts inside an earlier one (a stretched path swallowing it) is dropped.
export function textParts(text, links = findLinks(text)) {
  const s = String(text), out = [];
  let at = 0;
  for (const l of [...links].sort((a, b) => a.index - b.index)) {
    if (l.index < at) continue;
    if (l.index > at) out.push({ text: s.slice(at, l.index) });
    out.push({ text: l.text, link: l });
    at = l.index + l.text.length;
  }
  if (at < s.length) out.push({ text: s.slice(at) });
  return out;
}

// The links and files a question card shows (#416): from the task line's result and its detail
// lines, newest first (detail lines are added in order, so the last is the newest). A page on this
// PC's Tailscale (phone) address shows as its localhost one, once, unless the task's lines say the
// owner asked for a phone link. [{ href, label, file }].
const PHONE_HOST = /^(100\.\d+\.\d+\.\d+|[\w-]+\.[\w-]+\.ts\.net)$/i;
const ASKED_PHONE = /\b(asked|wants?|requested)\b[^.|]{0,40}\bphone\b/i;
export function cardLinks(task) {
  const lines = [task.result || '', ...[...(task.details || [])].reverse()];
  const phone = ASKED_PHONE.test(lines.join('\n'));
  const out = [], byKey = new Map();
  for (const line of lines) for (const l of findLinks(line)) {
    let href = l.text.replace(/[:;,.]+$/, '');
    try {
      const u = new URL(href);
      if (!phone && PHONE_HOST.test(u.hostname)) { u.hostname = 'localhost'; href = u.href; }
    } catch { /* a file path */ }
    const key = href.toLowerCase();
    if (byKey.has(key)) continue;
    const file = !/^https?:/i.test(href);
    const parts = href.replace(/^https?:\/\/[^/]+/i, '').split(/[\\/]/).filter(Boolean);
    const raw = parts.pop() || href.replace(/^https?:\/\//i, '');
    let label = raw;
    try { label = decodeURIComponent(raw); } catch { /* a lone % (#1340): shown as it is */ }
    const it = { href, label, file };
    byKey.set(key, it); out.push(it);
  }
  return out;
}
