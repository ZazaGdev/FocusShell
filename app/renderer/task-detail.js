// A board item opened, in a panel over the right side of the window. It starts with a short
// TL;DR and, for a card that needs the owner, the question with a button per option; under
// that a box to answer or tell the CTO about the card. The conversation with the CTO is
// kept as card notes ("#<n> You: ..." and "#<n> CTO: ..."). Then details, result,
// the related Markdown files, brief and the other notes. Home and project pages both open it.
import { parseNotes, splitTaskNotes, askOf, tldrOf, historyLabel, itemTags, hasTag, toggleTag } from '../lib/tasks.js';
import { planOf } from '../lib/plan.js';
import { sketchesOf, sketchName, parseRel } from '../lib/sketches.js';
import { openSavedSketch } from './sketch.js';
import { linkedText, folderMenu } from './textlinks.js';
import { voiceInto } from './voice.js';
import { whenFields } from './home.js';
import { dueOf, repeatOf } from '../lib/me.js';

const MARK_WORD = { '~': 'In progress', '?': 'Needs you', '!': 'Blocked', x: 'Done', ' ': 'Open' };
const MARK_CLASS = { '~': 'p', '?': 'q', '!': 'b', x: 'x', ' ': '' };

let panel = null, cur = null; // cur: { ctx, sig } for the card on screen
const dirty = () => !!panel && [...panel.querySelectorAll('input, textarea')].some(i => i.value.trim() && i.value !== i.defaultValue);
export function closeTask() { if (panel) { panel.remove(); panel = null; cur = null; } }
addEventListener('keydown', e => { if (e.key === 'Escape' && panel && !e.target.closest('input, textarea')) closeTask(); });
// A press outside the panel closes it, unless a note or title is half typed in it. A press
// on another item still opens that one, since its click comes after.
addEventListener('pointerdown', e => {
  if (!panel || panel.contains(e.target) || e.target.closest('.sk-host')) return;
  if (dirty()) return;
  closeTask();
}, true);

// The card on screen, if any, so the app can refresh it when its files change.
export const openCard = () => (cur ? { project: cur.ctx.project, n: cur.ctx.task.n } : null);
export async function refreshTask(task) {
  if (!cur || dirty()) return;
  const ctx = { ...cur.ctx, task }, extra = await ctx.deck.taskExtra(ctx.project, task.n);
  if (!cur || cur.ctx.project !== ctx.project || cur.ctx.task.n !== task.n || dirty()) return;
  if (JSON.stringify([task, extra]) !== cur.sig) draw(ctx, extra);
}

// Voice on a card: the cursor goes to the card's box and Windows voice typing opens, so
// what the owner says lands there to check before Send. False when no card is open.
export function talkIntoCard() {
  const box = panel && panel.querySelector('.tdsay');
  if (!box || !cur) return false;
  box.focus(); box.setSelectionRange(box.value.length, box.value.length);
  voiceInto(box); // the bar closes again when the box is left (#415)
  return true;
}

// ctx: { h, icon, deck, toast, project, task, onChange, talk, openMd } where onChange re-reads and redraws
// the board, talk(text, answer) sends a line about this card to its CTO (true if sent) and
// openMd(path) opens a Markdown file in its project's VS Code pane (true if opened).
export async function openTask(ctx) {
  closeTask();
  panel = ctx.h('aside', { class: 'tdpanel' }, ctx.h('div', { class: 'tdbody' }, ctx.h('div', { class: 'empty-note' }, 'Loading…')));
  document.body.append(panel);
  const extra = await ctx.deck.taskExtra(ctx.project, ctx.task.n);
  if (panel) draw(ctx, extra);
}

