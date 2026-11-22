// Requests from the CTO's scripts, dropped as files in state/requests: opening and closing
// panes (open-pane.ps1, close-pane.ps1), the owner's words (ask-owner.ps1) and a file to open
// (deck open-file, #2768). Kept out of main.js.
import { Notification } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { requestModel, sessionName } from './lib/sessions.js';
import { parseRequest, sessionOfLead, ctoLine, doneAllowed, EXPIRES } from './lib/ownerwords.js';
import { chunksOf, CHUNK_GAP } from './lib/ctoline.js';
import { laterToasts, shouldToast } from './lib/toasts.js';
import { runPane } from './lib/deckpanes.js';

// d: { ipcMain, P, SMOKE, APP_DIR, read, send, sessions, win: () => the window or null, using: () => the owner is in the app }
export function registerRequests(d) {
  const { ipcMain, P, SMOKE, APP_DIR, read, send, sessions } = d;
  // The CTO opens a project by dropping state/requests/open-<Project>.req (open-pane.ps1),
  // and closes one with close-<Project>.req (close-pane.ps1), whose content is "force" or
  // empty. The window answers a close in close-<Project>.out and an open in open-<Project>.out
  // ("Started ..." or "Failed: ..."), which the scripts print (#185).
  // open<n>-/close<n>- (n 2 to 5) do the same for the project's extra lead n, lead-<Project>-<n>
  // (#1485); an open<n> body of "worktree" gives it its own git worktree. Every request and
  // answer goes in requests.log.
  const logRequest = line => { try { fs.appendFileSync(path.join(P.requests, 'requests.log'), `${new Date().toISOString()} ${line}\n`); } catch { /* best effort */ } };
  function watchRequests() {
    fs.mkdirSync(P.requests, { recursive: true });
    const handle = () => {
      for (const f of fs.readdirSync(P.requests)) {
        const w = f.match(/^words-([\w-]{1,64})\.req$/);
        if (w) { takeWords(w[1], path.join(P.requests, f)); continue; }
        const of = f.match(/^file-([0-9a-f]{12})\.req$/);
        if (of) { takeFile(of[1], path.join(P.requests, f)); continue; }
        const m = f.match(/^(open|close)([2-5]?)-(.+)\.req$/);
        if (!m) continue;
        const full = path.join(P.requests, f);
        const body = read(full);
        try { fs.unlinkSync(full); } catch { continue; }
        logRequest(`got ${f}${body.trim() ? ` (${body.trim()})` : ''}`);
        const n = Number(m[2]) || 1;
        if (m[1] === 'open' && n > 1) send('request:open-extra', { name: m[3], n, worktree: /worktree/i.test(body), model: requestModel(body) });
        else if (m[1] === 'open') send('request:open', { name: m[3], model: requestModel(body) });
        else send('request:close', { name: m[3], force: /force/i.test(body), n });
      }
    };
    handle();
    fs.watch(P.requests, () => setTimeout(handle, 100));
  }

  // A file the owner asked the CTO to open (deck open-file, #2768): the window opens it as a
  // click on its path does and answers in file-<id>.out.
  // One left from before a restart is dropped, since the verb gave up after 30 seconds.
  function takeFile(id, file) {
    let age = 0;
    try { age = Date.now() - fs.statSync(file).mtimeMs; } catch { return; }
    const body = read(file);
    try { fs.unlinkSync(file); } catch { return; }
    if (age > 60000) { logRequest(`dropped file-${id}: older than a minute`); return; }
    let target = '';
    try { target = String(JSON.parse(body).file || ''); } catch { /* answered below */ }
    if (!target || /[\r\n]/.test(target)) { logRequest(`refused file-${id}: no path`); fileOut(id, 'Failed: the request named no file.'); return; }
    logRequest(`got file-${id}: ${target}`);
    send('request:file', { id, file: target });
  }
  const fileOut = (id, text) => { try { fs.writeFileSync(path.join(P.requests, `file-${id}.out`), text); } catch { /* the verb gave up */ } };
  ipcMain.on('request:filed', (_e, { id, answer }) => {
    if (!/^[0-9a-f]{12}$/.test(String(id))) return;
    logRequest(`answer file-${id}: ${answer}`);
    fileOut(id, String(answer));
  });
  // The smoke run opens a file through deck open-file, as the CTO does.
  ipcMain.handle('smoke:open-file', async (_e, file) => {
    if (!SMOKE) return '';
    return (await runPane('open-file', [String(file)], { data: path.dirname(P.requests), requests: P.requests, running: () => true, tries: 150 })).out;
  });

  // The owner's words (#228): a request from ask-owner.ps1 waits here as a card. Only the
  // owner's click (words:approve, with the request's id) types its stored words into the
  // lead's pane; the page never sends the text. Each request is used once; a day old, it goes.
  // After the click (#2991) a request moves to wordsTyping, with its state: 'held' (the page
  // waits for the lead's pane to be clear), 'typing' (the words are in the box, no Enter yet)
  // or 'sent' (Enter went in; the page looks for the words in the lead's own log). Its card
  // stays on screen until words:done or a failure here ends it, and every end is logged.
  const wordsWaiting = new Map(); // id -> request
  const wordsTyping = new Map();  // id -> { ...request, state }
  const wordsOut = (id, text) => { try { fs.writeFileSync(path.join(P.requests, `words-${id}.out`), text); } catch { /* the CTO hears from the card */ } };
  const wordsChanged = () => send('words:changed', [...wordsWaiting.values(), ...wordsTyping.values()]);
  const wordsEnd = (r, outcome) => {
    wordsTyping.delete(r.id);
    logRequest(`words-${r.id} ${outcome === 'typed' ? `typed into ${r.lead} and arrived` : outcome}`);
    wordsOut(r.id, outcome);
    wordsChanged();
    return { outcome, cto: ctoLine(r, outcome) };
  };
  const leadPane = r => { const s = sessions.get(sessionOfLead(r.project, r.lead)); return s && s.alive ? s : null; };
  const pause = ms => new Promise(res => setTimeout(res, ms));
  function takeWords(id, file) {
    const body = read(file);
    try { fs.unlinkSync(file); } catch { return; }
    const r = parseRequest(id, body);
    if (r.error) { logRequest(`refused words-${id}: ${r.error}`); wordsOut(id, `refused: ${r.error}`); return; }
    wordsWaiting.set(r.id, r);
    logRequest(`got words-${id} for ${r.lead}: ${r.words}`);
    wordsChanged();
    // Its card shows at once; a Windows toast only if it still waits five minutes later (#320).
    toasts.hold(`words:${r.id}`, r);
  }
  const toasts = laterToasts();
  setInterval(() => {
    const due = toasts.due(Date.now(), r => wordsWaiting.has(r.id));
    if (!due.length || SMOKE || !Notification.isSupported() || !shouldToast('alert', d.using())) return;
    for (const r of due) {
      const n = new Notification({ title: `${r.lead} needs your words`, body: r.words.slice(0, 200), icon: path.join(APP_DIR, 'build', 'icon.png') });
      n.on('click', () => { const win = d.win(); if (win) { win.show(); win.focus(); } });
      n.show();
    }
  }, 15000);
  setInterval(() => {
    for (const [id, r] of wordsWaiting) if (Date.now() - r.created > EXPIRES) { wordsWaiting.delete(id); logRequest(`words-${id} expired`); wordsOut(id, 'expired'); wordsChanged(); }
    for (const r of [...wordsTyping.values()]) if (Date.now() - r.created > EXPIRES) wordsEnd(r, 'expired');
  }, 60000);
  // A page that just loaded (boot) has no run for a clicked request (#2991): one still held
  // waits for a click again; one whose words were already going in ends not delivered.
  ipcMain.handle('words:list', (_e, boot) => {
    if (boot) {
      for (const r of [...wordsTyping.values()]) {
        if (r.state !== 'held') { wordsEnd(r, "not delivered: the app's window reloaded while typing"); continue; }
        wordsTyping.delete(r.id);
        const { state: _held, ...waiting } = r;
        wordsWaiting.set(r.id, waiting);
        logRequest(`words-${r.id} held when the window reloaded; waiting for a click again`);
      }
    }
    return [...wordsWaiting.values(), ...wordsTyping.values()];
  });
  // The smoke run files requests as ask-owner.ps1 would, and reads the answers it gets.
  ipcMain.handle('smoke:words', (_e, id, body) => { if (!SMOKE) return null; fs.mkdirSync(P.requests, { recursive: true }); const f = path.join(P.requests, `words-${id}.req`); fs.writeFileSync(f, body); takeWords(id, f); return read(path.join(P.requests, `words-${id}.out`), null); });
  ipcMain.handle('smoke:words-out', (_e, id) => (SMOKE ? read(path.join(P.requests, `words-${id}.out`), null) : null));
  // The click (#2991): the request is held for the page, which types it once the lead's pane
  // is clear (words:type, words:enter, words:erase) and ends it with words:done. The page
  // sends only the id; the words typed are always the stored ones.
  ipcMain.handle('words:approve', (_e, id) => {
    const r = wordsWaiting.get(String(id));
    if (!r) { logRequest(`words-${String(id).replace(/[^\w-]/g, '').slice(0, 64)} clicked but no longer waiting`); return { outcome: 'gone' }; }
    wordsWaiting.delete(r.id);
    if (!leadPane(r)) {
      const outcome = `no ${r.lead} pane is open`;
      logRequest(`words-${r.id} ${outcome}`);
      wordsOut(r.id, outcome);
      wordsChanged();
      return { outcome, cto: ctoLine(r, outcome) };
    }
    wordsTyping.set(r.id, { ...r, state: 'held' });
    logRequest(`words-${r.id} approved on the owner's click`);
    wordsChanged();
    return { session: sessionOfLead(r.project, r.lead) };
  });
  // Types the stored words in pieces, no Enter. A pane gone or a write that throws ends the
  // request here, with its outcome, never silently.
  ipcMain.handle('words:type', async (_e, id) => {
    const r = wordsTyping.get(String(id));
    if (!r || r.state !== 'held') return { outcome: 'gone' };
    const s = leadPane(r);
    if (!s) return wordsEnd(r, `no ${r.lead} pane is open`);
    r.state = 'typing';
    try {
      s.typedAt = s.total; s.used = true;
      for (const [i, part] of chunksOf(r.words).entries()) {
        if (i) await pause(CHUNK_GAP);
        if (!s.alive) throw new Error('the pane closed');
        s.pty.write(part);
      }
    } catch (e) { return wordsEnd(r, `not delivered: the words could not be typed into ${r.lead} (${String(e && e.message || e).slice(0, 120)})`); }
    wordsChanged();
    return { ok: true };
  });
  // The Enter, once the page saw the box holds the words alone.
  ipcMain.handle('words:enter', (_e, id) => {
    const r = wordsTyping.get(String(id));
    if (!r || r.state !== 'typing') return { outcome: 'gone' };
    const s = leadPane(r);
    if (!s) return wordsEnd(r, `no ${r.lead} pane is open`);
    try { s.pty.write('\r'); } catch (e) { return wordsEnd(r, `not delivered: the Enter could not be typed into ${r.lead} (${String(e && e.message || e).slice(0, 120)})`); }
    r.state = 'sent';
    logRequest(`words-${r.id} sent into ${r.lead}; looking for them in its log`);
    wordsChanged();
    return { ok: true };
  });
  // Takes the typed words back out of the box (one Backspace per character); the request is
  // held again, or ended by the page with words:done.
  ipcMain.handle('words:erase', (_e, id) => {
    const r = wordsTyping.get(String(id));
    if (!r || r.state !== 'typing') return { outcome: 'gone' };
    const s = leadPane(r);
    if (!s) return wordsEnd(r, `no ${r.lead} pane is open`);
    try { s.pty.write('\x7f'.repeat([...r.words].length)); } catch (e) { return wordsEnd(r, `not delivered: the words could not be taken back out of ${r.lead}'s box (${String(e && e.message || e).slice(0, 120)})`); }
    r.state = 'held';
    wordsChanged();
    return { ok: true };
  });
  ipcMain.handle('words:done', (_e, id, outcome) => {
    const r = wordsTyping.get(String(id));
    if (!r) return { outcome: 'gone' };
    if (!doneAllowed(r.state, outcome)) return { outcome: 'refused' };
    return wordsEnd(r, String(outcome));
  });
  // Decline (or the card's X) works while a request waits, and while it is held after the
  // click; once its words are being typed it cannot be taken back here.
  ipcMain.handle('words:decline', (_e, id) => {
    const r = wordsWaiting.get(String(id)) || wordsTyping.get(String(id));
    if (!r) return { outcome: 'gone' };
    if (r.state && r.state !== 'held') return { outcome: 'busy' };
    wordsWaiting.delete(r.id); wordsTyping.delete(r.id);
    logRequest(`words-${r.id} declined by the owner${r.state ? ' while it was held' : ''}`);
    wordsOut(r.id, 'declined');
    wordsChanged();
    return { outcome: 'declined', cto: ctoLine(r, 'declined') };
  });
  // The window's answer to an open request: once a session started, it must still be alive a
  // few seconds later to count as started; the answer goes to open-<Project>.out.
  ipcMain.on('request:opened', (_e, { name, n, ok, error, already }) => {
    if (!/^[^\\/:*?"<>|]+$/.test(String(name))) return;
    const k = [2, 3, 4, 5].includes(n) ? n : 1;
    const id = k > 1 ? `${name}:${k}` : name, lead = sessionName(id);
    const answer = text => { logRequest(`answer ${lead}: ${text}`); try { fs.writeFileSync(path.join(P.requests, `open${k > 1 ? k : ''}-${name}.out`), text); } catch { /* script gave up */ } };
    if (!ok) { answer(`Failed: ${error || `could not start ${lead}`}`); return; }
    // Which model it runs on (#202), so the CTO can tell when an open lead is on another one.
    const on = s => (s.model ? ` on ${s.model}` : ' on the default model');
    if (already) { const s = sessions.get(id); answer(`Already open: ${lead} runs${s ? on(s) : ''}.`); return; }
    setTimeout(() => {
      const s = sessions.get(id);
      answer(s && s.alive ? `Started ${lead}${on(s)}.` : `Failed: ${lead} ended right after it started.`);
    }, 4000);
  });
  // A smoke or try run answers too: it watches its own state/smoke/requests (#185), and its
  // close step goes through deck close-pane (#2562).
  ipcMain.on('request:closed', (_e, { name, answer, n }) => {
    if (!/^[^\\/:*?"<>|]+$/.test(String(name))) return;
    const k = [2, 3, 4, 5].includes(n) ? n : '';
    try { fs.writeFileSync(path.join(P.requests, `close${k}-${name}.out`), String(answer)); } catch { /* script gave up */ }
  });
  // The smoke run opens a lead through deck open-pane (#2562), which writes its request before
  // it first waits; the main process is then kept busy for three seconds as a long git command
  // would, and the verb's own wait reads the answer file (#185).
  const smokePane = (verb, argv, name) => runPane(verb, argv, { data: path.dirname(P.requests), requests: P.requests, running: () => true, names: [name], tries: 100 });
  ipcMain.handle('smoke:request', async (_e, name) => {
    if (!SMOKE || !/^[^\\/:*?"<>|]+$/.test(String(name))) return '';
    const r = smokePane('open-pane', [name], name);
    const busy = Date.now(); while (Date.now() - busy < 3000) { /* busy, as during git worktree add */ }
    return (await r).out.split('\n').pop();
  });
  // ... closes it through deck close-pane, and asks for the owner's words through deck ask-owner,
  // which answers with the request's id.
  ipcMain.handle('smoke:close', async (_e, name) => {
    if (!SMOKE || !/^[^\\/:*?"<>|]+$/.test(String(name))) return '';
    return (await smokePane('close-pane', [name, '--force'], name)).out;
  });
  ipcMain.handle('smoke:ask', async (_e, project, words, why, task) => {
    if (!SMOKE) return null;
    const r = await smokePane('ask-owner', [String(project), String(words), '--why', String(why), '--task', String(task)], String(project));
    const m = r.out.match(/Request ([0-9a-f]{12})\./);
    return m ? m[1] : null;
  });
  // The smoke run's fake Claude Code screen (#3015): its full path, to run in a fake lead's pane.
  ipcMain.handle('smoke:fake-claude', () => (SMOKE ? path.join(APP_DIR, 'smoke', 'fake-claude.mjs') : null));
  return { watchRequests };
}
