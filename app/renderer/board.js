// The Home board: four status lanes across every project, or one project's own board in
// the same place (its Kanban, notes and recent commits). The PM keeps the items tidy.
import { kanbanSection } from './kanban.js';
import { helperButton } from './helper.js';
import { planOf } from '../lib/plan.js';
import { doneOf } from '../lib/tasks.js';
import { hist, tagBadges } from './home.js';
import { filterDrop } from './filterdrop.js';
import { linkChips } from './textlinks.js';
import { cardLinks } from '../lib/links.js';
import { SORTS, normalizeSort, sortCmp, tagMatch, normalizeTagFilter } from '../lib/boardsort.js';

// What an item asks of the owner, if anything: a decision, an unblock, a test or a to-do.
export function ownerKind(t) {
  if (t.mark === '?') return 'decide';
  if (t.mark === '!') return 'unblock';
  if (t.forOwner && t.mark !== 'x') return isTest(t) ? 'test' : 'do';
  return null;
}
// The owner's checks and tests, open or done. The board's test view shows only these; its
// work view shows everything else, the owner's to-dos included.
export const isTest = t => !!t.forOwner && /^(check|test|try|confirm|verify)\b/i.test(t.text);
const KIND = { decide: 'Decide', unblock: 'Unblock', test: 'Test', do: 'Do' };
const ORDER = { decide: 0, unblock: 1, test: 2, do: 3 };

// Lanes, in order, with which items fall in each.
const LANES = [
  ['you', 'For you', 'needs', t => !!ownerKind(t)],
  ['ready', 'Ready to send', 'idle', t => t.mark === ' ' && !t.forOwner],
  ['doing', 'In progress', 'working', t => t.mark === '~'],
  ['done', 'Done', 'done', t => t.mark === 'x'],
];

// Home's columns (#167): by kind (the default: Tests, To-dos, Decide / unblock, Work and
// Done), by status (the lanes) or one per project. Each column scrolls on its own. The
// project dropdown and the priority toggles filter every view; by status, the kind chips
// filter For you. Done stays a thin rail until opened, then shows the latest 20.
const VIEWS = [['kind', 'By kind'], ['status', 'By status'], ['proj', 'By project']];
const KINDS = [['all', 'All'], ['test', 'Tests'], ['do', 'To-dos'], ['ask', 'Decide / unblock']];
const PRIOS = [[1, 'P1'], [2, 'P2'], [3, 'P3'], [4, 'P4'], [0, 'No priority']];
const kindIs = (k, f) => f === 'all' || (f === 'ask' ? k === 'decide' || k === 'unblock' : k === f);
// Any column folds to a thin rail and back (#367), as Done always could; Done starts folded.
// Remembered for this run.
const folded = new Set(['done']);
let doneAll = false;
// The project picker stays open across redraws until a click lands outside it.
let pickOpen = false;
// The filter row slides open under the Filters button (#403), remembered for this run.
let filtersOpen = false;
// Each column's icon in its header (#410), by the state colour it carries.
const COL_ICON = { needs: 'alert', blocked: 'alert', idle: 'send', working: 'progress', done: 'check' };
document.addEventListener('click', e => { if (!e.target.closest('.bpick')) pickOpen = false; });

