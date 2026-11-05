// Windows toasts wait (#320): no toast while the owner may still answer in the app. Something that
// needs the owner (a lead waiting on a prompt, a words card) toasts once, five minutes after it
// appeared, and only if it is still waiting then; the board's own items do the same through
// holdAlerts. A key that toasted never toasts again.
import { ALERT_DELAY } from './tasks.js';

export function laterToasts(delay = ALERT_DELAY) {
  const held = new Map(), sent = new Set();
  return {
    // Something new that needs the owner; the same key again keeps its first time.
    hold(key, info, now = Date.now()) { if (!held.has(key) && !sent.has(key)) held.set(key, { ...info, key, since: now }); },
    // Answered or opened: it will not toast.
    drop(key) { held.delete(key); },
    // The ones to toast now. `still(item)` says whether it still waits; one that does not is dropped.
    due(now = Date.now(), still = () => true) {
      const out = [];
      for (const [k, a] of held) {
        if (!still(a)) { held.delete(k); continue; }
        if (now - a.since >= delay) { held.delete(k); sent.add(k); out.push(a); }
      }
      return out;
    },
    get size() { return held.size; },
  };
}

// The owner is using FocusShell (#320) when its window is focused, not minimised, and they
// touched the keyboard or mouse in the last minute; otherwise they are away. idleSecs is the
// system's own idle time.
export const ACTIVE_FOR = 60 * 1000;
export function usingApp({ focused, minimized, idleSecs }) {
  return !!focused && !minimized && idleSecs * 1000 < ACTIVE_FOR;
}
// Whether a toast that came due goes out: alerts only while the owner is away, Me reminders
// always, right at their time.
export function shouldToast(kind, using) {
  return kind === 'reminder' || !using;
}
