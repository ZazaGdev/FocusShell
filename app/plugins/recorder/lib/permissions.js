// What the recorder says when macOS has not let FocusShell record (#2562). An unsigned build
// loses these grants after every update, so the owner needs to know where to turn them on.
export const MIC_PERMISSION = 'macOS has not let FocusShell use the microphone. Turn on FocusShell in System Settings > Privacy & Security > Microphone, then try again.';

// The words for a mic that could not be opened: on a Mac a refusal names the setting.
export function micError(e, mac) {
  const name = e && e.name, msg = (e && e.message) || String(e);
  return mac && (name === 'NotAllowedError' || /permission/i.test(msg)) ? MIC_PERMISSION : `the mic could not be opened (${msg})`;
}
