// A macOS permission FocusShell is missing (#2562), said once per run as a notification, so a
// feature that cannot work says why instead of failing quietly.
import { Notification } from 'electron';

const told = new Set();
export function tellOnce(why) {
  if (!why || told.has(why)) return;
  told.add(why);
  try { if (Notification.isSupported()) new Notification({ title: 'FocusShell needs a permission', body: why }).show(); } catch { /* nowhere to say it */ }
}
