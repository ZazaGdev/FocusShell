// A project's own page: tasks (editable, with per-task notes), notes, README, pull
// requests, past sessions, commits, and briefs with how each turned out.
import { parseTasks, parseNotes, splitTaskNotes, briefOutcome } from '../lib/tasks.js';
import { helperButton } from './helper.js';
import { hist, tagBadges } from './home.js';
import { noteText } from '../lib/helper.js';

const MARK_CLASS = { '~': 'p', '?': 'q', '!': 'b', x: 'x', ' ': '' };
const MARK_WORD = { '~': 'in progress', '?': 'asked you', '!': 'blocked', x: 'done', ' ': 'open', '': 'no task line' };
const GROUPS = [
  ['?', 'Waiting on you'],
  ['!', 'Blocked'],
  ['~', 'In progress'],
  [' ', 'Open'],
];

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

function briefGoal(text) {
  const m = text.match(/^Goal:\s*(.+)$/m);
  return m ? m[1] : text.split(/\r?\n/).find(l => l.trim() && !l.startsWith('#')) || '';
}

// ctx: { h, icon, deck, details, prs, tasksMd, isOpen, openSession, resume, back, refresh, openTask,
//        rerender, showDone, setShowDone }
export function renderProject(root, ctx) {
  const { h, deck, details: d } = ctx;
  root.replaceChildren();
  if (!d) { root.append(h('div', { class: 'home-inner' }, h('p', { class: 'sub' }, 'Loading…'))); return; }

  const tasks = parseTasks(ctx.tasksMd);
  const { byTask, general } = splitTaskNotes(parseNotes(d.notes));
  const addNote = async text => { d.notes = await deck.addProjectNote(d.name, text); ctx.rerender(); };

  // ---- header ----
  const gitLine = d.git
    ? [h('span', { class: 'gtag' }, d.git.branch), d.git.changed ? h('span', { class: 'gwarn' }, `${d.git.changed} uncommitted change${d.git.changed === 1 ? '' : 's'}`) : h('span', {}, 'clean')]
    : [h('span', {}, 'not a git repository')];
  const header = h('div', { class: 'phead' },
    h('button', { class: 'btn ghost back', onclick: ctx.back }, '← Home'),
    h('div', { class: 'ptitle' },
      h('h1', {}, d.name),
      h('div', { class: 'pmeta' },
        h('a', { class: 'plink', href: '#', title: 'Open folder', onclick: e => { e.preventDefault(); deck.openPath(d.path); } }, d.path),
        h('span', { class: 'sep' }, '·'), gitLine)),
    h('div', { class: 'pbtns' },
      h('button', { class: 'btn primary', onclick: () => ctx.openSession(d.name) }, ctx.isOpen ? 'Open session' : 'Start session'),
      h('button', { class: 'btn', onclick: () => deck.openPath(d.path) }, 'Open folder'),
      h('button', { class: 'btn', onclick: () => deck.openInCode(d.name) }, 'Open in VS Code')));

  // ---- tasks ----
  const addInput = h('input', { placeholder: `New task for ${d.name}, then Enter`, onkeydown: async e => {
    if (e.key === 'Enter' && addInput.value.trim()) { await deck.addTask(d.name, addInput.value); ctx.refresh(); }
  } });

  const row = t => {
    const notes = byTask[String(t.n)] || [];
    // Click the title to open the item: full details, brief, notes, and editing.
    const text = h('span', { class: 'ttext', title: 'Open details' }, `#${t.n} ${t.text}`);
    const textBox = h('div', {}, text, t.details.length ? h('span', { class: 'tmore' }, ' · details') : null, tagBadges(h, t), hist(h, t));
    text.onclick = () => ctx.openTask(t);
    const noteBox = h('div', { class: 'tnote-add', style: 'display:none' });
    const noteInput = h('input', { placeholder: `Note on #${t.n}, then Enter`, onkeydown: e => {
      if (e.key === 'Escape') noteBox.style.display = 'none';
      if (e.key === 'Enter' && noteInput.value.trim()) addNote(`#${t.n} ${noteInput.value}`);
    } });
    noteBox.append(noteInput);
    return h('li', { class: t.mark === 'x' ? 'done' : '' },
      h('span', { class: 'mk ' + MARK_CLASS[t.mark] }, `[${t.mark}]`),
      h('div', { class: 't' }, textBox,
        t.result ? h('div', { class: 'r' }, t.result) : null,
        notes.length ? h('div', { class: 'tnotes' }, notes.map(n => h('div', { class: 'tnote' }, h('span', { class: 'when' }, n.when), n.text))) : null,
        noteBox),
      h('span', { class: 'tacts' },
        h('button', { class: 'btn ghost', title: 'Add a note to this task', onclick: () => { noteBox.style.display = 'block'; noteInput.focus(); } }, 'Note'),
        t.mark === 'x'
          ? h('button', { class: 'btn ghost', title: 'Reopen', onclick: async () => { await deck.setTaskMark(d.name, t.n, ' '); ctx.refresh(); } }, 'Reopen')
          : h('button', { class: 'btn ghost', title: 'Mark done', onclick: async () => { await deck.setTaskMark(d.name, t.n, 'x'); ctx.refresh(); } }, 'Done')));
  };
  const groups = GROUPS.map(([mark, label]) => {
    const list = tasks.filter(t => t.mark === mark);
    return list.length ? [h('h3', {}, `${label} (${list.length})`), h('ul', { class: 'tlist' }, list.map(row))] : null;
  });
  const done = tasks.filter(t => t.mark === 'x');
  const taskCard = h('section', { class: 'pcard' },
    h('h2', {}, 'Tasks'),
    h('div', { class: 'note-add' }, addInput, helperButton({ kind: 'task', project: d.name, field: addInput, onAdd: async dr => { await deck.helperAdd({ kind: 'task', project: d.name, draft: dr }); ctx.refresh(); } })),
    tasks.length - done.length ? groups : h('div', { class: 'empty-note' }, 'Nothing open.'),
    done.length ? [
      h('button', { class: 'btn ghost more', onclick: () => ctx.setShowDone(!ctx.showDone) }, ctx.showDone ? `Hide ${done.length} done` : `Show ${done.length} done`),
      ctx.showDone ? h('ul', { class: 'tlist' }, done.map(row)) : null,
    ] : null);

  // ---- briefs, with how each turned out ----
  let briefCard = null;
  if (d.briefs.length) {
    const rows = d.briefs.map(b => ({ b, o: briefOutcome(b.text, tasks.find(t => t.n === b.n)) }));
    const count = m => rows.filter(r => r.o.mark === m).length;
    const asked = rows.filter(r => r.o.yes > 0).length;
    const stats = `${rows.length} brief${rows.length === 1 ? '' : 's'} · ${count('x')} done · ${count('?')} waiting on you · ${count('!')} blocked · ${asked} raised a deciding guess`;
    briefCard = h('section', { class: 'pcard' },
      h('h2', {}, 'Task briefs'),
      h('div', { class: 'bstats' }, stats),
      h('ul', { class: 'blist' }, rows.slice(0, 15).map(({ b, o }) => {
        const body = h('pre', { class: 'brief', style: 'display:none' }, b.text);
        return h('li', {},
          h('button', { class: 'blink', onclick: () => { body.style.display = body.style.display === 'none' ? 'block' : 'none'; } },
            h('span', { class: 'bn' }, `#${b.n}`),
            h('span', { class: 'bgoal' }, briefGoal(b.text)),
            h('span', { class: 'bout ' + (MARK_CLASS[o.mark] || '') }, MARK_WORD[o.mark] || o.mark)),
          o.result ? h('div', { class: 'bres' }, o.result) : null,
          body);
      })));
  }

  // ---- README ----
  const readmeCard = d.readme ? h('section', { class: 'pcard' },
    h('h2', {}, 'About'),
    d.readme.summary ? h('p', { class: 'readme' }, d.readme.summary) : h('div', { class: 'empty-note' }, 'The README has no summary paragraph.'),
    h('button', { class: 'btn ghost more', onclick: () => deck.openPath(d.readme.file) }, 'Show README in its folder')) : null;

  // ---- pull requests ----
  const pr = ctx.prs;
  const prCard = d.git ? h('section', { class: 'pcard' },
    h('h2', {}, 'Open pull requests'),
    !pr ? h('div', { class: 'empty-note' }, 'Checking GitHub…')
      : pr.error ? h('div', { class: 'empty-note' }, pr.error)
      : !pr.prs.length ? h('div', { class: 'empty-note' }, 'None open.')
      : h('ul', { class: 'clist' }, pr.prs.map(p => h('li', {},
        h('span', { class: 'chash' }, `#${p.number}`),
        h('a', { class: 'csub plink', href: '#', title: p.url, onclick: e => { e.preventDefault(); deck.openPath(p.url); } }, p.title, p.isDraft ? ' (draft)' : ''),
        h('span', { class: 'cwhen' }, when(p.updatedAt)))))) : null;

  // ---- notes ----
  const noteInput = h('input', { placeholder: 'Add a note, then Enter (start with #12 to attach it to task 12)', onkeydown: e => {
    if (e.key === 'Enter' && noteInput.value.trim()) addNote(noteInput.value);
  } });
  const noteList = general.slice().reverse();
  const noteCard = h('section', { class: 'pcard' },
    h('h2', {}, 'Notes'),
    h('div', { class: 'note-add' }, noteInput, helperButton({ kind: 'pnote', project: d.name, field: noteInput, onAdd: dr => addNote(noteText(dr)) })),
    noteList.length ? noteList.map(n => h('div', { class: 'note' }, h('div', { class: 'when' }, n.when), n.text)) : h('div', { class: 'empty-note' }, 'No notes for this project yet.'));

  // ---- sessions ----
  const sessCard = h('section', { class: 'pcard' },
    h('h2', {}, `Past sessions (${d.sessions.length})`),
    d.sessions.length ? h('ul', { class: 'slist' }, d.sessions.map(s => h('li', {},
      h('div', { class: 'sbody' },
        h('div', { class: 'stitle', title: s.title }, s.title),
        h('div', { class: 'smeta' }, `${when(s.start)}${s.end && s.end.slice(0, 16) !== s.start.slice(0, 16) ? ' to ' + when(s.end) : ''} · ${s.partial ? 'long session' : `${s.user + s.assistant} messages`}`)),
      h('button', { class: 'btn', title: 'Open this conversation again in a tab', onclick: () => ctx.resume(d.name, s.id) }, 'Resume'))))
      : h('div', { class: 'empty-note' }, 'No Claude Code sessions recorded for this folder.'));

  // ---- commits ----
  const gitCard = d.git ? h('section', { class: 'pcard' },
    h('h2', {}, 'Recent commits'),
    d.git.log.length ? h('ul', { class: 'clist' }, d.git.log.map(c => h('li', {},
      h('span', { class: 'chash' }, c.hash), h('span', { class: 'csub' }, c.subject), h('span', { class: 'cwhen' }, c.when))))
      : h('div', { class: 'empty-note' }, 'No commits yet.')) : null;

  root.append(h('div', { class: 'home-inner' }, header,
    h('div', { class: 'pgrid' },
      h('div', { class: 'pcol' }, taskCard, briefCard),
      h('div', { class: 'pcol' }, readmeCard, noteCard, prCard, sessCard, gitCard))));
}
