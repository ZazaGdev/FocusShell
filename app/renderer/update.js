// In-app updates (#1088): once a new version has downloaded, a "Update ready" button sits in
// the title bar; pressing it asks once, then restarts into the new version. Nothing installs
// before that. Settings shows the version and Check now.
import { updateLabel } from '../lib/update.js';

let state = null, btn = null, changed = () => {};
export const updateInfo = () => state;

// c: { h, icon, bar: the element the button goes before, onChange() redraws Settings }
export async function setupUpdates(c) {
  changed = c.onChange || changed;
  const show = s => {
    state = s;
    const label = updateLabel(s);
    if (label && !btn) {
      btn = c.h('button', { class: 'iconbtn updbtn', title: 'A new version is downloaded. Restart FocusShell to install it', onclick: install }, c.icon('arrowup'), label);
      c.bar.before(btn);
    } else if (btn) { if (label) btn.lastChild.textContent = label; else { btn.remove(); btn = null; } }
    changed();
  };
  window.deck.onUpdate(show);
  show(await window.deck.updateState());
}

export async function checkUpdates() { state = await window.deck.updateCheck(); changed(); }

async function install() {
  if (!confirm(`Restart FocusShell to install v${state.latest}? Open sessions end, as when you close the app; your boards and settings stay.`)) return;
  await window.deck.updateInstall();
}
