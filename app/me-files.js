// The Me page's files (#130): the ideas deck (ideas/Me.md) and saved Sketch boards
// (sketches/<Project>/<id>.excalidraw with a <id>.png preview), and the "> Sketch:" lines
// that attach a board to an idea, a task of any project, or a note. Kept out of main.js.
import fs from 'node:fs';
import path from 'node:path';
import { addTaskLine, parseTasks, setMark, setTaskText } from './lib/tasks.js';
import { nextShared } from './lib/counter.js';
import { setTags, setState, setSent, setAbout, addDetail } from './lib/ideas.js';
import { parseRel, sketchRel, sketchId, attachToTask, detachFromTask, attachToNote, detachFromNote, dropSketch, renameSketch } from './lib/sketches.js';

const SAFE = /^[^\\/:*?"<>|.][^\\/:*?"<>|]*$/;

// d: { ipcMain, read, readData, today, P: { ideas, sketches, tasks, notes } }
export function registerMeFiles(d) {
  const { ipcMain, read, readData, today, P, board } = d;
  const ideasFile = path.join(P.ideas, 'Me.md');
  const writeIdeas = fn => { board(ideasFile, fn, '# Me ideas'); return readData(); };
  const taskFile = project => path.join(P.tasks, `${project}.md`);
  const abs = rel => { const r = parseRel(rel); return r && path.join(P.sketches, r.project, `${r.id}.excalidraw`); };

  ipcMain.handle('ideas:add', (_e, text) => writeIdeas(md => addTaskLine(md, text, 'user', today())));
  ipcMain.handle('ideas:text', (_e, { n, text }) => writeIdeas(md => setTaskText(md, n, text)));
  ipcMain.handle('ideas:mark', (_e, { n, mark }) => writeIdeas(md => setMark(md, n, mark)));
  ipcMain.handle('ideas:detail', (_e, { n, text }) => writeIdeas(md => addDetail(md, n, text)));
  ipcMain.handle('ideas:about', (_e, { n, text }) => writeIdeas(md => setAbout(md, n, String(text))));
  ipcMain.handle('ideas:tags', (_e, { n, tags }) => writeIdeas(md => setTags(md, n, Array.isArray(tags) ? tags.map(String) : [])));
  ipcMain.handle('ideas:state', (_e, { n, state }) => writeIdeas(md => setState(md, n, String(state))));
  // Sent to the CTO (#342): marked with the day, beside whatever state the idea has.
  ipcMain.handle('ideas:sent', (_e, n) => writeIdeas(md => setSent(md, n, today())));
  // "To-do": the idea becomes a Me to-do with its description and boards; it then reads
  // "became Me #<n>" and stays in the deck.
  ipcMain.handle('ideas:toTask', (_e, n) => {
    const idea = parseTasks(read(ideasFile)).find(t => t.n === Number(n));
    if (!idea) return readData();
    let k = 0;
    board(taskFile('Me'), old => {
      k = nextShared(P.tasks, taskFile('Me'), old); // the shared counter (#411)
      let md = addTaskLine(old, idea.text, 'user', today(), k);
      for (const line of [...idea.details.filter(x => !/^(Tags|State):/i.test(x)), `From idea #${idea.n}`]) md = md.replace(/\s*$/, '') + `\n  > ${line}\n`;
      return md;
    }, '# Me tasks');
    return writeIdeas(x => setState(x, idea.n, `became Me #${k}`));
  });


  // Boards of one project, newest first, each with its preview as a data URL.
  ipcMain.handle('sketch:list', (_e, project) => {
    if (!SAFE.test(String(project))) return [];
    const dir = path.join(P.sketches, project);
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.excalidraw')); } catch { return []; }
    return files.map(f => {
      const id = f.slice(0, -11), rel = sketchRel(project, id), png = path.join(dir, `${id}.png`);
      if (!parseRel(rel)) return null;
      let preview = null;
      try { preview = 'data:image/png;base64,' + fs.readFileSync(png).toString('base64'); } catch { /* none yet */ }
      return { rel, id, mtime: fs.statSync(path.join(dir, f)).mtimeMs, preview };
    }).filter(Boolean).sort((a, b) => b.mtime - a.mtime);
  });
  ipcMain.handle('sketch:load', (_e, rel) => {
    const f = abs(rel);
    if (!f) return null;
    try { const j = JSON.parse(read(f)); return { elements: j.elements || [], files: j.files || {} }; } catch { return null; }
  });
  // A new board gets an id from its name; an existing one is overwritten with its preview.
  ipcMain.handle('sketch:save', (_e, { rel, project, name, scene, png }) => {
    let r = rel && parseRel(rel) ? rel : null;
    if (!r) {
      if (!SAFE.test(String(project))) return { error: 'Bad project name' };
      let taken = [];
      try { taken = fs.readdirSync(path.join(P.sketches, project)).filter(f => f.endsWith('.excalidraw')).map(f => f.slice(0, -11)); } catch { /* first board */ }
      r = sketchRel(project, sketchId(name, taken));
    }
    const f = abs(r);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const s = scene || {};
    fs.writeFileSync(f, JSON.stringify({ type: 'excalidraw', version: 2, source: 'FocusShell', elements: s.elements || [], appState: { viewBackgroundColor: '#ffffff' }, files: s.files || {} }));
    const pf = f.replace(/\.excalidraw$/, '.png');
    if (png && png.length) fs.writeFileSync(pf, Buffer.from(png)); else if (png === null) { try { fs.unlinkSync(pf); } catch { /* none */ } }
    return { rel: r };
  });
  // Attach or detach a board: item is { kind: 'task', project, n } (ideas are project
  // "ideas"), or { kind: 'note', when, text }.
  const onItem = (item, rel, forTask, forNote) => {
    if (!parseRel(rel)) return readData();
    if (item.kind === 'note') { board(P.notes, md => forNote(md, item.when, item.text, rel)); return readData(); }
    if (item.project === 'ideas') return writeIdeas(md => forTask(md, item.n, rel));
    if (!SAFE.test(String(item.project))) return readData();
    const f = taskFile(item.project);
    if (fs.existsSync(f)) board(f, md => forTask(md, item.n, rel));
    return readData();
  };
  ipcMain.handle('sketch:attach', (_e, { item, rel }) => onItem(item || {}, rel, attachToTask, attachToNote));
  ipcMain.handle('sketch:detach', (_e, { item, rel }) => onItem(item || {}, rel, detachFromTask, detachFromNote));
  // Renaming a board (#144) gives it an id from the new name, moves its files and points
  // every line at the new id. Returns the board's rel, unchanged when the id is the same.
  ipcMain.handle('sketch:rename', (_e, { rel, name }) => {
    const r = parseRel(rel), f = abs(rel);
    if (!r || !fs.existsSync(f)) return { error: 'No such sketch' };
    const dir = path.dirname(f);
    const taken = fs.readdirSync(dir).filter(x => x.endsWith('.excalidraw')).map(x => x.slice(0, -11)).filter(x => x !== r.id);
    const to = sketchRel(r.project, sketchId(name, taken));
    if (to === rel) return { rel };
    const g = abs(to);
    fs.renameSync(f, g);
    try { fs.renameSync(f.replace(/\.excalidraw$/, '.png'), g.replace(/\.excalidraw$/, '.png')); } catch { /* no preview */ }
    const move = file => { const md = read(file, null); if (md != null && md.includes(rel)) board(file, x => renameSketch(x, rel, to)); };
    try { for (const t of fs.readdirSync(P.tasks)) if (t.endsWith('.md')) move(path.join(P.tasks, t)); } catch { /* none */ }
    move(ideasFile); move(P.notes);
    return { rel: to };
  });
  // Deleting a board removes its files and every line that pointed at it.
  ipcMain.handle('sketch:delete', (_e, rel) => {
    const f = abs(rel);
    if (!f) return readData();
    for (const x of [f, f.replace(/\.excalidraw$/, '.png')]) { try { fs.unlinkSync(x); } catch { /* gone */ } }
    const strip = file => { const md = read(file, null); if (md != null && md.includes(rel)) board(file, x => dropSketch(x, rel)); };
    try { for (const t of fs.readdirSync(P.tasks)) if (t.endsWith('.md')) strip(path.join(P.tasks, t)); } catch { /* none */ }
    strip(ideasFile); strip(P.notes);
    return readData();
  });
}