function draw(ctx, extra) {
  const { h, deck, project, task: t } = ctx, { brief, notes, files = [], plan } = extra;
  cur = { ctx, sig: JSON.stringify([t, extra]) };
  const all = splitTaskNotes(parseNotes(notes)).byTask[String(t.n)] || [];
  const talkNotes = all.filter(n => /^(You|CTO):/.test(n.text)), mine = all.filter(n => !/^(You|CTO):/.test(n.text));

  const title = h('h3', { class: 'tdtitle', title: 'Click to edit' }, t.text);
  const titleBox = h('div', { class: 'tdtbox' }, title);
  const edit = () => {
    const input = h('input', { class: 'tedit', value: t.text, onkeydown: async e => {
      if (e.key === 'Escape') { e.stopPropagation(); titleBox.replaceChildren(title); }
      if (e.key === 'Enter' && input.value.trim()) { await deck.setTaskText(project, t.n, input.value); t.text = input.value.trim(); title.textContent = t.text; titleBox.replaceChildren(title); ctx.onChange(); }
    }, onblur: () => titleBox.replaceChildren(title) });
    titleBox.replaceChildren(input); input.focus(); input.select();
  };
  title.onclick = edit;

  const noteInput = h('input', { placeholder: `Note on #${t.n}, then Enter`, onkeydown: async e => {
    if (e.key === 'Enter' && noteInput.value.trim()) {
      await deck.addProjectNote(project, `#${t.n} ${noteInput.value}`);
      ctx.toast(`Note added to ${project} #${t.n}`); openTask(ctx);
    }
  } });
  const setMark = async mark => { await deck.setTaskMark(project, t.n, mark); t.mark = mark; ctx.onChange(); openTask(ctx); };
  const section = (label, ...kids) => [h('div', { class: 'tdlab' }, label), ...kids];
  // Done beside the title (#168), where it is seen; a done item offers Reopen there.
  const doneBtn = t.mark === 'x' ? h('button', { class: 'btn tddone', onclick: () => setMark(' ') }, 'Reopen')
    : h('button', { class: 'btn primary tddone', title: 'Mark this item done', onclick: () => setMark('x') }, 'Done');
  const details = t.details.filter(d => !(project === 'Me' ? /^(Version|Priority|Sketch|Screenshot|Due|Repeat|Done|Tags):/i : /^(Version|Priority|Sketch|Screenshot|Done|Tags):/i).test(d));
  const shots = screenshotsOf(t);

  // Answer first: the question and its options, then a box for anything else.
  const ask = t.mark === '?' ? askOf(t) : null;
  const say = async (text, answer) => {
    const s = String(text).replace(/\s+/g, ' ').trim();
    if (!s || !(await ctx.talk(s, answer))) return;
    await deck.addProjectNote(project, `#${t.n} You: ${s}`);
    box.value = ''; box.defaultValue = '';
    refreshTask(t);
  };
  const box = h('textarea', { class: 'tdsay', rows: 2, placeholder: ask ? 'Or say something else…' : `Tell the CTO about #${t.n}…`, onkeydown: e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); say(box.value, !!ask); }
  } });
  const mic = h('button', { class: 'mic', 'data-tip': 'Talk: Windows voice typing writes into this box, then press Send (Ctrl+Shift+Space)', onclick: () => talkIntoCard() }, ctx.icon('mic'));
  const talkBox = h('div', { class: 'tdtalk' }, box, mic,
    h('button', { class: 'btn primary', title: 'Send to the CTO (Enter)', onclick: () => say(box.value, !!ask) }, 'Send'));
  const sug = ask && ask.suggest;
  const tldr = ask
    ? h('div', { class: 'tldr q' }, h('div', { class: 'k' }, 'TL;DR · needs your pick'), h('p', {}, ask.question || t.text))
    : (() => { const d = tldrOf(t); return h('div', { class: 'tldr' }, h('div', { class: 'k' }, 'TL;DR'),
      h('p', {}, d.about || t.text), d.last ? h('p', { class: 'sub' }, `${MARK_WORD[t.mark] || 'Open'}. Last: ${d.last}`) : null); })();
  const opts = !ask ? null : ask.options.length
    ? h('div', { class: 'tdopts' }, ask.options.map(o => {
      const isSug = !!sug && (o.key ? sug.toLowerCase().startsWith(o.key) : sug.toLowerCase() === o.text.toLowerCase());
      return h('button', { class: 'tdopt' + (isSug ? ' sug' : ''), onclick: () => say(o.key ? `${o.key}: ${o.text}` : o.text, true) },
        o.key ? h('span', { class: 'l' }, o.key) : null, h('span', {}, o.text, isSug ? h('small', {}, 'CTO suggests') : null));
    }))
    : sug ? h('div', { class: 'tdopts' }, h('button', { class: 'tdopt sug', onclick: () => say(`go with the suggestion: ${sug}`, true) }, h('span', {}, `Go with the suggestion: ${sug}`))) : null;

  // The talk so far; the last line says whether the CTO has answered yet.
  const last = talkNotes[talkNotes.length - 1];
  const thread = talkNotes.length ? h('div', { class: 'tdthread' },
    talkNotes.slice(-6).map(n => { const cto = n.text.startsWith('CTO:');
      return h('div', { class: 'msg ' + (cto ? 'cto' : 'me') }, h('div', { class: 'who' }, `${cto ? 'CTO' : 'You'} · ${n.when.slice(11)}`), n.text.replace(/^(You|CTO):\s*/, '')); }),
    last.text.startsWith('You:') ? h('div', { class: 'tdwait' }, 'Sent to the CTO, waiting for its reply') : null) : null;

  // Paths and web links in the text open like the Files links (#207).
  const links = { openFile: ctx.openMd || (x => deck.openInCode(null, x)), toast: ctx.toast, before: closeTask };
  panel.replaceChildren(h('button', { class: 'btn ghost tdclose', title: 'Close (Esc)', onclick: closeTask }, 'Close'), h('div', { class: 'tdbody' }, h('div', {},
    h('div', { class: 'tdmeta' }, h('span', { class: 'tdproj' }, `${project} #${t.n}`),
      h('span', { class: 'mk ' + MARK_CLASS[t.mark] }, MARK_WORD[t.mark] || t.mark),
      h('span', { class: 'tdwho' }, [historyLabel(t), t.who, t.forOwner ? 'for you' : ''].filter(Boolean).join(' · ')),
      // Copy: a reference to this item to paste into a prompt or a note (#107).
      h('button', { class: 'btn ghost tdcopy', title: 'Copy a reference to this item', onclick: async () => {
        const ref = `${project} #${t.n}: ${t.text}`;
        try { await navigator.clipboard.writeText(ref); ctx.toast(`Copied: ${ref}`); } catch { ctx.toast('Could not copy to the clipboard', true); }
      } }, 'Copy')),
    h('div', { class: 'tdhead' }, titleBox, doneBtn), tldr, opts, talkBox, thread,
    plan ? planRow(ctx, plan) : null,
    project === 'Me' && t.mark !== 'x' ? section('When', whenRow(ctx)) : null,
    section('Details', details.length ? details.map(d => linkedText('p', { class: 'tdp' }, d, links)) : h('div', { class: 'empty-note' }, 'No details beyond the title.')),
    shots.length ? section('Screenshots', shotRow(ctx, shots)) : null,
    section('Result', t.result ? linkedText('p', { class: 'tdp' }, t.result, links) : h('div', { class: 'empty-note' }, 'None yet.')),
    (ctx.tags || []).length || itemTags(t).length ? section('Tags', tagRow(ctx)) : null,
    section('Sketches', sketchRow(ctx)),
    files.length ? section('Files', h('div', { class: 'tdfiles' }, files.map(f => h('a', { class: 'plink', href: '#', title: `Open ${f} in its project's VS Code`,
      onclick: async e => { e.preventDefault(); const go = ctx.openMd || (x => deck.openInCode(null, x)); closeTask(); if (!(await go(f))) ctx.toast(`Could not open ${f}`, true); },
      oncontextmenu: e => folderMenu(e, f) },
      f.split(/[\\/]/).slice(-3).join('/'))))) : null,
    brief ? section('Brief', h('pre', { class: 'brief' }, brief)) : null,
    section(`Notes (${mine.length})`, mine.map(n => h('div', { class: 'tnote' }, h('span', { class: 'when' }, n.when), n.text)), h('div', { class: 'note-add' }, noteInput)),
    h('div', { class: 'tdacts' },
      h('button', { class: 'btn', onclick: edit }, 'Edit title')))));
}

