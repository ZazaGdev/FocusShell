// The focus log (#1003), a debug switch: FOCUSSHELL_FOCUSLOG=1 when FocusShell starts, or a smoke
// run. Each time a terminal pane loses the keyboard it writes one line to state/focus-log.txt:
// when, which pane, where the keyboard went, whether the owner was holding the talk key, and
// what did it: the code that moved the pane in the page (a redraw) or that focused something
// else. Off, nothing here runs.

let on = false, talking = () => false;
const ring = [];          // the last lines, for the smoke run
let lastMove = null, lastFocus = null;
const short = stack => String(stack || '').split('\n').slice(2, 7).map(s => s.trim().replace(/^at /, '').replace(/\(?(file|app):\/\/\/?[^)]*\/renderer\//, '(')).join(' < ');
const desc = el => !el ? 'nothing' : el.closest && el.closest('.xterm') ? `pane ${paneOf(el)}` : `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}`;
const paneOf = el => el.closest('[data-pane]')?.dataset.pane || '?';
const isTerm = el => !!(el && el.classList && el.classList.contains('xterm-helper-textarea'));

function write(line) {
  ring.push(line); if (ring.length > 200) ring.shift();
  try { window.deck.focusLog(line); } catch { /* the log is a nicety */ }
}

// t: { talking() -> whether the talk key is held now }
export function setupFocusLog(enabled, t = {}) {
  if (!enabled || on) return;
  on = true; talking = t.talking || talking;
  // Anything that moves or removes the element holding the focused pane: remember who.
  const watchMove = (proto, name) => {
    const orig = proto[name];
    proto[name] = function (...args) {
      const a = document.activeElement;
      if (isTerm(a)) {
        const nodes = [this, ...args].filter(n => n instanceof Node);
        if (nodes.some(n => n === a || n.contains(a))) lastMove = { at: Date.now(), how: name, stack: short(new Error().stack) };
      }
      return orig.apply(this, args);
    };
  };
  for (const n of ['appendChild', 'insertBefore', 'replaceChild', 'removeChild']) watchMove(Node.prototype, n);
  for (const n of ['append', 'prepend', 'replaceChildren', 'replaceWith', 'remove', 'before', 'after']) watchMove(Element.prototype, n);
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (...args) {
    if (isTerm(document.activeElement) && this !== document.activeElement) lastFocus = { at: Date.now(), el: desc(this), stack: short(new Error().stack) };
    return focus.apply(this, args);
  };
  document.addEventListener('focusout', e => {
    if (!isTerm(e.target)) return;
    const from = desc(e.target), at = Date.now();
    setTimeout(() => {
      const to = desc(document.activeElement), back = isTerm(document.activeElement) && desc(document.activeElement) === from;
      const why = lastMove && at - lastMove.at < 100 ? `moved by ${lastMove.how}: ${lastMove.stack}`
        : lastFocus && at - lastFocus.at < 100 ? `${lastFocus.el} focused: ${lastFocus.stack}`
        : !document.hasFocus() ? 'the window lost focus (another app)' : 'no code found (a click?)';
      write(`${new Date(at).toISOString()} ${from} lost the keyboard${talking() ? ' WHILE TALKING' : ''} -> ${back ? 'given back' : to} | ${why}`);
    }, 0);
  }, true);
}
export const focusLog = () => [...ring];
