// Windows voice typing into a box (#415): Win+H opens Windows' voice typing bar, which then
// stays on screen until something closes it. Every box that starts it goes through here, so the
// bar closes again when the dictation is over: the box loses focus (Send clicked, another app
// in front), the box goes away (its card or panel closed), or the caller says it is done.

let box = null, startedAt = 0, watch = null;
const GRACE_MS = 1500; // a blur right after Win+H is Windows opening the bar, not the owner leaving

function onBlur() { if (Date.now() - startedAt >= GRACE_MS) voiceDone(); }

// Starts voice typing into this box (it should have the cursor). Already listening into it, it
// presses nothing again: Win+H toggles the bar, so a second press would close it (#1083).
export function voiceInto(el) {
  if (box && box === el) return Promise.resolve(true);
  if (box && box !== el) voiceDone();
  box = el; startedAt = Date.now();
  if (el) {
    el.addEventListener('blur', onBlur);
    clearInterval(watch);
    watch = setInterval(() => { if (!box || !box.isConnected) voiceDone(); }, 500);
  }
  return window.deck.voiceType();
}

// Ends it and closes the bar FocusShell opened. Safe to call when nothing is listening.
export function voiceDone() {
  clearInterval(watch); watch = null;
  if (box) box.removeEventListener('blur', onBlur);
  const was = box; box = null;
  if (was !== null) window.deck.voiceStop();
}
