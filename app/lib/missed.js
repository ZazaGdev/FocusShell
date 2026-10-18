// Maybe missed (#367): questions and delivered results in the CTO's replies that the owner seems
// to have skipped. Read from the CTO's own Claude Code log: each CTO reply is split into items,
// and an item is flagged when the owner's next message does not respond to it and the owner
// moved on faster than it takes to read down to it (about 4 words a second). Lower items score
// higher. An item answered later in chat or in the question boxes, asked again in a later reply
// (only the newest copy counts), closed on its board, marked seen or put off for later drops
// out, and so does anything already on Waiting on you (#412).
import { parseTasks, askOf } from './tasks.js';

export const WPS = 4;                 // reading speed, words a second
export const LATER_MS = 2 * 3600e3;   // "Later" hides a card this long
export const WINDOW_MS = 24 * 3600e3; // replies older than this are not looked at

const textOf = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter(p => p && p.type === 'text').map(p => p.text).join('\n') : '');

// The log as a list of events: { who: 'cto', t, text } for a reply (every text the CTO wrote
// between two messages to it), { who: 'owner', t, text } for what the owner typed, and
// { who: 'peer', t } for a message from another session, which ends a reply too.
export function conversation(log) {
  const out = [];
  for (const line of String(log).split('\n')) {
    if (!line.trim()) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if ((d.type !== 'user' && d.type !== 'assistant') || d.isSidechain) continue;
    const t = Date.parse(d.timestamp), c = d.message && d.message.content, text = textOf(c);
    if (!t) continue;
    if (d.type === 'assistant') {
      if (!text.trim()) continue;
      const last = out[out.length - 1];
      if (last && last.who === 'cto') { last.text += '\n\n' + text; last.t = t; } else out.push({ who: 'cto', t, text });
      continue;
    }
    // A pick in the CTO's question boxes is the owner answering too (#412): the questions and
    // the picks, as one message.
    const picks = d.toolUseResult && d.toolUseResult.answers;
    if (picks && typeof picks === 'object' && !Array.isArray(picks)) {
      const said = Object.entries(picks).map(([q, a]) => `${q} ${a}`).join('\n');
      if (said.trim()) out.push({ who: 'owner', t, text: said, picked: true });
      continue;
    }
    const kind = d.origin && d.origin.kind;
    const typed = kind === 'human' || (!d.origin && typeof c === 'string' && !/^\s*</.test(c) && !d.toolUseResult);
    if (typed && !d.isMeta && text.trim()) out.push({ who: 'owner', t, text });
    else if (kind === 'peer' || (!d.origin && /^\s*(Another Claude session sent|<cross-session-message)/.test(text))) out.push({ who: 'peer', t });
  }
  return out;
}

