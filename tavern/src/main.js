// The tavern mock-up's page (#238): starts the game, feeds it fake agents, and owns the bits
// around the canvas: the waiting badge, the answer box and the evening switch. In FocusShell
// the agent list and the answers will come from the app instead of fakeAgents.js.

import { TavernScene, ZOOM } from './scenes/TavernScene.js';
import { COLS, ROWS, TILE } from './core/layout.js';
import { startingAgents, tickAgents, answerAgent } from './mock/fakeAgents.js';

const Phaser = globalThis.Phaser;
export const FPS = 20;                       // capped: the tavern runs all day beside work
const EVENING_AFTER = 30 * 60 * 1000;        // no mouse or keyboard for 30 minutes
const TICK_MS = 5000;                        // how often the fake agents change

const $ = id => document.getElementById(id);
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: COLS * TILE * ZOOM,
  height: ROWS * TILE * ZOOM,
  pixelArt: true,
  backgroundColor: '#1b1412',
  fps: { limit: FPS, target: FPS },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
  scene: [TavernScene],
  banner: false,
});
// Keep moving while the owner works in another window; only a hidden page sleeps.
game.events.off(Phaser.Core.Events.BLUR, game.onBlur, game);
document.addEventListener('visibilitychange', () => document.hidden ? game.loop.sleep() : game.loop.wake());

let agents = startingAgents(), scene = null, open = null, lastActive = Date.now();
game.events.once('tavern-ready', s => {
  scene = s;
  scene.setAgents(agents);
  setInterval(() => { agents = tickAgents(agents, Math.random, Date.now() / 1000); scene.setAgents(agents); if (open && !agents.some(a => a.id === open.id && a.state === 'asking')) closeBox(); }, TICK_MS);
});

// ---- The waiting badge: what the Tavern button will show in FocusShell. ----
game.events.on('waiting', n => { $('badge').textContent = n; $('badge').hidden = !n; $('tavernBtn').title = n ? `${n} waiting at the bar` : 'Nobody waiting'; });

// ---- The answer box: the guest's question, its options, and a line for your own words. ----
game.events.on('answer-open', agent => {
  open = agent;
  const look = agent.look, s = 4;
  Object.assign($('face').style, { backgroundPosition: `-${look[0] * 17 * s}px -${look[1] * 17 * s}px`, backgroundSize: `${918 * s}px ${203 * s}px` });
  $('who').textContent = agent.role === 'lead' ? `lead-${agent.name}` : agent.name;
  $('proj').textContent = agent.project;
  $('question').textContent = agent.question.text;
  $('options').replaceChildren(...agent.question.options.map(o => {
    const b = document.createElement('button');
    b.className = 'opt' + (o === agent.question.suggest ? ' suggest' : '');
    b.textContent = o;
    if (o === agent.question.suggest) b.title = 'Suggested';
    b.onclick = () => answer(o);
    return b;
  }));
  $('words').value = '';
  $('box').hidden = false;
  game.input.keyboard.enabled = false;        // typing in the box must not walk the barkeeper
  $('words').focus({ preventScroll: true });
});
function answer(text) {
  if (!open || !text.trim()) return;
  agents = answerAgent(agents, open.id);
  scene.setAgents(agents);
  const g = scene.guests.get(open.id);
  if (g) scene.say(g, 'Thanks!');
  toast(`Sent to ${$('who').textContent}: ${text.trim()}`);
  closeBox();
}
function closeBox() { $('box').hidden = true; open = null; game.input.keyboard.enabled = true; }
$('send').onclick = () => answer($('words').value);
$('words').addEventListener('keydown', e => { if (e.key === 'Enter') answer($('words').value); if (e.key === 'Escape') closeBox(); });
$('closeBox').onclick = closeBox;
function toast(text) { const t = $('toast'); t.textContent = text; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600); }

// ---- Evening: 30 idle minutes, or the mock-up's skip button. Any key or click wakes it. ----
let forced = false;
const setEvening = on => { scene?.setEvening(on); $('evening').textContent = on ? 'Back to day' : 'Skip to evening'; $('evening').setAttribute('aria-pressed', on); };
$('evening').onclick = () => { forced = !scene.evening; lastActive = forced ? 0 : Date.now(); setEvening(forced); };
const active = () => { lastActive = Date.now(); if (scene?.evening) { forced = false; setEvening(false); } };
game.events.on('owner-active', active);
window.addEventListener('keydown', e => { if (!e.target.closest('#box')) active(); });
setInterval(() => { if (scene && !scene.evening && !forced && Date.now() - lastActive > EVENING_AFTER) setEvening(true); }, 10000);

// ---- Help, behind the ? button. ----
$('helpBtn').onclick = () => { $('help').hidden = !$('help').hidden; };
$('tavernBtn').onclick = () => { const g = [...(scene?.guests.values() || [])].find(x => x.brain.state === 'waiting'); if (g) scene.walkTo(g); };

// For a test or FocusShell later: the tavern's own handle.
window.tavern = { game, get scene() { return scene; }, setEvening, sleep: () => game.loop.sleep(), wake: () => game.loop.wake() };