// A smoke run starts from the same few sample ideas and no saved boards.
export function resetSmokeMe(P) {
  fs.rmSync(P.sketches, { recursive: true, force: true });
  // Boards a plugin wrote to in the last run (the recorder's Accept, #369) start empty.
  fs.rmSync(path.join(path.dirname(P.ideas), 'tasks'), { recursive: true, force: true });
  fs.rmSync(path.join(path.dirname(P.ideas), 'notes'), { recursive: true, force: true });
  fs.mkdirSync(P.ideas, { recursive: true });
  fs.writeFileSync(path.join(P.ideas, 'Me.md'), ['# Me ideas',
    '- [ ] #1 Pushing AI to its limits (2026-10-03, user)', '  > A series: give Claude a task just past what it can do and film where it breaks.', '  > Tags: youtube', '  > State: growing',
    '- [ ] #2 Merging 2-3 games together (2026-10-03, user)', '  > Pick two small games and have agents merge them into one playable thing.', '  > Tags: youtube',
    '- [ ] #3 Link tree and own site (2026-10-03, user)', '  > One page with the channel, the repos and the apps.', '  > Tags: life', '  > State: became Me #4',
    '- [ ] #4 MiroFish for video ideas (2026-10-03, user)', '  > Simulate an audience reacting to a title before filming it.', '  > Tags: app',
    '- [ ] #5 Free sound effects pack (2026-10-03, user)', '  > Version 2 backlog.', '  > Tags: youtube', '  > State: parked', ''].join('\n'));
}
