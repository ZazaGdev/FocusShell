// The Sketch button on every pane (#94). The board itself (Excalidraw, built from app/sketch
// into renderer/sketch/) loads the first time it is opened, so the window never pays for it.
// Insert hands the PNG to the main process, which pastes it into that session's prompt.
import { h, toast } from './dom.js';

const DARK_KEY = 'focusshell.sketch.dark';
const scenes = new Map(); // session id -> the drawing left on its board
let board = null;

function darkPref() { try { return localStorage.getItem(DARK_KEY) === '1'; } catch { return false; } }
function setDarkPref(v) { try { localStorage.setItem(DARK_KEY, v ? '1' : '0'); } catch { /* not kept */ } }

async function loadBoard() {
  if (document.querySelector('.sk-host')) return false;
  try {
    if (!board) {
      window.EXCALIDRAW_ASSET_PATH = new URL('./sketch/', import.meta.url).href;
      board = await import('./sketch/board.js');
      document.head.append(h('link', { rel: 'stylesheet', href: new URL('./sketch/board.css', import.meta.url).href }));
    }
    return true;
  } catch {
    toast('The Sketch board is not built. Run npm run sketch in the app folder.', true);
    return false;
  }
}

export async function openSketch(id, name, refocus) {
  if (!(await loadBoard())) return;
  const host = h('div', { class: 'sk-host' });
  document.body.append(host);
  let unmount = () => {};
  const done = scene => { scenes.set(id, scene); unmount(); host.remove(); refocus(); };
  unmount = board.mountBoard(host, {
    target: name,
    dark: darkPref(),
    scene: scenes.get(id),
    onDark: setDarkPref,
    onClose: done,
    onInsert: async (blob, scene) => {
      const ok = await window.deck.sketchPaste(id, new Uint8Array(await blob.arrayBuffer()));
      if (!ok) { toast(`Could not insert the sketch: ${name} is not running`, true); return; }
      done(scene);
    },
  });
}

// A saved board (#130): rel names an existing one; without it a new board called `name`
// is made in `project`'s sketches once something is drawn. Closing saves the drawing and
// its preview when it changed; onSaved(rel) follows. A name changed in the board (#144)
// names a new board, or renames a saved one: files and every line move to the new id.
export async function openSavedSketch({ rel, project, name, sub, onSaved }) {
  if (!(await loadBoard())) return;
  const scene = rel ? await window.deck.sketchLoad(rel) : null;
  if (rel && !scene) { toast(`Could not open the sketch ${rel}`, true); return; }
  const before = JSON.stringify(scene ? scene.elements : []);
  const host = h('div', { class: 'sk-host' });
  document.body.append(host);
  let unmount = () => {};
  unmount = board.mountBoard(host, {
    target: name, title: `Sketch: ${name}`, name, sub: sub || (rel ? 'saved when you close it' : `a new sketch in ${project}, saved when you close it`),
    dark: darkPref(), scene: scene || undefined, onDark: setDarkPref,
    onClose: () => { unmount(); host.remove(); },
    onSave: async (s, blob, newName = name) => {
      const live = (s.elements || []).filter(e => !e.isDeleted);
      const drawn = JSON.stringify(s.elements) !== before, renamed = !!rel && newName !== name;
      if ((!drawn && !renamed) || (!rel && !live.length)) return;
      let r = { rel };
      if (drawn) r = await window.deck.sketchSave({ rel, project, name: newName, scene: s, png: blob ? new Uint8Array(await blob.arrayBuffer()) : null });
      if (!r.error && renamed) r = await window.deck.sketchRename(rel, newName);
      if (r.error) { toast(r.error, true); return; }
      if (onSaved) await onSaved(r.rel);
    },
  });
}
