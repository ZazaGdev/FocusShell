// The deck command (#225): every change a session makes to a board, one verb at a time,
// through the same functions the app uses and under the same lock (lib/boardio.js).
// Boards: a project's tasks/<Project>.md, Me (tasks/Me.md), Ideas (ideas/Me.md). Notes:
// notes/<Project>.md for a project's card notes, notes.md for Me's.
import fs from 'node:fs';
import path from 'node:path';
import { parseTasks, addTaskLine, setMark, setResult, setWho, addDetail, setTaskText, addNoteLine, itemTags, toggleTag, SHARED_START } from './tasks.js';
import { nextShared, boardOf } from './counter.js';
import { relinkShots } from './shots.js';

// Verbs whose first argument is an item's board; with a shared-counter number it may be left out.
const ON_ITEM = new Set(['show', 'mark', 'result', 'detail', 'title', 'answer', 'tag', 'set', 'due', 'someday', 'move']);
import { setSomeday, setSchedule, rollRepeat, repeatOf } from './me.js';
import { parsePlan, setPlan, setTaskKey } from './plan.js';
import { update } from './boardio.js';
import { setStatus } from './status.js';
import { statusFile, readStatus, writeStatus } from './statusfile.js';

export const USAGE = `deck <verb> ...   (put text in single quotes; Windows paths go in as they are)
  show    <Board> [<n>]                     print a board, or one item with its details
  add     <Board> '<title>' [--who <session>] [--owner] [--detail '<text>']... [--tags 'A, B']
          [--priority 1-4] [--version <name>] [--due 'YYYY-MM-DD [HH:MM]'] [--repeat '<N> day|week'] [--someday]
  mark    <Board> <n> open|working|needs|blocked|done [--result '<short result>'] [--who <session>]
  result  <Board> <n> '<short result>'
  detail  <Board> <n> '<text>'              adds a detail line under the item
  title   <Board> <n> '<new title>'
  answer  <Board> <n> '<answer>'            the user's answer: marks it working, adds "Answer: ..."
  tag     <Board> <n> <Tag> [--off]
  set     <Board> <n> Version|Priority|Tags|State '<value>'   ('-' clears it)
  version <Board> <name> current|done|planned|remove
  due     Me <n> YYYY-MM-DD|- [HH:MM] [--repeat '<N> day|week']
  someday Me <n> on|off
  move    <From> <n> <To>                   copies the item to <To>, closes it on <From>
  note    <Project>|Me '<text>'             a note (card notes start '#<n> CTO: ...')
  status  [lead-<Project> '<where it stopped>']   one short line per lead for the Status view; none prints them
  backup  [--push]                          commit the board files now; --push also pushes them
  relink  '<old folder>' '<new folder>' [--dry]   Screenshot lines under the old folder point at the new one
Boards: a project name, Me, or Ideas.
Numbers: every task board shares one counter from 1000, so a number from 1000 up names one item
and its board may be left out (deck mark 1041 done). A number below 1000 is an old one: give its board.`;

const MARKS = { open: ' ', ' ': ' ', working: '~', '~': '~', needs: '?', '?': '?', blocked: '!', '!': '!', done: 'x', x: 'x' };
const KEYS = ['Version', 'Priority', 'Tags', 'State'];
const stamp = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

// Splits arguments into positionals and --options (repeatable ones collect into arrays).
export function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2);
    if (['owner', 'someday', 'off', 'push', 'dry'].includes(k)) { opt[k] = true; continue; }
    if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
    const v = argv[++i];
    if (k === 'detail') (opt.detail = opt.detail || []).push(v); else opt[k] = v;
  }
  return { pos, opt };
}

// Text that goes into a board: one line, no control characters.
function clean(v, what) {
  const s = String(v ?? '');
  if (/[\x00-\x08\x0b-\x1f\x7f]/.test(s)) throw new Error(`${what} holds a control character; check the quoting`);
  const one = s.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!one) throw new Error(`${what} is empty`);
  return one;
}
const num = v => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw new Error(`"${v}" is not an item number`); return n; };

// The file of a board, and of its notes.
export function boardFile(data, board) {
  const b = String(board || '');
  if (!/^[\w.-]+$/.test(b)) throw new Error(`"${b}" is not a board name`);
  if (/^ideas$/i.test(b)) return { file: path.join(data, 'ideas', 'Me.md'), head: '# Me ideas', name: 'Ideas' };
  const name = /^me$/i.test(b) ? 'Me' : b;
  return { file: path.join(data, 'tasks', `${name}.md`), head: `# ${name} tasks`, name };
}
const notesFile = (data, board) => /^me$/i.test(board) ? { file: path.join(data, 'notes.md'), head: '# Notes' } : { file: path.join(data, 'notes', `${board}.md`), head: `# ${board} notes` };
const itemOf = (md, n, name) => { const t = parseTasks(md).find(x => x.n === n); if (!t) throw new Error(`${name} has no #${n}`); return t; };

