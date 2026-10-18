// The Pixel Tavern in FocusShell (#240): a Tavern button at the top right, with a badge for
// the guests waiting at the bar, opens the tavern over the whole app. Every live session is
// a guest; a lead stopped on a prompt, or a project with a NEEDS YOU item, walks to the bar.
// Answers take the same roads as the cards: a prompt is answered by its own prompt card
// (keys into that lead's pane), a NEEDS YOU item as "ANSWER <Project> #<n>: ..." to its CTO.
// Phaser loads the first time the tavern opens; closed, the game sleeps. The room is the tavern
// room demo's own scene (#246): copied from the tavern folder into ./room at start and by
// npm run room, each session a robot, the owner the barkeep.
import { tavernAgents, settleAgents } from '../../lib/tavern/agents.js';
import { askOf } from '../../lib/tasks.js';
import { finishedCounts } from '../../lib/tavern/finished.js';

const REFRESH_MS = 1500;
const PHASER = '../node_modules/phaser/dist/phaser.min.js';

let c = null, btn = null, shade = null, game = null, scene = null, booting = null;
let agents = [], open = null;
const held = new Map();                 // agent id -> its settled state (settleAgents)
const answered = new Map();             // "<project>#<n>" -> the question it answered, until the CTO closes it

// ctx: { h, icon, deck, toast, input() -> tavernAgents' input without `answered`,
//        leadCard(sessionId) -> that lead's prompt card or null, task(project, n),
//        talkItem(project, n, text) -> bool, openPane(project),
//        workOf(agent) -> { task, report } its task in progress and its last reported item,
//        ctoOf(project) -> the session id of the CTO that project's lead answers to }
export function tavernButton(ctx) {
  c = ctx;
  btn = c.h('button', { class: 'iconbtn tavbtn', title: 'The tavern: your agents as guests', onclick: openTavern },
    c.h('span', { class: 'tavmug', 'aria-hidden': 'true' }), 'Tavern', c.h('b', { class: 'tavbadge', hidden: true }, '0'));
  setInterval(refresh, REFRESH_MS);
  refresh();
  return btn;
}
export const tavernOpen = () => !!shade && !shade.hidden;
// Settings > Preferences > Show Tavern (#1101): off, the button is gone and nothing runs.
let off = false;
export function setTavernOn(on) {
  off = !on;
  if (off) closeTavern();
  if (btn) btn.style.display = off ? 'none' : '';
  if (!off) refresh();
}

