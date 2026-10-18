// Smoke mode (electron . --smoke): fake sessions, a screenshot of each main view, then quit.
// app: the renderer's state as getters and setters, plus the functions the run drives.
import { autoLayout } from '../lib/layouts.js';
import { parseTasks } from '../lib/tasks.js';
import { isSomeday } from '../lib/me.js';
import { MAIN, groupOf } from '../lib/groups.js';
import * as C from './code.js';
import { closeWhiteboard } from './whiteboard.js';
import { ME } from './home.js';
import * as TD from './task-detail.js';
import { h, icon } from './dom.js';
import * as T from './terminal.js';
import { closeSearch } from './search.js';
import { tavernForSmoke, closeTavern, refresh as refreshTavern } from './tavern/tavern.js';
import { linkedText } from './textlinks.js';
import { refreshMissed, closeMissed as closeMissedBoard } from './missed.js';
import { closeStatus } from './status.js';
import { typeLine } from './cto-line.js';
import { finishedCounts } from '../lib/tavern/finished.js';
import { navForSmoke } from './nav.js';
import { recorderSmoke } from '../plugins/recorder/smoke.js';
import { showMissing } from './requirements.js';

const deck = window.deck;
const wait = ms => new Promise(r => setTimeout(r, ms));
// Waits for the Sketch board, then draws one stroke on it.
async function drawOnBoard() {
  for (let i = 0; i < 20 && !document.querySelector('.sk-canvas .excalidraw'); i++) await wait(500);
  await wait(1500);
  const cv = document.querySelector('.sk-canvas canvas.interactive'), r = cv?.getBoundingClientRect();
  document.querySelector('.App-toolbar label[title^="Draw"]')?.click();
  if (r) for (const [type, x] of [['pointerdown', 0.3], ['pointermove', 0.4], ['pointermove', 0.5], ['pointerup', 0.5]])
    cv.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: r.left + r.width * x, clientY: r.top + r.height * 0.4 }));
  await wait(800);
}

