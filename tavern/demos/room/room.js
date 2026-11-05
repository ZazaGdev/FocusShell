// The tavern room demo page (#248 onwards): the room scene (roomscene.js, the same scene as the
// app's tavern, #246) with all eighteen robots, the barkeep behind the bar, and the controls the
// owner tunes the motion with. The page's server reads the token board from Claude Code's logs.
import { h } from '../art/dom.js';
import { roomScene, loadRoom, DEFAULTS, W, H } from './roomscene.js';
import { ROBOTS } from './robots.js';

const SLIDERS = [
  ['speed', 'Speed', 0.2, 3, 0.1], ['fps', 'Frame rate', 4, 30, 1], ['bob', 'Bob height', 0, 6, 0.5],
  ['arm', 'Arm swing', 0, 14, 0.5], ['leg', 'Leg swing', 0, 10, 0.5], ['tilt', 'Head tilt', 0, 6, 0.5],
];
const PRESETS = structuredClone(DEFAULTS);
const query = new URLSearchParams(location.search);

const root = document.getElementById('demo');
const stage = h('div', { id: 'room' });
document.documentElement.style.setProperty('--roomw', `${W * 2}px`);
document.documentElement.style.setProperty('--roomratio', String(W / H));
// ?view=phone forces the phone layout (#273); narrow screens get it on their own (index.html).
if (query.get('view') === 'phone') document.documentElement.classList.add('phone');
const PHONE = document.documentElement.classList.contains('phone') || matchMedia('(max-width: 900px), (max-height: 500px)').matches;
// On a phone the description and the controls start folded.
if (PHONE) document.querySelector('.intro')?.removeAttribute('open');

