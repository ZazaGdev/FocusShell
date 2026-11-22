// The smoke run's block for #3016: a pane at 90% of its context is asked to stop at a safe point
// and reopened fresh, on smokeContext fakes, and a CTO due for the new day the same way (#3073). No Claude runs, so the panes are plain shells, every
// typed line echoes there as an unknown command, and no worktree is made (every pane runs in the
// data folder).
import * as T from './terminal.js';
import { MAIN, managerFor } from '../lib/groups.js';
import { typeLine, heldCount } from './cto-line.js';
import { contextForSmoke, forgetForSmoke } from './context-reopen.js';

const PROMPT = 'cls & echo  Bash command & echo    npm run build & echo  Do you want to proceed? & echo  ^> 1. Yes & echo    2. No, and tell Claude what to do differently (esc)\r';
const ASKED = 'CONTEXTFULL:thispaneisat91%ofitscontextwindow.';

export async function contextSmoke({ deck, app, wait }) {
  const flat = async id => (await T.screen(id)).join('').replace(/\s+/g, '');
  const until = async (ok, ms, every = 250) => { for (const end = Date.now() + ms; Date.now() < end; await wait(every)) if (await ok()) return true; return !!(await ok()); };
  const state = async id => (await deck.states())[id] || {};
  const toastSays = text => [...document.querySelectorAll('#toasts .toast')].some(t => t.textContent.startsWith(text));
  const check = (ok, said) => { if (ok) console.log(`smoke: context full: ${said}`); else deck.smokeFail(`context full: ${said}`); };
  const askedIn = id => until(async () => { await app.contextCheck(); return (await flat(id)).includes(ASKED); }, 20000, 1000);

  const P = app.openTabs.find(x => x !== MAIN && !/:/.test(x) && (app.proj(x) || {}).kind !== 'personal'
    && app.started.has(managerFor(app.groups, x)) && !T.isExited(managerFor(app.groups, x)));
  const n = P && [5, 4, 3, 2].find(k => !app.started.has(`${P}:${k}`));
  if (!P || !n) { deck.smokeFail(`context full: no open project with a free extra lead and a running CTO (${P}, ${n})`); return; }
  const L = `${P}:${n}`, lead = `lead-${P}-${n}`, cto = managerFor(app.groups, P);
  contextForSmoke({ manual: true, noBox: true, settle: 4000 });
  await app.openExtraRequest({ name: P, n, worktree: true, model: 'haiku' }); await wait(3000);
  const before = await state(L);

  // 1. A live prompt on the lead's screen holds the ask; once it is gone the line goes.
  deck.write(L, PROMPT); await wait(5000);
  await deck.smokeContext(L, { percent: 91 });
  await app.contextCheck(); await wait(2500);
  const promptHeld = heldCount(L) === 0 && !(await flat(L)).includes(ASKED);
  deck.write(L, 'cls\r');
  const afterPrompt = await askedIn(L);
  check(promptHeld && afterPrompt, `${lead} at 91% on a prompt got no line ${promptHeld}, got it once the prompt was gone ${afterPrompt}`);

  // 2. A words request waiting for that lead holds the ask until it ends. Below the ask point
  // first, with the ask above dropped (a drop below the ask point keeps an ask that went in).
  await deck.smokeContext(L, { percent: 10 }); forgetForSmoke(L); await app.contextCheck();
  deck.write(L, 'cls\r'); await wait(800);
  await deck.smokeWords('smoke-ctx', JSON.stringify({ project: P, n, task: 7, words: 'echo ctx-words', why: 'Context smoke', created: Date.now() }));
  await wait(1500);
  await deck.smokeContext(L, { percent: 91 });
  await app.contextCheck(); await wait(2500);
  const wordsHeld = heldCount(L) === 0 && !(await flat(L)).includes(ASKED);
  await deck.wordsDecline('smoke-ctx'); await wait(800);
  const afterWords = await askedIn(L);
  check(wordsHeld && afterWords, `${lead} with a words request got no line ${wordsHeld}, got it once the request ended ${afterWords}`);

  // 3. READY with a subagent still running: not reopened. With none: a new session on the same
  // model and folder, the note in its pane, the toast and REOPENED on its CTO's screen.
  await wait(6000); // a quiet pane
  const ready = { percent: 91, ready: '**READY TO REOPEN | #901**', endedAt: Date.now(), subagents: 1 };
  await deck.smokeContext(L, ready); await app.contextCheck(); await wait(3000);
  const keptWhileSub = (await state(L)).startedAt === before.startedAt;
  await deck.smokeContext(L, { ...ready, subagents: 0 }); await app.contextCheck();
  let toasted = false;
  const reopened = await until(async () => { toasted = toasted || toastSays(`${lead} reached 91% of its context, stopped at a safe point and was reopened fresh.`); return toasted && (await state(L)).startedAt > before.startedAt; }, 15000, 100);
  await deck.smokeContext(L, null);
  const after = await state(L);
  const same = after.model === 'haiku' && before.model === 'haiku' && after.cwd === before.cwd;
  const note = (await flat(L)).includes('[FocusShell]Reopenedfresh:thelastsessionreached91%ofitscontextandstoppedatasafepoint.');
  const told = await until(async () => (await flat(cto)).includes(`REOPENED${lead}|itreached91%ofitscontext,stoppedatasafepointandwasreopenedfresh|resend:#901`), 20000, 500);
  check(keptWhileSub && reopened && same && note && told, `${lead} kept while a subagent ran ${keptWhileSub}, reopened ${reopened} with a toast ${toasted}, same model and folder ${same} (${after.model}, ${after.cwd === before.cwd}), note ${note}, ${cto} told ${told}`);
  await app.closeExtra(P, n); await wait(500);

  // 4. The CTO: asked, then reopened; a line typed to it meanwhile waits, and REOPENED goes first.
  deck.write(MAIN, 'cls\r'); await wait(800);
  const c0 = await state(MAIN);
  await deck.smokeContext(MAIN, { percent: 91 });
  const ctoAsked = await askedIn(MAIN);
  await wait(6000);
  await deck.smokeContext(MAIN, { percent: 91, ready: '`READY TO REOPEN | stopped at: smoke check | next: nothing`', endedAt: Date.now(), subagents: 0 });
  await app.contextCheck();
  const ctoReopened = await until(async () => (await state(MAIN)).startedAt > c0.startedAt, 15000, 100);
  const how = await typeLine(deck, MAIN, 'echo after-the-reopen');
  await deck.smokeContext(MAIN, null);
  const both = await until(async () => { const f = await flat(MAIN); return f.includes('REOPENEDcto|') && f.includes('after-the-reopen'); }, 30000, 500);
  const f = await flat(MAIN), at = f.indexOf('REOPENEDcto|yourlastsessionreached91%ofitscontextandFocusShellreopenedyoufresh|itsaid:stoppedat:smokecheck|next:nothing');
  const first = at >= 0 && at < f.indexOf('after-the-reopen');
  check(ctoAsked && ctoReopened && how === 'held' && both && first, `the CTO asked ${ctoAsked}, reopened ${ctoReopened}, a line meanwhile was ${how}, REOPENED cto shown before it ${first}`);

  // 5. A new day (#3073): the CTO well below its ask point, idle, its conversation begun today:
  // nothing. Begun yesterday: the NEW DAY line, then on READY a fresh CTO told a new day started.
  deck.write(MAIN, 'cls\r'); await wait(800);
  forgetForSmoke(MAIN); // the fresh state left by 4
  contextForSmoke({ dayIdle: 0 });
  const DAY = 'NEWDAY:anewdaystarted,soFocusShellreopensthisCTOfresh.';
  const idle = { percent: 20, askAt: 90, idleAt: Date.now() - 3600000, subagents: 0 };
  await deck.smokeContext(MAIN, { ...idle, since: Date.now() });
  await app.contextCheck(); await wait(2500);
  const todayQuiet = !(await flat(MAIN)).includes(DAY);
  const d0 = await state(MAIN);
  await deck.smokeContext(MAIN, { ...idle, since: Date.now() - 26 * 3600000 });
  const dayAsked = await until(async () => { await app.contextCheck(); return (await flat(MAIN)).includes(DAY); }, 20000, 1000);
  await wait(6000); // a quiet pane
  await deck.smokeContext(MAIN, { ...idle, since: Date.now() - 26 * 3600000, ready: 'READY TO REOPEN | stopped at: smoke day | next: nothing', endedAt: Date.now() });
  await app.contextCheck();
  let dayToast = false;
  const dayReopened = await until(async () => { dayToast = dayToast || [...document.querySelectorAll('#toasts .toast')].some(t => t.textContent.includes('was reopened fresh for the new day.')); return (await state(MAIN)).startedAt > d0.startedAt; }, 15000, 100);
  await deck.smokeContext(MAIN, null);
  const dayTold = await until(async () => (await flat(MAIN)).includes('REOPENEDcto|anewdaystartedandFocusShellreopenedyoufresh|itsaid:stoppedat:smokeday|next:nothing'), 30000, 500);
  const dayNote = (await flat(MAIN)).includes('[FocusShell]Reopenedfreshforthenewday;thelastsessionstoppedatasafepoint.');
  check(todayQuiet && dayAsked && dayReopened && dayToast && dayTold && dayNote, `new day: begun today asked nothing ${todayQuiet}, begun yesterday asked ${dayAsked}, reopened ${dayReopened} with a toast ${dayToast}, REOPENED says a new day started ${dayTold}, note ${dayNote}`);
  contextForSmoke({ manual: false, noBox: false, settle: 0, dayIdle: null });
  deck.write(MAIN, 'cls\r'); await wait(800);
}