export async function smoke(app) {
  // Any error in the page ends the run with a failure instead of leaving it hanging (#187).
  addEventListener('error', e => deck.smokeFail((e.error && e.error.stack) || e.message));
  addEventListener('unhandledrejection', e => deck.smokeFail((e.reason && e.reason.stack) || e.reason));
  if ((await deck.smokeThrow()) === 'page') setTimeout(() => { throw new Error('forced page error (FOCUSSHELL_SMOKE_THROW=page)'); }, 3000);
  const { render, openTab, setBoardFocus, openGroup, openMd, wbCounts, openSecond, closeSecond, proj, tasksOf, showTask, collapsed } = app;
  const picks = app.projects.slice(0, 4).map(p => p.name);
  // The PM is off by default (#172); the sidebar and drawer views below show it on, and the
  // no-PM step further down turns it off.
  // The app opens on the Board, with no Dashboard tab (#1057).
  app.settings = { ...app.settings, dashboard: false }; render(); await wait(300);
  const noDash = { tab: !!document.querySelector('#tabs .tab.home:not(.board)'), board: !!document.querySelector('#tabs .tab.board.active') };
  if (noDash.tab || !noDash.board) throw new Error(`the app should open on the Board: ${JSON.stringify(noDash)}`);
  app.settings = { ...app.settings, runPm: true };
  app.prevSession = { name: 'Last session', projects: picks.slice(0, 3), layoutId: 'm-3r' };
  const d0 = new Date(), day = n => { const x = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  if (!app.tasksMd[ME]) app.tasksMd[ME] = ['# Me tasks', `- [ ] #1 Call the bank about the card limit (${day(0)}, user)`, `  > Due: ${day(0)} 17:00`,
    `- [ ] #2 Dentist (${day(0)}, user)`, `  > Due: ${day(3)} 10:30`, `- [ ] #3 Record the episode 3 voiceover (${day(0)}, user)`,
    `- [x] #4 Renew the Copilot seat (${day(0)}, user)`, `- [ ] #5 Learn to touch-type properly (${day(0)}, user)`, '  > Someday',
    `- [ ] #6 Invest (${day(0)}, user)`, `  > Due: ${day(2)} 09:00`, '  > Repeat: every 1 week'].join('\n');
  // A file change re-reads the data folder, which has no Me board; the sample goes back on.
  const meSample = app.tasksMd[ME], withMe = () => { app.tasksMd = { ...app.tasksMd, [ME]: meSample }; };
  for (const n of picks) await openTab(n, false);
  app.splitSet = picks; app.layoutId = autoLayout(picks.length); app.view = 'split'; render(); await wait(1500);
  await deck.smokeShot('split');
  // Files dragged over a pane show its drop target, on that pane only; crossing xterm's
  // child elements keeps it, leaving removes it (#216).
  {
    const hosts = [...document.querySelectorAll('.termhost')].filter(x => x.isConnected && x.clientWidth);
    const dt = new DataTransfer(); dt.items.add(new File(['x'], 'notes.txt'));
    const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    const host = hosts[1] || hosts[0], inner = host.querySelector('.xterm-screen') || host;
    fire(host, 'dragenter'); fire(inner, 'dragenter'); fire(host, 'dragleave');
    const on = hosts.filter(x => x.classList.contains('dropping')).length, shown = getComputedStyle(host.querySelector('.dropzone')).display;
    await wait(700); await deck.smokeShot('drop-overlay');
    fire(inner, 'dragleave'); const off = !host.classList.contains('dropping');
    console[on === 1 && shown === 'flex' && off ? 'log' : 'error'](`smoke: drop overlay on ${on} of ${hosts.length} panes (${shown}), gone after leaving ${off}`);
  }
  // Clicking CTO brings back its last split (#176): three projects in columns, then one
  // project's tab (CTO and that project), then CTO again.
  {
    const three = picks.slice(0, 3);
    app.splitSet = three; app.layoutId = 'm-3c'; app.view = 'split'; render(); await wait(800);
    const tab = name => [...document.querySelectorAll('#tabs .tab')].find(t => t.querySelector('.nm')?.textContent === name);
    tab(three[1])?.click(); await wait(800);
    const one = [...document.querySelectorAll('#stage .pane')].length;
    document.querySelector('#tabs .tab.mgr').click(); await wait(800);
    const back = app.splitSet.join(',') === three.join(',') && app.layoutId === 'm-3c';
    await deck.smokeShot('cto-split');
    // Focused, the CTO pane still shows its colour on the left edge only (#337).
    document.querySelector('#stage .pane.manager')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await wait(400);
    await deck.smokeShot('cto-split-focus');
    console[back ? 'log' : 'error'](`smoke: CTO tab brought back ${app.splitSet.join(', ')} in ${app.layoutId} (one project's tab showed ${one} panes)`);
    app.splitSet = picks; app.layoutId = autoLayout(picks.length); app.view = 'split'; render(); await wait(800);
  }
  // Quick </> clicks on three projects while VS Code's server is still starting (#122): each
  // Code pane ends up showing VS Code, none stays blank.
  {
    const three = picks.slice(0, 3);
    for (const n of three) { [...document.querySelectorAll('#tabs .tab')].find(t => t.querySelector('.cb') && t.textContent.includes(n)).querySelector('.cb').click(); await wait(400); }
    const shows = async v => { try { return await v.executeJavaScript("!!document.querySelector('.monaco-workbench')") && v.style.opacity !== '0'; } catch { return false; } };
    let ok = 0;
    for (let i = 0; i < 60; i++) {
      const views = [...document.querySelectorAll('#codelayer .codeview')];
      ok = 0; for (const v of views) if (await shows(v)) ok++;
      if (views.length === 3 && ok === 3) break;
      await wait(1000);
    }
    if (ok === 3) console.log('smoke: quick </> clicks on three projects, all three show VS Code');
    else console.error(`smoke: quick </> clicks on three projects, only ${ok} show VS Code`);
    for (const n of three) C.closeCode(n);
    render(); await wait(500);
  }
  // A lead sitting on a permission prompt (#119): marked as waiting, and its CTO is told.
  deck.write(picks[1], 'echo  Bash command: npm run build  Do you want to proceed?  1. Yes  2. No\r'); await wait(5000);
  await deck.smokeShot('waiting');
  // The CTO hears about it once, five minutes on (#146); the clock is moved, not waited for.
  {
    const t0 = Date.now(), told = [1, 6, 10, 30].map(m => app.checkPromptAlerts(t0 + m * 60e3));
    console[told.join() === '0,1,0,0' ? 'log' : 'error'](`smoke: a prompt held 30 minutes told the CTO ${told.join('+')} times`);
    deck.write(picks[1], 'cls\r'); deck.write(MAIN, 'cls\r'); await wait(2500);
    // Answered within five minutes (the owner typed in the pane): the CTO hears nothing.
    deck.write(picks[2], 'echo  Bash command: npm test  Do you want to proceed?  1. Yes  2. No\r'); await wait(5000);
    const t1 = Date.now(), seen = app.checkPromptAlerts(t1 + 2 * 60e3);
    deck.write(picks[2], 'cls\r'); await wait(2500);
    const late = [6, 12].map(m => app.checkPromptAlerts(t1 + m * 60e3));
    console[!seen && late.join() === '0,0' ? 'log' : 'error'](`smoke: a prompt answered within five minutes told the CTO ${seen + late[0] + late[1]} times`);
  }
  // The owner is writing in the CTO's prompt when a WAITING line comes (#243): it is held, and
  // typed only once the draft is sent and the pane has been quiet for ten seconds.
  {
    const rule = '-'.repeat(40);
    deck.write(MAIN, `cls & echo ${rule} & echo ^> half written & echo ${rule}\r`); T.typed(MAIN, 'h'); await wait(1500);
    deck.write(picks[1], 'cls & echo  Do you want to proceed? & echo  ^> 1. Yes & echo    2. No\r'); await wait(5000);
    const t0 = Date.now(), told = app.checkPromptAlerts(t0 + 6 * 60e3); await wait(3000);
    const rows = await T.screen(MAIN), waitingRow = () => T.screen(MAIN).then(r => r.some(l => /WAITING lead-/.test(l)));
    const held = told === 1 && rows.some(l => l.trim() === '> half written') && !(await waitingRow());
    await deck.smokeShot('cto-draft-held');
    deck.write(MAIN, 'cls\r'); T.typed(MAIN, '\r'); await wait(13000);
    const after = await waitingRow();
    console[held && after ? 'log' : 'error'](`smoke: a WAITING line during a draft in the CTO prompt was ${held ? 'held' : 'not held'}, then ${after ? 'typed after the draft went' : 'never typed'}`);
    await deck.smokeShot('cto-draft-sent');
    deck.write(picks[1], 'cls\r'); deck.write(MAIN, 'cls\r'); await wait(2500);
    app.checkPromptAlerts(Date.now() + 20 * 60e3);
  }
  app.splitSet = picks.slice(0, 3); app.layoutId = 'm-3r'; collapsed.add(picks[1]); render(); await wait(1200);
  await deck.smokeShot('folded');
  collapsed.clear();
  const six = app.projects.slice(0, 6).map(p => p.name);
  for (const n of six.slice(4)) await openTab(n, false);
  app.splitSet = six; app.layoutId = autoLayout(six.length); render(); await wait(1500);
  await deck.smokeShot('split6');
  app.layoutId = '3x2-m'; render(); await wait(1200);
  await deck.smokeShot('split6-right');
  // The CTO opens two leads that are already open, then closes them at once (#159): once
  // the open requests' batch runs, the closed leads must not come back as ended panes.
  app.view = 'split'; render();
  for (const n of six.slice(4)) await app.openRequest(n);
  for (const n of six.slice(4)) await app.closeRequest({ name: n, force: true });
  await wait(2500);
  await deck.smokeShot('split-closed');
  const back = six.slice(4).filter(n => app.splitSet.includes(n) || app.openTabs.includes(n));
  console[back.length ? 'error' : 'log'](`smoke: closed leads left the split (${back.length ? 'still there: ' + back.join(', ') : app.splitSet.join(', ')})`);
  // The owner is talking to the CTO while the CTO opens, restarts and closes a lead (#361): the
  // CTO pane keeps the keyboard and never tells Claude Code it lost focus, in a split and
  // beside a project on its own. The pane asks for focus reports the way Claude Code does.
  {
    const steps = [], lead = six[4];
    const check = async (what, act) => {
      T.focus(MAIN); const outs = T.focusOutsSent(MAIN);
      await act(); await wait(2500);
      steps.push({ what, kept: T.focusedId() === MAIN, outs: T.focusOutsSent(MAIN) - outs });
    };
    T.write(MAIN, '\x1b[?1004h'); await wait(300);
    app.view = 'split'; render(); await wait(800);
    await check('open in a split', () => app.openRequest(lead));
    await check('restart in a split', () => app.restart(lead));
    await check('close in a split', () => app.closeRequest({ name: lead, force: true }));
    app.view = 'single'; app.single = picks[0]; render(); await wait(800);
    await check('open beside one project', async () => { await app.openTab(lead, false); });
    await check('close beside one project', () => app.closeRequest({ name: lead, force: true }));
    // #1018: Claude Code's own dictation, Space held in the CTO pane, from the Board where the
    // CTO sits in the sidebar and a lead opening switches the page to a split.
    const spaceHeld = async ([what, act]) => {
      app.view = 'home'; render(); await wait(800); T.focus(MAIN);
      const box = document.activeElement, outs = T.focusOutsSent(MAIN);
      const hold = setInterval(() => box.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', repeat: true, bubbles: true, cancelable: true })), 40);
      await act(); await wait(2500);
      steps.push({ what: what + ' (Space held)', kept: T.focusedId() === MAIN, outs: T.focusOutsSent(MAIN) - outs });
      clearInterval(hold); await wait(800);
    };
    for (const a of [['open from the Board', () => app.openRequest(lead)], ['restart from the Board', () => app.restart(lead)], ['close from the Board', () => app.closeRequest({ name: lead, force: true })]]) await spaceHeld(a);
    T.write(MAIN, '\x1b[?1004l');
    const bad = steps.filter(s => !s.kept || s.outs);
    console[bad.length ? 'error' : 'log'](`smoke: the CTO pane kept the keyboard through ${steps.map(s => `${s.what} (${s.kept ? 'kept' : 'lost'}, ${s.outs} focus-out)`).join('; ')}`);
    app.view = 'split'; render(); await wait(800);
  }
  app.groups = [{ name: 'Mobile', projects: picks.slice(2, 4) }];
  app.ctx = null; app.view = 'home'; render(); await wait(1200);
  await deck.smokeShot('home');
  // #400: a card's answer buttons stay inside the card, at this width and in a narrow column.
  // A sample question with options, in memory, so the check never depends on the live boards.
  {
    const keepAsk = app.tasksMd, p0 = picks[0];
    app.tasksMd = { ...keepAsk, [p0]: `${keepAsk[p0] || `# ${p0} tasks`}\n- [?] #9870 Pick the export format (${day(0)}, lead-${p0}) -> needs you\n  > Result: NEEDS YOU #9870 | Which format for the export? | options: MP4, WebM, both | suggest: MP4\n` };
    render(); await wait(500);
    const outside = () => [...document.querySelectorAll('#home .bacts .btn')].filter(b => {
      const r = b.getBoundingClientRect(), card = b.closest('.bitem').getBoundingClientRect();
      return r.width && (r.right > card.right + 1 || r.left < card.left - 1);
    }).map(b => b.textContent);
    const n = document.querySelectorAll('#home .bacts.answers .btn').length, wide = outside();
    const cols = [...document.querySelectorAll('#home .bcol')];
    const keep = cols.map(c => c.style.cssText);
    cols.forEach(c => { c.style.flex = '0 0 170px'; c.style.width = '170px'; c.style.minWidth = '170px'; });
    await wait(300);
    const narrow = outside();
    cols.forEach((c, i) => { c.style.cssText = keep[i]; });
    console[n && !wide.length && !narrow.length ? 'log' : 'error'](`smoke: ${n} answer buttons; outside their card ${JSON.stringify(wide)}, in 170px columns ${JSON.stringify(narrow)}`);
    app.tasksMd = keepAsk; render(); await wait(300);
  }
  // Ctrl+K search (#233): opens from Home, narrows as you type, arrow keys and Enter open the
  // item, Esc closes; inside a pane only Ctrl+Shift+K opens it, Ctrl+K stays with Claude.
  {
    const key = (target, code, shiftKey = false, k = code) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, code, ctrlKey: code === 'KeyK', shiftKey, bubbles: true, cancelable: true }));
    const items = Object.keys(app.tasksMd).flatMap(p => tasksOf(p).map(t => ({ p, t })));
    const goal = items.filter(({ t }) => t.mark !== 'x' && t.text.split(' ').length >= 3)[1] || items[0];
    key(document.body, 'KeyK'); await wait(200);
    const opened = !!document.querySelector('.sr-back');
    const input = document.querySelector('.sr-back input');
    input.value = goal.t.text.split(' ').slice(0, 2).map(w => w.slice(0, 4)).join(' ');
    const t0 = performance.now(); input.dispatchEvent(new Event('input')); const ms = performance.now() - t0;
    const rows = [...document.querySelectorAll('.sr-row')], at = rows.findIndex(r => r.querySelector('.sr-proj')?.textContent === goal.p && r.querySelector('.sr-num').textContent === `#${goal.t.n}`);
    for (let i = 0; i < at; i++) key(input, 'ArrowDown', false, 'ArrowDown');
    await wait(300); await deck.smokeShot('search');
    key(input, 'Enter', false, 'Enter'); await wait(800);
    const shown = !document.querySelector('.sr-back') && !!document.querySelector('.tdpanel')?.textContent.includes(goal.t.text);
    await deck.smokeShot('search-open'); TD.closeTask();
    key(document.body, 'KeyK'); await wait(100); key(document.querySelector('.sr-back input'), 'Escape', false, 'Escape'); await wait(100);
    const esc = !document.querySelector('.sr-back');
    const pane = document.querySelector('.xterm textarea');
    if (pane) { key(pane, 'KeyK'); await wait(100); }
    const paneKeeps = !pane || !document.querySelector('.sr-back');
    if (pane) { key(pane, 'KeyK', true); await wait(100); }
    const paneShift = !pane || !!document.querySelector('.sr-back');
    // Sections (#235): a broad search shows them in Home's order with Done last, each row
    // with its project chip, and the arrow keys walk from one section into the next.
    key(document.body, 'KeyK'); await wait(100);
    const box2 = document.querySelector('.sr-back input');
    const common = Object.entries(items.reduce((m, { t }) => { for (const w of t.text.toLowerCase().match(/[a-z]{4,}/g) || []) (m[w] ||= new Set()).add(t.mark === 'x'); return m; }, {})).find(([, v]) => v.size === 2)?.[0] || 'the';
    box2.value = common; box2.dispatchEvent(new Event('input')); await wait(100);
    const secs = [...document.querySelectorAll('.sr-sec')].map(s => s.firstChild.textContent);
    const order = ['For you', 'Open', 'Doing', 'Done'], sorted = secs.every((s, i) => !i || order.indexOf(s) > order.indexOf(secs[i - 1]));
    const all = [...document.querySelectorAll('.sr-row')], firstOfNext = all.findIndex(r => r.previousElementSibling?.classList.contains('sr-sec') && r !== all[0]);
    for (let i = 0; i < firstOfNext; i++) key(box2, 'ArrowDown', false, 'ArrowDown');
    const crossed = firstOfNext < 0 || document.querySelectorAll('.sr-row')[firstOfNext].classList.contains('on');
    const chips = all.filter(r => !r.classList.contains('more')).every(r => r.querySelector('.sr-proj')?.textContent);
    await wait(200); await deck.smokeShot('search-sections');
    closeSearch();
    const ok = opened && at >= 0 && shown && esc && paneKeeps && paneShift && ms < 50 && secs.length > 1 && secs.at(-1) === 'Done' && sorted && crossed && chips;
    const said = `smoke: search opened ${opened}, "${input.value}" found ${goal.p} #${goal.t.n} at row ${at} of ${rows.length} in ${ms.toFixed(1)} ms, Enter opened it ${shown}, Esc closed ${esc}, Ctrl+K in a pane left to Claude ${paneKeeps}, Ctrl+Shift+K there opened it ${paneShift}, "${common}" in sections ${secs.join(' / ')} (Done last ${secs.at(-1) === 'Done'}, ordered ${sorted}), arrows crossed a section ${crossed}, every row has a project ${chips}`;
    if (!ok) deck.smokeFail(said); else console.log(said);
  }
  // The Pixel Tavern (#240): the button's badge counts the guests at the bar; it opens over
  // the app with every live session as a guest, a guest's question opens the answer box with
  // its card's options, its light follows the clock, and closed it sleeps.
  {
    // A question of the smoke's own on a running lead's board, so a guest walks to the bar
    // whatever the real boards hold. Only running sessions are guests (#311). The leads are the
    // ones running here, so the Demo's work too (#315), and their boards are held for the
    // check, so a board file another session writes meanwhile cannot move anyone (#319).
    const realMd = app.tasksMd, [ask1, ask2, ask3] = app.openTabs.filter(n => picks.includes(n)), smokeMd = p => `# ${p} tasks
- [?] #1 Keep 15 minute breaks? (${day(0)}, lead-${p}) -> NEEDS YOU #1 | keep 15 or make it 20? | options: keep 15, make it 20 | suggest: keep 15
`;
    const askOn = n => { const hold = Object.fromEntries([ask1, ask2, ask3].map(x => [x, x === n ? smokeMd(x) : `# ${x} tasks
`])); app.hold = hold; app.tasksMd = { ...realMd, ...hold }; };
    askOn(ask1);
    const btn = document.querySelector('.tavbtn');
    btn.click();
    let tv = null;
    for (let i = 0; i < 80 && !((tv = tavernForSmoke()).scene && tv.scene.guests.size); i++) await wait(250);
    // The room (#246): everyone in sits down at once; the one with a question walks to the bar.
    // Waits for every agent to be in the room and every question to reach the bar.
    const arrived = () => { const t = tavernForSmoke(), q = t.agents.filter(a => a.state === 'asking'); return q.length && t.scene && t.agents.every(a => t.scene.guests.has(a.id)) && q.every(a => t.scene.guests.get(a.id).where === 'bar'); };
    // The first opening (#306): they walk in by the door one by one, a moment apart.
    const inAt = new Map(), started = Date.now();
    const heldAtFirst = tv.scene ? [...tv.scene.guests.values()].filter(p => p.hold).length : 0;
    // The door opens for them and they fade through the doorway (#281). They were running
    // already, so the CTO calls none of them: no phone over its head (#363).
    let doorOpened = false, faded = false, phonedAtFirst = false, shot = false;
    for (let i = 0; i < 200 && !(arrived() && [...tavernForSmoke().scene.guests.values()].every(p => !p.hold)); i++) {
      const sc = tavernForSmoke().scene;
      for (const p of sc?.guests.values() || []) if (!p.hold && !inAt.has(p.id)) inAt.set(p.id, Date.now() - started);
      if (sc) {
        const cto = sc.guests.get('cto');
        doorOpened ||= !!sc.doorOpen; faded ||= [...sc.guests.values()].some(g => !g.hold && g.sprite.alpha > 0 && g.sprite.alpha < 1);
        phonedAtFirst ||= !!cto?.call?.visible;
        if (!shot && sc.doorOpen && faded) { shot = true; await deck.smokeShot('tavern-door'); }
      }
      await wait(250);
    }
    const ins = [...inAt.values()].sort((a, b) => a - b), gaps = ins.slice(1).map((t, i) => t - ins[i]);
    const oneByOne = gaps.length > 1 && Math.min(...gaps) >= 1000;
    console[oneByOne ? 'log' : 'error'](`smoke: tavern first opening walked in one by one ${oneByOne} (${heldAtFirst} waiting at the door, came in at ${ins.join(', ')} ms)`);
    // A lead the CTO opens now is called in: the phone shows while it walks in and is down once
    // it is inside (#281, #363).
    let phoned = false, phoneDown = false, called = '';
    {
      const sc = tavernForSmoke().scene, cto = sc.guests.get('cto');
      called = app.projects.map(p => p.name).find(n => !app.openTabs.includes(n)) || '';
      if (called) await openTab(called, false);
      for (let i = 0; i < 120 && called && !(phoned && sc.guests.get(called)?.where === 'seat'); i++) {
        if (!phoned && cto?.call?.visible) { phoned = true; await deck.smokeShot('tavern-call'); }
        await wait(250);
      }
      await wait(500);
      phoneDown = !cto?.call?.visible;
      await deck.smokeShot('tavern-call-done');
      console[!phonedAtFirst && phoned && phoneDown ? 'log' : 'error'](`smoke: tavern CTO phone at the first opening ${phonedAtFirst}, calling ${called || 'nobody'} in ${phoned}, down once it was inside ${phoneDown}`);
      if (called) await app.closeTab(called, false);
      for (let i = 0; i < 120 && sc.guests.has(called); i++) await wait(250);
    }
    tv = tavernForSmoke();
    const asking = tv.agents.filter(a => a.state === 'asking'), badge = Number(btn.querySelector('.tavbadge').textContent);
    // The cat wakes and stretches on a question it has not seen, then sleeps again (#284).
    {
      const sc = tv.scene;
      sc.setNotices(sc.seen ? sc.seen.size + 1 : 1, [...(sc.seen || []), 'smoke:new']); await wait(1300);
      const woke = !!sc.catAt && sc.cat.img.scaleX > 1.2;
      await deck.smokeShot('tavern-cat');
      await wait(2500);
      const slept = !sc.catAt && sc.cat.img.scaleX === 1;
      console[woke && slept ? 'log' : 'error'](`smoke: tavern cat woke and stretched ${woke}, asleep again ${slept}`);
    }
    const guests = tv.scene ? tv.scene.guests.size : 0;
    const atBar = asking.filter(a => tv.scene?.guests.get(a.id)?.where === 'bar').length;
    await deck.smokeShot('tavern');
    // Checked a moment after the last one came in, once it has been drawn.
    const robots = tv.scene ? [...tv.scene.guests.values()].every(g => g.sprite.anims.currentAnim) : false;
    // Each acts out its state (#278): "!" at the bar, a scroll when busy, a beer when idle.
    const acting = [...tv.scene.guests.values()].every(g => g.state === 'asking' ? g.where !== 'bar' || (g.bubble?.visible && g.bubble.text === '!')
      : g.mode === 'walk' || (g.state === 'working' && g.mode !== 'sit') || !!g.prop?.visible || !!g.mug?.visible);
    // The tap barrels show the 5-hour allowance the status line wrote (#279); the fire burns
    // as high as there are busy agents (#280).
    await tv.scene.refreshUsage();
    const use = await deck.tavernUsage(), tapsOk = use ? tv.scene.usage?.used === use.used : !tv.scene.usage;
    const fire = tv.scene.anim.find(a => a.name === 'fire');
    tv.scene.setBusy(6); const fireUp = fire.k > 0.8; await wait(300);
    // The allowance tip under the taps, shown for the shot (#302).
    const hadUse = tv.scene.usage;
    if (!hadUse) tv.scene.setUsage({ used: 20, resetsAt: Date.now() + 3600e3 });
    tv.scene.tapTip.setVisible(true);
    await deck.smokeShot('tavern-fire-busy');
    tv.scene.tapTip.setVisible(false);
    if (!hadUse) tv.scene.setUsage(null);
    refreshTavern(); await wait(300);
    // Against the agents as they are now: a fake one may have gone idle during the shot.
    const busyNow = tavernForSmoke().agents.filter(a => a.state === 'working').length;
    const fireOk = fireUp && tv.scene.busy === Math.min(8, busyNow);
    // The mug rack and trophy shelf count the boards' Done dates, Me left out (#282).
    const fin = finishedCounts(app.tasksMd, [ME]), finishedOk = tv.scene.finishedKey === JSON.stringify(fin);
    tv.scene.rackTip.setVisible(true); tv.scene.trophyTip.setVisible(true);
    await deck.smokeShot('tavern-finished');
    tv.scene.rackTip.setVisible(false); tv.scene.trophyTip.setVisible(false);
    // A click on the guest with the "?" opens its answer box (#246, #288).
    const item = asking.find(a => a.asks[0].kind === 'item') || asking[0];
    if (item) tv.scene.guests.get(item.id)?.sprite.emit('pointerdown');
    await wait(400);
    const box = document.querySelector('.tavbox'), boxOk = !!item && !box.hidden && !!box.querySelector('.tdopt, .popts button, textarea');
    await deck.smokeShot('tavern-answer');
    document.querySelector('.tavbox .tavx')?.click();
    // A click on a guest without a question opens its card (#277): task, last report, model, tokens.
    const plain = tv.agents.find(a => !a.asks.length);
    if (plain) tv.scene.guests.get(plain.id)?.sprite.emit('pointerdown');
    await wait(800);
    const cardOk = !plain || (!!document.querySelector('.tavbox .tavfacts') && document.querySelector('.tavbox .tavwho b')?.textContent === plain.name);
    await deck.smokeShot('tavern-card');
    document.querySelector('.tavbox .tavx')?.click();
    // The notice board by the door (#276): its pin counts every question, a click lists them, and
    // a note opens its own answer card with the card's options.
    const pinned = Number(tv.scene.pin.text);
    tv.notice(); await wait(400);
    const notes = [...document.querySelectorAll('.tavbox .tavnote')], noteOk = notes.length === asking.reduce((n, a) => n + a.asks.length, 0) && pinned === notes.length;
    const smokeNote = notes.find(b => b.textContent.includes(`${ask1} #1`));
    await deck.smokeShot('tavern-notice');
    smokeNote?.click(); await wait(300);
    const noteCard = !!document.querySelector('.tavbox .tavitem .tdopt') && !!document.querySelector('.tavbox button[title="Back to the notice board"]');
    await deck.smokeShot('tavern-notice-answer');
    document.querySelector('.tavbox .tavx')?.click();
    // The barkeep walks by the keys and by a click on the floor; a guest walks in by the door and
    // another walks out of it (#288).
    const sc = tv.scene, k = sc.keeper;
    // The keys walk him on the open floor; into the bar they stop him at it (#298).
    const { solidAt } = await import('./tavern/room/demos/room/paths.js');
    k.x = 200; k.y = 200; k.target = null; k.route = null;
    sc.keys.DOWN.isDown = true;
    let barIn = false;
    for (let i = 0; i < 8; i++) { await wait(150); barIn ||= solidAt(sc.grid, k.x, k.y); }
    sc.keys.DOWN.isDown = false;
    const barStop = !barIn && k.y < 210;
    k.x = 640; k.y = 360; k.target = null; k.route = null;
    const y0 = k.y;
    sc.keys.DOWN.isDown = true; await wait(1200); sc.keys.DOWN.isDown = false;
    const keyWalk = Math.round(k.y - y0);
    // Shift held runs him (#291): about twice as far in the same time, then he walks again.
    const y1 = k.y;
    sc.keys.SHIFT.isDown = true; sc.keys.UP.isDown = true; await wait(1200); sc.keys.UP.isDown = false; sc.keys.SHIFT.isDown = false;
    const runWalk = Math.round(y1 - k.y);
    await wait(800);
    if (!(runWalk > keyWalk * 1.6) || k.run) console.error(`smoke: barkeep sprint ${runWalk}px with Shift against ${keyWalk}px walking, still running ${!!k.run}`);
    else console.log(`smoke: barkeep sprint ${runWalk}px with Shift against ${keyWalk}px walking`);
    // He reaches the spot, then after 8 s alone goes back to his round: the closest he came counts.
    sc.input.emit('pointerdown', { worldX: 640, worldY: 330 }, []);
    let clickWalk = Infinity;
    // Nobody walks through furniture (#298): every walker, sampled, stands clear of it, but for
    // the edge of the seat or spot it is leaving or reaching.
    let through = 0, walkers = 0;
    for (let i = 0; i < 40; i++) {
      await wait(250); clickWalk = Math.min(clickWalk, Math.round(Math.hypot(k.x - 640, k.y - 330)));
      for (const p of sc.people()) {
        const r = p.route;
        if (p.mode !== 'walk' || !r) continue;
        walkers++;
        if (solidAt(sc.grid, p.x, p.y) && Math.hypot(r.to[0] - p.x, r.to[1] - p.y) > 18 && Math.hypot(r.from[0] - p.x, r.from[1] - p.y) > 18) through++;
      }
    }
    // As the app does it: the smoke's question moves to another running lead, so the first goes
    // back to its seat and the other walks to the bar. Nobody stands in for a project with no
    // lead running (#311): the real boards' questions of such projects bring no one.
    askOn(ask2);
    for (let i = 0; i < 160 && (sc.guests.get(ask1)?.where === 'bar' || sc.guests.get(ask2)?.where !== 'bar'); i++) await wait(250);
    const doorShut = await wait(1500).then(() => !sc.doorOpen);
    const walkedOut = sc.guests.get(ask1)?.where !== 'bar', walkedIn = sc.guests.get(ask2)?.where === 'bar';
    const running = new Set(tv.agents.map(a => a.id)), noStrangers = [...sc.guests.keys()].every(id => running.has(id) || id.startsWith('helper:') || id.startsWith('smoke-extra'));
    await deck.smokeShot('tavern-comings');
    // The chalkboard's token board: the owner's real counts (Demo mode too); the smoke's fake panes have none.
    await tv.tokens(); await wait(1500);
    const boardOk = !!document.querySelector('.chalkshade .chalk'), boardRows = document.querySelectorAll('.chalkshade li:not(.msg)').length;
    await deck.smokeShot('tavern-tokens');
    // Its tabs (#285): each shows its source's rows; Commits is the canned count.
    const tabRows = {};
    for (const b of document.querySelectorAll('.chalkshade .chalktab')) {
      b.click();
      for (let i = 0; i < 60 && /Reading/.test(document.querySelector('.chalkshade li.msg')?.textContent || ''); i++) await wait(250);
      tabRows[b.textContent] = document.querySelectorAll('.chalkshade li:not(.msg)').length;
      // Every tab is shot, and its rows logged, so a Demo run shows no real name on any (#314).
      await deck.smokeShot(`tavern-board-${b.textContent.toLowerCase().replace(/\W+/g, '-')}`);
      console.log(`smoke: tavern board ${b.textContent}: ${[...document.querySelectorAll('.chalkshade li')].map(li => li.textContent).join(' | ')}`);
    }
    const commits = await deck.commitsToday(), tabsOk = Object.keys(tabRows).length === 5 && tabRows.Commits === commits.projects.length;
    document.querySelector('.chalkshade')?.click();
    // No two robots on top of each other (#303): six more guests given in two overlapping casts,
    // as the app gives them, then two minutes run fast.
    const { overlapCheck } = await import('./tavern/room/demos/room/overlapcheck.js');
    const base = [...tv.scene.guests.values()].map(p => ({ id: p.id, robot: p.name, state: p.state }));
    const extra = n => Array.from({ length: n }, (_, i) => ({ id: `smoke-extra-${i}`, robot: i % 2 ? 'helper' : 'general-1', state: 'idle' }));
    await Promise.all([tv.scene.setCast([...base, ...extra(3)]), tv.scene.setCast([...base, ...extra(6)])]);
    const overlaps = await overlapCheck(tv.scene, { seconds: 120 }), apart = overlaps.sharedSeats === 0 && overlaps.worst < 2;
    // The light follows the clock (#283): dusk and night shown in turn, then back to the clock.
    const { lightAt } = await import('./tavern/room/demos/room/daylight.js');
    const clockLight = tv.scene?.light === lightAt();
    // The day/night button (#310): each click switches, over the clock.
    const lb = document.querySelector('.tavlight');
    lb.click(); await wait(800); const lightA = tv.scene.light; await deck.smokeShot(`tavern-button-${lightA}`);
    lb.click(); await wait(800); const lightB = tv.scene.light; await deck.smokeShot(`tavern-button-${lightB}`);
    const lightBtnOk = [lightA, lightB].sort().join() === 'day,night' && tv.scene.pinned === lightB;
    tv.scene?.setLight('dusk'); await wait(800);
    await deck.smokeShot('tavern-dusk');
    tv.scene?.setLight('night'); await wait(800);
    await deck.smokeShot('tavern-evening');
    tv.scene?.setLight(null);
    closeTavern();
    const asleep = !!tv.game && !tv.game.loop.running && !!document.querySelector('.tavshade[hidden]');
    // Changed while closed (#296): the question moves to a third project; on opening, its visitor
    // is already at the bar and the last one gone, with no walking, and no frames ran meanwhile.
    const framesClosed = tv.game.loop.frame;
    askOn(ask3);
    await wait(2500);
    const idleClosed = tv.game.loop.frame === framesClosed;
    btn.click(); await wait(300);
    const walkingOnReopen = [...sc.guests.values()].filter(g => g.mode === 'walk').map(g => `${g.id}>${g.where}`);
    // The two guests the closed-time change moved are in place, neither walking; another guest
    // (the PM) may walk because its own session changed just then, which is right (#1110).
    const three = sc.guests.get(ask3), inPlace = !!three && three.where === 'bar' && sc.guests.get(ask2)?.where !== 'bar' && [ask3, ask2].every(id => sc.guests.get(id)?.mode !== 'walk');
    await deck.smokeShot('tavern-reopened');
    // A closed tavern takes no clicks (#1066): a press on the chalkboard's spot opens it while the
    // tavern is open; closed, the same press on the Board, Settings or the CTO pane opens nothing.
    // Phaser hears presses on the whole window, so the control run turns its input back on.
    const canvas = document.querySelector('.tavstage canvas'), cr = canvas.getBoundingClientRect(), zb = sc.chalk.zone.getBounds(), px = cr.width / tv.game.scale.width;
    const spot = { clientX: cr.left + zb.centerX * px, clientY: cr.top + zb.centerY * px, bubbles: true, button: 0 };
    const press = el => { for (const t of ['mousedown', 'mouseup']) el.dispatchEvent(new MouseEvent(t, spot)); };
    const chalkOpen = () => !!document.querySelector('.chalkshade');
    press(canvas); await wait(400);
    const insideOpens = chalkOpen(); document.querySelector('.chalkshade')?.click(); await wait(200);
    closeTavern();
    const ghost = [];
    for (const [where, go] of [['Board', () => { app.view = 'home'; }], ['Settings', () => { app.view = 'settings'; }], ['CTO pane', () => { app.view = 'single'; app.single = MAIN; }]]) {
      go(); render(); await wait(400);
      press(document.elementFromPoint(spot.clientX, spot.clientY) || document.body); await wait(400);
      if (chalkOpen()) { ghost.push(where); document.querySelector('.chalkshade').click(); await wait(200); }
    }
    tv.game.input.enabled = true; press(document.body); await wait(400);
    const controlBites = chalkOpen(); document.querySelector('.chalkshade')?.click(); tv.game.input.enabled = false; await wait(200);
    console[insideOpens && !ghost.length && controlBites ? 'log' : 'error'](`smoke: tavern closed takes no clicks: chalkboard opens inside ${insideOpens}, opened while closed on ${ghost.join(', ') || 'nothing'}, the same press with Phaser's input left on opens it ${controlBites}`);
    const ok = !!tv.scene && guests === tv.agents.length && robots && badge === asking.length && asking.length > 0 && atBar === asking.length && boxOk && boardOk && tabsOk && apart && lightBtnOk && asleep && keyWalk > 20 && clickWalk < 3 && walkedOut && walkedIn && noStrangers && noteOk && noteCard && idleClosed && inPlace && cardOk && through === 0 && barStop && acting && tapsOk && fireOk && finishedOk && clockLight && doorOpened && doorShut && faded && !phonedAtFirst && phoned && phoneDown;
    app.hold = null; app.tasksMd = (await deck.readData()).tasks;
    const where = tv.scene ? [...tv.scene.guests.values()].map(g => `${g.id}:${g.name}:${g.where}`).join(' ') : '';
    const said = `smoke: tavern opened ${!!tv.scene} (${where}), ${guests} guests for ${tv.agents.length} agents, robots animated ${robots}, acting out their state ${acting}, tap barrels ${tv.scene.usage ? `${tv.scene.usage.used}% used` : 'empty'} as the status line ${tapsOk}, fire for ${busyNow} busy ${fireOk}, mugs ${fin.today} today and trophies ${fin.week} this week ${finishedOk}, light by the clock ${tv.scene.light} ${clockLight}, badge ${badge} for ${asking.length} asking, ${atBar} reached the bar, answer box ${boxOk}, guest card ${cardOk}, reopened in place ${inPlace}${inPlace ? '' : ` (walking ${walkingOnReopen.join(' ') || 'none'})`} and idle while closed ${idleClosed}, notice board ${notes.length} notes for pin ${pinned} ${noteOk} with an answer card ${noteCard}, walkers through furniture ${through} of ${walkers} samples, barkeep stopped at the bar by the keys ${barStop}, by keys ${keyWalk}px and to a click ${clickWalk}px off, back from the bar ${walkedOut}, to the bar ${walkedIn}, only running sessions ${noStrangers}, door opened ${doorOpened} and shut ${doorShut}, faded through it ${faded}, phone ${phoned}, token board ${boardOk} with ${boardRows} rows, its tabs ${JSON.stringify(tabRows)} ${tabsOk}, day/night button ${lightA} then ${lightB} ${lightBtnOk}, robots apart ${apart} (${overlaps.guests} guests, ${overlaps.sharedSeats} shared seats, longest overlap ${overlaps.worst}s ${JSON.stringify(overlaps.pairs.slice(0, 3))}), asleep when closed ${asleep}, frames ${tv.game?.loop.frame}, fps ${Math.round(tv.game?.loop.actualFps || 0)}, hidden ${document.visibilityState}`;
    if (!ok) deck.smokeFail(said); else console.log(said);
  }
  // Self hides to a tab on the right edge and comes back from it (#190). On the Board: the
  // tavern check before this one leaves a pane on screen.
  {
    closeTavern(); app.ctx = null; app.view = 'home'; render(); await wait(600);
    const noFold = !document.querySelector('#home [aria-label="Fold to the title"]'); // gone from the Board too (#1023)
    document.querySelector('.pp-me .ptool[aria-label^="Hide Self"]')?.click(); await wait(600);
    const gone = !document.querySelector('.pp-me') && document.querySelector('.metab');
    await deck.smokeShot('home-self-hidden');
    document.querySelector('.metab')?.click(); await wait(600);
    const back = document.querySelector('.pp-me') && !document.querySelector('.metab');
    console[gone && back && noFold ? 'log' : 'error'](`smoke: Self hides to the right edge and comes back (hidden ${!!gone}, back ${!!back}, no fold ${noFold})`);
  }
  // Personal (#177): never a board column or option, and no row above the board (#1020); its tab opens it.
  {
    const row = document.querySelector('#home .personal'), opts = [...document.querySelectorAll('#home select option')].map(o => o.textContent);
    const has = app.projects.some(p => p.kind === 'personal'), ok = !row && !opts.includes('Personal');
    console[ok ? 'log' : 'error'](`smoke: Personal project ${has ? 'listed' : 'not in projects.json'}, row on Home ${!!row}, in the board dropdown ${opts.includes('Personal')}`);
  }
  // The Me page (#130): a new saved sketch, drawn and saved, then attached to an idea.
  withMe(); app.view = 'me'; render(); await wait(1200);
  // New sketch in the Sketches section (#147) opens the board at once, named after today.
  document.querySelector('.mer .note-add button').click();
  await drawOnBoard(); await deck.smokeShot('me-sketch');
  document.querySelector('.sk-foot .btn.primary').click(); await wait(2500);
  const saved = await deck.sketchList(ME);
  if (!saved.length || !saved[0].preview) console.error(`smoke: the Me sketch was not saved with a preview (${saved.length} saved)`);
  else {
    if (!/^sketches\/Me\/sketch-\d{4}-\d{2}-\d{2}\.excalidraw$/.test(saved[0].rel)) console.error(`smoke: the Me New sketch is not named after today (${saved[0].rel})`);
    await deck.sketchAttach({ kind: 'task', project: 'ideas', n: 1 }, saved[0].rel); await wait(1500); console.log(`smoke: saved ${saved[0].rel}`); }
  withMe(); render(); await wait(1200);
  if (!document.querySelector('.idea .skb') || !document.querySelector('.shelfit img')) console.error('smoke: the Me page does not show the attached sketch');
  await deck.smokeShot('me');
  // The header's toggle (#396) hides the Sketches column and the Ideas take its room, then shows it again.
  {
    const midW = () => document.querySelector('.mem').getBoundingClientRect().width, before = midW();
    document.querySelector('.mehd .sktoggle').click(); await wait(400);
    const gone = !document.querySelector('.mer'), wider = midW() > before + 100;
    await deck.smokeShot('me-nosketches');
    document.querySelector('.mehd .sktoggle').click(); await wait(400);
    const back = !!document.querySelector('.mer');
    console[gone && wider && back ? 'log' : 'error'](`smoke: the sketches toggle hid the column ${gone}, widened the ideas ${wider}, showed it again ${back}`);
  }
  // An opened idea (#343): its description edited in one box, the tag picker finding a tag
  // and making a new one (which joins Settings' tags), and the box to the CTO (#342) typing
  // the IDEA line with what was written into the CTO's pane and marking the card sent.
  {
    const typeIn = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    const ideaOne = async () => (await deck.readData()).ideas.split('\n- [')[1] || '';
    document.querySelector('.idea .t').click(); await wait(400);
    document.querySelector('.idea.open .idesc').click(); await wait(400);
    const ta = document.querySelector('.idea.open textarea.idesc');
    typeIn(ta, `${ta.value}\nMake each episode under ten minutes.`); ta.blur(); await wait(1500);
    const desc = [...document.querySelectorAll('.idea.open .idesc p')].map(p => p.textContent), kept = /State: growing/.test(await ideaOne());
    const descOk = desc.length === 2 && desc[1] === 'Make each episode under ten minutes.' && kept;
    const pin = () => document.querySelector('.idea.open .tpin');
    pin().focus(); typeIn(pin(), 'li'); await wait(300);
    const offered = [...document.querySelectorAll('.idea.open .tpitem')].map(b => b.textContent);
    pin().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(1200);
    pin().focus(); typeIn(pin(), 'Shorts'); await wait(300);
    const create = document.querySelector('.idea.open .tpitem.new')?.textContent;
    await deck.smokeShot('me-idea-tags');
    pin().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(1200);
    const chips = [...document.querySelectorAll('.idea.open .tagpick .tag')].map(t => t.firstChild.textContent);
    const tagsOk = offered.join('|') === 'life|Create "li"' && create === 'Create "Shorts"' && chips.join('|') === 'youtube|life|shorts' && app.settings.tags.includes('Shorts');
    const say = document.querySelector('.idea.open .tdtalk .tdsay'); typeIn(say, 'make it 3d');
    document.querySelector('.idea.open .tdtalk .btn.primary').click(); await wait(2500);
    const screen = (await T.screen(MAIN)).join('').replace(/\s+/g, ' ');
    const typed = screen.includes('IDEA #1: Pushing AI to its limits') && screen.includes('You: make it 3d');
    const mark = document.querySelector('.idea.open .f .tag.ok')?.textContent, st = document.querySelector('.idea.open .f .tag.st')?.textContent;
    await deck.smokeShot('me-idea-sent');
    console[descOk ? 'log' : 'error'](`smoke: idea description edited in one box: ${JSON.stringify(desc)}, keyed lines kept ${kept}`);
    console[tagsOk ? 'log' : 'error'](`smoke: idea tag picker offered ${JSON.stringify(offered)} for "li", then "${create}"; tags ${chips.join(', ')}; in Settings ${app.settings.tags.includes('Shorts')}`);
    console[typed && /^sent to CTO \d{4}-\d{2}-\d{2}$/.test(mark || '') && st === 'growing' ? 'log' : 'error'](`smoke: idea sent to the CTO: line typed ${typed}, card shows "${mark}", state ${st}`);
    document.querySelector('.idea.open .t').click(); await wait(300);
  }
  // Reminders (#198): every dated item soonest first, a repeating one with its rhythm, and
  // To do keeps only the undated ones.
  {
    app.tasksMd = { ...app.tasksMd, [ME]: ['# Me tasks', `- [ ] #1 Call the bank about the card limit (${day(0)}, user)`, `  > Due: ${day(0)} 17:00`,
      `- [ ] #2 Dentist (${day(0)}, user)`, `  > Due: ${day(3)} 10:30`, `- [ ] #3 Record the episode 3 voiceover (${day(0)}, user)`,
      `- [ ] #6 Invest (${day(0)}, user)`, `  > Due: ${day(2)} 09:00`, '  > Repeat: every 1 week'].join('\n') };
    render(); await wait(400);
    const under = label => { const out = []; let el = [...document.querySelectorAll('.mel .daygrp')].find(x => x.firstChild.textContent === label);
      while (el && (el = el.nextElementSibling) && !el.classList.contains('daygrp')) if (el.classList.contains('mecard')) out.push(el.querySelector('.tx').firstChild.textContent); return out; };
    const rem = under('Reminders'), todo = under('To do'), rep = document.querySelector('.mel .mecard .rep');
    const ok = rem.join('|') === 'Call the bank about the card limit|Invest|Dentist' && todo.join('|') === 'Record the episode 3 voiceover' && rep && rep.textContent === 'every week';
    console[ok ? 'log' : 'error'](`smoke: Reminders ${rem.join(', ')}; To do ${todo.join(', ')}; repeat label ${rep && rep.textContent}`);
    document.querySelector('.mel .note-add .iconbtn').click(); await wait(300);
    const fields = document.querySelectorAll('.mel .whenrow:not([hidden]) .whenf input, .mel .whenrow:not([hidden]) .whenf select').length;
    console[fields === 4 ? 'log' : 'error'](`smoke: the clock beside the add field shows date, time and repeat (${fields} fields)`);
    await deck.smokeShot('me-when');
    document.querySelector('.mel .note-add .iconbtn').click(); await wait(200);
    withMe(); render(); await wait(400);
  }
  // To do lists newest first; the picker in its heading switches to oldest first and back (#204).
  {
    app.tasksMd = { ...app.tasksMd, [ME]: ['# Me tasks', `- [ ] #1 Oldest one (${day(-5)}, user)`, `- [ ] #2 Newest one (${day(0)}, user)`,
      `- [ ] #3 Middle one (${day(-2)}, user)`, '  > Priority: 1'].join('\n') };
    render(); await wait(400);
    const titles = () => [...document.querySelectorAll('.mel .mecard .tx')].map(t => t.firstChild.textContent);
    const pick = document.querySelector('.mel .daygrp .tdsort'), first = titles().join('|');
    await deck.smokeShot('me-sort');
    pick.value = 'oldest'; pick.dispatchEvent(new Event('change')); await wait(400);
    const second = titles().join('|');
    const back = document.querySelector('.mel .daygrp .tdsort'); back.value = 'newest'; back.dispatchEvent(new Event('change')); await wait(300);
    const ok = first === 'Newest one|Middle one|Oldest one' && second === 'Oldest one|Middle one|Newest one';
    console[ok ? 'log' : 'error'](`smoke: Self To do by default ${first}; oldest first ${second}`);
    withMe(); render(); await wait(400);
  }
  // The To do column opens 380px wide; its edge drags it wider, and the width is kept (#203).
  {
    const width = () => Math.round(document.querySelector('.mel').getBoundingClientRect().width);
    const w0 = width(), r = document.querySelector('.mecols').getBoundingClientRect();
    document.querySelector('.megut').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.left + w0 }));
    dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + 480 })); dispatchEvent(new MouseEvent('mouseup', {}));
    render(); await wait(400);
    // A title's lines: the distinct tops of its text's boxes.
    const lines = node => { const rg = document.createRange(); rg.selectNodeContents(node); return new Set([...rg.getClientRects()].map(x => Math.round(x.top))).size; };
    const w1 = width(), two = [...document.querySelectorAll('.mel .mecard .tx')].map(t => t.firstChild).filter(n => n.textContent.length < 60).every(n => lines(n) <= 2);
    console[w0 === 380 && w1 === 480 && two ? 'log' : 'error'](`smoke: Self To do column ${w0}px, dragged to ${w1}px and kept after a redraw, short titles on at most two lines ${two}`);
    await deck.smokeShot('me-wide');
    document.querySelector('.megut').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.left + w1 }));
    dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + 380 })); dispatchEvent(new MouseEvent('mouseup', {}));
    render(); await wait(300);
  }
  // Someday (#170): folded under To do with its count; open, it shows its items and add box.
  document.querySelector('.mel .sdhead').click(); await wait(400);
  const some = [...document.querySelectorAll('.mel .memove')].filter(b => b.textContent.includes('To do')).length;
  const dones = document.querySelectorAll('.mel .medone').length;
  // As many as the Me board holds: the sample has one, a data folder with its own Me board more.
  const wantSome = parseTasks(app.tasksMd[ME] || '').filter(t => t.mark !== 'x' && isSomeday(t)).length;
  console[some === wantSome && some > 0 && dones === document.querySelectorAll('.mel .mecard:not(.done)').length && document.querySelector('.mel .sdcheck input') ? 'log' : 'error'](`smoke: Someday open shows ${some} item(s), the add field has its Someday box, ${dones} Done buttons`);
  await deck.smokeShot('me-someday');
  document.querySelector('.mel .sdhead').click(); await wait(200);
  // The opened to-do shows Done beside its title (#168).
  document.querySelector('.mel .mecard .tx').click(); await wait(1500);
  console[document.querySelector('.tdhead .tddone')?.textContent === 'Done' ? 'log' : 'error']('smoke: the opened to-do has Done by its title');
  await deck.smokeShot('me-item');
  document.querySelector('.tdclose')?.click(); await wait(300);
  // Rename in the board (#144): open the sketch from the idea, change its name, close; the
  // files move and the idea's line follows (smoke data folder only).
  {
    document.querySelector('.idea .skb button').click();
    for (let i = 0; i < 20 && !document.querySelector('.sk-name'); i++) await wait(500);
    const nm = document.querySelector('.sk-name');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(nm, 'Episode map v2');
    nm.dispatchEvent(new Event('input', { bubbles: true })); await wait(300);
    await deck.smokeShot('sketch-rename');
    document.querySelector('.sk-foot .btn.primary').click(); await wait(2500);
    withMe(); render(); await wait(1200);
    const rels = (await deck.sketchList(ME)).map(s => s.rel), chip = document.querySelector('.idea .skb')?.textContent;
    const ok = rels.join() === 'sketches/Me/episode-map-v2.excalidraw' && chip === 'episode map v2';
    console[ok ? 'log' : 'error'](`smoke: renamed in the board, files ${rels.join()}, idea shows "${chip}"`);
    await deck.smokeShot('sketch-renamed');
  }
  // The AI helper (#154): the sparkle beside the idea field, seeded with what is typed; the
  // smoke run's canned reply fills the draft, and Add puts the idea on the deck.
  {
    const field = document.querySelector('.mem .note-add input');
    field.value = 'Shorts from long videos';
    field.parentElement.querySelector('.aihelp').click();
    for (let i = 0; i < 20 && !document.querySelector('.aidraft')?.value; i++) await wait(300);
    await deck.smokeShot('helper');
    const drafted = document.querySelectorAll('.aib.me').length === 1 && document.querySelectorAll('.aib.ai').length === 1
      && /^Shorts from long videos\n/.test(document.querySelector('.aidraft').value);
    document.querySelector('.aibox footer .btn.primary').click(); await wait(1500);
    const added = !document.querySelector('.aishade') && field.value === '' && /#\d+ Shorts from long videos \(/.test((await deck.readData()).ideas);
    console[drafted && added ? 'log' : 'error'](`smoke: helper drafted ${drafted}, added the idea ${added}`);
    withMe(); render(); await wait(800);
  }
  app.view = 'home'; render(); await wait(500);
  app.settings = { ...app.settings, boardCompact: true }; render(); await wait(800);
  await deck.smokeShot('home-compact');
  app.settings = { ...app.settings, boardCompact: false }; render(); await wait(800);
  // Home's columns (#167): by kind by default (Tests, To-dos, Decide / unblock, Work, the
  // Done rail), no For owner panel, one project dropdown, Done buttons on the owner's tests.
  const chipOf = (sel, re) => [...document.querySelectorAll(sel)].find(b => re.test(b.textContent));
  await deck.smokeShot('home-tests');
  {
    const panel = !!document.querySelector('.pp-own'), done = document.querySelectorAll('.bcol[data-col="test"] .bitem .btn').length;
    const cols = [...document.querySelectorAll('.bcols > .bcol')].map(x => x.dataset.col).join(',');
    const chips = document.querySelectorAll('.bchips > .chip').length, pick = !!document.querySelector('.bchips .bsel');
    const me = document.querySelector('.pp-board').getBoundingClientRect().left < document.querySelector('.pp-me').getBoundingClientRect().left;
    console[!panel && done && cols === 'test,do,ask,work,done' && !chips && pick && me ? 'log' : 'error'](`smoke: Home columns ${cols}, For owner panel ${panel}, ${done} tests with Done, ${chips} project chips, dropdown ${pick}, Me right of the board ${me}`);
  }
  // #403: the filters sit behind one button that slides them open; #410: the columns touch, one
  // panel with thin lines between them; #404: one sort control.
  {
    const shut = document.querySelector('.bfilters')?.getBoundingClientRect().height < 2;
    document.querySelector('.bfbtn').click(); await wait(400);
    const open = document.querySelector('.bfilters').getBoundingClientRect().height > 20;
    const cs = [...document.querySelectorAll('.bcols > .bcol')].map(x => x.getBoundingClientRect());
    const touch = cs.length > 1 && cs.every((r, i) => !i || Math.abs(r.left - cs[i - 1].right) <= 1);
    const sorts = document.querySelectorAll('.bsort select').length, noWords = !/Newest first|Oldest first/.test(document.querySelector('.bsort').textContent);
    await deck.smokeShot('home-filters-open');
    console[shut && open && touch && sorts === 1 && noWords ? 'log' : 'error'](`smoke: Board filters hidden at first ${shut}, open after the button ${open}, columns in one panel ${touch}, one sort control ${sorts === 1 && noWords}`);
  }
  // A priority toggle filters every column; the Done rail opens to the latest 20.
  // Priority and Tags are dropdowns like Azure Boards' (#293): search, checkboxes, Clear.
  const pickOpt = async (id, re) => {
    if (!document.querySelector(`.fdrop[data-fd="${id}"] .fdpop.open`)) document.querySelector(`.fdrop[data-fd="${id}"] .bsel`).click();
    const box = [...document.querySelectorAll(`.fdrop[data-fd="${id}"] .bpopt`)].find(l => re.test(l.textContent))?.querySelector('input');
    if (box) { box.click(); await wait(500); }
    return !!box;
  };
  await pickOpt('prio', /^P1/);
  const p1 = [...document.querySelectorAll('.bcols .bitem')].every(b => b.querySelector('.prio.p1'));
  await deck.smokeShot('home-filter');
  document.querySelector('.fdrop[data-fd="prio"] .fdfoot .ptool').click(); await wait(300);
  document.body.click(); await wait(200);
  // One filter dropdown open at a time (#1098): opening another closes the first; Esc and a
  // click outside close it.
  {
    const ids = [...document.querySelectorAll('.fdrop')].map(d => d.dataset.fd).slice(0, 2), openNow = () => [...document.querySelectorAll('.fdrop .fdpop.open')].map(p => p.closest('.fdrop').dataset.fd);
    document.querySelector(`.fdrop[data-fd="${ids[0]}"] .bsel`)?.click(); await wait(150);
    const first = openNow().join();
    document.querySelector(`.fdrop[data-fd="${ids[1]}"] .bsel`)?.click(); await wait(150);
    const second = openNow().join();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(150);
    const afterEsc = openNow().length;
    document.querySelector(`.fdrop[data-fd="${ids[0]}"] .bsel`)?.click(); await wait(150);
    document.body.click(); await wait(150);
    const afterOutside = openNow().length;
    const ok = ids.length === 2 && first === ids[0] && second === ids[1] && afterEsc === 0 && afterOutside === 0;
    console[ok ? 'log' : 'error'](`smoke: filter dropdowns ${ids.join(', ')}: open ${first}, then ${second} alone, Esc closes ${afterEsc === 0}, a click outside closes ${afterOutside === 0}`);
  }
  // Sort by date added, newest first, in every column (#293); then back to priority.
  const sortSel = document.querySelector('.bsort select');
  sortSel.value = 'added'; sortSel.dispatchEvent(new Event('change')); await wait(500);
  // The Work column holds two sections, Ready to send and In progress, each sorted on its own.
  const addedOf = b => (b.querySelector('.bhist')?.textContent.match(/added (\d+ \w+)/) || [])[1];
  const sections = []; let cur = null;
  for (const el of document.querySelectorAll('.bcol[data-col="work"] .bsub, .bcol[data-col="work"] .bitem')) {
    if (el.classList.contains('bsub')) sections.push(cur = []); else if (cur) cur.push(addedOf(el));
  }
  const work = sections.flat().filter(Boolean);
  const addedOn = x => new Date(`${x} ${new Date().getFullYear()}`).getTime();
  const newest = sections.every(s => s.filter(Boolean).every((x, i, a) => !i || addedOn(a[i - 1]) >= addedOn(x)));
  await deck.smokeShot('home-sorted');
  const sortSel2 = document.querySelector('.bsort select'); sortSel2.value = 'priority'; sortSel2.dispatchEvent(new Event('change')); await wait(300);
  console[newest && work.length > 1 ? 'log' : 'error'](`smoke: sort by date added puts the newest first: ${newest} (${work.slice(0, 4).join(', ')})`);
  document.querySelector('.brail').click(); await wait(500);
  const doneShown = document.querySelectorAll('.bcol[data-col="done"] .bitem').length;
  console[p1 && doneShown && doneShown <= 20 ? 'log' : 'error'](`smoke: P1 filter keeps only P1 cards ${p1}, Done opens with ${doneShown} cards`);
  chipOf('.btab', /^By status/).click(); await wait(800);
  await deck.smokeShot('home-status');
  // #405: For you's types are one dropdown, no row of chips.
  {
    const sel = document.querySelector('.bchips select.bkind'), chips = document.querySelectorAll('.bkinds .chip').length;
    const opts = sel ? [...sel.options].map(o => o.textContent.replace(/ \(\d+\)$/, '')).join(', ') : '';
    console[sel && !chips && opts === 'All types, Tests, To-dos, Decide / unblock' ? 'log' : 'error'](`smoke: Board Type dropdown ${opts}, kind chips left ${chips}`);
  }
  document.querySelector('.bcol[data-col="done"] .bfold').click(); await wait(300);
  // By project (#110): one column per project with items left, the most first.
  chipOf('.btab', /^By project/).click(); await wait(800);
  await deck.smokeShot('home-byproject');
  const cnt = [...document.querySelectorAll('.lanes.byproj > .lane > header small')].map(e => +e.textContent);
  if (!cnt.length || cnt.some((n, i) => !n || (i && n > cnt[i - 1]))) console.error(`smoke: By project columns wrong (${cnt.join(', ')})`);
  else console.log(`smoke: By project shows ${cnt.length} columns (${cnt.join(', ')})`);
  // The project picker (#205): tick two, only their columns and prompt cards show; a redraw keeps them.
  {
    document.querySelector('.bpick .bsel').click(); await wait(300);
    const boxes = [...document.querySelectorAll('.bpickpop .bpopt')];
    const two = boxes.slice(0, 2).map(b => b.querySelector('span').textContent);
    for (const n of two) { [...document.querySelectorAll('.bpickpop .bpopt')].find(b => b.querySelector('span').textContent === n).querySelector('input').click(); await wait(300); }
    const open = document.querySelector('.bpickpop').classList.contains('open');
    await deck.smokeShot('home-pick');
    render(); await wait(500);
    const shown = [...document.querySelectorAll('.lanes.byproj > .lane')].map(e => e.dataset.project);
    const cards = [...document.querySelectorAll('#home .pcard')].map(e => e.dataset.session);
    const label = document.querySelector('.bpick .bsel').textContent;
    const ok = two.length === 2 && open && shown.length && shown.every(n => two.includes(n)) && cards.every(s => two.some(n => s.startsWith(n))) && /^2 projects/.test(label);
    console[ok ? 'log' : 'error'](`smoke: picker ticks ${two.join(' + ')}, stays open ${open}, columns ${shown.join(', ')}, prompt cards ${cards.join(', ') || 'none'}, label ${label}`);
    document.querySelector('.bpick .bsel').click(); await wait(200);
    document.querySelector('.bpickpop .bpall').click(); await wait(300);
    document.body.click(); await wait(300);
  }
  const boardOf = ['FocusShell', 'Clipper'].find(n => proj(n)) || picks[0];
  await setBoardFocus(boardOf); await wait(2500);
  await deck.smokeShot('board-project');
  // A redraw (a drop, or a session writing the task file) keeps the board's scroll (#108).
  const bpb = () => document.querySelector('#home .pp-board > .pb');
  bpb().scrollTop = 200; const was = bpb().scrollTop; render(); await wait(300);
  if (!was || bpb().scrollTop !== was) console.error(`smoke: board scroll jumped on redraw (${was} to ${bpb().scrollTop})`);
  else console.log(`smoke: board scroll kept on redraw (${was})`);
  // While a card is dragged, every column is as tall as the longest (#109).
  const kc = document.querySelector('.kcard');
  if (kc) {
    kc.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() })); await wait(100);
    const hs = [...document.querySelectorAll('.kcol')].map(x => Math.round(x.getBoundingClientRect().height));
    kc.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    if (new Set(hs).size !== 1) console.error(`smoke: drop zones differ in height while dragging (${hs})`);
    else console.log(`smoke: drop zones all ${hs[0]}px while dragging`);
  }
  document.querySelector('.kbtabs button:last-child').click(); await wait(800); await deck.smokeShot('board-planning');
  document.querySelector('.kbtabs button').click(); await setBoardFocus(null);
  app.settings = { ...app.settings, pmDock: 'bottom' }; render(); await wait(1200);
  await deck.smokeShot('side-bottom');
  app.settings = { ...app.settings, pmDock: 'float' }; render(); await wait(1200);
  await deck.smokeShot('side-float');
  app.settings = { ...app.settings, pmDock: 'left', foldCto: true }; render(); await wait(1000);
  await deck.smokeShot('side-cto-folded');
  app.settings = { ...app.settings, foldCto: false, pmFolded: true }; render(); await wait(1000);
  await deck.smokeShot('side-folded');
  app.settings = { ...app.settings, pmFolded: false };
  // With the PM off (#172): the CTO has the sidebar alone, hints name the CTO, no PM drawer.
  {
    app.settings = { ...app.settings, runPm: false }; app.view = 'home'; render(); await wait(1000);
    const panes = document.querySelectorAll('#side .sidepane').length;
    const hints = [...document.querySelectorAll('#home input[placeholder]')].map(i => i.placeholder).filter(p => /PM|CTO/.test(p));
    await deck.smokeShot('home-no-pm');
    app.view = 'single'; app.single = picks[0]; render(); await wait(800);
    const drawer = !!document.querySelector('#pmdock *');
    await deck.smokeShot('single-no-pm');
    app.settings = { ...app.settings, runPm: true }; app.view = 'home'; render(); await wait(800);
    const ok = panes === 1 && hints.length && hints.every(p => !/\bPM\b/.test(p)) && !drawer;
    console[ok ? 'log' : 'error'](`smoke: without the PM the sidebar has ${panes} pane, hints ${JSON.stringify(hints)}, PM drawer ${drawer}`);
  }
  // Missing Claude Code and Node.js (#390): the start-up card with both links, gone once closed.
  {
    const card = showMissing([
      { name: 'Claude Code', why: 'Every pane runs a Claude Code session.', url: 'https://docs.anthropic.com/en/docs/claude-code/setup' },
      { name: 'Node.js', why: 'The CTO, the PM and the leads change the boards with node.', url: 'https://nodejs.org/en/download' },
    ]);
    await wait(300); await deck.smokeShot('missing-tools');
    const links = [...card.querySelectorAll('.rq-row .btn')].map(b => b.textContent);
    card.querySelector('.rq-x').click();
    const ok = links.join() === 'Get Claude Code,Get Node.js' && !document.getElementById('reqcard') && showMissing([]) === null;
    console[ok ? 'log' : 'error'](`smoke: missing-tools card links ${JSON.stringify(links)}, closes ${!document.getElementById('reqcard')}`);
  }
  app.view = 'settings'; render(); await wait(800);
  await deck.smokeShot('settings');
  // #408: the session names are plain text, nothing that looks like an input.
  {
    const card = [...document.querySelectorAll('.settings .pcard')].find(s => s.querySelector('h2')?.textContent === 'Sessions');
    const names = card ? [...card.querySelectorAll('.fixedname')].map(x => x.textContent) : [];
    const boxes = card ? card.querySelectorAll('.inp, input, select').length : -1;
    console[names.length === 4 && boxes === 0 ? 'log' : 'error'](`smoke: Settings session names as text ${names.join(', ')}, input-like boxes ${boxes}`);
  }
  // Models (#142, #174): pickers for the CTO, the PM (Sonnet by default) and the AI helper (Haiku), none per project.
  {
    const rows = [...document.querySelectorAll('.settings .pcard')].find(c => c.querySelector('h2')?.textContent === 'Models')?.querySelectorAll('select') || [];
    const pm = rows[1]?.value;
    console[rows.length === 3 && pm === 'sonnet' && rows[2]?.value === 'haiku' ? 'log' : 'error'](`smoke: Settings Models has ${rows.length} pickers, PM on "${pm}"`);
    // #409: a sidebar of the sections, small ones folded together; a click shows that entry's cards alone.
    document.querySelector('.setnav [data-sec="Sessions"]')?.click(); await wait(300); await deck.smokeShot('settings-models');
    const secs = [...document.querySelectorAll('.setnav button')].map(b => b.dataset.sec), shownNow = [...document.querySelectorAll('.setmain > .pcard')].filter(x => !x.hidden).map(x => x.querySelector('h2').textContent);
    console[secs.join() === 'Preferences,Projects,Sidebar and PM,Boards,Sessions,Connections,Plugins,Dashboard' && shownNow.join() === 'Models,Catch up,Status,Sessions' ? 'log' : 'error'](`smoke: Settings sidebar lists ${secs.join(', ')}; showing ${shownNow.join(', ')}`);
  }
  // Preferences (#1026), first in Settings: a theme, the spacing and the font apply at once and
  // are saved; light themes keep the terminals dark.
  {
    const root = document.documentElement, css = v => getComputedStyle(root).getPropertyValue(v).trim();
    document.querySelector('.setnav [data-sec="Preferences"]')?.click(); await wait(300);
    const swatches = document.querySelectorAll('.themes .themepick').length;
    document.querySelector('.themepick[data-pick="nord"]')?.click(); await wait(300);
    [...document.querySelectorAll('.prefs .seg button')].find(b => b.textContent === 'Spacious')?.click(); await wait(300);
    const sel = document.querySelector('.prefs select'); sel.value = 'plex'; sel.dispatchEvent(new Event('change', { bubbles: true })); await wait(400);
    await deck.smokeShot('settings-prefs');
    const nord = root.dataset.theme === 'nord' && css('--bg') === '#2e3440' && root.dataset.space === 'spacious' && /IBM Plex Sans/.test(css('--ui'));
    const saved = app.settings.theme === 'nord' && app.settings.space === 'spacious' && app.settings.font === 'plex';
    const plexLoaded = await document.fonts.load('12px "IBM Plex Sans"').then(f => f.length > 0, () => false);
    app.view = 'home'; render(); await wait(800); await deck.smokeShot('theme-nord');
    app.saveSettings({ ...app.settings, theme: 'graphite-light', space: 'normal', font: 'inter' }); await wait(500);
    app.view = 'home'; render(); await wait(800); await deck.smokeShot('theme-light');
    app.view = 'single'; app.single = picks[0]; render(); await wait(800); await deck.smokeShot('theme-light-pane');
    const termBg = getComputedStyle(document.querySelector('.pane .body:has(.termhost)') || root).backgroundColor;
    app.saveSettings({ ...app.settings, theme: 'graphite' }); await wait(500);
    const back = root.dataset.theme === 'graphite' && css('--bg') === '#0e0e10';
    const ok = swatches === 10 && nord && saved && plexLoaded && termBg === 'rgb(11, 11, 12)' && back;
    console[ok ? 'log' : 'error'](`smoke: Preferences ${swatches} themes, Nord + Spacious + IBM Plex Sans applied ${nord}, saved ${saved}, Plex loaded ${plexLoaded}, light theme terminal ${termBg}, back to Graphite ${back}`);
    app.view = 'settings'; render(); await wait(400);
  }
  // In-app updates (#1088): a downloaded version shows "Update ready" in the title bar, which
  // asks before restarting; Settings shows the version. A smoke run never checks for updates.
  {
    const keepConfirm = window.confirm; let asked = '';
    window.confirm = m => { asked = String(m); return true; };
    await deck.updateFake('9.9.9'); await wait(400);
    const label = document.querySelector('#titlebar .updbtn')?.textContent || '';
    await deck.smokeShot('update-ready');
    document.querySelector('#titlebar .updbtn')?.click(); await wait(400);
    const st = await deck.updateState();
    window.confirm = keepConfirm;
    app.view = 'settings'; render(); await wait(300);
    document.querySelector('.setnav [data-sec="Preferences"]')?.click(); await wait(300);
    const row = [...document.querySelectorAll('.prefs .opt')].find(o => o.querySelector('b')?.textContent === 'Version')?.textContent || '';
    await deck.updateFake(''); await wait(300);
    const gone = !document.querySelector('#titlebar .updbtn');
    const ok = label === 'Update ready: v9.9.9' && /Restart FocusShell to install v9\.9\.9/.test(asked) && st.installAsked === true && /v\d+\.\d+\.\d+/.test(row) && gone;
    console[ok ? 'log' : 'error'](`smoke: update button "${label}", asks "${asked.slice(0, 50)}", install asked ${st.installAsked}, Settings row "${row.slice(0, 80)}", gone after ${gone}`);
  }
  // First run (#1061): with no project the window is the setup wizard under a title bar with
  // Settings alone: Welcome, Connect your projects (several folders at once), Check Claude Code,
  // All set; then the app. With no project after it, the Board shows Connect your projects;
  // Settings lists connected projects with remove.
  {
    const DEMO4 = ['FocusTimer', 'Habitly', 'NoteNest', 'RecipeScale'], dirs = DEMO4.map(n => `D:\\FocusShellDemo\\projects\\${n}`);
    const keepProjects = app.projects, shown = sel => [...document.querySelectorAll(sel)].some(e => e.getClientRects().length > 0);
    const stepNo = () => document.querySelector('#home .setupcard')?.dataset.step, go = k => document.querySelector(`#home .setupfoot [data-go="${k}"]`)?.click();
    app.settings = { ...app.settings, setupDone: false, tourDone: false };
    app.projects = []; app.view = 'home'; app.startSetup(); await wait(600);
    const chrome = ['#tabs', '#side', '#status', '#btnLayout', '.plugbtn', '#btnNew'].filter(shown), settingsBtn = shown('#btnSettings');
    const s1 = stepNo() === '1' && !!document.querySelector('#home .setupcard .art svg') && !!document.querySelector('#home [data-go="skip"]');
    await deck.smokeShot('setup-1');
    go('next'); await wait(300);
    const s2 = stepNo() === '2' && document.querySelector('#home .bempty [data-act="connect"]')?.textContent === 'Connect your projects';
    app.smokePick = dirs;
    document.querySelector('#home .bempty [data-act="connect"]')?.click(); await wait(1500);
    const listed2 = [...document.querySelectorAll('#home .setupnames span')].map(s => s.textContent), stillSetup = stepNo() === '2';
    await deck.smokeShot('setup-2');
    // #1106: a chip's x disconnects that project at once; connecting again brings it back.
    document.querySelector('#home .setupnames [data-rm="FocusTimer"]')?.click(); await wait(800);
    const removed = ![...document.querySelectorAll('#home .setupnames span')].some(s => s.textContent === 'FocusTimer') && !app.projects.some(p => p.name === 'FocusTimer') && stepNo() === '2';
    await deck.smokeShot('setup-2-removed');
    document.querySelector('#home .bempty [data-act="connect"]')?.click(); await wait(1200);
    const reAdded = [...document.querySelectorAll('#home .setupnames span')].some(s => s.textContent === 'FocusTimer');
    console[removed && reAdded ? 'log' : 'error'](`smoke: setup chip x removed FocusTimer ${removed}, connecting again brought it back ${reAdded}`);
    go('next'); await wait(800);
    const s3 = stepNo() === '3' && /found, signed in/.test(document.querySelector('#home .setupchk')?.textContent || '');
    await deck.smokeShot('setup-3');
    go('next'); await wait(300);
    const s4 = stepNo() === '4' && document.querySelector('#home [data-go="next"]')?.textContent === 'Open the Board' && !document.querySelector('#home [data-go="skip"]');
    go('next'); await wait(1200);
    const appBack = !document.body.classList.contains('startonly') && !!document.querySelector('#home .bcols, #home .bcol') && shown('#tabs') && app.settings.setupDone === true;
    const got = DEMO4.filter(n => app.projects.some(p => p.name === n));
    // The walkthrough (#1036) follows the setup once: a ring and a card per part; Skip ends it
    // for good; Settings > Preferences replays it, and Next through to Done ends it too.
    {
      const tourStep = () => document.querySelector('.tour .tourn')?.textContent || '', tgo = k => document.querySelector(`.tour [data-go="${k}"]`)?.click();
      for (let t = 0; t < 20 && !document.querySelector('.tour'); t++) await wait(200);
      const first = tourStep(), title1 = document.querySelector('.tour h3')?.textContent;
      await deck.smokeShot('tour-1');
      tgo('next'); await wait(400); tgo('next'); await wait(400);
      const third = tourStep(), title3 = document.querySelector('.tour h3')?.textContent;
      await deck.smokeShot('tour-3');
      tgo('skip'); await wait(400);
      const skipped = !document.querySelector('.tour') && app.settings.tourDone === true;
      app.view = 'settings'; render(); await wait(300);
      document.querySelector('.setnav [data-sec="Preferences"]')?.click(); await wait(300);
      const replayBtn = document.querySelector('.prefs [data-act="tour"]');
      replayBtn?.click();
      for (let t = 0; t < 15 && !document.querySelector('.tour'); t++) await wait(200);
      const replay = /^1 of \d+$/.test(tourStep()), total = Number(tourStep().split(' of ')[1]) || 0;
      if (!replay) console.error(`smoke: walkthrough replay detail: button ${!!replayBtn}, Board shown ${!!document.querySelector('#home .pp-board')}, CTO pane ${!!document.querySelector('#side .sidepane')}, layer ${!!document.querySelector('.tour')}`);
      for (let t = 0; t < total; t++) { tgo('next'); await wait(300); }
      const finished = !document.querySelector('.tour');
      const tourOk = /^1 of [5-7]$/.test(first) && title1 === 'Your CTO' && third.startsWith('3 of') && title3 === 'The Board' && skipped && replay && finished;
      console[tourOk ? 'log' : 'error'](`smoke: walkthrough after setup "${first}" ${title1}, step 3 ${title3}, Skip ends it and marks it done ${skipped}, replayed from Settings ${replay} (${total} steps), Done ends it ${finished}`);
    }
    // Settings: the connected projects, each with a remove.
    app.view = 'settings'; render(); await wait(300);
    document.querySelector('.setnav [data-sec="Projects"]')?.click(); await wait(600);
    const inSettings = [...document.querySelectorAll('.plist .plrow .plname')].map(c => c.textContent), more = document.querySelector('.plist .pladd [data-act="connect"]')?.textContent;
    await deck.smokeShot('settings-projects');
    // #1115: a project's model is saved and used at its next start, the change says so with
    // Restart now / Later when its lead is open, and remove asks Remove / Cancel first.
    {
      const p = 'FocusTimer', row = () => document.querySelector(`.plist .plrow[data-proj="${p}"]`);
      const sel = row()?.querySelector('select.plmodel');
      if (sel) { sel.value = 'haiku'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      await wait(700);
      const saved = (app.projects.find(x => x.name === p) || {}).model === 'haiku' && row()?.querySelector('select.plmodel')?.value === 'haiku';
      const notice = [...document.querySelectorAll('#toasts .toast')].map(t => t.textContent).find(t => t.includes(`${p} will use Haiku from its next start`)) || '';
      await deck.smokeShot('settings-project-model');
      row()?.querySelector('[data-act="remove"]')?.click(); await wait(300);
      const asks = row()?.textContent || '';
      row()?.querySelector('[data-act="remove-no"]')?.click(); await wait(300);
      const kept = !!row() && !!row().querySelector('select.plmodel');
      await deck.setProjectModel(p, '');
      const ok = saved && !!notice && /Remove FocusTimer\? Its folder stays on disk\./.test(asks) && /Remove/.test(asks) && /Cancel/.test(asks) && kept;
      console[ok ? 'log' : 'error'](`smoke: project model saved ${saved}, notice "${notice.slice(0, 70)}", remove asks "${asks.slice(0, 60)}", Cancel keeps it ${kept}`);
    }
    for (const n of DEMO4) await deck.removeProject(n);
    // No project after setup (Skip setup): the Board's one button.
    app.projects = []; app.view = 'home'; render(); await wait(600);
    const emptyBtn = document.querySelector('#home .bempty [data-act="connect"]')?.textContent, emptyArt = !!document.querySelector('#home .bempty .art svg');
    await deck.smokeShot('board-empty');
    app.smokePick = undefined; app.projects = keepProjects;
    const ok = !chrome.length && settingsBtn && s1 && s2 && DEMO4.every(n => listed2.includes(n)) && stillSetup && s3 && s4 && appBack && got.length === 4
      && DEMO4.every(n => inSettings.includes(n)) && more === 'Connect more' && emptyBtn === 'Connect your projects' && emptyArt;
    console[ok ? 'log' : 'error'](`smoke: setup wizard other chrome ${JSON.stringify(chrome)}, Settings ${settingsBtn}, steps ${[s1, s2, s3, s4].join('/')}, connected ${JSON.stringify(listed2)} and stayed on step 2 ${stillSetup}, app back ${appBack} with ${got.length} projects, Settings lists ${JSON.stringify(inSettings)} with "${more}", empty Board "${emptyBtn}" with art ${emptyArt}`);
    app.view = 'settings'; render(); await wait(300);
  }
  await openGroup('Mobile'); await wait(1500);
  await deck.smokeShot('group');
  app.pmOpen = true; render(); await wait(1200);
  await deck.smokeShot('pm-over');
  app.pmOpen = false;
  // Group tabs by right-click (#104): two tabs in the main CTO's split, right-click one,
  // New group, and both must land in it with the group's CTO beside them.
  const pair = picks.slice(0, 2), keepGroups = app.groups;
  app.ctx = null; app.splitSet = pair; app.layoutId = autoLayout(2); app.view = 'split'; render(); await wait(800);
  const tabOf = n => [...document.querySelectorAll('#tabs .tab')].find(t => t.querySelector(':scope > span:not(.st-dot):not(.cb):not(.x)')?.textContent === n);
  tabOf(pair[0]).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await wait(400); await deck.smokeShot('tab-menu');
  document.querySelector('.tabmenu .tmi.new').click(); await wait(200);
  const nameIn = document.querySelector('.tabmenu input'); nameIn.value = 'Tools';
  nameIn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(1500);
  const left = pair.filter(n => groupOf(app.groups, n) !== 'Tools');
  if (left.length) console.error(`smoke: tab menu left ${left.join(', ')} out of the new group`);
  if (!document.querySelector('.pane.manager')) console.error('smoke: the new group did not show its CTO');
  await deck.smokeShot('tab-group');
  app.groups = keepGroups;
  // Making a group in the Groups panel (#1024): Save what is open in one click, named after
  // the projects on screen; New group... with chips, the ones on screen ticked; rename by a click.
  {
    app.ctx = null; app.splitSet = pair; app.layoutId = autoLayout(2); app.view = 'split'; render(); await wait(600);
    app.view = 'home'; render(); await wait(500);
    const gtool = () => document.querySelector('#home .ptool[aria-label^="Show groups"]');
    gtool()?.click(); await wait(400);
    const save = [...document.querySelectorAll('.gnew')].find(b => b.textContent.startsWith('Save what is open'));
    const saveText = save?.textContent || '';
    save?.click(); await wait(500);
    const saved = app.groups.find(g => pair.every(p => g.projects.includes(p)));
    [...document.querySelectorAll('.gnew')].find(b => b.textContent === 'New group...')?.click(); await wait(300);
    const ticked = [...document.querySelectorAll('.gpick .gchip.on')].map(b => b.firstChild?.nodeName === 'svg' ? b.childNodes[1].textContent : b.textContent);
    const other = [...document.querySelectorAll('.gpick .gchip:not(.on)')].find(b => !b.querySelector('small'));
    const otherName = other ? other.childNodes[0].textContent : '';
    other?.click(); await wait(300);
    await deck.smokeShot('group-new');
    document.querySelector('.gpick .btn.primary')?.click(); await wait(500);
    const made = !!otherName && app.groups.some(g => g.projects.includes(otherName));
    const nm = [...document.querySelectorAll('.preset .gname')].find(s => saved && s.textContent === saved.name);
    nm?.click(); await wait(200);
    const box = document.querySelector('.preset .grename');
    if (box) { box.value = 'Daily'; box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(400); }
    const renamed = !!app.groups.find(g => g.name === 'Daily' && pair.every(p => g.projects.includes(p)));
    console[saved && made && renamed ? 'log' : 'error'](`smoke: groups panel "${saveText}" made ${saved && saved.name}, New group ticked ${JSON.stringify(ticked)} and made one with ${otherName} ${made}, renamed to Daily ${renamed}`);
    gtool() || document.querySelector('#home .ptool[aria-label^="Hide groups"]')?.click();
    app.groups = keepGroups;
  }
  // The Code pane, opened the way the owner does: the </> button in the lead pane's header (#97).
  app.pmOpen = false; app.ctx = null; app.view = 'single'; app.single = picks[0]; render(); await wait(300);
  document.querySelector('.pane:not(.manager) .ph .pa button[title="Open VS Code beside the lead"]').click();
  for (let i = 0; i < 90 && !document.querySelector('#codelayer .codeview[style*="visible"]'); i++) await wait(1000);
  if (!C.isOpen(picks[0])) console.error('smoke: the pane header </> button did not open the Code pane');
  await wait(4000); await deck.smokeShot('code'); C.closeCode(picks[0]);
  // A start that hangs (#1114): after each timeout the pane says it is trying again with the
  // try's number, up to four tries, then shows an error with Retry and Open in VS Code.
  {
    const p1 = picks[1], text = () => document.querySelector(`.codeslot[data-code="${CSS.escape(p1)}"] .codewait`)?.textContent || '';
    const T0 = 6000; // a new pane in the hidden window takes a few seconds to load its first page
    await deck.codeHang(true); C.setStartTimeout(T0);
    app.view = 'single'; app.single = p1; render(); await wait(200);
    const t0 = Date.now(), until = ms => wait(Math.max(0, t0 + ms - Date.now()));
    C.openCode(p1, deck, render); render(); await wait(500);
    const starting = /Starting VS Code/.test(text()), seen = [];
    let downloading = false;
    while (!downloading && Date.now() < t0 + T0 - 300) { await wait(150); downloading = /downloading its server/.test(text()); }
    for (let k = 1; k <= 3; k++) { await until(k * T0 + T0 / 2); seen.push((text().match(/Try (\d) of 4/) || [])[1] || '-'); }
    await deck.smokeShot('code-retrying');
    await until(4 * T0 + 1500);
    const failed = /did not start .* after 4 tries/.test(text()), acts = [...document.querySelectorAll(`.codeslot[data-code="${CSS.escape(p1)}"] .codeacts .btn`)].map(b => b.textContent);
    // The error shows the steps, the one it stopped at marked, and the requirements, checked.
    await wait(600);
    const stopped = document.querySelector(`.codeslot[data-code="${CSS.escape(p1)}"] .cwst.failed`)?.dataset.step || '';
    const reqs = [...document.querySelectorAll(`.codeslot[data-code="${CSS.escape(p1)}"] .cwrq`)].map(r => `${r.dataset.req}:${r.className.split(' ')[1]}`);
    await deck.smokeShot('code-hung');
    C.closeCode(p1); C.setStartTimeout(60000); await deck.codeHang(false); render(); await wait(200);
    // The "downloading" step is shown only once the page has loaded; this hidden test window
    // does not load the stand-in page, so that step is checked by a real first start instead
    // (#1114: FOCUSSHELL_CODE_CLI_DIR set to an empty folder shows it, then VS Code).
    const ok = starting && seen.join() === '2,3,4' && failed && acts.join() === 'Retry,Open in VS Code' && (stopped === 'download' || stopped === 'open') && reqs.join() === 'installed:ok,version:ok,internet:ok,port:ok,firewall:info';
    console[ok ? 'log' : 'error'](`smoke: hung Code pane: starting ${starting}, says VS Code is downloading its server ${downloading}, tries shown ${seen.join(', ')}, then the error ${failed} with ${JSON.stringify(acts)}, stopped at ${stopped}, requirements ${reqs.join(' ')}`);
  }
  // A Markdown file of that project opens in its VS Code pane (#69).
  const base = (proj(picks[0]) || {}).path || '';
  for (const f of [`${base}\\README.md`, `${base}\\CLAUDE.md`]) {
    if ((await deck.projectForFile(f)) !== picks[0]) continue;
    await openMd(f);
    for (let i = 0; i < 90 && !document.querySelector('#codelayer .codeview[style*="visible"]'); i++) await wait(1000);
    await wait(6000); await deck.smokeShot('code-md');
    // The page is VS Code, not the server's "Forbidden." (#201).
    const v = document.querySelector('#codelayer .codeview');
    const page = v ? await v.executeJavaScript("(document.querySelector('.monaco-workbench') ? 'workbench' : '') + '|' + document.body.innerText.slice(0, 40)").catch(e => `|${e.message}`) : '|no view';
    console[page.startsWith('workbench') ? 'log' : 'error'](`smoke: a clicked .md file shows ${page.startsWith('workbench') ? 'VS Code' : `"${page.slice(1)}"`} in the Code pane`);
    // A second file of the same project opens as a new tab in that pane, not a reload (#365).
    let second = null;
    for (const x of [`${base}\\CLAUDE.md`, `${base}\\README.md`, `${base}\\package.json`, `${base}\\.gitignore`]) if (!second && x !== f && await deck.fileAt(x)) second = x;
    if (v && second) {
      let navs = 0;
      const nav = e => { if (e.isMainFrame && !e.isInPlace) navs++; };
      v.addEventListener('did-start-navigation', nav);
      await openMd(second);
      const tabs = () => v.executeJavaScript("[...document.querySelectorAll('.tabs-container .tab')].map(t => t.getAttribute('aria-label') || t.textContent).join('|')").catch(() => '');
      const name = second.split('\\').pop(), first = f.split('\\').pop();
      let seen = '';
      for (let i = 0; i < 30 && !(seen = await tabs()).includes(name); i++) await wait(500);
      v.removeEventListener('did-start-navigation', nav);
      await wait(1000); await deck.smokeShot('code-md-second');
      const ok = navs === 0 && seen.includes(name) && seen.includes(first) && document.querySelector('#codelayer .codeview') === v;
      console[ok ? 'log' : 'error'](`smoke: a second file of the same project opened as a new tab without reloading the pane: ${ok} (reloads ${navs}, tabs ${seen.slice(0, 160)})`);
    } else console.error('smoke: no second file to open in the Code pane');
    C.closeCode(picks[0]); break;
  }
  // Any file clicked in a lead's pane opens in its built-in Code pane (#126), here a .js file.
  const js = 'D:\\SideProjects\\FocusShell\\app\\main.js';
  if (await app.openFile(picks[0], js)) {
    for (let i = 0; i < 90 && !document.querySelector('#codelayer .codeview'); i++) await wait(500);
    const src = (document.querySelector('#codelayer .codeview') || {}).src || '';
    if (!decodeURIComponent(decodeURIComponent(src)).includes('/app/main.js')) console.error('smoke: a clicked .js file did not open in the Code pane', src);
    else console.log('smoke: a clicked .js file opened in the Code pane');
    C.closeCode(picks[0]);
  }
  // A file in no project, linked from an item (#292), opens in a Code pane beside the lead of
  // that item's project, with the file's own folder as the workspace; right-click on a file
  // link offers its folder.
  {
    const outsideFile = 'C:\\Windows\\win.ini';
    if (!(await deck.projectForFile(outsideFile)) && await app.openFile(null, outsideFile, picks[1])) {
      for (let i = 0; i < 90 && !(C.isOpen(picks[1]) && (document.querySelector('#codelayer .codeview') || {}).src); i++) await wait(500);
      const src = decodeURIComponent(decodeURIComponent((document.querySelector('#codelayer .codeview') || {}).src || ''));
      const ok = C.isOpen(picks[1]) && /win\.ini/i.test(src) && /folder=\/c:\/Windows(&|$)/i.test(src);
      console[ok ? 'log' : 'error'](`smoke: a file in no project opened beside ${picks[1]}'s lead: ${ok} (${src.slice(0, 160)})`);
      C.closeCode(picks[1]);
    } else console.error('smoke: a file in no project did not open beside the item\'s project');
    const p = linkedText('p', {}, `See ${outsideFile} for it`);
    document.body.append(p);
    p.querySelector('.tlink').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
    const menu = document.querySelector('.linkmenu');
    console[menu && /Open containing folder/.test(menu.textContent) ? 'log' : 'error'](`smoke: right-click on a file link offers its folder: ${!!menu}`);
    if (menu) await deck.smokeShot('link-menu');
    dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); p.remove();
  }
  // A binary file clicked in the CTO's pane is shown in Explorer, not the Code pane, with no
  // error toast (#166); a path through the G: link to D: still finds its project. A video
  // editor's project file goes the same way (#317), and a web page (#318).
  app.view = 'single'; app.single = MAIN; render(); await wait(1000);
  for (const bin of ['G:\\SideProjects\\FocusShell\\app\\build\\icon.png', 'G:\\SideProjects\\FocusShell\\state\\smoke\\intro-rough-2.editbay', 'G:\\SideProjects\\FocusShell\\tavern\\demos\\room\\index.html']) {
    const { row } = T.cursorRow(MAIN);
    T.write(MAIN, `\r\n  Built: ${bin}\r\n`); await wait(500);
    const link = (await T.linksOnRow(MAIN, row + 1)).find(l => l.text === bin);
    if (link) { link.activate(); await wait(1500); }
    const errs = [...document.querySelectorAll('#toasts .toast.err')].map(t => t.textContent);
    const viaG = await deck.projectForFile('G:\\SideProjects\\FocusShell\\CLAUDE.md');
    const ok = link && !errs.length && !document.querySelector('#codelayer .codeview[style*="visible"]') && viaG === 'FocusShell';
    console[ok ? 'log' : 'error'](`smoke: a clicked ${bin.slice(bin.lastIndexOf('.'))} ${link ? 'link' : 'NO LINK'}, error toasts ${JSON.stringify(errs)}, G: path project ${viaG}`);
  }
  // Find in a pane (#360): Ctrl+Shift+F opens the bar, typing counts matches across the
  // scrollback, Enter and Shift+Enter step through them, Esc closes it and the terminal has
  // the focus again. Five marked rows, the first pushed far up the scrollback.
  {
    T.write(MAIN, '\r\n  findme-360 first\r\n' + '  filler\r\n'.repeat(120) + '  findme-360 a\r\n  findme-360 b\r\n  FINDME-360 c\r\n  findme-360 d\r\n');
    await wait(500);
    const ta = T.cursorRow(MAIN).el.querySelector('textarea');
    ta.focus();
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', code: 'KeyF', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await wait(200);
    const { el } = T.findState(MAIN), input = el.querySelector('input'), count = () => el.querySelector('.fcount').textContent;
    const opened = T.findState(MAIN).open && document.activeElement === input;
    input.value = 'findme-360'; input.dispatchEvent(new Event('input')); await wait(400);
    const typed = count();
    await deck.smokeShot('find');
    const key = (k, shift = false) => input.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true }));
    key('Enter'); await wait(200); const next = count();
    key('Enter', true); await wait(200); const back = count();
    el.querySelector('.ftog').click(); await wait(300); const cased = count();
    el.querySelector('.ftog').click(); await wait(200);
    key('Escape'); await wait(200);
    const closed = !T.findState(MAIN).open && document.activeElement === ta;
    const ok = opened && /^\d+ of 5$/.test(typed) && next !== typed && back === typed && /of 4$/.test(cased) && closed;
    const said = `smoke: find in a pane opened ${opened}, typed ${typed}, Enter ${next}, Shift+Enter ${back}, match case ${cased}, Esc closed ${closed}`;
    if (!ok) deck.smokeFail(said); else console.log(said);
  }
  deck.write(MAIN, 'mode con\r'); await wait(1200);
  await deck.smokeShot('cto');
  // Sample questions for the whiteboard, in memory only.
  const keep = { ...app.tasksMd }, loose = app.projects.map(p => p.name).filter(n => !groupOf(app.groups, n) && n !== ME).slice(0, 2);
  loose.forEach((n, i) => { app.tasksMd[n] = `${app.tasksMd[n] || '# x'}
- [?] #901 Pick the export format (2026-10-0${i + 1}, lead-${n}) -> needs you
  > Result: NEEDS YOU #901 | Which format for the export? | options: MP4, WebM, both | suggest: MP4
  > Review: http://100.101.102.103:8731/tmp/export/review.mp4 and http://localhost:8731/tmp/export/review.mp4
- [?] #902 Login screen layout (2026-09-2${i}, lead-${n}) -> needs you
  > Result: NEEDS YOU: a) one column, b) two columns with the logo left; suggest a
- [?] #903 Build the release APK (2026-10-04, lead-${n}) -> waiting on a prompt
  > Result: NEEDS YOU #903 | lead-${n} is stopped on a prompt in its own pane: Do you want to proceed?. Answer it in that pane.
- [?] #904 Simpler presets (2026-10-05, lead-${n}) -> pick a flow
  > NEEDS YOU: which simpler way to create a group? Demo http://127.0.0.1:5391/groups.html (today 5 steps) | options: A Save what is open, B New group card, C both | suggest: C`; });
  wbCounts(); document.querySelector('.wbbtn').click(); await wait(800);
  // A lead's prompt the CTO put on the list (#146) shows as a card with its question.
  const wbText = document.querySelector('.wbox')?.textContent || '';
  console[wbText.includes('is stopped on a prompt in its own pane') ? 'log' : 'error']('smoke: Waiting on you shows the lead stopped on a prompt');
  // #416: a question card shows the link it is about, once, as the PC address.
  {
    const c901 = [...document.querySelectorAll('.wbox .wbcard')].find(x => /#901/.test(x.querySelector('.wbid')?.textContent || ''));
    const hrefs = c901 ? [...c901.querySelectorAll('.lchip')].map(a => a.title) : [];
    console[hrefs.join() === 'http://localhost:8731/tmp/export/review.mp4' ? 'log' : 'error'](`smoke: question card links ${JSON.stringify(hrefs)}`);
    // #1000: it opens with a TLDR line; the full question is folded until "more".
    const line = c901?.querySelector('.wbtldr span')?.textContent || '', folded = !!c901?.querySelector('.wbmore')?.hidden;
    console[/ #901 Pick the export format: Which format for the export\?$/.test(line) && folded ? 'log' : 'error'](`smoke: card TLDR "${line}", details folded ${folded}`);
    // #1045: a web link inside the question text is a link.
    const c904 = [...document.querySelectorAll('.wbox .wbcard')].find(x => /#904/.test(x.querySelector('.wbid')?.textContent || ''));
    const inText = c904 ? [...c904.querySelectorAll('.wbq a.tlink')].map(a => a.textContent) : [];
    console[inText.includes('http://127.0.0.1:5391/groups.html') ? 'log' : 'error'](`smoke: Waiting on you question text links ${JSON.stringify(inText)}`);
  }
  // #414: dictating into a card, then a pause, sends nothing; the words wait in the box for Send.
  {
    const wcard = [...document.querySelectorAll('.wbox .wbcard')].find(x => x.querySelector('.tdsay') && x.querySelector('.mic'));
    if (wcard) {
      wcard.querySelector('.mic').click(); await wait(200);
      const box = wcard.querySelector('.tdsay'), before = wcard.isConnected;
      box.value = 'MP4 please, but'; box.dispatchEvent(new Event('input', { bubbles: true })); await wait(3500);
      const stayed = before && wcard.isConnected && box.value === 'MP4 please, but', hint = wcard.querySelector('.wblisten').textContent;
      wcard.querySelector('.mic').click(); await wait(200);
      const stopped = !wcard.classList.contains('listen') && box.value === 'MP4 please, but';
      box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true }));
      console[stayed && stopped && /Send/.test(hint) ? 'log' : 'error'](`smoke: card dictation after a 3.5 s pause kept the text unsent ${stayed}, hint "${hint}", second mic click stops without sending ${stopped}`);
    } else console.error('smoke: no whiteboard card with an answer box');
  }
  // #1083: the talk key held over Waiting on you starts one dictation; its repeats do not
  // toggle it off and on (each toggle pressed Win+H and could leave the voice bar open).
  {
    const key = repeat => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', ctrlKey: true, shiftKey: true, repeat, bubbles: true, cancelable: true }));
    key(false); await wait(150);
    const after1 = document.querySelectorAll('.wbox .wbcard.listen').length;
    for (let i = 0; i < 5; i++) { key(true); await wait(60); }
    const afterHold = document.querySelectorAll('.wbox .wbcard.listen').length;
    document.querySelector('.wbox .wbcard.listen .mic')?.click(); await wait(150);
    const stopped = document.querySelectorAll('.wbox .wbcard.listen').length;
    console[after1 === 1 && afterHold === 1 && stopped === 0 ? 'log' : 'error'](`smoke: talk key held over Waiting on you: listening cards after the press ${after1}, after 5 repeats ${afterHold}, after the mic ${stopped}`);
  }
  await deck.smokeShot('whiteboard'); closeWhiteboard(); app.tasksMd = keep; wbCounts();
  // Maybe missed (#367): a CTO reply with three numbered questions, answered about the first
  // within seconds and then a new topic, gives two cards with their reasons. Seen clears one,
  // an answer later in chat clears the other, and an item on Waiting on you never shows.
  {
    const t0 = Date.now() - 120e3, at = s => new Date(t0 + s * 1000).toISOString();
    const reply = 'Brewlog #9280 is built. Three things from you:\n1. Thumbnail: keep 3.jpg or switch to the new one for the upload?\n2. Where does 4.jpg go: the end card or the description?\n3. FocusShell #9364: OK to ship the tray icon change tonight?';
    const line = (s, who, text) => JSON.stringify(who === 'cto' ? { type: 'assistant', timestamp: at(s), message: { content: [{ type: 'text', text }] } } : { type: 'user', timestamp: at(s), origin: { kind: 'human' }, message: { content: text } });
    const log = [line(0, 'cto', reply), line(5, 'owner', 'keep 3.jpg thumbnail for the upload. New idea: the tavern robots should wave when a lead finishes')];
    const cards = () => [...document.querySelectorAll('.missbox .wbcard.miss')];
    const count = () => Number((document.querySelector(`.missbtn[data-miss="${MAIN}"] b`) || {}).textContent);
    app.view = 'single'; app.single = MAIN; render(); await wait(500);
    await deck.missedFake(log.join('\n'), []); await refreshMissed();
    document.querySelector(`.missbtn[data-miss="${MAIN}"]`).click(); await wait(500);
    const first = cards().map(c => ({ title: c.querySelector('.wbtitle').textContent, why: c.querySelector('.mswhy').textContent }));
    await deck.smokeShot('missed');
    const two = first.length === 2 && count() === 2 && first.every(c => /moved on after 5 s/.test(c.why)) && /tray icon/.test(first[0].title) && /4\.jpg/.test(first[1].title);
    // Maybe missed is not a status, so the Board has no column for it in any view (#1016);
    // any column there folds like Done.
    closeMissedBoard(); app.view = 'home'; render(); await wait(600);
    let onBoard = 0;
    for (const v of ['By status', 'By kind']) {
      const tab = [...document.querySelectorAll('.btab')].find(b => b.textContent.startsWith(v));
      if (tab) { tab.click(); await wait(400); }
      onBoard += document.querySelectorAll('.bcol[data-col="missed"], .wbcard.miss').length;
    }
    await deck.smokeShot('missed-board');
    document.querySelector('.bcol[data-col="ask"] .bfold').click(); await wait(300);
    const folds = !!document.querySelector('.brail[data-col="ask"]');
    await deck.smokeShot('board-folded');
    document.querySelector('.brail[data-col="ask"]').click(); await wait(300);
    const unfolds = !!document.querySelector('.bcol[data-col="ask"]:not(.brail)');
    console[onBoard === 0 && folds && unfolds ? 'log' : 'error'](`smoke: maybe missed on the Board ${onBoard} (none expected), a column folds ${folds} and opens again ${unfolds}`);
    app.view = 'single'; app.single = MAIN; render(); await wait(500);
    document.querySelector(`.missbtn[data-miss="${MAIN}"]`).click(); await wait(500);
    [...cards()[0].querySelectorAll('.msacts .btn')].find(b => b.textContent === 'Seen, not needed').click(); await wait(500);
    const afterSeen = cards().length === 1 && count() === 1;
    log.push(line(60, 'owner', '4.jpg goes on the end card, not in the description'));
    await deck.missedFake(log.join('\n'), []); await refreshMissed(); await wait(300);
    const afterChat = cards().length === 0 && count() === 0 && !!document.querySelector('.missbox .wbempty');
    closeMissedBoard();
    // On Waiting on you as a NEEDS YOU (by number) and as a lead's question (by words): never here.
    const keep2 = app.tasksMd, t1 = Date.now() - 60e3, at1 = s => new Date(t1 + s * 1000).toISOString();
    app.tasksMd = { ...keep2, Brewlog: `${keep2.Brewlog || ''}\n- [?] #9281 Badge colours (2026-10-15, cto) -> NEEDS YOU #9281 | which colour for the AFTER badge? | options: green, red\n` };
    const again = 'Two things:\n1. Brewlog #9281: which colour for the AFTER badge, green or red?\n2. Should the robots wave when a lead finishes?';
    const log2 = [JSON.stringify({ type: 'assistant', timestamp: at1(0), message: { content: [{ type: 'text', text: again }] } }),
      JSON.stringify({ type: 'user', timestamp: at1(3), origin: { kind: 'human' }, message: { content: 'Completely different thing: the dashboard clock is one hour off today' } })];
    await deck.missedFake(log2.join('\n'), []); wbCounts(); await refreshMissed();
    const before = count();
    app.tasksMd = { ...app.tasksMd, FocusShell: `${keep2.FocusShell || ''}\n- [?] #9990 Robots (2026-10-15, cto) -> NEEDS YOU #9990 | should the tavern robots wave when a lead finishes?\n` };
    wbCounts(); await refreshMissed();
    const noDupes = before === 1 && count() === 0;
    app.tasksMd = keep2; wbCounts();
    // A card shows its options and the suggestion as chips (#1033, #1038: split at the letters,
    // never inside brackets), and Seen all clears every card at once.
    const t3 = Date.now() - 30e3, at3 = s => new Date(t3 + s * 1000).toISOString();
    const ask3 = 'Two more:\n1. Which board layout should ship? Demo http://127.0.0.1:5391/groups.html options: (a) two columns (wide, roomy), (b) one column, (c) tabs; suggest a\n2. Should the dock open on the left side by default?';
    await deck.missedFake([JSON.stringify({ type: 'assistant', timestamp: at3(0), message: { content: [{ type: 'text', text: ask3 }] } }),
      JSON.stringify({ type: 'user', timestamp: at3(2), origin: { kind: 'human' }, message: { content: 'Unrelated: the tavern lights look great tonight' } })].join('\n'), []);
    // A check already under way read the old log; an unsure match shows from the next check.
    await refreshMissed(); await refreshMissed(); await refreshMissed();
    document.querySelector(`.missbtn[data-miss="${MAIN}"]`).click(); await wait(500);
    const chips = [...document.querySelectorAll('.missbox .mschip')].map(c => c.textContent);
    await deck.smokeShot('missed-chips');
    const chipsOk = chips.length === 4 && chips[0] === 'atwo columns (wide, roomy)' && chips.some(c => /^Suggests/.test(c));
    // #1045: the web link in a card's text is a link.
    const missLinks = [...document.querySelectorAll('.missbox .wbtldr a.tlink')].map(a => a.textContent);
    console[missLinks.includes('http://127.0.0.1:5391/groups.html') ? 'log' : 'error'](`smoke: Maybe missed card text links ${JSON.stringify(missLinks)}`);
    const many = cards().length;
    document.querySelector('.missbox .msseenall')?.click(); await wait(600);
    const seenAll = many === 2 && cards().length === 0 && count() === 0;
    closeMissedBoard();
    console[chipsOk && seenAll ? 'log' : 'error'](`smoke: missed chips ${JSON.stringify(chips)} ${chipsOk}, Seen all cleared ${many} cards ${seenAll}`);
    const ok = two && afterSeen && afterChat && noDupes;
    console[ok ? 'log' : 'error'](`smoke: maybe missed gave ${first.length} cards (${first.map(c => c.why).join(' / ')}), Seen cleared one ${afterSeen}, a later answer in chat cleared the other ${afterChat}, nothing on Waiting on you shows ${noDupes}`);
  }
  // Settings > Preferences removes Maybe missed and the Tavern from the window (#1101), at
  // once, and brings them back.
  {
    const seen = sel => [...document.querySelectorAll(sel)].some(e => e.getClientRects().length > 0);
    app.view = 'single'; app.single = MAIN; render(); await wait(400);
    const before = seen(`.missbtn[data-miss="${MAIN}"]`) && seen('.tavbtn');
    app.view = 'settings'; render(); await wait(300);
    document.querySelector('.setnav [data-sec="Preferences"]')?.click(); await wait(300);
    const rowOf = t => [...document.querySelectorAll('.setmain .opt')].find(o => o.querySelector('b')?.textContent === t);
    rowOf('Show Maybe missed')?.querySelector('.sw')?.click(); await wait(300);
    rowOf('Show Tavern')?.querySelector('.sw')?.click(); await wait(300);
    const off = app.settings.showMissed === false && app.settings.showTavern === false;
    app.view = 'single'; app.single = MAIN; render(); await wait(400);
    const gone = !document.querySelector('.missbtn') && !seen('.tavbtn');
    await deck.smokeShot('missed-tavern-off');
    app.saveSettings({ ...app.settings, showMissed: true, showTavern: true }); await wait(400);
    const back = seen(`.missbtn[data-miss="${MAIN}"]`) && seen('.tavbtn');
    console[before && off && gone && back ? 'log' : 'error'](`smoke: Show Maybe missed and Show Tavern: shown before ${before}, both off saved ${off}, both gone ${gone}, back when on ${back}`);
  }
  // Status (#383): the CTO pane's header reads Waiting, Missed and Status with no "talk here";
  // Status lists the CTO's open leads with the line written for one of them.
  {
    app.view = 'single'; app.single = MAIN; render(); await wait(500);
    const head = document.querySelector(`.statbtn[data-stat="${MAIN}"]`)?.closest('.ph');
    const words = head ? [...head.querySelectorAll('.wbbtn span')].map(s => s.textContent).join(',') : '';
    const noTalk = !!head && !/talk here/.test(head.textContent);
    document.querySelector(`.statbtn[data-stat="${MAIN}"]`).click(); await wait(500);
    const lead = document.querySelector('.statbox tbody tr')?.dataset.lead || `lead-${picks[0]}`;
    closeStatus();
    await deck.leadStatusFake(lead, 'DONE #12, idle');
    document.querySelector(`.statbtn[data-stat="${MAIN}"]`).click(); await wait(700);
    const row = document.querySelector(`.statbox tbody tr[data-lead="${lead}"]`);
    const ok = words === 'Waiting,Missed,Status' && noTalk && !!row && /DONE #12, idle/.test(row.textContent) && /Last refresh/.test(document.querySelector('.statbox').textContent);
    // #413: rows A to Z, a badge per lead, and each column starting at the same x in every row.
    const rows = [...document.querySelectorAll('.statbox tbody tr')], names = rows.map(r => r.dataset.lead);
    const sorted = names.join() === [...names].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).join();
    const badges = rows.every(r => r.querySelector('.sbadge'));
    const lined = [0, 1, 2, 3].every(k => new Set(rows.map(r => Math.round(r.children[k].getBoundingClientRect().left))).size === 1);
    await deck.smokeShot('status');
    closeStatus();
    if (!ok) deck.smokeFail(`status: header "${words}", no talk here ${noTalk}, row ${row ? row.textContent : 'missing'}`);
    console[sorted && badges && lined ? 'log' : 'error'](`smoke: status header ${words}, ${rows.length} leads listed (${names.join(', ')}), A to Z ${sorted}, badges ${badges}, columns line up ${lined}`);
  }
  // #1003: the talk key held 60 s in all (on the Board, the CTO alone and a split) while boards
  // change, the page redraws and Waiting on you and Maybe missed refresh: the CTO pane
  // keeps the keyboard and never tells Claude Code it lost focus. The focus log names any cause.
  {
    const key = () => dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', ctrlKey: true, shiftKey: true, repeat: true, bubbles: true, cancelable: true }));
    const results = [], logBefore = app.focusLog().length, keepMd = { ...app.tasksMd };
    T.write(MAIN, '\x1b[?1004h'); await wait(300);
    for (const [name, show] of [['the Board', () => { app.view = 'home'; }], ['the CTO alone', () => { app.view = 'single'; app.single = MAIN; }], ['a split', () => { app.view = 'split'; }]]) {
      show(); render(); await wait(600); T.focus(MAIN); await wait(100);
      const outs = T.focusOutsSent(MAIN), hold = setInterval(key, 40), t0 = Date.now();
      let i = 0;
      while (Date.now() - t0 < 20000) {
        await wait(1000); i++;
        const p = app.projects[i % Math.max(1, app.projects.length)]?.name;
        if (p) app.tasksMd = { ...app.tasksMd, [p]: `${app.tasksMd[p] || '# x'}\n- [ ] #${9000 + i} Focus check ${i} (2026-10-18, user)` };
        // A line for the CTO waits while the owner talks (#388), so none is typed here.
        app.redrawPage(); wbCounts();
        if (i % 5 === 0) render();
      }
      clearInterval(hold);
      results.push(`${name}: kept ${T.focusedId() === MAIN}, focus-out sent ${T.focusOutsSent(MAIN) - outs}`);
    }
    T.write(MAIN, '\x1b[?1004l'); app.tasksMd = keepMd;
    const lost = app.focusLog().slice(logBefore).filter(l => /WHILE TALKING/.test(l));
    const ok = results.every(r => /kept true, focus-out sent 0/.test(r)) && !lost.length;
    console[ok ? 'log' : 'error'](`smoke: 60 s talk-key hold: ${results.join('; ')}; focus log while talking ${lost.length ? lost.join(' || ') : 'empty'}`);
    app.view = 'home'; render(); await wait(400);
  }
  // #415: inside the app, letting go of Ctrl+Shift+Space sends nothing; the words wait for the owner.
  {
    app.view = 'home'; render(); await wait(400);
    const key = (type, code) => dispatchEvent(new KeyboardEvent(type, { code, key: code === 'Space' ? ' ' : code, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    key('keydown', 'Space'); await wait(150); key('keyup', 'Space'); await wait(3000);
    const sent = [...document.querySelectorAll('#toasts .toast')].some(t => /^Sent to the /.test(t.textContent));
    console[!sent ? 'log' : 'error'](`smoke: letting go of the talk key inside the app sent nothing ${!sent}`);
  }
  // #388: a line for the CTO waits while a permission prompt is live in its pane (its Enter would
  // answer it), and goes once the prompt is gone.
  {
    deck.write(MAIN, 'cls & echo  Bash command & echo    rm -rf build & echo  Do you want to proceed? & echo  ^> 1. Yes & echo    2. No, and tell Claude what to do differently (esc)\r');
    await wait(1500);
    const how = await typeLine(deck, MAIN, 'echo held-past-the-prompt');
    await wait(2500);
    const onScreen = async () => (await T.screen(MAIN)).some(r => r.trim() === 'held-past-the-prompt');
    const heldOk = how === 'held' && !(await onScreen());
    deck.write(MAIN, 'cls\r');
    let sentAfter = false;
    for (let i = 0; i < 20 && !sentAfter; i++) { await wait(500); sentAfter = await onScreen(); }
    if (!heldOk || !sentAfter) deck.smokeFail(`cto line: during a prompt it was ${how}, kept off the pane ${heldOk}, sent once the prompt was gone ${sentAfter}`);
    console.log(`smoke: a CTO line during a permission prompt was ${how} and sent once it was gone ${sentAfter}`);
    deck.write(MAIN, 'cls\r'); await wait(800);
  }
  // A lead's prompt answered from FocusShell (#152): read off its screen, it shows as a card
  // with the prompt's own options on Home's For you and on the whiteboard, and words typed in
  // the card reach the pane (Escape, then the words and Enter).
  {
    const who = picks[1], sel = `.pcard[data-session="${who}"]`;
    deck.write(who, 'cls & echo  Bash command & echo    npm run build & echo  Do you want to proceed? & echo  ^> 1. Yes & echo    2. No, and tell Claude what to do differently (esc)\r');
    app.view = 'home'; render(); await wait(300);
    [...document.querySelectorAll('.btab')].find(b => /^By kind/.test(b.textContent)).click();
    for (let i = 0; i < 30 && !document.querySelector(`${sel} .popts button`); i++) await wait(500);
    const opts = [...document.querySelectorAll(`${sel} .popts button`)].map(b => b.textContent);
    await deck.smokeShot('home-prompt');
    app.view = 'single'; app.single = MAIN; render(); await wait(800);
    document.querySelector('.wbbtn').click(); await wait(800);
    const onBoard = !!document.querySelector(`.wbox ${sel}`);
    await deck.smokeShot('whiteboard-prompt');
    const card = document.querySelector(`.wbox ${sel}`);
    if (card) { const box = card.querySelector('textarea'); box.value = 'echo answered-from-card'; card.querySelector('.pwords .btn').click(); }
    await wait(3500); closeWhiteboard();
    const reached = (await T.screen(who)).some(r => r.trim() === 'answered-from-card');
    const ok = opts.join('|') === '1. Yes|2. No, and tell Claude what to do differently (esc)' && onBoard && reached;
    console[ok ? 'log' : 'error'](`smoke: a lead's prompt on Home with options [${opts.join(', ')}], on the whiteboard ${onBoard}, typed answer reached the pane ${reached}`);
    deck.write(who, 'cls\r'); await wait(1500);
    // #388: the card drawn for one command, then a new prompt with the same wording for another:
    // a click at once sends nothing and says so, and the card then shows the new command.
    deck.write(who, 'cls & echo  Bash command & echo    npm run build & echo  Do you want to proceed? & echo  ^> 1. Yes & echo    2. No, and tell Claude what to do differently (esc)\r');
    app.view = 'home'; render();
    for (let i = 0; i < 30 && !document.querySelector(`${sel} .popts button`); i++) await wait(500);
    deck.write(who, 'cls & echo  Bash command & echo    git push --force & echo  Do you want to proceed? & echo  ^> 1. Yes & echo    2. No, and tell Claude what to do differently (esc)\r');
    await wait(400);
    const shown = document.querySelector(`${sel} .pdetail`)?.textContent || '';
    document.querySelector(`${sel} .popts button`)?.click(); await wait(800);
    const refusedClick = /npm run build/.test(shown) && !!document.querySelector(`${sel} .pchanged`);
    for (let i = 0; i < 20 && !/git push --force/.test(document.querySelector(`${sel} .pdetail`)?.textContent || ''); i++) await wait(500);
    const redrawn = /git push --force/.test(document.querySelector(`${sel} .pdetail`)?.textContent || '');
    if (!refusedClick || !redrawn) deck.smokeFail(`prompt card: a changed prompt with the same wording, click refused ${refusedClick}, card redrawn ${redrawn}`);
    console.log(`smoke: a changed prompt with the same wording refused the click ${refusedClick} and redrew the card ${redrawn}`);
    deck.write(who, 'cls\r'); await wait(1500);
    // An answered prompt whose text is still on screen above Claude Code's input line raises
    // no card (#191).
    deck.write(who, 'cls & echo  Do you want to proceed? & echo  ^> 1. Yes & echo    2. No & echo  ^> \r');
    app.view = 'home'; render(); await wait(9000);
    const stale = !!document.querySelector(sel);
    console[stale ? 'error' : 'log'](`smoke: an answered prompt left on screen ${stale ? 'still shows as a card' : 'raises nothing'}`);
    deck.write(who, 'cls\r'); await wait(1500);
  }
  // The owner's words (#228): a request shows as a card with the exact words; Decline types
  // nothing, the button types exactly the words, a request for a closed pane types nothing,
  // and words with a line break are refused before any card shows.
  {
    const who = picks[1], req = (id, words, extra = {}) => deck.smokeWords(id, JSON.stringify({ project: who, task: 7, words, why: 'Edit a file outside its folder?', created: Date.now(), ...extra }));
    const card = id => document.querySelector(`.pcard[data-words="${id}"]`);
    deck.write(who, 'cls\r'); await wait(800);
    await req('smoke-no', 'echo should-not-appear');
    await req('smoke-yes', String.raw`echo typed-on-click D:\new\back\test`);
    const refused = await req('smoke-bad', 'echo one\necho two');
    app.view = 'home'; render(); await wait(600);
    const shown = !!card('smoke-yes') && !!card('smoke-no') && !card('smoke-bad');
    const exact = card('smoke-yes')?.querySelector('.pwordsbox')?.textContent === String.raw`echo typed-on-click D:\new\back\test`;
    await deck.smokeShot('home-words');
    [...card('smoke-no').querySelectorAll('button')].find(b => b.textContent === 'Decline').click(); await wait(1500);
    const quiet = !(await T.screen(who)).some(r => r.includes('should-not-appear'));
    card('smoke-yes').querySelector('.btn.primary').click(); await wait(2500);
    const typed = (await T.screen(who)).some(r => r.trim() === String.raw`typed-on-click D:\new\back\test`);
    await req('smoke-closed', 'echo nowhere', { project: 'NoSuchOpenProject' });
    render(); await wait(400);
    card('smoke-closed')?.querySelector('.btn.primary').click(); await wait(800);
    const outs = await Promise.all(['smoke-no', 'smoke-yes', 'smoke-closed'].map(deck.smokeWordsOut));
    const ok = shown && exact && quiet && typed && /^refused: .*line break/.test(refused || '') && outs.join('|') === 'declined|typed|no lead-NoSuchOpenProject pane is open' && !document.querySelector('.pcard.words');
    const said = `smoke: words cards shown ${shown}, exact ${exact}, decline typed nothing ${quiet}, click typed ${typed}, bad one ${refused}, answers ${outs.join(' | ')}`;
    // Nothing must ever be typed without the click, so a miss here fails the whole run.
    if (!ok) deck.smokeFail(said); else console.log(said);
    deck.write(who, 'cls\r'); await wait(800);
  }
  app.view = 'single'; app.single = picks[0]; render(); await wait(1200);
  await deck.smokeShot('single');
  // A path Claude Code broke onto a second row links whole from either row (#165); a short
  // web link at a row's end followed by a word stays as it was.
  {
    const dir = proj(picks[0]).path, cut = Math.ceil(dir.length / 2), { cols, row } = T.cursorRow(picks[0]);
    const url = 'https://example.com/' + 'a'.repeat(Math.max(10, cols - 30)) + '/end';
    const urlCut = cols - 9;
    T.write(picks[0], `\r\n  Built: ${dir.slice(0, cut)}\r\n  ${dir.slice(cut)}\r\n  see ${url.slice(0, urlCut)}\r\n  ${url.slice(urlCut)}\r\n  short https://x.com/a\r\n  and more\r\n`);
    await wait(500);
    const on = async r => (await T.linksOnRow(picks[0], r)).map(l => l.text);
    const r0 = row + 1, got = [await on(r0), await on(r0 + 1), await on(r0 + 2), await on(r0 + 3), await on(r0 + 4)];
    const ok = got[0][0] === dir && got[1][0] === dir && got[2][0] === url && got[3][0] === url && got[4][0] === 'https://x.com/a';
    console[ok ? 'log' : 'error'](`smoke: wrapped links ${ok ? 'join' : 'do not join'} across rows: ${JSON.stringify(got)}`);
    // Every one of those rows shows its link in the link colour without a hover (#348).
    await wait(600);
    const painted = T.paintedRows(picks[0]), lit = [0, 1, 2, 3, 4].map(k => painted.some(p => p.row === r0 + k));
    console[lit.every(Boolean) ? 'log' : 'error'](`smoke: links coloured before any hover on rows ${JSON.stringify(lit)}; painted ${JSON.stringify(painted.filter(p => p.row >= r0 && p.row <= r0 + 4))}`);
    const scr = T.cursorRow(picks[0]).el?.querySelector('.xterm-screen'), rect = scr?.getBoundingClientRect();
    if (rect) {
      const { rows } = T.cursorRow(picks[0]), w = rect.width / cols, hgt = rect.height / rows;
      scr.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: rect.left + w * 3.5, clientY: rect.top + hgt * (r0 + 1.5) }));
      await wait(600);
    }
    await deck.smokeShot('wrapped-link');
    // A path with a space that Claude Code broke at the space is one link on both rows (#350).
    const smokeDir = decodeURI(location.pathname).replace(/^\//, '').split('/').slice(0, -3).join('\\') + '\\state\\smoke';
    const want = `${smokeDir}\\with space\\media\\map-1080x1350.mp4`, sp = want.indexOf(' ');
    T.write(picks[0], `\x1b[2J\x1b[H\r\nposted, with ${want.slice(0, sp)}\r\n${want.slice(sp + 1)}: done\r\n`);
    await wait(500);
    const [l1] = await T.linksOnRow(picks[0], 1), [l2] = await T.linksOnRow(picks[0], 2);
    const opens = l => l && (l.target || l.text);
    const whole = opens(l1) === want && opens(l2) === want;
    console[whole ? 'log' : 'error'](`smoke: a path broken at its space links whole from both rows: ${whole ? 'yes' : `no, rows give ${JSON.stringify([opens(l1), opens(l2)])}`}`);
    await wait(500);
    await deck.smokeShot('wrapped-link-space');
    // Clipboard history (#352): a Win+V pick arrives as an "insert from paste" input, which now
    // reaches the session; Ctrl+V with only an image on the clipboard sends Claude Code's
    // image paste (Alt+V, ESC v). The owner's clipboard text is put back afterwards.
    {
      const before = await navigator.clipboard.readText().catch(() => '');
      const area = T.cursorRow(picks[0]).el?.querySelector('textarea');
      T.write(picks[0], '\x1b[2J\x1b[H');
      await navigator.clipboard.writeText('from-clipboard-history');
      area?.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertFromPaste', bubbles: true, cancelable: true }));
      await wait(1200);
      const textIn = (await T.screen(picks[0])).join('').includes('from-clipboard-history');
      // A real Ctrl+V of text goes in once: the paste event's own input must not paste it again.
      deck.write(picks[0], '\x1b'); await wait(300);
      T.write(picks[0], '\x1b[2J\x1b[H');
      await navigator.clipboard.writeText('ctrl-v-text'); await wait(500);
      T.focus(picks[0]); await deck.smokeCtrlV(); await wait(1200);
      const ctrlV = ((await T.screen(picks[0])).join('').match(/ctrl-v-text/g) || []).length;
      console[ctrlV === 1 ? 'log' : 'error'](`smoke: Ctrl+V of text pastes it ${ctrlV} time(s)`);
      deck.write(picks[0], '\x1b'); await wait(300);
      const png = await (await fetch('logo.png')).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      const kd = new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', keyCode: 86, ctrlKey: true, bubbles: true, cancelable: true });
      // The page's own write reaches the clipboard the main process reads a moment later.
      await wait(500);
      const kind = window.deck.clipboardKind().kind;
      area?.dispatchEvent(kd); await wait(600);
      const after = (await T.screen(picks[0])).filter(r => r.trim()).slice(-2).join(' | ');
      await navigator.clipboard.writeText(before).catch(() => {});
      console[textIn && kind === 'image' ? 'log' : 'error'](`smoke: a clipboard-history paste reaches the pane ${textIn}; an image on the clipboard reads as "${kind}", Ctrl+V then leaves "${after}"`);
    }
  }
  // The Sketch board over that pane (#94), then Insert: the board closes once the PNG has
  // been pasted into the session.
  document.querySelector('.ph .sketch').click();
  await drawOnBoard(); await deck.smokeShot('sketch');
  document.querySelector('.sk-foot .btn.primary').click(); await wait(1500);
  if (document.querySelector('.sk-host')) { console.error('smoke: Sketch insert did not close the board'); document.querySelector('.sk-x').click(); }
  await deck.smokeShot('sketch-inserted');
  await openSecond(picks[0], false); await wait(1200);
  await deck.smokeShot('second');
  await closeSecond(picks[0]);
  const target = ['Streaky', 'Papers'].find(n => proj(n)) || picks[0];
  // Reach the project page the way the owner does: the project name in its pane header.
  app.view = 'single'; app.single = target; render(); await wait(800);
  document.querySelector('.ph .pn.link').click(); await wait(7000);
  await deck.smokeShot('project');
  const withDetails = tasksOf(target).find(t => t.details.length) || tasksOf(target)[0];
  if (withDetails) { showTask(target, withDetails); await wait(1500); await deck.smokeShot('task');
    // Copy puts "<Project> #<n>: <title>" on the clipboard (#107); the owner's clipboard is put back.
    const before = await navigator.clipboard.readText().catch(() => '');
    document.querySelector('.tdcopy').click(); await wait(300);
    const got = await navigator.clipboard.readText().catch(e => `(${e.message})`), want = `${target} #${withDetails.n}: ${withDetails.text}`;
    console[got === want ? 'log' : 'error'](got === want ? `smoke: Copy gave "${got}"` : `smoke: Copy gave "${got}", wanted "${want}"`);
    await navigator.clipboard.writeText(before).catch(() => {});
  }
  // A card that needs the owner, shaped like a real lead report with lettered options.
  showTask(target, { mark: '?', n: 999, text: 'Tooltip on the section title, none on empty measurements', date: '2026-10-03', who: `lead-${target}`, forOwner: false, result: 'needs you on the tooltip',
    details: ['FOR 9461 this tooltip should be on the title of the section itself.', 'Result: empty icons hidden (ff77df8). NEEDS YOU: the top-right icon is the score formula tooltip, not the 9461 one. a) move the formula tooltip to a help icon beside the title, b) put a "based on the section metrics" icon beside the title and drop the formula one, c) keep the formula icon top right and add the "based on" icon beside the title; suggest a'] });
  await wait(1500); await deck.smokeShot('task-ask');
  // A path inside a detail sentence is a link that opens in the Code pane (#207).
  {
    const file = decodeURI(location.pathname).replace(/^\//, '').replace(/\//g, '\\').replace(/[^\\]+$/, 'styles.css'), opened = [];
    const ctx = { h, icon, deck: { ...deck, taskExtra: async () => ({ notes: '', files: [], plan: null }) }, toast: () => {}, project: target, talk: async () => false,
      openMd: async f => { opened.push(f); return true; },
      task: { mark: ' ', n: 997, text: 'Read the QA report', date: '2026-10-06', who: 'user', details: [`Report: ${file} (evidence in the folder beside it), see https://example.com/qa.`] } };
    await TD.openTask(ctx); await wait(800);
    const links = [...document.querySelectorAll('.tdp .tlink')].map(a => a.textContent);
    await deck.smokeShot('task-text-links');
    document.querySelector('.tdp .tlink').click(); await wait(500);
    const ok = links.length === 2 && links[0] === file && links[1] === 'https://example.com/qa' && opened[0] === file;
    console[ok ? 'log' : 'error'](`smoke: links in an item's text ${ok ? `opened ${file}` : `failed: links ${JSON.stringify(links)}, opened ${JSON.stringify(opened)}`}`);
    TD.closeTask();
  }
  // Add version from an item's Version picker (#141), on a project with no versions. The
  // writes go to a stand-in, so no real task file changes.
  {
    const wrote = [], card = { mark: ' ', n: 998, text: 'Export to MP4', date: '2026-10-04', who: 'user', details: [] };
    const fake = { ...deck, taskExtra: async () => ({ notes: '', files: [], plan: { length: 7, start: '', versions: wrote.filter(w => w[0] === 'plan').flatMap(w => w[1].versions) } }),
      setPlan: async (p, plan) => { wrote.push(['plan', plan]); }, setTaskKey: async (p, n, key, value) => { wrote.push([key, value]); card.details = [`Version: ${value}`]; } };
    const ctx = { h, icon, deck: fake, toast: () => {}, project: target, task: card, talk: async () => false };
    ctx.onChange = () => TD.openTask({ ...ctx, task: { ...card } });
    await TD.openTask(ctx); await wait(500);
    const sel = [...document.querySelectorAll('.tdpick')].find(l => l.textContent.startsWith('Version')).querySelector('select');
    sel.value = '__add_version__'; sel.dispatchEvent(new Event('change')); await wait(200);
    const vin = document.querySelector('.tdvnew'); vin.value = '0.6';
    await deck.smokeShot('task-version-add');
    vin.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(1000);
    const shown = [...document.querySelectorAll('.tdpick')].find(l => l.textContent.startsWith('Version'))?.querySelector('select')?.value;
    const ok = JSON.stringify(wrote) === JSON.stringify([['plan', { length: 7, start: '', versions: [{ name: '0.6', state: '' }] }], ['Version', '0.6']]) && shown === '0.6';
    console[ok ? 'log' : 'error'](`smoke: Add version from the item ${ok ? 'added 0.6 and set it' : `failed: wrote ${JSON.stringify(wrote)}, shows "${shown}"`}`);
    await deck.smokeShot('task-version-added'); TD.closeTask();
    // New sketch on the same item (#140): one button opens the board, no name step; the
    // saved board (smoke data folder) is named after the item and attached to it.
    const attached = [];
    fake.sketchAttach = async (item, rel) => { attached.push(rel); };
    await TD.openTask({ ...ctx, task: { ...card } }); await wait(500);
    await deck.smokeShot('task-sketch-button');
    [...document.querySelectorAll('.tdsk button')].find(b => b.textContent.includes('New sketch')).click();
    await drawOnBoard(); await deck.smokeShot('task-sketch-board');
    document.querySelector('.sk-foot .btn.primary').click(); await wait(2500);
    const want = new RegExp(`^sketches/${target}/export-to-mp4(-\\d+)?\\.excalidraw$`);
    console[attached.length === 1 && want.test(attached[0]) ? 'log' : 'error'](`smoke: New sketch on an item attached ${JSON.stringify(attached)}`);
    TD.closeTask();
  }
  // An open request that arrives while the app is busy (#185) still starts the lead and is
  // answered "Started ..." in open-<Project>.out, in the smoke run's own requests folder.
  {
    const p = app.projects.find(x => !app.openTabs.includes(x.name) && x.kind !== 'personal');
    const answer = p ? await deck.smokeRequest(p.name) : '(no closed project to open)';
    console[/^Started lead-/.test(answer) ? 'log' : 'error'](`smoke: open request while busy for ${p && p.name} answered "${answer}"`);
  }
  // A pane the CTO closes and reopens at once (#197): the closed session ends after the new
  // one started, and the new pane must stay live.
  {
    const p = app.openTabs.find(n => n !== MAIN && !/:/.test(n) && (app.proj(n) || {}).kind !== 'personal');
    await app.closeRequest({ name: p, force: true }); await app.openRequest(p); await wait(6000);
    const alive = ((await deck.states())[p] || {}).alive;
    console[alive && !T.isExited(p) ? 'log' : 'error'](`smoke: ${p} closed and reopened at once: session ${alive ? 'alive' : 'ended'}, pane ${T.isExited(p) ? 'shows ended' : 'live'}`);
    // Left on a permission prompt, the reopened lead stays live and still takes an answer.
    deck.write(p, 'cls & echo  Do you want to proceed? & echo  ^> 1. Yes & echo    2. No\r'); await wait(12000);
    const held = ((await deck.states())[p] || {}).alive && !T.isExited(p);
    deck.write(p, 'echo answered-after-wait\r'); await wait(1500);
    const took = (await T.screen(p)).some(r => r.trim() === 'answered-after-wait');
    console[held && took ? 'log' : 'error'](`smoke: ${p} on a prompt for 12s: ${held ? 'still live' : 'ended'}, answer ${took ? 'reached it' : 'lost'}`);
    // Claude exiting leaves its shell (#353): the title cmd sets after Claude marks the pane
    // ended with a Restart bar, typing still runs commands, and a claude typed there brings it back.
    app.view = 'single'; app.single = p; render();
    deck.write(p, 'cls & title focusshell-claude-ended\r'); await wait(2000);
    const gone = !((await deck.states())[p] || {}).alive && T.isExited(p) && !!document.querySelector('.endbar') && !document.querySelector('.overlay');
    await deck.smokeShot('claude-exited-shell');
    deck.write(p, 'echo typed-after-claude\r'); await wait(1500);
    const typed = (await T.screen(p)).some(r => r.trim() === 'typed-after-claude');
    deck.write(p, 'claude --version\r'); await wait(2500);
    const again = T.isExited(p) || !!document.querySelector('.endbar');
    console[gone && typed && again ? 'log' : 'error'](`smoke: Claude exited in ${p}: ${gone ? 'ended with Restart bar' : 'not shown ended'}, shell ${typed ? 'takes commands' : 'ignores typing'}, ${again ? 'ended again after claude returns' : 'stuck live'}`);
    deck.write(p, 'title smoke\r'); await wait(500);
    // A session that really ended: Restart brings a live one and the overlay goes.
    deck.write(p, 'exit\r'); await wait(2000);
    const overlay = () => !!document.querySelector('.overlay');
    const ended = T.isExited(p) && overlay();
    await app.restart(p); await wait(6000);
    const back = ((await deck.states())[p] || {}).alive && !T.isExited(p) && !overlay();
    console[ended && back ? 'log' : 'error'](`smoke: Restart on ended ${p}: ended ${ended}, then ${back ? 'live with no overlay' : 'still shows ended'}`);
    // Restart resumes the last conversation; when that resume fails, a fresh session starts.
    await deck.kill(p); T.reset(p);
    await deck.open(p, 'fb5bcd84-76e6-4e35-8628-01a5e6addba4', { orFresh: true }); await wait(6000);
    const fresh = ((await deck.states())[p] || {}).alive && !T.isExited(p);
    const said = (await T.screen(p)).some(r => /Could not resume/.test(r));
    console[fresh && said ? 'log' : 'error'](`smoke: failed resume on ${p}: ${fresh ? 'fresh session live' : 'pane ended'}, note ${said ? 'shown' : 'missing'}`);
    // Opened on a model the CTO names (#202): that pane runs on it, also after Restart; opened
    // again with none, it is back on the default.
    await app.closeTab(p, false); await app.openRequest(p, 'haiku'); await wait(3000);
    const m1 = ((await deck.states())[p] || {}).model;
    await app.restart(p); await wait(3000);
    const m2 = ((await deck.states())[p] || {}).model;
    await app.closeTab(p, false); await app.openRequest(p); await wait(3000);
    const m3 = ((await deck.states())[p] || {}).model;
    console[m1 === 'haiku' && m2 === 'haiku' && !m3 ? 'log' : 'error'](`smoke: ${p} opened on haiku: ${m1 || 'default'}, after Restart ${m2 || 'default'}, reopened with no model ${m3 || 'default'}`);
  }
  // Back and forward (#301): the Board, a project page, a task opened there, two leads in a split
  // with VS Code beside the first, the Me page; then back to the start and forward to the end,
  // each step the view it was: page, tabs, split, opened item, Code pane, scroll.
  {
    const nav = navForSmoke(), [a, b] = app.openTabs, want = [];
    const look = () => { const s = nav.snapshot(); return JSON.stringify([s.view, s.single, s.view === 'split' ? s.splitSet : [], s.layoutId, s.currentProject, s.task, s.code, s.scrolls.map(x => x[1])]); };
    const keep = async () => { await wait(400); want.push(look()); };
    TD.closeTask(); app.view = 'home'; render(); await keep();
    app.openProjectPage(a); await wait(1500);
    document.getElementById('home').scrollTop = 120; await keep();
    const t = app.tasksOf(a)[0];
    if (t) { app.showTask(a, t); await wait(800); await keep(); }
    app.splitSet = [a, b]; app.layoutId = autoLayout(2); app.view = 'split'; C.openCode(a, deck, render); render(); await wait(1500); await keep();
    app.view = 'me'; render(); await wait(1000); await keep();
    const seen = [];
    for (let i = want.length - 2; i >= 0; i--) { nav.go(-1); await wait(1800); seen.unshift(look()); }
    const backOk = seen.every((s, i) => s === want[i]);
    const ahead = [];
    for (let i = 1; i < want.length; i++) { nav.go(1); await wait(1800); ahead.push(look()); }
    const fwdOk = ahead.every((s, i) => s === want[i + 1]);
    const bad = [...seen.map((s, i) => [s, want[i]]), ...ahead.map((s, i) => [s, want[i + 1]])].filter(([x, y]) => x !== y);
    console[backOk && fwdOk && t && want.length === 5 ? 'log' : 'error'](`smoke: back and forward through ${want.length} views: back ${backOk}, forward ${fwdOk}${bad.length ? ` (got ${bad[0][0]}, wanted ${bad[0][1]}; wanted ${want.map(w => JSON.parse(w).slice(0, 3).join(':')).join(' / ')}; back saw ${seen.map(w => JSON.parse(w).slice(0, 3).join(':')).join(' / ')}; forward saw ${ahead.map(w => JSON.parse(w).slice(0, 3).join(':')).join(' / ')}; steps ${nav.hist.index} of ${nav.hist.size})` : ''}`);
    C.closeCode(a); TD.closeTask();
    // The real side buttons (#322), pressed as Chromium input: Back over a lead's terminal
    // leaves the split for the project page, Forward over that page brings the split back.
    app.openProjectPage(a); await wait(1500);
    app.splitSet = [a, b]; app.layoutId = autoLayout(2); app.view = 'split'; render(); await wait(1500);
    const term = document.querySelector('#stage .xterm')?.getBoundingClientRect();
    const preBack = `${nav.snapshot().view} at ${nav.hist.index} of ${nav.hist.size} ${JSON.stringify(nav.hist.current && [nav.hist.current.view, nav.hist.current.currentProject])}`;
    if (term) await deck.smokeMouse('back', Math.round(term.x + term.width / 2), Math.round(term.y + term.height / 2));
    await wait(1800);
    const backBtn = nav.snapshot().view === 'project', afterBack = `${nav.snapshot().view} at ${nav.hist.index} of ${nav.hist.size}, before ${preBack}`;
    await deck.smokeMouse('forward', Math.round(innerWidth / 2), Math.round(innerHeight / 2)); await wait(1800);
    const fwdBtn = nav.snapshot().view === 'split';
    console[term && backBtn && fwdBtn && nav.presses > 0 ? 'log' : 'error'](`smoke: mouse side buttons over a terminal ${!!term} (${nav.presses} button events, after back ${afterBack}): back to the project page ${backBtn}, forward to the split ${fwdBtn}`);
  }
  // Plugins (#369): the smoke-only Echo plugin, switched on, shows its title bar button and
  // answers through the host; its shortcut reaches the page; a throwing handler switches it
  // off and Settings shows why, while the app keeps running.
  {
    const btn = () => document.querySelector('.plugbtn[data-plugin="smoke-echo"]');
    const until = async (ok, ms = 3000) => { for (let t = 0; t < ms && !ok(); t += 100) await wait(100); return ok(); };
    app.saveSettings({ ...app.settings, plugins: { 'smoke-echo': { on: true, settings: { greeting: 'hi' } } } });
    if (!(await until(() => btn()))) deck.smokeFail('plugins: the Echo button never showed');
    btn().click();
    if (!(await until(() => document.querySelector('.echo-out')))) deck.smokeFail('plugins: Echo opened no modal');
    const said = document.querySelector('.echo-out').textContent;
    if (said !== 'hi there') deck.smokeFail(`plugins: Echo answered "${said}", not "hi there"`);
    await deck.smokeShot('plugin-modal');
    document.querySelector('.plugmodal .closex').click();
    // The Plugins button (#377) lists the plugins; Open shows one plugin's screen and its Start
    // opens what its title bar button opens. Tavern rests in the colour of Settings.
    const tav = getComputedStyle(document.querySelector('.tavbtn')).color, set = getComputedStyle(document.getElementById('btnSettings')).color;
    if (tav !== set) deck.smokeFail(`plugins: Tavern is ${tav}, Settings ${set}`);
    document.querySelector('.plugsbtn').click();
    if (!(await until(() => document.querySelectorAll('.plugsrow').length >= 2))) deck.smokeFail('plugins: the Plugins list shows no plugins');
    await deck.smokeShot('plugins-list');
    [...document.querySelectorAll('.plugsrow')].find(r => /Echo/.test(r.textContent)).querySelector('button').click();
    if (!(await until(() => document.querySelector('.plugsone .sw.on')))) deck.smokeFail('plugins: Echo\'s screen does not show it on');
    await deck.smokeShot('plugins-one');
    document.querySelector('.plugsctl .btn.primary').click();
    if (!(await until(() => document.querySelector('.echo-out')))) deck.smokeFail('plugins: Start opened nothing');
    document.querySelector('.plugmodal .closex').click();
    await deck.plugin.smokeKey('smoke-echo');
    if (!(await until(() => btn() && btn().dataset.state === 'attention'))) deck.smokeFail('plugins: the shortcut did not reach the page');
    await deck.plugin.invoke('smoke-echo', 'boom');
    if (!(await until(() => !btn()))) deck.smokeFail('plugins: a throwing plugin stayed on');
    app.view = 'settings'; render();
    if (!(await until(() => /boom on purpose/.test((document.querySelector('.plugerr') || {}).textContent || '')))) deck.smokeFail('plugins: Settings does not show the error');
    document.querySelector('.setnav [data-sec="Plugins"]')?.click();
    document.querySelector('.plugerr').scrollIntoView({ block: 'center' }); await wait(300);
    await deck.smokeShot('plugins');
    app.saveSettings({ ...app.settings, plugins: {} });
    app.view = 'home'; render();
  }
  // The screen recorder (#369): its own block, in its plugin folder.
  await recorderSmoke({ deck, app, render, wait });
  deck.smokeDone();
}