// A card's screenshots (#369, "> Screenshot: <path>" lines from the recorder) as thumbnails;
// a click shows one full size over the window, a second click or Escape closes it.
export const screenshotsOf = t => (t.details || []).map(d => (d.match(/^Screenshot:\s*(.+?)\s*$/i) || [])[1]).filter(Boolean);
function shotRow(ctx, paths) {
  const { h, deck } = ctx;
  const big = url => {
    const shade = h('div', { class: 'tdzoom', title: 'Close', onclick: () => { removeEventListener('keydown', esc, true); shade.remove(); } }, h('img', { src: url, alt: 'Screenshot' }));
    const esc = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); shade.click(); } };
    addEventListener('keydown', esc, true);
    document.body.append(shade);
  };
  return h('div', { class: 'tdshots' }, paths.map(p => {
    const img = h('img', { alt: p.split(/[\\/]/).pop() }), b = h('button', { class: 'tdshot', title: p }, img);
    deck.readImage(p).then(url => { if (url) { img.src = url; b.onclick = () => big(url); } else b.replaceWith(h('span', { class: 'empty-note' }, `Missing: ${p}`)); });
    return b;
  }));
}

// A Self item's date, time and repeat (#198); Clear takes the time off.
function whenRow(ctx) {
  const { h, deck, task: t } = ctx, due = dueOf(t), w = whenFields(h, due, repeatOf(t));
  const save = async when => { await deck.setSchedule(t.n, when); ctx.onChange(); };
  return h('div', { class: 'tdwhen' }, w.el,
    h('button', { class: 'btn', onclick: () => { const v = w.read(); if (v.day) save(v); else ctx.toast('Pick a date first: a repeat counts from it.', true); } }, 'Save'),
    due ? h('button', { class: 'btn ghost', onclick: () => save({ day: '' }) }, 'Clear') : null);
}