// Rebuilds the agent list, the badge and (when open) the guests.
export function refresh() {
  if (!c || off) return;
  // A NEEDS YOU answered here keeps its guest away from the bar until the CTO closes it,
  // or until the question on it changes.
  for (const [key, q] of answered) {
    const [project, n] = [key.slice(0, key.lastIndexOf('#')), Number(key.slice(key.lastIndexOf('#') + 1))];
    const t = c.task(project, n);
    if (!t || t.mark !== '?' || questionOf(t) !== q) answered.delete(key);
  }
  agents = settled();
  for (const id of uncalled) if (!agents.some(a => a.id === id)) uncalled.delete(id);
  const waiting = agents.filter(a => a.state === 'asking').length;
  const badge = btn.querySelector('.tavbadge');
  badge.textContent = String(waiting); badge.hidden = !waiting;
  btn.title = waiting ? `The tavern: ${waiting} waiting at the bar` : 'The tavern: your agents as guests';
  if (tavernOpen() && scene) {
    scene.setCast(cast(agents));
    showLight();
    scene.setNotices(notices().length, notices().map(askKey));
    scene.setBusy(agents.filter(a => a.state === 'working').length);
    // The mug rack and trophy shelf (#282): items closed today and this week, Me left out.
    { const { tasksMd, skip } = c.input(); scene.setFinished(finishedCounts(tasksMd, skip)); }
    if (open && open.notice) { if (notices().map(askKey).join() !== open.keys) showNotice(); }
    else if (open && open.board) { if (!notices().some(x => askKey(x) === askKey(open))) showNotice(); }
    else if (open) { const a = agents.find(x => x.id === open.id); if (!a || !a.asks.length) closeBox(); else if (askKey(a.asks[0]) !== askKey(open.ask)) showBox(a); }
  }
}
// Every open question and prompt, for the notice board (#276): [{ agent, ask }].
const notices = () => agents.flatMap(agent => agent.asks.map(ask => ({ agent, ask })));
const askKey = x => { const a = x.ask || x; return a.kind === 'prompt' ? `p:${a.id}` : `i:${a.project}#${a.n}`; };
// Settled states, except that a session busy for a few seconds is working at once (#312): a robot
// given a task stops drinking then, rather than once the 20 s hold is over.
const START_MS = 4000;
const settled = () => {
  const now = Date.now();
  return settleAgents(tavernAgents({ ...c.input(), answered: new Set(answered.keys()) }), held, now).map(a => {
    const h = held.get(a.id);
    if (a.state !== 'idle' || h.seen !== 'working' || now - h.since < START_MS) return a;
    h.state = 'working';
    return { ...a, state: 'working' };
  });
};
const questionOf = t => { const a = askOf(t); return (a && a.question) || t.text; };
// The room's cast: each agent as its robot and how it is (working, idle, asking). A lead coming
// in is called by its CTO, and takes over its project's visitor at the bar if there is one (#281).
// The first opening's walk-in brings in leads that were already running, so nobody calls
// them (#363): they are uncalled until they leave.
const uncalled = new Set();
const cast = list => list.map(a => (a.role === 'lead' && !a.id.startsWith('visit:')
  ? { id: a.id, robot: a.robot, state: a.state, was: `visit:${a.project}`, caller: uncalled.has(a.id) ? null : c.ctoOf ? c.ctoOf(a.project) : 'cto' }
  : { id: a.id, robot: a.robot, state: a.state }));
const robotPic = robot => new URL(`./room/art/sprites/robot-${robot}.png`, import.meta.url).href;

// ---- Open and close: the game is made once and kept, asleep while closed. ----
async function openTavern() {
  if (!shade) build();
  shade.hidden = false;
  const first = !booting;
  await boot();
  game.loop.wake();
  game.input.enabled = true;
  showLight();
  scene.input.keyboard.enabled = !open;
  // Whatever changed while it was closed is already in place when it opens (#296): the game
  // slept meanwhile, so nobody walks to catch up.
  // The first time it opens, boot() has them walking in instead (#306).
  agents = settled();
  if (!first) await scene.setCast(cast(agents), { seated: true });
  scene.refreshTokens();   // fresh counts each time the tavern opens (#288)
  shade.querySelector('.tavstage').focus({ preventScroll: true });
  refresh();
}
export function closeTavern() {
  if (!tavernOpen()) return;
  closeBox();
  shade.hidden = true;
  if (scene) scene.input.keyboard.enabled = false;
  // Phaser hears mouse presses on the whole window, not only its canvas: closed, a click
  // anywhere in the app hit the room's chalkboard or guests at their last place (#1066).
  if (game) { game.input.enabled = false; game.loop.sleep(); }
}
addEventListener('keydown', e => {
  // The token board closes first, by itself (chalkboard.js).
  if (e.key !== 'Escape' || !tavernOpen() || document.querySelector('.chalkshade')) return;
  e.preventDefault(); e.stopPropagation();
  if (open) closeBox(); else closeTavern();
}, true);

// Day or night by hand (#310), over the clock until FocusShell restarts; dusk counts as night.
let pinned = null, lightBtn = null;
function showLight() {
  if (!lightBtn) return;
  const night = (pinned || (scene && scene.light)) !== 'day';
  lightBtn.replaceChildren(c.icon(night ? 'sun' : 'moon'));
  lightBtn.title = night ? 'Switch to day' : 'Switch to night';
}
function toggleLight() {
  if (!scene) return;
  pinned = scene.light === 'day' ? 'night' : 'day';
  scene.setLight(pinned);
  showLight();
}