// The change can only touch what it means to: every item there before is still there.
function checked(before, after) {
  const had = parseTasks(before).map(t => t.n), now = new Set(parseTasks(after).map(t => t.n));
  const lost = had.filter(n => !now.has(n));
  if (lost.length) throw new Error(`refused: the change would lose #${lost.join(', #')}`);
  return after;
}

// Runs one command. ctx: { data, lock, now, git } (git(args) runs git in the data folder).
// Returns the text to print.
export function run(argv, ctx) {
  const [verb, ...rest] = argv;
  const { pos, opt } = parseArgs(rest);
  // A task board's new item takes the shared counter (#411); the ideas deck keeps its own.
  const tasksDir = path.join(ctx.data, 'tasks');
  const numberFor = (b, md) => (b.name === 'Ideas' ? undefined : nextShared(tasksDir, b.file, md));
  // A number from the shared counter names one item, so its board may be left out: deck mark 1041 x.
  if (ON_ITEM.has(verb) && /^\d+$/.test(String(pos[0] ?? ''))) {
    const board = boardOf(tasksDir, Number(pos[0]));
    if (!board) throw new Error(Number(pos[0]) >= SHARED_START ? `no board has #${pos[0]}` : `#${pos[0]} is an old number that more than one board may have: give the board too, e.g. ${verb} FocusShell ${pos[0]} ...`);
    pos.unshift(board);
  }
  const now = ctx.now || new Date(), when = stamp(now), today = when.slice(0, 10);
  const change = (b, fn) => update(ctx.lock, b.file, md => checked(md, fn(md)), `${b.head}\n`);
  const need = (k, what) => { if (pos[k] == null) throw new Error(`missing ${what}\n\n${USAGE}`); return pos[k]; };

  switch (verb) {
    case 'show': {
      const b = boardFile(ctx.data, need(0, 'the board'));
      const md = fs.existsSync(b.file) ? fs.readFileSync(b.file, 'utf8').replace(/\r\n/g, '\n') : '';
      if (pos[1] == null) return md.trimEnd();
      const t = itemOf(md, num(pos[1]), b.name), lines = md.split('\n');
      return [lines[t.line], ...t.details.map(d => `  > ${d}`)].join('\n');
    }
    case 'add': {
      const b = boardFile(ctx.data, need(0, 'the board')), title = clean(need(1, 'the title'), 'the title');
      const who = clean(opt.who || 'user', '--who') + (opt.owner ? ', for owner' : '');
      let n = 0;
      change(b, md => {
        let out = addTaskLine(md, title, who, /^\d{4}-\d{2}-\d{2}$/.test(opt.date || '') ? opt.date : today, numberFor(b, md));
        n = parseTasks(out).at(-1).n;
        for (const d of opt.detail || []) out = addDetail(out, n, clean(d, '--detail'));
        if (opt.tags) out = setTaskKey(out, n, 'Tags', clean(opt.tags, '--tags'));
        if (opt.priority) out = setTaskKey(out, n, 'Priority', String(num(opt.priority)));
        if (opt.version) out = setTaskKey(out, n, 'Version', clean(opt.version, '--version'));
        if (opt.due) out = setSchedule(out, n, schedule(opt.due, opt.repeat));
        if (opt.someday) out = setSomeday(out, n, true);
        return out;
      });
      // A for-owner item needs What and To do lines to make sense a day later (#236).
      const bare = opt.owner && !['What', 'To do'].every(k => (opt.detail || []).some(d => new RegExp(`^${k}:`, 'i').test(String(d).trim())));
      return `${b.name} #${n} added` + (bare ? `; it lacks a What: or To do: line, add it: deck detail ${b.name} ${n} 'What: <what and where>' / 'To do: <action, and how to tell it is done>'` : '');
    }
    case 'mark': {
      const b = boardFile(ctx.data, need(0, 'the board')), n = num(need(1, 'the number')), m = MARKS[String(need(2, 'the mark')).toLowerCase()];
      if (!m) throw new Error(`"${pos[2]}" is not a mark: open, working, needs, blocked or done`);
      let rolled = false;
      change(b, md => {
        const t = itemOf(md, n, b.name);
        // A repeating Me item ticked done stays open on its next date (#198).
        const roll = m === 'x' && b.name === 'Me' && repeatOf(t) ? rollRepeat(md, t, now) : null;
        rolled = !!roll;
        let out = roll || setMark(md, n, m, when);
        if (opt.result != null) out = setResult(out, n, opt.result === '-' ? '' : clean(opt.result, '--result'));
        if (opt.who) out = setWho(out, n, clean(opt.who, '--who'));
        return out;
      });
      return rolled ? `${b.name} #${n} repeats: moved to its next date` : `${b.name} #${n} marked ${m === ' ' ? 'open' : m}`;
    }
    case 'result': case 'detail': case 'title': case 'answer': {
      const b = boardFile(ctx.data, need(0, 'the board')), n = num(need(1, 'the number')), text = clean(need(2, 'the text'), 'the text');
      change(b, md => {
        itemOf(md, n, b.name);
        if (verb === 'result') return setResult(md, n, text);
        if (verb === 'detail') return addDetail(md, n, text);
        if (verb === 'title') return setTaskText(md, n, text);
        return addDetail(setMark(md, n, '~', when), n, `Answer: ${text}`);
      });
      return `${b.name} #${n}: ${verb} written`;
    }
    case 'tag': {
      const b = boardFile(ctx.data, need(0, 'the board')), n = num(need(1, 'the number')), tag = clean(need(2, 'the tag'), 'the tag').replace(/,/g, ' ');
      change(b, md => {
        const t = itemOf(md, n, b.name), on = itemTags(t).some(x => x.toLowerCase() === tag.toLowerCase());
        return on === !opt.off ? md : setTaskKey(md, n, 'Tags', toggleTag(t, tag));
      });
      return `${b.name} #${n} ${opt.off ? 'untagged' : 'tagged'} ${tag}`;
    }
    case 'set': {
      const b = boardFile(ctx.data, need(0, 'the board')), n = num(need(1, 'the number'));
      const key = KEYS.find(k => k.toLowerCase() === String(need(2, 'the key')).toLowerCase());
      if (!key) throw new Error(`set takes ${KEYS.join(', ')}`);
      const v = need(3, 'the value');
      const value = v === '-' ? null : key === 'Priority' ? String(Math.min(4, num(v))) : clean(v, 'the value');
      change(b, md => { itemOf(md, n, b.name); return setTaskKey(md, n, key, value); });
      return `${b.name} #${n} ${key} ${value ?? 'cleared'}`;
    }
    case 'version': {
      const b = boardFile(ctx.data, need(0, 'the board')), name = clean(need(1, 'the version'), 'the version').replace(/^v(?=\d)/i, '');
      const state = String(pos[2] || 'planned').toLowerCase();
      if (!['current', 'done', 'planned', 'remove'].includes(state)) throw new Error('version takes current, done, planned or remove');
      change(b, md => {
        const plan = parsePlan(md);
        let versions = plan.versions.filter(v => v.name !== name);
        if (state === 'current') versions = versions.map(v => (v.state === 'current' ? { ...v, state: '' } : v));
        if (state !== 'remove') {
          const at = plan.versions.findIndex(v => v.name === name), entry = { name, state: state === 'planned' ? '' : state };
          at < 0 ? versions.push(entry) : versions.splice(at, 0, entry);
        }
        return setPlan(md, { ...plan, versions });
      });
      return `${b.name} version ${name}: ${state}`;
    }
    case 'due': {
      const b = boardFile(ctx.data, need(0, 'the board')), n = num(need(1, 'the number'));
      const day = need(2, 'the date');
      change(b, md => { itemOf(md, n, b.name); return setSchedule(md, n, day === '-' ? { day: '' } : schedule(`${day}${pos[3] ? ` ${pos[3]}` : ''}`, opt.repeat)); });
      return `${b.name} #${n} ${day === '-' ? 'has no time' : `due ${day}${pos[3] ? ` ${pos[3]}` : ''}`}`;
    }
    case 'someday': {
      const b = boardFile(ctx.data, need(0, 'the board')), n = num(need(1, 'the number')), on = !/^off$/i.test(need(2, 'on or off'));
      change(b, md => { itemOf(md, n, b.name); return setSomeday(md, n, on); });
      return `${b.name} #${n} ${on ? 'moved to Someday' : 'back in To do'}`;
    }
    case 'move': {
      const from = boardFile(ctx.data, need(0, 'the board it is on')), n = num(need(1, 'the number')), to = boardFile(ctx.data, need(2, 'the board to move it to'));
      if (from.file === to.file) throw new Error('that is the same board');
      const t = itemOf(fs.readFileSync(from.file, 'utf8').replace(/\r\n/g, '\n'), n, from.name);
      if (t.mark === 'x') throw new Error(`${from.name} #${n} is closed already`);
      let m = 0;
      change(to, md => {
        let out = addTaskLine(md, t.text, to.name === 'Me' ? 'user' : t.who + (t.forOwner ? ', for owner' : ''), t.date || today, numberFor(to, md));
        m = parseTasks(out).at(-1).n;
        for (const d of [...new Set(t.details)].filter(x => !/^Done:/i.test(x))) out = addDetail(out, m, d);
        return addDetail(out, m, `From: ${from.name} #${n}`);
      });
      change(from, md => setResult(setMark(md, n, 'x', when), n, `moved to ${to.name} #${m}`));
      return `${from.name} #${n} moved to ${to.name} #${m}`;
    }
    case 'note': {
      const board = need(0, 'the project or Me');
      if (!/^[\w.-]+$/.test(board)) throw new Error(`"${board}" is not a board name`);
      const f = notesFile(ctx.data, board), text = clean(need(1, 'the note'), 'the note');
      update(ctx.lock, f.file, md => addNoteLine(md || f.head, text, when), `${f.head}\n`);
      return `note added to ${/^me$/i.test(board) ? 'Me' : board}`;
    }
    case 'status': {
      const file = statusFile(ctx.data), st = readStatus(file);
      if (pos[0] == null) return Object.entries(st.leads).map(([k, v]) => `${k}: ${v.line} (${stamp(new Date(v.at))})`).join('\n') || 'no status lines yet';
      writeStatus(file, setStatus(st, pos[0], need(1, 'the line'), now.getTime()));
      return `${pos[0]}: ${clean(pos[1], 'the line')}`;
    }
    case 'backup': return backup(ctx, when, opt.push === true);
    // Every board's Screenshot lines under one folder, moved to another (#1030): the recorder
    // copies a recording's screenshots out before deleting it. Prints the old paths moved.
    case 'relink': {
      const from = clean(need(0, 'the old folder'), 'the old folder'), to = clean(need(1, 'the new folder'), 'the new folder');
      let names = [];
      try { names = fs.readdirSync(tasksDir).filter(n => n.endsWith('.md')).map(n => n.slice(0, -3)); } catch { /* no boards yet */ }
      const moved = [];
      for (const b of [...names.map(n => boardFile(ctx.data, n)), boardFile(ctx.data, 'Ideas')]) {
        if (!fs.existsSync(b.file)) continue;
        if (opt.dry) { moved.push(...relinkShots(fs.readFileSync(b.file, 'utf8'), from, to).moved); continue; }
        change(b, md => { const r = relinkShots(md, from, to); moved.push(...r.moved); return r.md; });
      }
      return moved.length ? moved.join('\n') : 'nothing to relink';
    }
    case undefined: case 'help': case '--help': return USAGE;
    default: throw new Error(`unknown verb "${verb}"\n\n${USAGE}`);
  }
}

