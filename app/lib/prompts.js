// A lead stopped on Claude Code's own prompt (#119): a permission dialog ("Do you want to
// proceed?" with numbered options) or a question picker ("Enter to select"). Read from the
// terminal output since the owner last typed in that pane.

// Terminal output as plain text. ConPTY writes runs of spaces as cursor-forward moves, so
// those become a space; every other escape sequence is dropped.
export function plainText(s) {
  return String(s)
    .replace(/\x1b\[\d*C/g, ' ')
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

// What the lead waits on, in a few words, or null.
export function waitingFor(output) {
  const text = plainText(output).replace(/\s+/g, ' ');
  const asks = [...text.matchAll(/Do you want to [^?]{1,160}\?/g)];
  const after = asks.length ? text.slice(asks[asks.length - 1].index) : '';
  // Working again after the prompt means it was answered (from the phone, say) (#146).
  if (asks.length && /\b1\. ?Yes\b/.test(after) && !/esc to interrupt/i.test(after)) return asks[asks.length - 1][0];
  const pick = text.lastIndexOf('Enter to select');
  if (pick >= 0 && !/esc to interrupt/i.test(text.slice(pick))) return 'a question in its pane';
  return null;
}

// When to tell the CTO (#146): once per prompt, and only when the owner has left it for
// ALERT_AFTER. A prompt that drops out of view for less than GONE_AFTER (a redraw) is the
// same prompt; one gone longer was answered, and a later one is a new prompt.
export const ALERT_AFTER = 5 * 60e3, GONE_AFTER = 60e3;
// prev: { what, since, goneAt, told } or null. Returns { state, alert }.
export function alertStep(prev, what, now) {
  if (!what) {
    if (!prev) return { state: null, alert: false };
    const goneAt = prev.goneAt ?? now;
    return { state: now - goneAt >= GONE_AFTER ? null : { ...prev, goneAt }, alert: false };
  }
  const st = prev && prev.what === what ? { ...prev, goneAt: null } : { what, since: now, goneAt: null, told: false };
  if (st.told || now - st.since < ALERT_AFTER) return { state: st, alert: false };
  return { state: { ...st, told: true }, alert: true };
}

// The prompt on a lead's screen (#152), read from its terminal rows so the owner can answer
// it from FocusShell: a permission dialog ("Do you want to proceed?") or a question picker
// ("Enter to select"). Returns { kind, ask, detail, options: [{ n, label }], at, other } or
// null; `at` is the option the cursor is on and `other` the option that takes typed words.
const OPT = /^\s*([❯>›]\s*)?(\d+)\.\s+(.*\S)\s*$/;
const RULE = l => /^[\s─━╭╮╰╯-]*$/.test(l) && /[─━-]{6}/.test(l); // a box edge or a divider
export function readPrompt(rows) {
  const lines = rows.map(l => String(l).replace(/^\s*│ ?/, '').replace(/\s*│\s*$/, '').replace(/\s+$/, ''));
  let ask = -1, foot = -1;
  lines.forEach((l, i) => { if (/Do you want to [^?]{1,160}\?/.test(l)) ask = i; if (/Enter to select/.test(l)) foot = i; });
  const kind = foot > ask ? 'question' : ask >= 0 ? 'permission' : null;
  if (!kind) return null;
  // Numbered options: below the question for a permission, above the footer for a picker.
  let first = -1;
  if (kind === 'permission') first = lines.findIndex((l, i) => i > ask && OPT.test(l));
  else for (let i = foot - 1; i >= 0; i--) { if (OPT.test(lines[i])) first = i; else if (first >= 0 && lines[i].trim() && !/^\s{3,}/.test(lines[i])) break; }
  if (first < 0) return null;
  const options = [];
  let at = 1;
  for (let i = first; i < lines.length && i !== foot; i++) {
    const m = lines[i].match(OPT);
    if (m && +m[2] === options.length + 1) { options.push({ n: +m[2], label: m[3] }); if (m[1]) at = +m[2]; continue; }
    if (RULE(lines[i])) break;
    if (!lines[i].trim()) { if (kind === 'permission') break; continue; }
    // A wrapped permission option carries on; a picker's indented line describes its option.
    if (kind === 'permission' && options.length) options[options.length - 1].label += ' ' + lines[i].trim();
  }
  let q, detail = [];
  if (kind === 'permission') {
    q = lines[ask].trim();
    for (let i = ask - 1; i >= 0 && detail.length < 8; i--) {
      if (RULE(lines[i])) break;
      detail.unshift(lines[i].trim());
    }
  } else {
    let i = first - 1;
    while (i >= 0 && !lines[i].trim()) i--;
    q = i >= 0 ? lines[i].trim() : 'A question';
  }
  detail = detail.join('\n').replace(/^\n+|\n+$/g, '').replace(/\n{3,}/g, '\n\n');
  const other = options.find(o => kind === 'permission' ? /^No\b.*tell Claude/i.test(o.label) : /^(Type something|Other)\b/i.test(o.label));
  return { kind, ask: q, detail, options, at, other: other ? other.n : null };
}

// The prompt only while it is live on the lead's screen (#191): the output text alone also
// matches a prompt that was answered, since a narrow pane drops "esc to interrupt" from the
// spinner. A live prompt replaces Claude Code's input line, so an input line ("> ", not
// "> 1.") below the question means the prompt is gone and only its text is left.
const INPUT = /^\s*[│|]?\s*[>❯](\s+(?!\d+\.)\S|\s*$)/;
export function livePrompt(rows) {
  const p = readPrompt(rows);
  if (!p) return null;
  const lines = rows.map(String);
  let from = -1;
  lines.forEach((l, i) => { if (/Do you want to [^?]{1,160}\?/.test(l) || /Enter to select/.test(l)) from = i; });
  return lines.slice(from + 1).some(l => INPUT.test(l)) ? null : p;
}

// Whether the prompt on screen now is the one a card was drawn from (#388): the same question,
// command, options and highlighted option. Two prompts often share "Do you want to proceed?".
export function samePrompt(a, b) {
  if (!a || !b) return false;
  return a.kind === b.kind && a.ask === b.ask && a.detail === b.detail && a.at === b.at
    && a.options.length === b.options.length && a.options.every((o, i) => o.n === b.options[i].n && o.label === b.options[i].label);
}

// What to type into the pane to answer: arrows from the highlighted option, then Enter.
// Typed words go into a picker's "Type something" option; for a permission (or a picker
// without one) Escape turns it down and the words go to Claude as the next message.
const DOWN = '\x1b[B', UP = '\x1b[A';
const moveTo = (p, n) => (n > p.at ? DOWN : UP).repeat(Math.abs(n - p.at));
export function answerKeys(p, { n, text }) {
  if (n) return [moveTo(p, n) + '\r'].filter(Boolean);
  const words = String(text || '').replace(/\s+/g, ' ').trim();
  if (!words) return [];
  if (p.kind === 'question' && p.other) return [moveTo(p, p.other), words, '\r'].filter(Boolean);
  return ['\x1b', words, '\r'];
}

// What the owner has written in Claude Code's input box and not sent yet (#243), read from the
// pane's rows: the text after the last "> " line that sits right under a divider, up to the
// next divider. '' for an empty box, null when the screen shows no input box. A sent prompt
// echoed in the conversation has no divider above it, so it does not count.
const BOX_LINE = /^\s*[│|]?\s*[>❯](\s|$)(?!\s*\d+\.)/;
export function inputDraft(rows) {
  const lines = rows.map(l => String(l).replace(/\s+$/, ''));
  let at = -1;
  lines.forEach((l, i) => { if (i > 0 && BOX_LINE.test(l) && RULE(lines[i - 1])) at = i; });
  if (at < 0) return null;
  const text = [];
  for (let i = at; i < lines.length && (i === at || !RULE(lines[i])); i++) {
    text.push(lines[i].replace(/^\s*│ ?/, '').replace(/\s*│$/, '').replace(i === at ? /^\s*[>❯]\s?/ : /^$/, ''));
  }
  return text.join('\n').trim();
}