const PATH_RE = /(?:[A-Za-z]:[\\/][^\s"'<>|*?`]+|https?:\/\/[^\s"'<>`)]+)/;
const LIST_RE = /^\s*(?:(\d+)[.)]|[-*•●])\s+/;
const TAG_RE = /\b([A-Z][A-Za-z0-9_-]*) #(\d+)\b/;
const plain = s => String(s).replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
const words = s => (plain(s).match(/\S+/g) || []).length;

// A reply cut into items: { kind: 'question' | 'result', text, words (to the end of the item),
// index, of, num (its list number), project, n, path, ctx: [before, it, after] }. A question
// has a "?" or starts "Needs you"; a result carries a file path or a web link.
export function splitItems(reply) {
  const units = [];
  let cur = null, fence = false;
  for (const raw of String(reply).split(/\r?\n/)) {
    if (/^\s*```/.test(raw)) { fence = !fence; continue; }
    if (fence) { if (cur && PATH_RE.test(raw)) cur.lines.push(raw.trim()); continue; }
    if (!raw.trim()) { cur = null; continue; }
    const li = raw.match(LIST_RE);
    // An option of a question ("- (a) ...") stays part of the question above it.
    const option = /^\(?[a-h]\)\s/.test(raw.replace(LIST_RE, '').trim()) && units.length;
    if (option && !cur) cur = units[units.length - 1];
    else if (!cur || (li && !option)) { cur = { lines: [], num: li && li[1] ? Number(li[1]) : null }; units.push(cur); }
    cur.lines.push(raw.trim());
  }
  let seen = 0, asking = false;
  const all = units.map(u => {
    const text = plain(u.lines.map(l => l.replace(LIST_RE, '')).join(' '));
    seen += words(text);
    const isList = /^\s*(?:\d+[.)]|[-*•●])\s+/.test(u.lines[0]);
    // A "Needs you:" heading is not an item itself: the list under it holds the questions.
    const heading = /^needs you\b[^:]{0,30}:$/i.test(text);
    if (heading) asking = true; else if (!isList) asking = false;
    const p = text.match(PATH_RE), tag = text.match(TAG_RE), bare = !tag && text.match(/(?:^|\s|\()#(\d+)\b/);
    const kind = heading ? null : /\?/.test(text.replace(PATH_RE, '')) || /^needs you\b/i.test(text) || (asking && isList) ? 'question' : p ? 'result' : null;
    return { kind, text, words: seen, num: u.num, isList, project: tag ? tag[1] : null, n: tag ? Number(tag[2]) : bare ? Number(bare[1]) : null,
      path: p ? p[0].replace(/[.,;:)\]}'"]+$/, '') : null };
  });
  // A list of links or files is one result: its first entry, with how many there are.
  for (let i = 0; i < all.length; i++) {
    if (all[i].kind !== 'result' || !all[i].isList) continue;
    let j = i + 1;
    while (j < all.length && all[j].kind === 'result' && all[j].isList) j++;
    if (j - i > 2) {
      const n = j - i;
      all.splice(i, n, { ...all[i], text: `${all[i].text} (and ${n - 1} more in the same list)`, words: all[j - 1].words });
    }
  }
  const items = [];
  all.forEach((u, i) => {
    if (!u.kind) return;
    const cut = s => (s && s.length > 90 ? s.slice(0, 87) + '...' : s || '');
    items.push({ ...u, ctx: [cut(all[i - 1] && all[i - 1].text), u.text, cut(all[i + 1] && all[i + 1].text)] });
  });
  items.forEach((it, i) => { it.index = i; it.of = items.length; });
  return items;
}

const STOP = new Set(("this that with from have what which when where there their they them then than your yours also just like want does will been were here more some only each make sure need needs okay into about would should could shall these those other after before again still very much many don't can't won't i'll i've you're we're thing things done want going goes said says yeah yes good fine great right well over under both either because while being doing know think maybe really already").split(' '));
export function keywords(s) {
  const out = [];
  for (let w of String(s).toLowerCase().replace(PATH_RE, ' ').match(/[a-z][a-z0-9'-]{3,}/g) || []) {
    if (STOP.has(w)) continue;
    w = w.replace(/'s$/, '').replace(/(?<=[a-z]{3})s$/, '');
    if (!STOP.has(w) && !out.includes(w)) out.push(w);
  }
  return out;
}

// Whether a message of the owner responds to an item: 'yes', 'no' or 'unsure' (then a small
// model decides). ctx.only: the item is the reply's only question; ctx.numbered: the message
// answers in a numbered list ("1) ... 2) ..."); ctx.later: the message came after the next one.
export function responds(item, message, ctx = {}) {
  const m = String(message), low = m.toLowerCase();
  if (item.n && new RegExp(`(^|[^\\d])${item.n}(?!\\d)`).test(m)) return 'yes';
  if (item.path) {
    const base = item.path.split(/[\\/]/).filter(Boolean).pop().toLowerCase();
    if (base.length > 3 && low.includes(base)) return 'yes';
  }
  if (item.num && ctx.numbered && new RegExp(`(^|[\\s(])${item.num}[).:-]`).test(m)) return 'yes';
  const a = keywords(item.text), b = new Set(keywords(m)), shared = a.filter(w => b.has(w)).length;
  if (shared >= 2) return 'yes';
  if (shared === 1) return 'unsure';
  // A short "yes" or "b" answers the reply right above it, not one further back (ctx.later).
  if (item.kind === 'question' && words(m) <= 6 && !ctx.later) return ctx.only ? 'yes' : 'unsure';
  return 'no';
}

// Short stable key for an item: the reply's time and the item's text.
export function keyOf(t, text) {
  let h = 5381;
  for (const ch of String(text)) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return `${t}-${h.toString(36)}`;
}

// The flagged items, highest score first, and the unsure matches a small model should judge
// ({ key, item, message }). typing: times (ms) the owner started typing in this pane, so
// "moved on after" counts from the first key, not from when the message was sent. judged:
// { key: true when the message did respond }.
// opened: paths the owner clicked in this pane (lower case); a result they opened was seen.
export function maybeMissed(convo, { typing = [], judged = {}, opened = [], now = Date.now() } = {}) {
  const items = [], unsure = [], clicked = new Set(opened.map(p => String(p).toLowerCase()));
  const split = convo.map(turn => (turn.who === 'cto' && now - turn.t <= WINDOW_MS ? splitItems(turn.text) : null));
  // A question the CTO asks again in a later reply is one question (#412): only its newest copy
  // is looked at, so an answer to any copy clears it.
  const askedAgain = (i, it) => split.some((list, j) => j > i && list && list.some(x => x.kind === it.kind &&
    ((it.n && x.n === it.n && x.project === it.project) || sameThing(it.text, x.text))));
  convo.forEach((turn, i) => {
    if (!split[i]) return;
    // A message sent within 2 s of the reply was written before it (queued while the CTO worked).
    const at = convo.findIndex((e, j) => j > i && e.who === 'owner' && e.t - turn.t >= 2000);
    if (at < 0) return;
    const next = convo[at], later = convo.slice(at + 1).filter(e => e.who === 'owner');
    const start = typing.find(x => x > turn.t && x <= next.t) || next.t;
    const gap = Math.max(0, Math.round((start - turn.t) / 1000));
    const all = split[i], questions = all.filter(x => x.kind === 'question');
    const numbered = (next.text.match(/(^|[\s(])\d[).:-]/g) || []).length >= 2;
    for (const it of all) {
      const read = Math.round(it.words / WPS);
      if (gap >= read || (it.path && clicked.has(it.path.toLowerCase())) || askedAgain(i, it)) continue;
      const key = keyOf(turn.t, it.text);
      let r = responds(it, next.text, { only: questions.length === 1 && it.kind === 'question', numbered });
      if (r === 'unsure') {
        if (!(key in judged)) { unsure.push({ key, item: it.text, message: next.text }); continue; }
        r = judged[key] ? 'yes' : 'no';
      }
      // Any later message of the owner that may answer it clears it: a wrong nag is worse than a
      // question left (#412).
      if (r === 'yes' || later.some(e => responds(it, e.text, { later: true }) !== 'no')) continue;
      const lower = it.of > 1 ? it.index / (it.of - 1) : 0;
      const why = it.kind === 'result'
        ? [`Delivered ${it.path ? 'a file or link' : 'a result'} in a reply`, `you moved on after ${gap} s, and reading down to it takes about ${read} s`]
        : [`Item ${it.index + 1} of ${it.of}${lower >= 0.5 && it.of > 1 ? ', low in the reply' : ''}`, `you moved on after ${gap} s, and reading down to it takes about ${read} s`, 'your next message did not answer it'];
      items.push({ ...it, key, at: turn.t, gap, read, why, score: (1 - gap / Math.max(1, read)) + 0.5 * lower });
    }
  });
  return { items: items.sort((a, b) => b.score - a.score || b.at - a.at), unsure };
}

// What is on Waiting on you, or otherwise already on the owner's boards, as [{ project, n, text }]:
// every open item waiting on the owner ("?"), every open for-owner item, every open item on the
// owner's own board (Me), and leads stopped on a prompt ([{ project, question }]).
export function waitingItems(tasksMd, prompts = [], me = 'Me') {
  const out = [];
  for (const [project, md] of Object.entries(tasksMd || {})) {
    for (const t of parseTasks(md)) {
      if (t.mark === 'x' || !(t.mark === '?' || t.forOwner || project === me)) continue;
      const ask = askOf(t);
      out.push({ project, n: t.n, text: [t.text, ask && ask.question].filter(Boolean).join(' ') });
    }
  }
  for (const w of prompts) out.push({ project: w.project, n: null, text: w.question || '' });
  return out;
}

// Two texts about the same thing: most key words of the shorter one are in the longer one.
export function sameThing(a, b) {
  const x = keywords(a), y = new Set(keywords(b));
  const shared = x.filter(w => y.has(w)).length, small = Math.min(x.length, y.size);
  return shared >= 2 && shared >= 0.6 * small;
}

// The cards to show: flagged items not seen, not put off, not closed on their board, and never
// anything on Waiting on you (by task number, or by text). state: { seen, answered, later: { key: until } }.
export function visibleItems(items, { state = {}, tasksMd = {}, waiting = [], now = Date.now() } = {}) {
  const gone = k => (state.seen && state.seen[k]) || (state.answered && state.answered[k]) || (state.later && state.later[k] > now);
  return items.filter(it => {
    if (gone(it.key)) return false;
    if (it.n && it.project && tasksMd[it.project] && parseTasks(tasksMd[it.project]).some(t => t.n === it.n && t.mark === 'x')) return false;
    return !waiting.some(w => (it.n && w.n === it.n && (!it.project || w.project === it.project)) || sameThing(it.text, w.text));
  });
}
