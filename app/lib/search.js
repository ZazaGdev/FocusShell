// Ctrl+K search (#233): every board item, found by typing a few letters of it. Pure, so
// what matches and in what order is tested. Like a command palette, each typed word
// must begin a word of the item; a word of five letters or more may also be one letter off,
// so a typo still finds it. "#12" finds item 12, and a word that begins a project's name
// narrows to that project.

const WORD = /[\p{L}\p{N}]+/gu;
const words = s => String(s || '').toLowerCase().match(WORD) || [];

// One letter added, dropped or changed, and only that: a and b differ by at most one edit.
function oneOff(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// How well one typed word meets a list of words: 3 begins the first, 2 begins another,
// 1 a typo of the start of one, 0 not at all.
function meet(w, list) {
  if (!list.length) return 0;
  if (list[0].startsWith(w)) return 3;
  for (let k = 1; k < list.length; k++) if (list[k].startsWith(w)) return 2;
  if (w.length >= 5) for (const o of list) if (oneOff(w, o.slice(0, w.length)) || oneOff(w, o.slice(0, w.length + 1)) || oneOff(w, o.slice(0, w.length - 1))) return 1;
  return 0;
}

// The search's own copy of every item, made once per board change rather than per keystroke.
// items: [{ project, task }] with task as parseTasks returns it.
export function searchIndex(items) {
  return items.map(({ project, task }) => ({
    project, task,
    title: words(task.text),
    rest: words([task.result, ...(task.details || [])].join(' ')),
    proj: words(project),
  }));
}

// The items that match, best first, at most `limit`. Title matches come before detail
// matches, open items before done ones, then the newest. Nothing typed shows open items, newest first.
export function searchItems(index, typed, limit = 50) {
  const q = String(typed || '').trim().toLowerCase();
  const num = q.match(/^#?(\d+)$/);
  const want = words(q);
  const newer = (a, b) => (b.task.date || '').localeCompare(a.task.date || '') || b.task.n - a.task.n;
  if (!want.length) return q ? [] : index.filter(e => e.task.mark !== 'x').sort(newer).slice(0, limit);
  const hits = [];
  for (const e of index) {
    let score = 0, ok = true;
    for (const w of want) {
      if (num && e.task.n === Number(num[1])) { score += 40; continue; }
      const t = meet(w, e.title);
      if (t) { score += t * 10; continue; }
      if (e.proj[0] && e.proj[0].startsWith(w)) { score += 5; continue; }
      const r = meet(w, e.rest);
      if (r) { score += r; continue; }
      ok = false; break;
    }
    if (ok) hits.push({ e, score: score + (e.task.mark === 'x' ? 0 : 6) });
  }
  return hits.sort((a, b) => b.score - a.score || newer(a.e, b.e)).slice(0, limit).map(h => h.e);
}

// Results in sections (#235), in Home's lane order: For you, Open, Doing, then Done last.
// Each keeps searchItems' order inside it; empty sections are left out.
const SECTIONS = [['you', 'For you'], ['open', 'Open'], ['doing', 'Doing'], ['done', 'Done']];
export function sectionOf(t) {
  if (t.mark === 'x') return 'done';
  if (t.mark === '?' || t.mark === '!' || t.forOwner) return 'you';
  return t.mark === '~' ? 'doing' : 'open';
}
export function searchSections(hits) {
  const by = Object.fromEntries(SECTIONS.map(([k]) => [k, []]));
  for (const e of hits) by[sectionOf(e.task)].push(e);
  return SECTIONS.filter(([k]) => by[k].length).map(([key, label]) => ({ key, label, items: by[key] }));
}

// The detail line that matched, when a typed word was found there rather than in the title
// or the project's name; '' otherwise. Tags, Version and Priority lines show as badges instead.
export function matchedDetail(e, typed) {
  const want = words(typed).filter(w => !meet(w, e.title) && !(e.proj[0] && e.proj[0].startsWith(w)));
  if (!want.length) return '';
  const lines = [e.task.result, ...(e.task.details || [])].filter(l => l && !/^(Tags|Version|Priority|Done):/i.test(l));
  return lines.find(l => want.some(w => meet(w, words(l)))) || '';
}