// Made-up questions for the notice board (#276): the robots they belong to wait at the bar.
const NOTICES = [
  { id: 'focus-shell', kind: 'item', label: 'FocusShell #276 · NEEDS YOU', q: 'Pin the notice board by the door or on the far wall?', options: ['by the door', 'far wall'] },
  { id: 'gym', kind: 'prompt', label: 'lead-Workout · WAITING', q: 'Do you want to proceed? Run npm test', options: ['1. Yes', '2. No'] },
  { id: 'builder', kind: 'item', label: 'Blogger #41 · NEEDS YOU', q: 'Thumbnail with the face or without?', options: ['with', 'without'] },
];
const room = await loadRoom();
// The chalkboard's other tabs (#285), from the page's server.
const board = async tab => (await (await fetch(`/api/board?tab=${tab}`)).json()).rows;
const BOARDS = { today: () => board('today'), week: () => board('week'), tasks: () => board('tasks'), commits: () => board('commits') };
const Scene = roomScene({ room, presets: PRESETS, rows: async () => (await (await fetch('/api/tokens')).json()).rows, boards: BOARDS, usage: async () => (await fetch('/api/usage')).json(), finished: async () => (await fetch('/api/finished')).json(), onNotice: () => noticeBoard(), onGuest: id => guestCard(id) });
const game = new Phaser.Game({
  type: Phaser.AUTO, parent: stage, width: W, height: H, pixelArt: true, backgroundColor: '#14100f', banner: false,
  scale: { mode: Phaser.Scale.NONE }, scene: [Scene],
});
const scene = await new Promise(ok => game.events.once('ready', () => ok(game.scene.getScene('room'))));
await new Promise(ok => (scene.ready ? ok() : scene.events.once('room-ready', ok)));
// A robot sent out of the door, and called back in by the CTO on the phone (#281).
const away = new Set();
// Leads given a task in the demo (#312): their robots take their mugs back to the counter first.
const tasked = new Set();
const recast = (seated = false) => { scene.setNotices(NOTICES.length, NOTICES.map(x => x.label)); return scene.setCast(ROBOTS.filter(([name]) => !away.has(name)).map(([name], i) => ({ id: name, robot: name, state: NOTICES.some(x => x.id === name) ? 'asking' : i % 3 === 1 || tasked.has(name) ? 'working' : 'idle', caller: 'cto' })), { seated }); };
await recast(true);
// The notice board's list, answered here the way a card answers: a prompt's key into the lead's
// pane, a NEEDS YOU as "ANSWER <Project> #<n>: ..." to its CTO (shown, not sent, in the demo).
function noticeBoard() {
  document.querySelector('.chalkshade')?.remove();
  const close = () => shade.remove();
  const list = h('ol', {}, ...(NOTICES.length ? NOTICES.map(x => h('li', { class: 'note' }, h('span', { class: 'who' }, x.label), h('small', {}, x.q),
    h('span', { class: 'opts' }, ...x.options.map(o => h('button', { onclick: () => {
      NOTICES.splice(NOTICES.indexOf(x), 1); recast();
      sent.textContent = x.kind === 'prompt' ? `Pressed ${o[0]} in the lead's pane.` : `Sent to the CTO: ANSWER ${x.label.split(' ·')[0]}: ${o}`;
      setTimeout(() => { close(); noticeBoard(); }, 900);
    } }, o))))) : [h('li', { class: 'msg' }, 'No questions or prompts right now.')]));
  const sent = h('p', { class: 'hint' }, 'Esc or click outside to close');
  const shade = h('div', { class: 'chalkshade' }, h('div', { class: 'chalk notice', role: 'dialog', 'aria-label': 'Notice board' }, h('h2', {}, 'Notice board'), h('p', {}, 'Every open question and prompt; answer it here.'), list, sent));
  shade.addEventListener('click', e => { if (e.target === shade) close(); });
  addEventListener('keydown', e => { if (e.key === 'Escape') close(); }, { once: true });
  document.body.append(shade);
}
// ?perf hands the scene to the console, for checks.
if (query.has('perf')) window.roomScene = scene;
// ?check (#303): twelve more guests arrive at once, given in three overlapping casts as the app
// gives them, then five minutes run fast with states changing every half minute; the result
// (how long any two robots stood one on top of the other) goes on the page and in window.overlaps.
if (query.has('check')) {
  const { overlapCheck } = await import('./overlapcheck.js');
  const base = ROBOTS.map(([name]) => ({ id: name, robot: name, state: 'idle' }));
  const more = n => Array.from({ length: n }, (_, i) => ({ id: `extra-${i}`, robot: i % 3 ? 'helper' : 'general-1', state: i % 4 === 1 ? 'working' : 'idle' }));
  await Promise.all([scene.setCast([...base, ...more(4)]), scene.setCast([...base, ...more(8)]), scene.setCast([...base, ...more(12)])]);
  const shake = (s, i) => s.setCast([...s.guests.values()].filter(p => p.next !== 'leave').map((p, k) => ({ id: p.id, robot: p.name, state: (k + i) % 5 === 0 ? 'asking' : (k + i) % 3 === 0 ? 'working' : 'idle' })));
  window.overlaps = await overlapCheck(scene, { seconds: 300, shake });
  console.log('overlap check', window.overlaps);
  root.prepend(h('pre', { class: 'check' }, `Overlap check: ${JSON.stringify(window.overlaps)}`));
}