function build() {
  const { h, icon } = c;
  shade = h('div', { class: 'tavshade', hidden: true },
    h('div', { class: 'tavwin', role: 'dialog', 'aria-label': 'The tavern' },
      h('header', {}, h('h2', {}, 'The Tavern'),
        h('span', { class: 'qhelp', tabindex: '0', title: 'You are the barkeeper. Walk with the arrow keys or WASD, or click the floor to walk there; left alone, he goes back behind the bar. Click a guest for its task, last report, model and tokens. A guest at the bar with a ! is waiting on you; one writing on a scroll is busy, one with a beer is idle: click it to answer, or click the notice board by the door for every question and prompt at once. Click the chalkboard behind the bar for the tokens each agent has used, today and this week, and the tasks done and commits made today. The mug rack hangs a mug for each task finished today; the trophies on the mantel are this week, one a day; point at either for the numbers. The windows and the light follow your clock: day, dusk and night.' }, '?'),
        lightBtn = h('button', { class: 'btn ghost tavlight', onclick: toggleLight }),
        h('button', { class: 'btn ghost', title: 'Close (Esc)', onclick: closeTavern }, icon('x'))),
      h('div', { class: 'tavstage', tabindex: '-1' }),
      h('div', { class: 'tavbox', hidden: true })));
  document.body.append(shade);
}

function loadScript(src) {
  return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error(`could not load ${src}`)); document.head.append(s); });
}
function boot() {
  if (booting) return booting;
  booting = (async () => {
    if (!globalThis.Phaser) await loadScript(PHASER);
    const Phaser = globalThis.Phaser;
    const { roomScene, loadRoom, W, H } = await import('./room/demos/room/roomscene.js');
    const stage = shade.querySelector('.tavstage');
    const Scene = roomScene({ room: await loadRoom(), rows: () => c.deck.tavernTokens(), boards: BOARDS, usage: () => c.deck.tavernUsage(), onGuest: id => { const a = agents.find(x => x.id === id); if (a && a.asks.length) showBox(a); else if (a) showCard(a); }, onNotice: showNotice });
    game = new Phaser.Game({
      type: Phaser.AUTO, parent: stage, width: W, height: H, pixelArt: true, backgroundColor: '#1b1412', banner: false,
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      input: { keyboard: { target: stage } },
      // The smoke run's hidden window barely gets screen refreshes; a timer keeps the room going.
      fps: { target: 60, forceSetTimeOut: !!c.isSmoke?.() },
      scene: [Scene],
    });
    // Keep moving while the owner works in another window; closed or hidden, it sleeps.
    game.events.off(Phaser.Core.Events.BLUR, game.onBlur, game);
    scene = await new Promise(ok => game.events.once('ready', () => { const s = game.scene.getScene('room'); if (s.ready) ok(s); else s.events.once('room-ready', () => ok(s)); }));
    // The first time the tavern opens after FocusShell starts, everyone already in walks in by the
    // door one by one (#306); later openings find them in place (#296).
    for (const a of agents) uncalled.add(a.id);
    await scene.setCast(cast(agents));
  })();
  return booting;
}

