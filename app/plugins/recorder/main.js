// The recorder's main side (#369): owns the session (lib/session.js), saves it after every
// event, takes the page's recorded chunks, runs the processing steps, puts accepted cards on
// the boards and tells the page. A session left open by a restart carries on: a recording is
// processed, processing restarts its step, a review (or a send cut off) waits on the button.
import fs from 'node:fs';
import path from 'node:path';
import { shell, BrowserWindow, dialog } from 'electron';
import { choicesFor } from './lib/choices.js';
import manifest from './manifest.js';
import { newSession, next, pickCurrent, STEPS } from './lib/session.js';
import { cropFor } from './lib/area.js';
import { areaWindows } from './area.js';
import { writesFor, ctoLine } from './lib/send.js';
import { createRecording, save, loadAll, append, size, remove, videoFile } from './store.js';
import { STEP_RUN, killAll, findWhisperCli } from './process.js';
import { brainstormer } from './brainstorm.js';
import { expired, keptPath } from './lib/cleanup.js';

export function activate(host) {
  const root = host.dir;
  let cur = pickCurrent(loadAll(root)), busy = false, stopped = false;
  const dirOf = s => path.join(root, s.id);
  // The real check in a smoke run marks its area from FOCUSSHELL_RECORDER_AREA ('x,y,w,h,on|off')
  // instead of a drag.
  const auto = (() => {
    const m = host.smoke && String(process.env.FOCUSSHELL_RECORDER_AREA || '').match(/^(\d+),(\d+),(\d+),(\d+),(on|off)$/);
    return m ? { rect: { x: +m[1], y: +m[2], width: +m[3], height: +m[4] }, mic: m[5] === 'on' } : null;
  })();
  const area = host.fake ? null : areaWindows({ log: host.log, quiet: !!auto, keys: host.keys !== false });
  // The mic choice, kept for the next recording.
  const prefsFile = path.join(root, 'prefs.json');
  const prefs = () => { try { return JSON.parse(fs.readFileSync(prefsFile, 'utf8')); } catch { return {}; } };
  const savePrefs = p => { try { fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(prefsFile, JSON.stringify({ ...prefs(), ...p })); } catch (e) { host.log(`prefs: ${e.message}`); } };

  const reviewing = s => s && (s.state === 'review' || s.state === 'sending');
  const projects = () => { try { return host.boards.projects(); } catch (e) { host.log(`projects: ${e.message}`); return []; } };
  const view = () => {
    if (!cur) return { session: null };
    const dir = dirOf(cur);
    return {
      session: cur, steps: STEPS,
      files: { folder: dir, video: videoFile(dir), transcript: path.join(dir, 'transcript.md') },
      videoBytes: size(videoFile(dir)),
      projects: reviewing(cur) ? projects() : [],
      brainstormId: bs.liveId(),
    };
  };
  const tell = () => host.emit('state', view());
  // Applies an event; a session that ended leaves cur once it is saved. A review that ends
  // ends its brainstorm session with it.
  function apply(ev) {
    if (!cur || stopped) return; // a switched-off instance never writes session.json
    const n = next(cur, ev);
    if (n === cur) return;
    const hadBrainstorm = !!cur.brainstorm;
    cur = n;
    try { save(dirOf(cur), cur); } catch (e) { host.log(`save ${cur.id}: ${e.message}`); }
    if (cur.state === 'done' || cur.state === 'discarded') cur = null;
    if (hadBrainstorm && !(cur && cur.brainstorm)) bs.end();
    tell();
  }
  const bs = brainstormer({ host, current: () => cur, apply, dirOf });

  async function processNow() {
    if (busy) return;
    busy = true;
    try {
      while (!stopped && cur && cur.state === 'processing') {
        const s = cur, step = s.step;
        try {
          const r = await STEP_RUN[step](dirOf(s), host.settings(), host.fake, s, host);
          if (stopped) return;
          if (cur === s) apply({ type: 'stepDone', step, ...(r && Array.isArray(r.cards) ? { cards: r.cards } : {}) });
        } catch (e) {
          if (stopped) return; // killed by a switch-off: the next start restarts the step
          host.log(`${s.id} ${step}: ${e.message}`);
          if (cur === s) apply({ type: 'stepFailed', step, error: e.message });
        }
      }
    } finally { busy = false; }
  }

  // Old recordings (#1030). A screenshot is kept as <data>\screenshots\<recording id>\<file>.
  const copyShot = (id, p) => {
    const to = keptPath(host.boards.shotsHome(), id, p);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(p, to);
    return to;
  };
  const keepShots = (id, shots) => shots.map(p => { try { return copyShot(id, p); } catch (e) { host.log(`keep ${p}: ${e.message}`); return p; } });
  // Deletes one recording; the screenshots board items still point at are copied out first and
  // the items follow them. A copy that fails keeps the recording.
  function sweep(id) {
    const dir = path.join(root, id), shots = path.join(dir, 'shots');
    const used = host.boards.relink(shots, path.join(host.boards.shotsHome(), id), true);
    for (const p of used) if (fs.existsSync(p)) copyShot(id, p);
    if (used.length) host.boards.relink(shots, path.join(host.boards.shotsHome(), id));
    remove(dir);
  }
  const sweepAll = ids => {
    let deleted = 0, failed = 0;
    for (const id of ids) { try { sweep(id); deleted++; } catch (e) { failed++; host.log(`delete ${id}: ${e.message}`); } }
    return { deleted, failed };
  };
  const prune = () => {
    const ids = expired(loadAll(root), host.settings().deleteAfter, Date.now(), cur && cur.id);
    if (ids.length) { sweepAll(ids); host.emit('list'); }
  };
  const pruneTimer = setInterval(prune, 3600e3);
  host.onSettings(prune);
  // Delete all recordings (Plugins > Screen recorder), except the one open in the recorder.
  host.handle('deleteAll', () => ({ ...sweepAll(loadAll(root).filter(s => s && s.id && !(cur && cur.id === s.id)).map(s => s.id)), open: !!cur }));

  // Accept: the cards go on their boards one at a time, each marked placed as soon as it is
  // written, so a failure or a restart never writes one twice. A card merged into an open item
  // skips the detail lines a cut-off try already wrote. With cto, the main CTO's line for the
  // placed cards (and any a restart cut off from theirs) comes back for the page to type, also
  // when a later card failed.
  function accept(ids, cto) {
    if (!cur || cur.state !== 'review') return { error: 'Nothing to accept' };
    const want = ids === 'all' ? cur.cards.filter(c => c.status === 'open').map(c => c.id) : [].concat(ids || []);
    apply({ type: 'send', ids: want, cto: cto === true });
    if (!cur || cur.state !== 'sending') return { error: 'Nothing to accept' };
    const s = cur, transcript = path.join(dirOf(s), 'transcript.md');
    // Each card's screenshots go on its item as copies outside the recording, so deleting the
    // recording later leaves the item's screenshots in place (#1030).
    const batch = s.cards.filter(c => s.sending.ids.includes(c.id)).map(c => ({ ...c, shots: keepShots(s.id, c.shots || []) })), where = {};
    const waiting = (s.ctoPending || []).map(id => s.cards.find(c => c.id === id)).filter(c => c && c.placed);
    const line = () => (cto === true ? ctoLine([...waiting, ...batch.filter(c => where[c.id]).map(c => ({ ...c, placed: where[c.id] }))], { transcript }) : null);
    try {
      for (const w of writesFor(batch, { transcript })) {
        let n = null;
        if (w.op === 'add') n = host.boards.add(w.board, w);
        else if (w.op === 'detail') {
          const have = String(host.boards.show(w.board, w.n));
          for (const d of w.details) if (!have.includes(`> ${d}`)) host.boards.detail(w.board, w.n, d);
          n = w.n;
        } else host.boards.note(w.board, w.text);
        where[w.id] = { board: w.board, n };
        apply({ type: 'placed', id: w.id, board: w.board, n });
      }
    } catch (e) {
      host.log(`${s.id} accept: ${e.message}`);
      const cl = line();
      apply({ type: 'sendFailed', error: e.message });
      return { error: e.message, placed: Object.keys(where).length, cto: cl };
    }
    const cl = line();
    apply({ type: 'sent' });
    return { placed: batch.length, cto: cl };
  }

  host.handle('state', () => view());
  // Settings' dropdowns (#407): what was found for a setting, and Choose... for another folder or file.
  const defaults = Object.fromEntries(manifest.settings.map(f => [f.key, f.default]));
  host.handle('choices', key => choicesFor(String(key), host.settings(), { env: process.env, defaults, findCli: findWhisperCli }));
  host.handle('pickPath', async key => {
    const f = manifest.settings.find(x => x.key === key && x.pick);
    if (!f) return null;
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const r = await dialog.showOpenDialog(win, f.pick === 'file'
      ? { title: f.label, properties: ['openFile'], filters: [{ name: 'Programs', extensions: ['exe'] }] }
      : { title: f.label, properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0] || null;
  });
  // Start: the overlay first (a fake run has none), where the owner marks the area and picks the
  // mic; Cancel answers { cancel }. Then the recording, the border and the floating bar.
  host.handle('start', async () => {
    if (cur) return { error: 'A recording is already open' };
    let picked = null;
    if (area) {
      if (area.picking()) { area.cancelPick(); return { cancel: true }; }
      picked = await area.pickArea({ mic: prefs().mic !== false, auto });
      if (!picked) return { cancel: true };
      savePrefs({ mic: picked.mic });
      if (cur) return { error: 'A recording is already open' };
    }
    if (stopped) return { cancel: true }; // switched off while the overlay was open
    const { id, dir } = createRecording(root);
    cur = { ...newSession(id, Date.now()), mic: picked ? picked.mic : true };
    save(dir, cur);
    let source = null, crop = null;
    if (picked) {
      try { source = await host.screen.source(String(picked.display.id)); } catch (e) {
        remove(dir); cur = null; tell();
        return { error: e.message };
      }
      if (stopped) { remove(dir); cur = null; return { cancel: true }; }
      crop = cropFor(picked.rect, picked.display.scaleFactor || 1, source);
      area.showRecording({ ...picked, startedAt: cur.startedAt, onStop: () => host.emit('toggle') });
    }
    tell();
    return { id, source, crop, mic: cur.mic };
  });
  // FocusShell's own window comes forward on Stop, to show the processing and then the review.
  host.handle('front', () => {
    if (host.smoke) return false;
    const w = BrowserWindow.getAllWindows().find(x => !x.isDestroyed() && !(area && area.owns(x)));
    if (!w) return false;
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
    return true;
  });
  if (host.smoke) {
    host.handle('auto', () => !!auto);
    host.handle('windows', () => (area ? area.openKinds() : []));
    host.handle('drawTest', () => (area ? area.drawTest() : false));
  }
  host.handle('chunk', (id, bytes) => {
    if (!cur || cur.id !== id || cur.state !== 'recording') return false;
    append(dirOf(cur), Buffer.from(bytes));
    return true;
  });
  host.handle('stop', id => {
    if (!cur || cur.id !== id) return false;
    if (area) area.closeRecording();
    apply({ type: 'stop', at: Date.now() });
    processNow();
    return true;
  });
  // The page could not start capturing: the empty recording goes.
  host.handle('abort', (id, why) => {
    if (!cur || cur.id !== id || cur.state !== 'recording') return false;
    host.log(`${id} not started: ${why}`);
    if (area) area.closeRecording();
    const dir = dirOf(cur);
    cur = null;
    remove(dir);
    tell();
    return true;
  });
  host.handle('retry', () => { apply({ type: 'retry' }); processNow(); return true; });
  host.handle('done', () => { apply({ type: 'done' }); return true; });
  // The review's card events: the session decides what each may change.
  host.handle('edit', (id, patch) => { apply({ type: 'edit', id, patch }); return true; });
  host.handle('dropShot', (id, p) => { apply({ type: 'dropShot', id, path: p }); return true; });
  host.handle('drop', id => { apply({ type: 'drop', id }); return true; });
  host.handle('restore', id => { apply({ type: 'restore', id }); return true; });
  host.handle('accept', (ids, cto) => accept(ids, cto));
  // Stage 4: the brainstorm beside the review, its proposal's Undo, and "Update the cards".
  host.handle('brainstorm', who => bs.start(String(who)));
  host.handle('brainstormEnd', () => { bs.end(); return true; });
  host.handle('updateLine', () => bs.updateLine());
  host.handle('undo', id => { apply({ type: 'undo', id }); return true; });
  host.handle('undoAll', () => { apply({ type: 'undoAll' }); return true; });
  if (host.smoke) host.handle('fakeProposal', () => bs.fakeProposal());
  // Discard all. Once a card is on a board its screenshots live in this folder, so the files stay.
  host.handle('discard', keep => {
    if (!cur || next(cur, { type: 'discard' }) === cur) return false; // not while processing
    const dir = dirOf(cur), placed = (cur.cards || []).some(c => c.status === 'accepted');
    killAll();
    if (area) area.closeRecording();
    apply({ type: 'discard' });
    if (!keep && !placed) remove(dir);
    return true;
  });
  // One screenshot of the open recording, as a data URL for the page (its CSP allows no files).
  host.handle('shot', p => {
    if (!cur) return null;
    const shots = path.join(dirOf(cur), 'shots') + path.sep, f = path.resolve(String(p || ''));
    if (!f.startsWith(shots) || !f.endsWith('.png')) return null;
    try { return 'data:image/png;base64,' + fs.readFileSync(f).toString('base64'); } catch { return null; }
  });
  // Opens the video (in the default player), the transcript or the folder.
  host.handle('open', what => {
    const f = view().files;
    if (!f || !f[what]) return false;
    if (host.smoke) { host.log(`open ${what}`); return true; }
    return shell.openPath(f[what]).then(err => err === '');
  });
  // Past recordings (#384), newest first, for the Recordings list in Plugins > Screen recorder.
  host.handle('list', () => loadAll(root).filter(s => s && s.id).sort((a, b) => b.startedAt - a.startedAt).map(s => ({
    id: s.id, state: s.state, startedAt: s.startedAt, stoppedAt: s.stoppedAt, current: !!cur && cur.id === s.id,
    cards: (s.cards || []).length, accepted: (s.cards || []).filter(c => c.status === 'accepted').length,
    video: size(videoFile(dirOf(s))) > 0, transcript: fs.existsSync(path.join(dirOf(s), 'transcript.md')),
  })));
  // Opens one past recording's video, transcript or folder; only a folder that holds a recording.
  host.handle('openPast', (id, what) => {
    const s = loadAll(root).find(x => x && x.id === String(id));
    if (!s) return false;
    const dir = dirOf(s), f = { folder: dir, video: videoFile(dir), transcript: path.join(dir, 'transcript.md') }[what];
    if (!f) return false;
    if (host.smoke) { host.log(`open past ${what}`); return true; }
    return shell.openPath(f).then(err => err === '');
  });
  // The smoke run reads back what Accept wrote.
  if (host.smoke) host.handle('peek', (board, n) => host.boards.show(board, n));
  // The shortcut pressed while the overlay is open closes it, as Esc does.
  host.shortcut(() => { if (area && area.picking()) area.cancelPick(); else host.emit('toggle'); });

  // Carry on with what a restart interrupted.
  // A recording cut off ends when its last chunk was written.
  if (cur && cur.state === 'recording') {
    let at = cur.startedAt;
    try { at = fs.statSync(videoFile(dirOf(cur))).mtimeMs; } catch { /* nothing was recorded */ }
    apply({ type: 'resume', at });
  }
  if (cur && cur.state === 'sending') apply({ type: 'resume' });
  // A brainstorm session never outlives FocusShell: one recorded open is over.
  if (cur && cur.brainstorm) apply({ type: 'brainstormEnd' });
  processNow();
  prune();

  return { deactivate() { clearInterval(pruneTimer); bs.end(); stopped = true; killAll(); if (area) area.dispose(); } };
}