const bar = h('div', { class: 'bar' });
// The light follows the clock (#283); the button tries each light in turn, then back to the clock.
const night = h('button', {}, `Light: clock (${scene.light})`), pause = h('button', {}, 'Pause');
night.onclick = () => { const order = [null, 'day', 'dusk', 'night'], next = order[(order.indexOf(scene.pinned || null) + 1) % 4]; scene.setLight(next); night.textContent = next ? `Light: ${next}` : `Light: clock (${scene.light})`; night.classList.toggle('on', !!next); };
pause.onclick = () => { const p = !pause.classList.contains('on'); pause.classList.toggle('on', p); if (p) game.loop.sleep(); else game.loop.wake(); };
// The fire grows with the busy agents (#280): the demo's count, to try it.
const busyCount = () => [...scene.guests.values()].filter(g => g.state === 'working').length;
scene.setBusy(busyCount());
const busy = h('label', { class: 'tunelabel' }, 'Busy agents ', h('b', {}, String(busyCount())), ' ', h('input', { type: 'range', min: '0', max: '10', step: '1', value: String(busyCount()), oninput: e => { scene.setBusy(Number(e.target.value)); busy.querySelector('b').textContent = e.target.value; } }));
// A made-up question pinned on the board, as a lead's NEEDS YOU would be: the cat wakes (#284).
let asked = 0;
const ask = h('button', {}, 'New question');
ask.onclick = () => { asked++; NOTICES.push({ id: 'focus-shell', kind: 'item', label: `FocusShell #${300 + asked} · NEEDS YOU`, q: 'A new question for the cat to notice?', options: ['yes', 'no'] }); recast(); };
const door = h('button', {}, 'Send a lead out');
door.onclick = () => { const out = !away.has('video-editor'); if (out) away.add('video-editor'); else away.delete('video-editor'); door.textContent = out ? 'CTO calls the lead in' : 'Send a lead out'; recast(); };
// A drinking robot's lead gets a task (#312): it takes its mug back to the counter, then works.
const task = h('button', {}, 'Give a lead a task');
task.onclick = () => { const p = [...scene.guests.values()].find(g => g.state === 'idle' && g.where === 'seat' && !g.next && !g.hold && ROBOTS.some(([n]) => n === g.id)); if (p) { tasked.add(p.id); recast(); } };
bar.append(night, pause, ask, busy, door, task);
// Motion sliders: pick the pose to tune; a change bakes every character's poses again.
let tune = 'walk', again = null;
const rebake = () => { clearTimeout(again); again = setTimeout(() => scene.rebake(PRESETS), 250); };
const tuneBar = h('div', { class: 'bar' }, h('span', { class: 'tunelabel' }, 'Tune:'));
const sliders = h('div', { class: 'sliders' });
const showValues = () => sliders.querySelectorAll('input').forEach((x, i) => { const k = SLIDERS[i][0]; x.value = String(PRESETS[tune][k]); x.previousSibling.lastChild.textContent = String(PRESETS[tune][k]); });
for (const [m, label] of [['walk', 'Walk'], ['sit', 'Sit'], ['idle', 'Idle']]) {
  const b = h('button', { class: m === tune ? 'on' : '' }, label);
  b.onclick = () => { tune = m; tuneBar.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); showValues(); };
  tuneBar.append(b);
}
const reset = h('button', {}, 'Reset sliders');
reset.onclick = () => { PRESETS[tune] = { ...DEFAULTS[tune] }; showValues(); rebake(); };
tuneBar.append(reset);
for (const [k, label, min, max, step] of SLIDERS) {
  const val = h('b', {}, String(PRESETS[tune][k]));
  const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(PRESETS[tune][k]) });
  input.oninput = () => { PRESETS[tune][k] = Number(input.value); val.textContent = input.value; rebake(); };
  sliders.append(h('label', {}, h('span', {}, label, ' ', val), input));
}
root.append(h('details', PHONE ? { class: 'controls' } : { class: 'controls', open: '' }, h('summary', {}, 'Controls'), bar, tuneBar, sliders),
  h('figure', {}, stage, h('figcaption', {}, h('b', {}, 'The tavern at 48px tiles'), ` ${W}x${H}, shown at 2x; every piece 1:1 with the people. Walk the barkeep with the arrow keys or WASD, or click the floor.`)));
game.scale.refresh();
addEventListener('resize', () => game.scale.refresh());

// A robot's card (#277), with made-up facts in the demo; the app fills them from the boards,
// the pane's model and the token logs.
function guestCard(id) {
  const ask = NOTICES.find(x => x.id === id);
  if (ask) { noticeBoard(); return; }
  document.querySelector('.chalkshade')?.remove();
  const [, who] = ROBOTS.find(r => r[0] === id) || [id, id], n = id.length * 7;
  const facts = [['Task', `#${200 + n} Make the ${who} pane remember its split`], ['Last report', `#${190 + n} DONE: tests pass, pushed`], ['Model', n % 2 ? 'Opus 5.5' : 'Sonnet 5.5'], ['Tokens', `${n * 13}k fresh · ${(n * 0.9).toFixed(1)}M cache reads`]];
  const shade = h('div', { class: 'chalkshade' }, h('div', { class: 'chalk', role: 'dialog', 'aria-label': who },
    h('h2', {}, who), h('dl', { class: 'facts' }, ...facts.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])), h('p', { class: 'hint' }, 'Made-up facts in the demo. Esc or click outside to close')));
  shade.addEventListener('click', e => { if (e.target === shade) shade.remove(); });
  addEventListener('keydown', e => { if (e.key === 'Escape') shade.remove(); }, { once: true });
  document.body.append(shade);
}