// ---- The answer box: the guest's first question, or one picked on the notice board. ----
function showBox(agent, ask = agent.asks && agent.asks[0], fromBoard = false) {
  const { h } = c, box = shade.querySelector('.tavbox');
  if (!ask) return;
  open = { id: agent.id, ask, board: fromBoard };
  if (scene) scene.input.keyboard.enabled = false;   // typing in the box must not walk the barkeeper
  const nth = agent.asks.findIndex(x => askKey(x) === askKey(ask)) + 1;
  const head = h('div', { class: 'tavwho' }, h('img', { class: 'tavface tavrobot', src: robotPic(agent.robot), alt: '' }),
    h('div', {}, h('b', {}, agent.name),
      h('small', {}, agent.project, agent.asks.length > 1 ? ` · ${nth} of ${agent.asks.length} questions` : '')),
    fromBoard ? h('button', { class: 'btn ghost', title: 'Back to the notice board', onclick: showNotice }, 'Notice board') : null,
    h('button', { class: 'btn ghost tavx', title: 'Close (Esc)', onclick: closeBox }, c.icon('x')));
  const body = ask.kind === 'prompt' ? c.leadCard(ask.id) : itemCard(ask);
  box.replaceChildren(head, fromBoard ? null : facts(agent), body || h('p', { class: 'pnote' }, 'This question was answered already.'));
  box.hidden = false;
  const first = box.querySelector('textarea');
  if (first) first.focus({ preventScroll: true });
}
// A guest's card (#277): its current task, its last report, its model and its tokens, as
// FocusShell knows them; a fact it does not know is left out rather than guessed.
function showCard(agent) {
  const { h } = c, box = shade.querySelector('.tavbox');
  open = { card: agent.id };
  if (scene) scene.input.keyboard.enabled = false;
  const head = h('div', { class: 'tavwho' }, h('img', { class: 'tavface tavrobot', src: robotPic(agent.robot), alt: '' }),
    h('div', {}, h('b', {}, agent.name), h('small', {}, `${agent.project} · ${agent.state === 'working' ? 'busy' : 'idle'}`)),
    h('button', { class: 'btn ghost tavx', title: 'Close (Esc)', onclick: closeBox }, c.icon('x')));
  box.replaceChildren(head, facts(agent));
  box.hidden = false;
}
const fmt = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
// The facts on a guest's card; the model and tokens fill in once read.
function facts(agent) {
  const { h } = c, dl = h('dl', { class: 'tavfacts' });
  const row = (k, v) => { if (v) dl.append(h('dt', {}, k), h('dd', {}, v)); };
  const { task, report } = c.workOf(agent);
  row('Task', task ? `#${task.n} ${task.text}` : agent.role === 'lead' ? 'No task in progress' : null);
  row('Last report', report ? `#${report.n} ${report.result}` : null);
  const sid = agent.role === 'helper' ? agent.parent : agent.id;
  Promise.all([c.deck.states().catch(() => ({})), c.deck.tavernTokens().catch(() => [])]).then(([states, rows]) => {
    if (agent.role !== 'helper') row('Model', (states[sid] || {}).model);
    const t = rows.find(r => r.id === sid && (agent.role === 'helper' ? r.kind === 'helpers' : r.kind !== 'helpers'));
    if (t) row(agent.role === 'helper' ? 'Tokens (all helpers)' : 'Tokens', `${fmt(t.fresh)} fresh · ${fmt(t.cacheRead)} cache reads`);
  });
  return dl;
}
// The notice board by the door (#276): every open NEEDS YOU and every lead stopped on a prompt,
// one note each; a click opens that note's own answer card, which answers as the cards do.
function showNotice() {
  if (!shade) return;
  const { h } = c, box = shade.querySelector('.tavbox'), list = notices();
  open = { notice: true, keys: list.map(askKey).join() };
  if (scene) scene.input.keyboard.enabled = false;
  const head = h('div', { class: 'tavwho' }, h('div', {}, h('b', {}, 'Notice board'),
    h('small', {}, list.length ? `${list.length} waiting on you` : 'Nothing waiting on you')),
    h('button', { class: 'btn ghost tavx', title: 'Close (Esc)', onclick: closeBox }, c.icon('x')));
  const rows = list.map(({ agent, ask }) => {
    const t = ask.kind === 'item' ? c.task(ask.project, ask.n) : null;
    const what = ask.kind === 'prompt' ? ask.what || 'Stopped on a prompt' : t ? questionOf(t) : `#${ask.n}`;
    return h('button', { class: 'tavnote', onclick: () => showBox(agent, ask, true) },
      h('img', { class: 'tavface tavrobot', src: robotPic(agent.robot), alt: '' }),
      h('span', {}, h('b', {}, ask.kind === 'prompt' ? `${agent.name} · WAITING` : `${ask.project} #${ask.n} · NEEDS YOU`), h('small', {}, what)));
  });
  box.replaceChildren(head, rows.length ? h('div', { class: 'tavnotes' }, rows) : h('p', { class: 'pnote' }, 'No questions or prompts right now.'));
  box.hidden = false;
}
function closeBox() {
  open = null;
  if (!shade) return;
  shade.querySelector('.tavbox').hidden = true;
  if (scene && tavernOpen()) { scene.input.keyboard.enabled = true; shade.querySelector('.tavstage').focus({ preventScroll: true }); }
}