// Priority and version of the card (#23), each a small picker that writes its detail line.
function planRow(ctx, plan) {
  const { h, deck, project, task: t } = ctx, pl = planOf(t);
  const set = async (key, value) => { await deck.setTaskKey(project, t.n, key, value || null); ctx.onChange(); };
  const pick = (label, key, value, opts) => h('label', { class: 'tdpick' }, label,
    h('select', { onchange: e => set(key, e.target.value) }, opts.map(([v, text]) => h('option', { value: v, selected: String(value ?? '') === String(v) }, text))));
  // Version also offers "Add version..." (#141): an inline box takes the name, Enter adds it
  // to the project's versions and sets it on the card, Escape goes back to the picker.
  const ADD = '__add_version__';
  const version = pick('Version', 'Version', pl.version, [['', 'None'], ...[...new Set([...plan.versions.map(v => v.name), pl.version].filter(Boolean))].map(v => [v, v]), [ADD, 'Add version...']]);
  const vsel = version.querySelector('select'), vset = vsel.onchange;
  const vname = h('input', { class: 'tdvnew', placeholder: 'e.g. 0.6, then Enter', onkeydown: async e => {
    if (e.key === 'Escape') { e.stopPropagation(); vname.value = ''; vname.replaceWith(vsel); vsel.value = pl.version ?? ''; }
    if (e.key !== 'Enter') return;
    const name = vname.value.trim().replace(/^v(?=\d)/i, '');
    if (!name) return;
    vname.value = '';
    if (!plan.versions.some(v => v.name === name)) await deck.setPlan(project, { ...plan, versions: [...plan.versions, { name, state: '' }] });
    await set('Version', name);
  } });
  vsel.onchange = e => { if (e.target.value !== ADD) return vset(e); vsel.replaceWith(vname); vname.focus(); };
  return h('div', { class: 'tdplan' },
    pick('Priority', 'Priority', pl.priority, [['', 'None'], [1, '1 (highest)'], [2, '2'], [3, '3'], [4, '4']]),
    version);
}

// The item's tags (#224): each tag from Settings, and any it already carries, toggles on a click.
function tagRow(ctx) {
  const { h, deck, project, task: t } = ctx;
  const all = [...new Set([...(ctx.tags || []), ...itemTags(t)])];
  return h('div', { class: 'tagset tdtags' }, all.map(x => h('button', { class: 'chip' + (hasTag(t, x) ? ' on' : ''), title: hasTag(t, x) ? `Take the tag ${x} off` : `Tag it ${x}`,
    onclick: async () => { await deck.setTaskKey(project, t.n, 'Tags', toggleTag(t, x)); ctx.onChange(); } }, x)));
}

// The card's saved sketches (#130): open or take off each one, attach one from this
// project's or Me's sketches, or draw a new one, saved in this project's sketches.
function sketchRow(ctx) {
  const { h, icon, deck, project, task: t } = ctx, item = { kind: 'task', project, n: t.n }, have = sketchesOf(t);
  const attach = rel => deck.sketchAttach(item, rel).then(() => ctx.onChange());
  const pick = h('select', { onchange: e => { if (e.target.value) attach(e.target.value); } }, h('option', { value: '' }, 'Attach a sketch...'));
  Promise.all([deck.sketchList(project), project === 'Me' ? [] : deck.sketchList('Me')]).then(([own, me]) => {
    for (const s of [...own, ...me]) if (!have.includes(s.rel)) pick.append(h('option', { value: s.rel }, sketchName(s.rel) + (parseRel(s.rel).project !== project ? ` (${parseRel(s.rel).project})` : '')));
  });
  // New sketch (#140) opens the board at once, named after the item ("-2", "-3" when taken).
  const newSk = h('button', { class: 'btn', title: 'Draw a new sketch for this item', onclick: () => openSavedSketch({ project, name: t.text, onSaved: attach }) }, icon('pen'), 'New sketch');
  return h('div', { class: 'tdsks' },
    have.length ? h('div', { class: 'skbs' }, have.map(rel => h('span', { class: 'skb' },
      h('button', { title: `Open the sketch "${sketchName(rel)}"`, onclick: () => openSavedSketch({ rel, project: parseRel(rel).project, name: sketchName(rel), onSaved: () => ctx.onChange() }) }, icon('pen'), sketchName(rel)),
      h('button', { class: 'skx', title: 'Take this sketch off', onclick: () => deck.sketchDetach(item, rel).then(() => ctx.onChange()) }, icon('x'))))) : null,
    h('div', { class: 'tdsk' }, pick, newSk));
}