// "YYYY-MM-DD [HH:MM]" and "every 2 weeks" / "2 week" into setSchedule's shape.
function schedule(due, repeat) {
  const m = String(due).trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?$/);
  if (!m) throw new Error(`"${due}" is not a date: YYYY-MM-DD, optionally with HH:MM`);
  const r = String(repeat || '').match(/^(?:every\s+)?(\d+)?\s*(day|week)s?$/i);
  if (repeat && !r) throw new Error(`"${repeat}" is not a repeat: like '1 week' or '3 days'`);
  return { day: m[1], time: m[2] || '', every: r ? Number(r[1] || 1) : 0, unit: r ? r[2].toLowerCase() : 'day' };
}

// The board files that are backed up: every board, note and brief.
export const BOARD_PATHS = ['tasks', 'ideas', 'notes', 'notes.md', 'briefs'];
// Pushing is the owner's choice in Settings (#346): the app passes --push only when it is on.
function backup(ctx, when, push) {
  if (!ctx.git || !fs.existsSync(path.join(ctx.data, '.git'))) return 'backup: the data folder is not a git repository, nothing done';
  const paths = BOARD_PATHS.filter(p => fs.existsSync(path.join(ctx.data, p)));
  ctx.git(['add', '--all', '--', ...paths]);
  const staged = ctx.git(['diff', '--cached', '--name-only', '--', ...paths]).trim();
  if (!staged) return 'backup: no board changes';
  ctx.git(['commit', '-q', '-m', `chore: board backup ${when}`, '--', ...paths]);
  let pushed = push ? 'not pushed: no remote' : 'not pushed: pushing is off';
  if (push && ctx.git(['remote']).trim()) { try { ctx.git(['push', '-q']); pushed = 'pushed'; } catch (e) { pushed = `not pushed: ${String(e.message).split('\n')[0]}`; } }
  return `backup: ${staged.split('\n').length} files committed, ${pushed}`;
}
