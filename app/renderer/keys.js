// The window's keys (#1785, from app.js): talking to the CTO by voice, the search and the PM's
// show and hide.
import { MAIN, PM } from '../lib/groups.js';
import * as T from './terminal.js';
import { toast } from './dom.js';
import { openCard, talkIntoCard } from './task-detail.js';
import { talkIntoWhiteboard, whiteboardOpen } from './whiteboard.js';
import { talkIntoHelper, helperOpen } from './helper.js';
import { setTalking } from './cto-line.js';
import { openSearch, searchKey } from './search.js';
import { navKey } from './nav.js';

// a: app.js's shared state and functions (S there), read when each key comes.
export function windowKeys(a) {
  const talkKey = e => e.ctrlKey && e.shiftKey && e.code === 'Space';
  const pmKey = e => e.ctrlKey && e.shiftKey && e.code === 'KeyP';
  // Ctrl+K stays with Claude Code inside a pane; Ctrl+Shift+K opens the search from there (#233).
  T.setKeyFilter(e => !talkKey(e) && !pmKey(e) && !(searchKey(e) && e.shiftKey) && !navKey(e));
  addEventListener('keydown', e => {
    if (!searchKey(e) || (!e.shiftKey && e.target.closest && e.target.closest('.xterm'))) return;
    e.preventDefault(); e.stopPropagation();
    if (!e.repeat) openSearch({ tasksMd: a.tasksMd, open: a.showTask });
  }, true);
  // Ctrl+Shift+P shows or hides the PM over the coding view; Escape hides it unless a
  // terminal has the keyboard (Escape means something to Claude Code there).
  function togglePm() { if (!a.settings.runPm) return; a.pmOpen = !a.pmOpen; a.render(); if (a.pmOpen) T.focus(PM); }
  addEventListener('keydown', e => {
    if (pmKey(e) && (a.view === 'single' || a.view === 'split')) { e.preventDefault(); togglePm(); }
    else if (e.key === 'Escape' && a.pmOpen && (a.view === 'single' || a.view === 'split') && !e.target.closest('.xterm')) { a.pmOpen = false; a.render(); }
  }, true);
  T.setLinkFailHandler(p => toast(`Can't find ${p}`, true));
  T.setFileOpener((...args) => a.openFile(...args));
  addEventListener('keydown', e => {
    if (!talkKey(e)) return;
    e.preventDefault();
    // With a card open, the voice goes into the card's box instead of the CTO's terminal. The
    // key's repeats while it is held start nothing more: each start presses Win+H, which toggles
    // the voice typing bar, and a held key left it open (#1083).
    if (e.repeat && (helperOpen() || whiteboardOpen() || openCard())) return;
    if (talkIntoHelper()) return;
    if (talkIntoWhiteboard()) return;
    if (openCard()) { talkIntoCard(); return; }
    if (a.voiceMode === 'tap' && e.repeat) return;
    talkAt = Date.now();
    // Tap mode: the first press starts the dictation and the next one ends it (#1018).
    if (a.voiceMode === 'tap') tapSince = tapSince ? 0 : talkAt;
    const to = a.view === 'home' || a.view === 'project' ? MAIN : a.curMgr();
    T.typed(to, ' '); a.deck.write(to, ' ');
  }, true);
  // Claude Code's own dictation, Space held inside a pane, is talking too (#1018): its repeats
  // keep it going like the talk key's. Enter in a pane ends a tapped dictation.
  addEventListener('keydown', e => {
    if (!e.target.closest || !e.target.closest('.xterm')) return;
    if (e.code === 'Space' && e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey) talkAt = Date.now();
    else if (e.key === 'Enter' || e.key === 'Escape') tapSince = 0;
  }, true);
  // The talk key's last press: held, it repeats every few tens of ms (#1003's focus log). A tapped
  // dictation counts until the second tap, for two minutes at most.
  let talkAt = 0, tapSince = 0;
  const TAP_MAX = 2 * 60 * 1000;
  const talking = () => Date.now() - talkAt < 400 || (tapSince > 0 && Date.now() - tapSince < TAP_MAX);
  setTalking(talking);
  // The same key from another app talks to the main CTO (#253); its Space presses count as typing.
  // There, letting go sends it (#415); inside the app the words wait in the prompt for the owner.
  a.deck.onTalkGlobal(id => T.typed(id, ' '));
  a.deck.onTalkSent(id => toast(`Sent to the ${a.mgrName(id)}`));
  return { togglePm, talking };
}