// A NEEDS YOU item, answered as its whiteboard card answers: "ANSWER <Project> #<n>: ..."
// to the project's CTO, with the same note on the project.
function itemCard({ project, n }) {
  const { h } = c, t = c.task(project, n);
  if (!t) return null;
  const ask = askOf(t), q = questionOf(t), sug = ask && ask.suggest;
  const say = text => {
    const s = String(text).replace(/\s+/g, ' ').trim();
    if (!s || !c.talkItem(project, n, s)) return;
    c.deck.addProjectNote(project, `#${n} You: ${s}`);
    answered.set(`${project}#${n}`, q);
    // Answered from the notice board: back to the board, which no longer lists it.
    if (!(open && open.board)) closeBox();
    refresh();
  };
  const box = h('textarea', { class: 'tdsay', rows: 2, placeholder: 'Answer…', onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); say(box.value); } } });
  const opts = ask && ask.options.length
    ? ask.options.map(o => {
      const isSug = !!sug && (o.key ? sug.toLowerCase().startsWith(o.key) : sug.toLowerCase() === o.text.toLowerCase());
      return h('button', { class: 'tdopt' + (isSug ? ' sug' : ''), onclick: () => say(o.key ? `${o.key}: ${o.text}` : o.text) },
        o.key ? h('span', { class: 'l' }, o.key) : null, h('span', {}, o.text, isSug ? h('small', {}, 'CTO suggests') : null));
    })
    : sug ? [h('button', { class: 'tdopt sug', onclick: () => say(`go with the suggestion: ${sug}`) }, h('span', {}, `Go with the suggestion: ${sug}`))] : [];
  return h('article', { class: 'tavitem' },
    h('div', { class: 'wbmeta' }, h('span', { class: 'wbid' }, `${project} #${n}`), h('span', { class: 'wbtitle' }, t.text)),
    q !== t.text ? h('p', { class: 'wbq' }, q) : null,
    opts.length ? h('div', { class: 'tdopts' }, opts) : null,
    h('div', { class: 'tdtalk' }, box, h('button', { class: 'btn primary', title: 'Send to the CTO (Enter)', onclick: () => say(box.value) }, 'Send')));
}

// The chalkboard's other tabs (#285).
const BOARDS = {
  today: () => c.deck.tavernPeriod('today'), week: () => c.deck.tavernPeriod('week'), tasks: () => c.deck.tavernTasksDone(),
  commits: async () => (await c.deck.commitsToday()).projects.map(p => ({ who: p.name, count: p.count })),
};

// For the smoke run: the scene, and a way to open a guest's box without the walk.
export const tavernForSmoke = () => ({ scene, game, agents, card: id => { const a = agents.find(x => x.id === id); if (a) showCard(a); }, notice: () => scene.notice.zone.emit('pointerdown'), openBox: id => { const a = agents.find(x => x.id === id); if (a) showBox(a); },
  tokens: async () => { const { openBoard } = await import('./room/demos/room/chalkboard.js'); openBoard({ now: () => scene.refreshTokens(), ...BOARDS }); } });