// c: { h, icon, projects, tasksOf, focus, tab, setTab, kind, setKind, only, setOnly, prompts, promptCard, testView, setFocus, showTask, send, answer, markDone,
//      addTask, openTab, isOpen, openInCode, openProjectPage, labelOf, dot, extra,
//      deck, apply, rerender, tasksMd } where apply(promise of fresh data) redraws with it
export function boardSection(c) {
  const { h } = c;
  const left = n => c.tasksOf(n).filter(t => t.mark !== 'x').length;
  const active = c.projects.filter(p => c.isOpen(p.name) || left(p.name)), quiet = c.projects.filter(p => !active.includes(p));
  // The ticked projects (#205); one that went quiet or is gone drops out. None ticked shows all.
  const only = (c.only || []).filter(n => active.some(p => p.name === n));
  // A project's own board keeps its work / tests switch; Home's columns show everything.
  const items = (c.focus ? [c.focus] : only.length ? only : c.projects.map(p => p.name))
    .flatMap(p => c.tasksOf(p).map(t => ({ p, t })))
    .filter(({ t }) => !c.focus || isTest(t) === !!c.testView)
    .filter(({ t }) => c.focus || !c.prios?.length || c.prios.includes(planOf(t).priority ?? 0))
    .filter(({ t }) => tagMatch(t, c.tagFilter));
  // The order (#293): priority, or date added newest or oldest first, in every column.
  const sort = normalizeSort(c.sort), cmp = sortCmp(sort), added = sort.by === 'added';

  // One dropdown in place of a chip per project: projects with work left are ticked to filter
  // the columns (#205); a quiet one opens its own board. It stays open while ticking.
  const tick = (n, on) => c.setOnly(on ? [...only, n] : only.filter(x => x !== n));
  const menu = h('div', { class: 'pop left bpickpop' + (pickOpen ? ' open' : '') },
    h('button', { class: 'bpall' + (only.length ? '' : ' on'), onclick: () => c.setOnly([]) }, 'All projects'),
    active.map(p => h('label', { class: 'bpopt' },
      h('input', { type: 'checkbox', checked: only.includes(p.name), onchange: e => tick(p.name, e.target.checked) }),
      h('span', {}, p.name), h('small', {}, String(left(p.name))))),
    quiet.length ? [h('h4', {}, `Quiet (${quiet.length})`),
      quiet.map(p => h('button', { class: 'bpquiet', onclick: () => { pickOpen = false; c.setFocus(p.name); } }, p.name))] : null);
  const label = !only.length ? 'All projects' : only.length === 1 ? only[0] : `${only.length} projects`;
  const pick = h('span', { class: 'wrap bpick' },
    h('button', { class: 'bsel', title: 'Show these projects', onclick: e => { e.stopPropagation(); pickOpen = !menu.classList.contains('open'); menu.classList.toggle('open', pickOpen); } },
      label, h('span', { class: 'bcaret' }, '▾')),
    menu);
  const laneIs = key => LANES.find(l => l[0] === key)[3];
  // Leads stopped on a prompt in their own pane (#152): answered from the top of For you.
  const prompts = (c.prompts || []).filter(w => !only.length || only.includes(w.project));
  const views = h('span', { class: 'bviews' }, VIEWS.map(([k, name]) =>
    h('button', { class: 'btab' + (c.tab === k ? ' on' : ''), onclick: () => c.setTab(k) }, name)));
  // Priority and Tags filter from dropdowns like Azure Boards' (#293); none picked shows all.
  const all = (c.focus ? [c.focus] : c.projects.map(p => p.name)).flatMap(p => c.tasksOf(p));
  const prios = filterDrop({ h, id: 'prio', label: 'Priority', picked: c.prios || [], onChange: c.setPrios,
    options: PRIOS.map(([n, name]) => ({ value: n, label: name, count: all.filter(t => (planOf(t).priority ?? 0) === n && t.mark !== 'x').length })) });
  const tf = normalizeTagFilter(c.tagFilter);
  const tags = (c.tags || []).length ? filterDrop({ h, id: 'tags', label: 'Tags', picked: tf.tags, onChange: l => c.setTagFilter({ ...tf, tags: l }),
    mode: tf.mode, setMode: m => c.setTagFilter({ ...tf, mode: m }),
    options: c.tags.map(x => ({ value: x, label: x, count: all.filter(t => t.mark !== 'x' && tagMatch(t, { tags: [x] })).length })) }) : null;
  // One sort control (#404): what to sort by, and for date added an arrow for the direction.
  const sorter = h('span', { class: 'bsort', title: 'Order of the cards in every column' },
    h('span', { class: 'bsortlab' }, 'Sort'),
    h('select', { class: 'bsel', onchange: e => c.setSort({ ...sort, by: e.target.value }) }, SORTS.map(([v, name]) => h('option', { value: v, selected: sort.by === v }, name))),
    added ? h('button', { class: 'bsel bdir', title: sort.old ? 'Oldest first: click for newest first' : 'Newest first: click for oldest first', 'aria-label': sort.old ? 'Oldest first' : 'Newest first',
      onclick: () => c.setSort({ ...sort, old: !sort.old }) }, c.icon(sort.old ? 'arrowup' : 'arrowdown')) : null);
  // By status, For you's types are a dropdown like the others (#405), not a row of chips.
  const kindCount = k => (kindIs('decide', k) ? prompts.length : 0) + items.filter(({ t }) => ownerKind(t) && kindIs(ownerKind(t), k)).length;
  const kinds = c.tab === 'status' ? h('select', { class: 'bsel bkind' + (c.kind && c.kind !== 'all' ? ' set' : ''), title: 'Which of For you to show', onchange: e => c.setKind(e.target.value) },
    KINDS.map(([k, name]) => h('option', { value: k, selected: (c.kind || 'all') === k }, k === 'all' ? 'All types' : `${name} (${kindCount(k)})`))) : null;
  const chips = h('div', { class: 'bchips' }, c.focus ? null : views, pick, c.focus ? null : prios, tags, kinds, sorter);
  // The filters hide behind one button (#403) that shows how many are in use.
  const inUse = (only.length ? 1 : 0) + (!c.focus && c.prios?.length ? 1 : 0) + (tf.tags.length ? 1 : 0) + (kinds && c.kind && c.kind !== 'all' ? 1 : 0);
  const shelf = h('div', { class: 'bfilters' + (filtersOpen ? ' open' : '') }, h('div', {}, chips));
  const fbtn = h('button', { class: 'btn bfbtn' + (filtersOpen ? ' on' : ''), title: filtersOpen ? 'Hide the filters' : 'Show the filters', onclick: () => {
    filtersOpen = !filtersOpen; shelf.classList.toggle('open', filtersOpen); fbtn.classList.toggle('on', filtersOpen); fbtn.title = filtersOpen ? 'Hide the filters' : 'Show the filters';
  } }, c.icon('filter'), 'Filters', inUse ? h('span', { class: 'bfcount' }, String(inUse)) : null);
  const bar = [h('div', { class: 'bfbar' }, fbtn), shelf];

  const itemEl = ({ p, t }, lane) => {
    const kind = ownerKind(t);
    let act = null;
    if (lane === 'ready') act = h('button', { class: 'btn send', title: `Hand it to ${p}'s CTO`, onclick: () => c.send(p, t.n) }, 'Send');
    else if (kind === 'decide') {
      const { options, suggest } = c.optionsOf(t);
      act = options.length ? options.map(o => h('button', { class: 'btn' + (o === suggest ? ' primary' : ''), onclick: () => c.answer(p, t.n, o) }, o)) : null;
    } else if (kind === 'test' || kind === 'do') act = h('button', { class: 'btn', title: 'Mark done', onclick: () => c.markDone(p, t.n) }, 'Done');
    const open = e => { if (!e.target.closest('button')) c.showTask(p, t); };
    // Compact: one line per item, the title cut short and a small action at the end; the
    // project and number show on hover. A decision still opens the item to answer it.
    if (c.compact) {
      const mini = lane === 'ready' ? h('button', { class: 'mini send', title: `Send to ${p}'s CTO`, onclick: () => c.send(p, t.n) }, '→')
        : kind === 'test' || kind === 'do' ? h('button', { class: 'mini', title: 'Mark done', onclick: () => c.markDone(p, t.n) }, '✓') : null;
      return h('div', { class: 'bitem compact', title: `${t.text}\n${p} #${t.n}${kind ? ' · ' + KIND[kind] : ''}`, onclick: open },
        kind ? h('span', { class: 'kdot ' + kind }) : null, h('span', { class: 'btitle' }, t.text), mini);
    }
    // A question's links and files (#416), so it can be answered from the card.
    const links = kind === 'decide' || kind === 'unblock' ? linkChips(cardLinks(t), { openFile: c.openMd, toast: c.toast }) : null;
    return h('div', { class: 'bitem', title: 'Open details', onclick: open },
      h('div', { class: 'btitle' }, t.text), hist(h, t), links,
      t.result && lane !== 'ready' ? h('div', { class: 'bitres' }, t.result) : null,
      h('div', { class: 'brow' },
        planOf(t).priority ? h('span', { class: 'prio p' + planOf(t).priority }, `P${planOf(t).priority}`) : null, tagBadges(h, t),
        kind && !(c.tab === 'kind' && !c.focus && (kind === 'test' || kind === 'do')) ? h('span', { class: 'kind ' + kind }, KIND[kind]) : null, // its column already says it
        c.focus || c.tab === 'proj' ? h('span', { class: 'bn' }, `#${t.n}`)
          : h('button', { class: 'bproj', title: `${p}'s board`, onclick: () => c.setFocus(p) }, c.dot(p), p, h('span', { class: 'bn' }, ` #${t.n}`)),
        h('span', { class: 'bacts' + (kind === 'decide' && Array.isArray(act) ? ' answers' : '') }, act)));
  };

  const laneList = (key, kind = c.kind) => {
    const list = items.filter(({ t }) => laneIs(key)(t));
    if (key === 'you') return list.filter(({ t }) => kindIs(ownerKind(t), kind)).sort((a, b) => (added ? 0 : ORDER[ownerKind(a.t)] - ORDER[ownerKind(b.t)]) || cmp(a.t, b.t));
    if (key === 'done') return list.sort((a, b) => added ? cmp(a.t, b.t) : doneOf(b.t).localeCompare(doneOf(a.t)) || (b.t.date || '').localeCompare(a.t.date || '') || b.t.n - a.t.n);
    return list.sort((a, b) => cmp(a.t, b.t));
  };
  // One column: a header with its icon, count and a fold button, then its cards in a list that
  // scrolls on its own. Folded, it is a thin rail with its name; a click opens it again.
  // The columns sit in one panel, divided by thin lines (#410).
  const colIcon = st => h('span', { class: 'bcicon ' + (st || 'work') }, c.icon(COL_ICON[st] || 'board'));
  const col = (key, name, st, cards, o = {}) => {
    const count = o.count ?? cards.length;
    if (folded.has(key)) return h('section', { class: 'lane bcol brail', 'data-col': key, title: `Show ${name}`, onclick: () => { folded.delete(key); c.rerender(); } },
      h('span', { class: 'bfold' }, c.icon('colopen')), colIcon(st), h('span', { class: 'vt' }, name, h('small', {}, count)));
    return h('section', { class: 'lane bcol' + (o.wide ? ' wide' : ''), 'data-col': key },
      h('header', {}, colIcon(st), h('span', { class: 'bcname' }, name), h('small', {}, count),
        h('button', { class: 'ptool bfold', title: `Fold ${name}`, onclick: () => { folded.add(key); if (key === 'done') doneAll = false; c.rerender(); } }, c.icon('colfold'))),
      h('div', { class: 'bcl' }, o.top || null, cards.length || o.top?.length ? cards : h('div', { class: 'empty-note' }, 'Nothing here'), o.after || null));
  };
  const sub = (st, name, n) => h('div', { class: 'bsub' }, h('span', { class: 'st-dot ' + st }), name, h('small', {}, n));
  const doneCol = () => {
    const d = laneList('done');
    return col('done', 'Done', 'done', (doneAll ? d : d.slice(0, 20)).map(i => itemEl(i, 'done')), { count: d.length,
      after: !doneAll && d.length > 20 ? h('button', { class: 'more', onclick: () => { doneAll = true; c.rerender(); } }, `Show ${d.length - 20} older`) : null });
  };
  const cols = (...kids) => h('div', { class: 'lanes bcols' + (c.compact ? ' compact' : '') }, kids);

  // By kind (the default): what you are asked for, one column per kind, then the leads' work.
  if (!c.focus && c.tab === 'kind') {
    const you = laneList('you', 'all'), of = k => you.filter(({ t }) => kindIs(ownerKind(t), k));
    return [...bar, cols(
      col('test', 'Tests', 'needs', of('test').map(i => itemEl(i, 'you'))),
      col('do', 'To-dos', 'needs', of('do').map(i => itemEl(i, 'you'))),
      col('ask', 'Decide / unblock', 'blocked', of('ask').map(i => itemEl(i, 'you')), { top: prompts.map(c.promptCard), count: prompts.length + of('ask').length }),
      col('work', 'Work', null, [sub('idle', 'Ready to send', laneList('ready').length), ...laneList('ready').map(i => itemEl(i, 'ready')),
        sub('working', 'In progress', laneList('doing').length), ...laneList('doing').map(i => itemEl(i, 'doing'))], { count: laneList('ready').length + laneList('doing').length }),
      doneCol())];
  }
  // By status: the lanes, For you first and wider, its kind chips above.
  if (!c.focus && c.tab === 'status') {
    const asks = kindIs('decide', c.kind) ? prompts : [];
    return [...bar, cols(
      col('you', 'For you', 'needs', laneList('you').map(i => itemEl(i, 'you')), { wide: true, top: asks.map(c.promptCard), count: asks.length + laneList('you').length }),
      col('ready', 'Ready to send', 'idle', laneList('ready').map(i => itemEl(i, 'ready'))),
      col('doing', 'In progress', 'working', laneList('doing').map(i => itemEl(i, 'doing'))),
      doneCol())];
  }

  // By project: one column per project with items left (anything not done), the most first.
  if (!c.focus) {
    const laneOf = t => LANES.find(l => l[3](t))?.[0];
    const rank = { you: 0, doing: 1, ready: 2 };
    const list = c.projects.map(p => ({ p: p.name, list: items.filter(i => i.p === p.name && i.t.mark !== 'x') }))
      .filter(x => x.list.length)
      .sort((a, b) => b.list.length - a.list.length || a.p.localeCompare(b.p));
    const byProj = h('div', { class: 'lanes bcols byproj' + (c.compact ? ' compact' : '') }, list.length ? list.map(({ p, list }) => {
      list.sort((a, b) => (added ? 0 : (rank[laneOf(a.t)] ?? 3) - (rank[laneOf(b.t)] ?? 3)) || cmp(a.t, b.t));
      return h('section', { class: 'lane bcol', 'data-project': p },
        h('header', {}, h('button', { class: 'bproj', title: `${p}'s board`, onclick: () => c.setFocus(p) }, c.dot(p), p), h('small', {}, list.length)),
        h('div', { class: 'bcl' }, list.map(i => itemEl(i, laneOf(i.t)))));
    }) : h('div', { class: 'empty-note' }, 'Nothing left in any project'));
    return [...bar, byProj];
  }

  // One project's board: a header with its session and links, its lanes, notes and commits.
  const add = h('input', { placeholder: `New task for ${c.focus}, then Enter (the ${c.keeper || 'PM'} can tidy it)`, onkeydown: e => {
    if (e.key === 'Enter' && add.value.trim()) c.addTask(c.focus, add.value);
  } });
  const head = h('div', { class: 'bhead' },
    h('button', { class: 'btn ghost', onclick: () => c.setFocus(null) }, '← All projects'),
    c.dot(c.focus), h('span', { class: 'bname' }, c.focus), h('span', { class: 'bsub' }, c.labelOf(c.focus)),
    h('span', { class: 'bacts' },
      h('button', { class: 'btn primary', onclick: () => c.openTab(c.focus) },c.isOpen(c.focus) ? 'Open session' : 'Start session'),
      h('button', { class: 'btn', onclick: () => c.openInCode(c.focus) }, 'Open in VS Code'),
      h('button', { class: 'btn', onclick: () => c.openProjectPage(c.focus) }, 'Project page')));
  const x = c.extra;
  const notes = x ? x.notes.slice(-6).reverse() : [];
  const extra = h('div', { class: 'bextra' },
    h('section', { class: 'lane' }, h('header', {}, 'Notes'),
      !x ? h('div', { class: 'empty-note' }, 'Loading…') : notes.length ? notes.map(n => h('div', { class: 'note' }, h('div', { class: 'when' }, n.when), n.text)) : h('div', { class: 'empty-note' }, 'No notes yet.')),
    h('section', { class: 'lane' }, h('header', {}, 'Recent commits'),
      !x ? h('div', { class: 'empty-note' }, 'Loading…') : x.commits.length ? h('ul', { class: 'clist' }, x.commits.slice(0, 8).map(cm => h('li', {}, h('span', { class: 'chash' }, cm.hash), h('span', { class: 'csub' }, cm.subject), h('span', { class: 'cwhen' }, cm.when)))) : h('div', { class: 'empty-note' }, x.git ? 'No commits yet.' : 'Not a git repository.')));
  return [head, h('div', { class: 'note-add' }, add, helperButton({ kind: 'task', project: c.focus, field: add, onAdd: d => c.apply(c.deck.helperAdd({ kind: 'task', project: c.focus, draft: d })) })), kanbanSection({ ...c, ownerKind, sortCmp: cmp }, items), extra];
}
