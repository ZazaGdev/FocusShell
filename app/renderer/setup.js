// The first-run setup (#1061): with no project connected and setup neither finished nor
// skipped, the window is this short wizard, one step per screen, each with an illustration and
// Back, Next and Skip setup: 1 Welcome, 2 Connect your projects, 3 Check Claude Code, 4 All set.
// Finishing or skipping calls done(); the app then starts as usual.
// c: { h, icon, deck, toast, given, names() the projects connected, refresh() reloads the
//      project list and resolves their number, done() }
import { emptyBoard } from './connect.js';
import { art } from './art.js';

let step = 0, claude = null, checking = false;
export function resetSetup() { step = 0; claude = null; }

export function setupWizard(root, c) {
  const { h } = c;
  // The projects connected one by one, the ones a chip's x can take off.
  let conn = new Set();
  const loadConn = async () => { try { conn = new Set((await c.deck.connectedProjects()).projects.map(p => p.name)); } catch { conn = new Set(); } };
  const draw = () => {
    const names = c.names(), steps = [welcome, connect, check, ready], last = step === steps.length - 1;
    root.replaceChildren(h('div', { class: 'setup' }, h('div', { class: 'setupcard', 'data-step': String(step + 1) },
      h('div', { class: 'setupdots' }, steps.map((_, i) => h('i', { class: i <= step ? 'on' : '' }))),
      h('div', { class: 'setupn' }, `Step ${step + 1} of ${steps.length}`),
      ...steps[step](names),
      h('div', { class: 'setupfoot' },
        step ? h('button', { class: 'btn', 'data-go': 'back', onclick: () => { step--; draw(); } }, 'Back') : null,
        h('span', { class: 'sp' }),
        last ? null : h('button', { class: 'btn ghost', 'data-go': 'skip', onclick: () => c.done(true) }, 'Skip setup'),
        h('button', { class: 'btn primary', 'data-go': 'next', onclick: () => { if (last) c.done(false); else { step++; draw(); } } },
          last ? 'Open the Board' : step === 1 && !names.length ? 'Next (connect later)' : 'Next')))));
  };
  const welcome = () => [art('welcome'), h('h1', {}, 'Welcome to FocusShell'),
    h('p', {}, 'One window for all your Claude Code sessions: a CTO hands tasks to a lead in each project, and you follow it all on one Board.')];
  const connect = names => [art('connect'), h('h1', {}, 'Connect your projects'),
    h('p', {}, 'Select your project folders, as many as you like at once. Each one becomes a project.'),
    h('p', {}, 'Connecting a folder means you trust it: Claude Code will run there with its settings and hooks, and FocusShell answers Claude Code\'s "trust this folder" question for you.'),
    emptyBoard({ ...c, bare: true, has: names.length > 0, refresh: async () => { const n = await c.refresh(); await loadConn(); draw(); return n; } }),
    // A project picked by mistake comes off again with its x (#1106): it is disconnected only,
    // its folder stays. One listed from an older setup's projects folder has no x.
    names.length ? h('div', { class: 'setupnames' }, names.map(n => h('span', {}, n,
      conn.has(n) ? h('button', { class: 'tagx', 'data-rm': n, title: `Remove ${n} (its folder stays)`, onclick: async () => {
        await c.deck.removeProject(n); await c.refresh(); await loadConn(); draw();
      } }, c.icon('x')) : null))) : null];
  const check = () => {
    if (!claude && !checking) { checking = true; c.deck.setupClaude().then(r => { claude = r; }, () => { claude = { found: false }; }).finally(() => { checking = false; if (step === 2) draw(); }); }
    const r = claude;
    const [tone, head, sub] = !r ? ['', 'Checking Claude Code…', ''] : !r.found ? ['bad', 'Claude Code not found', 'Install it, then press Check again.']
      : r.tooOld ? ['bad', `Claude Code ${r.version} is too old`, `The CTO and the leads need ${r.min} or later to message each other. Open a terminal, run claude update, then press Check again.`]
      : !r.loggedIn ? ['warn', `Claude Code ${r.version} found, not signed in`, 'Open a terminal, run claude and sign in, then press Check again.']
      : ['ok', `Claude Code ${r.version} found, signed in`, 'Ready: sessions start in your projects.'];
    return [art('check'), h('h1', {}, 'Check Claude Code'), h('p', {}, 'FocusShell runs Claude Code in every pane.'),
      h('div', { class: 'setupchk ' + tone }, h('i', {}), h('div', {}, h('b', {}, head), sub ? h('span', {}, sub) : null)),
      h('div', { class: 'bempty-acts' },
        h('button', { class: 'btn', onclick: () => { claude = null; draw(); } }, 'Check again'),
        r && !r.found ? h('button', { class: 'btn', onclick: () => c.deck.openPath('https://docs.anthropic.com/en/docs/claude-code/setup') }, 'How to install') : null)];
  };
  const ready = names => [art('ready'), h('h1', {}, 'All set'), h('p', {}, names.length
    ? 'Your projects are on the Board. Talk to the CTO in the pane on the left: tell it what you want done, and it hands the work to each project\'s lead.'
    : 'No projects yet: connect them from the Board any time. Then talk to the CTO in the pane on the left.')];
  draw();
  loadConn().then(() => { if (step === 1) draw(); });
}
