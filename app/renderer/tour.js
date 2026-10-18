// The walkthrough (#1036): after the first-run setup, a short tour that rings one part of the
// window at a time with a card of one or two lines beside it, Back / Skip / Next. Shown once;
// Settings > Preferences replays it. A step whose part is not on screen is left out.
// openTour({ h, steps: [{ sel, title, text }], onEnd(finished) })
export const TOUR = [
  { sel: '#side .sidepane', title: 'Your CTO', text: 'Tell it what you want done, in plain words. It turns that into a brief and hands it to the lead of the right project.' },
  { sel: '#tabs .tab[title^="Click to open"], #btnNew', title: 'A project and its lead', text: 'Each project tab is a lead: a Claude Code session in that folder, doing the tasks the CTO sends. + opens another one.' },
  { sel: '#home .pp-board', title: 'The Board', text: 'Every project\'s tasks in one place: what needs you, what is ready to send, what is in progress and done. Questions from the leads wait under Waiting on you, above the CTO: answer them in place.' },
  { sel: '#home .pp-me', title: 'Self', text: 'Your own to-dos and reminders. They are never sent to a lead.' },
  { sel: '#status .talkhint', title: 'Hold to talk', text: 'Hold Ctrl+Shift+Space anywhere to talk to the CTO with your voice.' },
  { sel: '.plugsbtn', title: 'Screen recorder', text: 'Under Plugins: record your screen while you talk, and FocusShell turns what you say into tasks with screenshots.' },
  { sel: '#btnSettings', title: 'Settings', text: 'Themes, spacing, fonts and more. You can replay this walkthrough from Preferences.' },
];
let layer = null;

export const tourOpen = () => !!layer;
export function closeTour() { if (layer) { layer.remove(); layer = null; } }

export function openTour({ h, steps, onEnd }) {
  closeTour();
  const shown = steps.filter(s => document.querySelector(s.sel));
  if (!shown.length) { onEnd(false); return; }
  let i = 0;
  const spot = h('div', { class: 'tourspot' }), tip = h('div', { class: 'tourtip', role: 'dialog', 'aria-label': 'Walkthrough' });
  layer = h('div', { class: 'tour' }, spot, tip);
  document.body.append(layer);
  const end = finished => { removeEventListener('resize', place); closeTour(); onEnd(finished); };
  const go = n => { i = n; if (i >= shown.length) end(true); else place(); };
  function place() {
    const s = shown[i], el = document.querySelector(s.sel);
    if (!el) { go(i + 1); return; }
    const r = el.getBoundingClientRect(), pad = 4, last = i === shown.length - 1;
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    tip.replaceChildren(h('div', { class: 'tourn' }, `${i + 1} of ${shown.length}`), h('h3', {}, s.title), h('p', {}, s.text),
      h('div', { class: 'tourfoot' },
        i ? h('button', { class: 'btn', 'data-go': 'back', onclick: () => go(i - 1) }, 'Back') : null,
        h('span', { class: 'sp' }),
        last ? null : h('button', { class: 'btn ghost', 'data-go': 'skip', onclick: () => end(false) }, 'Skip'),
        h('button', { class: 'btn primary', 'data-go': 'next', onclick: () => go(i + 1) }, last ? 'Done' : 'Next')));
    // The card sits beside the part: right of it, else left, else below or above, inside the window.
    const W = innerWidth, H = innerHeight, tw = 300, th = tip.offsetHeight || 160;
    let x = r.right + 14, y = r.top;
    if (x + tw > W - 8) x = r.left - tw - 14;
    if (x < 8) { x = Math.min(Math.max(8, r.left), W - tw - 8); y = r.bottom + 14; }
    if (y + th > H - 8) y = Math.max(8, r.top - th - 14);
    Object.assign(tip.style, { left: `${x}px`, top: `${Math.max(8, y)}px` });
  }
  addEventListener('resize', place);
  addEventListener('keydown', function esc(e) { if (!layer) { removeEventListener('keydown', esc); return; } if (e.key === 'Escape') { removeEventListener('keydown', esc); end(false); } });
  place();
}
