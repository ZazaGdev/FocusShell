// Requests from the CTO's scripts, dropped as files in state/requests: opening and closing
// panes (open-pane.ps1, close-pane.ps1) and the owner's words (ask-owner.ps1). Kept out of main.js.
import { Notification } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { requestModel } from './lib/sessions.js';
import { parseRequest, sessionOfLead, ctoLine, EXPIRES } from './lib/ownerwords.js';
import { laterToasts, shouldToast } from './lib/toasts.js';

// d: { ipcMain, P, SMOKE, APP_DIR, read, send, sessions, win: () => the window or null, using: () => the owner is in the app }
export function registerRequests(d) {
  const { ipcMain, P, SMOKE, APP_DIR, read, send, sessions } = d;
  // The CTO opens a project by dropping state/requests/open-<Project>.req (open-pane.ps1),
  // and closes one with close-<Project>.req (close-pane.ps1), whose content is "force" or
  // empty. The window answers a close in close-<Project>.out and an open in open-<Project>.out
  // ("Started ..." or "Failed: ..."), which the scripts print (#185).
  // open2-/close2- do the same for the project's second lead; an open2 body of "worktree"
  // gives it its own git worktree. Every request and answer goes in requests.log.
  const logRequest = line => { try { fs.appendFileSync(path.join(P.requests, 'requests.log'), `${new Date().toISOString()} ${line}\n`); } catch { /* best effort */ } };
  function watchRequests() {
    fs.mkdirSync(P.requests, { recursive: true });
    const handle = () => {
      for (const f of fs.readdirSync(P.requests)) {
        const w = f.match(/^words-([\w-]{1,64})\.req$/);
        if (w) { takeWords(w[1], path.join(P.requests, f)); continue; }
        const m = f.match(/^(open|close)(2?)-(.+)\.req$/);
        if (!m) continue;
        const full = path.join(P.requests, f);
        const body = read(full);
        try { fs.unlinkSync(full); } catch { continue; }
        logRequest(`got ${f}${body.trim() ? ` (${body.trim()})` : ''}`);
        if (m[1] === 'open' && m[2]) send('request:open2', { name: m[3], worktree: /worktree/i.test(body), model: requestModel(body) });
        else if (m[1] === 'open') send('request:open', { name: m[3], model: requestModel(body) });
        else send('request:close', { name: m[3], force: /force/i.test(body), second: !!m[2] });
      }
    };
    handle();
    fs.watch(P.requests, () => setTimeout(handle, 100));
  }

  // The owner's words (#228): a request from ask-owner.ps1 waits here as a card. Only the
  // owner's click (words:approve, with the request's id) types its stored words into the
  // lead's pane; the page never sends the text. Each request is used once; a day old, it goes.
  const wordsWaiting = new Map(); // id -> request
  const wordsOut = (id, text) => { try { fs.writeFileSync(path.join(P.requests, `words-${id}.out`), text); } catch { /* the CTO hears from the card */ } };
  const wordsChanged = () => send('words:changed', [...wordsWaiting.values()]);
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
  }, 60000);
  ipcMain.handle('words:list', () => [...wordsWaiting.values()]);
  // The smoke run files requests as ask-owner.ps1 would, and reads the answers it gets.
  ipcMain.handle('smoke:words', (_e, id, body) => { if (!SMOKE) return null; fs.mkdirSync(P.requests, { recursive: true }); const f = path.join(P.requests, `words-${id}.req`); fs.writeFileSync(f, body); takeWords(id, f); return read(path.join(P.requests, `words-${id}.out`), null); });
  ipcMain.handle('smoke:words-out', (_e, id) => (SMOKE ? read(path.join(P.requests, `words-${id}.out`), null) : null));
  ipcMain.handle('words:approve', async (_e, id) => {
    const r = wordsWaiting.get(String(id));
    if (!r) return { outcome: 'gone' };
    wordsWaiting.delete(r.id);
    const s = sessions.get(sessionOfLead(r.project, r.lead));
    let outcome = 'typed';
    if (!s || !s.alive) outcome = `no ${r.lead} pane is open`;
    else {
      s.typedAt = s.total; s.used = true;
      s.pty.write(r.words);
      await new Promise(res => setTimeout(res, 150));
      s.pty.write('\r');
    }
    logRequest(`words-${r.id} ${outcome === 'typed' ? `typed into ${r.lead} on the owner's click` : outcome}`);
    wordsOut(r.id, outcome);
    wordsChanged();
    return { outcome, cto: ctoLine(r, outcome) };
  });
  ipcMain.handle('words:decline', (_e, id) => {
    const r = wordsWaiting.get(String(id));
    if (!r) return { outcome: 'gone' };
    wordsWaiting.delete(r.id);
    logRequest(`words-${r.id} declined by the owner`);
    wordsOut(r.id, 'declined');
    wordsChanged();
    return { outcome: 'declined', cto: ctoLine(r, 'declined') };
  });
  // The window's answer to an open request: once a session started, it must still be alive a
  // few seconds later to count as started; the answer goes to open-<Project>.out.
  ipcMain.on('request:opened', (_e, { name, second, ok, error, already }) => {
    if (!/^[^\\/:*?"<>|]+$/.test(String(name))) return;
    const id = second ? `${name}:2` : name, lead = `lead-${name}${second ? '-2' : ''}`;
    const answer = text => { logRequest(`answer ${lead}: ${text}`); try { fs.writeFileSync(path.join(P.requests, `open${second ? '2' : ''}-${name}.out`), text); } catch { /* script gave up */ } };
    if (!ok) { answer(`Failed: ${error || `could not start ${lead}`}`); return; }
    // Which model it runs on (#202), so the CTO can tell when an open lead is on another one.
    const on = s => (s.model ? ` on ${s.model}` : ' on the default model');
    if (already) { const s = sessions.get(id); answer(`Already open: ${lead} runs${s ? on(s) : ''}.`); return; }
    setTimeout(() => {
      const s = sessions.get(id);
      answer(s && s.alive ? `Started ${lead}${on(s)}.` : `Failed: ${lead} ended right after it started.`);
    }, 4000);
  });
  ipcMain.on('request:closed', (_e, { name, answer, second }) => {
    if (SMOKE) return; // the smoke run's close requests come from no script
    if (!/^[^\\/:*?"<>|]+$/.test(String(name))) return;
    try { fs.writeFileSync(path.join(P.requests, `close${second ? '2' : ''}-${name}.out`), String(answer)); } catch { /* script gave up */ }
  });
  // The smoke run drops an open request as open-pane.ps1 does, keeps the main process busy for
  // three seconds as a long git command would, then waits for the answer file (#185).
  ipcMain.handle('smoke:request', async (_e, name) => {
    if (!SMOKE || !/^[^\\/:*?"<>|]+$/.test(String(name))) return '';
    const out = path.join(P.requests, `open-${name}.out`);
    try { fs.unlinkSync(out); } catch { /* none */ }
    fs.writeFileSync(path.join(P.requests, `open-${name}.req`), name);
    const busy = Date.now(); while (Date.now() - busy < 3000) { /* busy, as during git worktree add */ }
    for (let i = 0; i < 100; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (fs.existsSync(out)) return read(out).trim();
    }
    return '(no answer in 20 seconds)';
  });
  return { watchRequests };
}
