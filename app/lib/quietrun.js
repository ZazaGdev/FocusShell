// Short passing runs (#3073): the lead plugin's PreToolUse hook wraps a lead's or builder's
// Bash test run or build so a pass reaches Claude as a header plus its count lines, and a
// failure, or anything that looks like one, reaches it complete. Pure: no Node-only imports.
// app/lead-plugin/hooks/quiet-runs.mjs (the hook) and quiet-out.mjs (the filter) use it.

export const MARK = '__FOCUSSHELL_EXIT__:';

// A segment of a command whose first word is one of these may be a run; any other first word
// (git, grep, echo, sed, deck) only mentions one, as in a commit message or a search.
const PREFIX = [
  /^[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|\S*)\s+/, // VAR=value
  // Not exec: bash skips the subshell's EXIT trap after it, so the marker would be lost. Not
  // bash -c or cmd /c either: their quoted body is never split into parts.
  /^(?:env|time|nice|command)\s+(?:-\S+\s+)*/,
  /^timeout\s+(?:-\S+\s+)*\S+\s+/,
  /^(?:uv|poetry|pipenv|pdm|hatch)\s+run\s+/,
];
const RUNS = [
  /^(?:npm|pnpm|yarn|bun)\s+(?:--?[\w-]+(?:[= ]\S+)?\s+)*(?:run(?:-script)?\s+)?(?:test|build|lint|typecheck|check)\b/,
  /^node\b.*\s--test(?=\s|$)/,
  /^(?:npx|bunx|pnpx|pnpm\s+exec|yarn)\s+(?:--?\S+\s+)*(?:vitest|jest|mocha|playwright\s+test|tsc|eslint)\b/,
  /^(?:vitest|jest|mocha|tsc|eslint)\b/,
  /^(?:(?:npx|bunx|pnpx)\s+)?electron\s+\.\s+(?:\S+\s+)*--smoke\b/,
  /^pytest\b/,
  /^(?:python[\d.]*|py)\s+(?:-\S+\s+)*-m\s+(?:pytest|unittest)\b/,
  /^dotnet\s+(?:test|build)\b/,
  /^go\s+(?:test|build|vet)\b/,
  /^cargo\s+(?:test|build|check|clippy)\b/,
  /^(?:\S*[\\/])?gradlew?(?:\.bat)?\s.*\b(?:test|build|assemble\w*)\b/,
  /^(?:\S*[\\/])?mvnw?(?:\.cmd)?\s.*\b(?:test|verify|package|install)\b/,
  /^(?:powershell|pwsh)(?:\.exe)?\b.*\bInvoke-Pester\b/i,
  /^Invoke-Pester\b/i,
  /^flutter\s+(?:test|build)\b/,
  /^xcodebuild\b.*\s(?:test|build)\b/,
  /^make\s+(?:-\S+\s+)*(?:test|check|build)\b/,
];
// A part that changes the shell itself, which a wrapped command could not carry back.
const STATE = /^(?:export|source|unset|alias|unalias|set|\.)(?:\s|$)|^[A-Za-z_]\w*=/;

// The command's parts between unquoted && || ; & ( ) and newlines, and whether it holds an
// unquoted || or a lone background & (not &&, 2>&1, >&2, &> or |&), or an unquoted ; or newline
// (seq: the parts before it run whatever their exit code).
function segments(command) {
  const parts = [];
  let cur = '', quote = '', orOr = false, bg = false, seq = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i], prev = command[i - 1] || '', next = command[i + 1] || '';
    if (quote) {
      cur += c;
      if (c === quote) quote = '';
      else if (c === '\\' && quote === '"' && i + 1 < command.length) cur += command[++i];
    } else if (c === '"' || c === "'") { quote = c; cur += c; }
    else if (c === '\\' && i + 1 < command.length) cur += c + command[++i];
    else if (c === '&' && next === '&') { parts.push(cur); cur = ''; i++; }
    else if (c === '&' && (prev === '>' || prev === '<' || next === '>' || prev === '|')) cur += c;
    else if (c === '&') { bg = true; parts.push(cur); cur = ''; }
    else if (c === '|' && next === '|') { orOr = true; parts.push(cur); cur = ''; i++; }
    else if ('|;()\n'.includes(c)) { if (c === ';' || c === '\n') seq = true; parts.push(cur); cur = ''; }
    else cur += c;
  }
  parts.push(cur);
  return { parts: parts.map(s => s.trim()).filter(Boolean), orOr, bg, seq };
}

function bare(segment) {
  let s = segment, before;
  do {
    before = s;
    for (const p of PREFIX) s = s.replace(p, '');
  } while (s !== before);
  return s;
}

// A test run or build in the foreground whose output is not already shortened, and whose exit
// code and output are the run's own: its last part is the run. False when it pipes on (a
// single |), holds || (a masked code) or a background & (the job would hold the pipe open),
// changes the shell (export, source, set, a bare VAR=value), watches, or is empty; when a part
// other than a cd or a # comment comes before a ; or newline (its failure would not show in the
// exit code); and for a test tool's list, config, help or version form, whose output is the answer.
// run_in_background is the hook's check.
export function isRun(command) {
  const c = String(command || '');
  if (!c.trim()) return false;
  if (/(^|[^|])\|(?![|&])/.test(c) || /(^|[^|])\|&/.test(c)) return false;
  if (/--watch|(^|[^\w-])watch\b/i.test(c)) return false;
  const { parts, orOr, bg, seq } = segments(c);
  if (orOr || bg || !parts.length) return false;
  const bares = parts.map(bare);
  if (bares.some(b => STATE.test(b))) return false;
  if (seq && !bares.slice(0, -1).every(b => /^cd\s/.test(b) || b.startsWith('#'))) return false;
  const last = bares[bares.length - 1];
  if (/\s(?:--list(?:Tests|-tests)?|-list|--collect-only|--show-?config|--print-config|--help|--version)(?=[\s=]|$)|^(?:(?:npx|bunx|pnpx)\s+)?vitest\s+list\b|gradlew?(?:\.bat)?\s+(?:\S+\s+)*tasks\b|\bdependency:/i.test(last)) return false;
  return RUNS.some(r => r.test(last));
}

// The Bash text that runs the command in a subshell and pipes everything it prints, then a
// marker line with its exit code, into the filter. The subshell's EXIT trap prints the marker
// even after an `exit` in the command and saves its final folder, which the calling shell
// then cd's into, so a `cd app && npm test` still leaves the lead in app. The newlines keep a
// trailing `# comment` working. The whole line exits with node's code, which is the command's.
// A command that sets its own EXIT trap loses the marker and counts as a failure (full output).
export function wrap(command, outScript) {
  const script = String(outScript).replace(/\\/g, '/');
  return `__ad_d=$(mktemp); ( trap 'echo "${MARK}$?"; pwd -P >| "$__ad_d"' EXIT\n${command}\n) 2>&1 | node "${script}"; `
    + `__ad_rc=$?; cd "$(cat "$__ad_d" 2>/dev/null || pwd)"; rm -f "$__ad_d"; (exit $__ad_rc)`;
}

// Any sign of failure, even with exit 0. Errs on the side of true: a false alarm only costs
// the full output.
const FAILED = [
  /# fail [1-9]/,
  // Lower case: Pester 3.4's passing "Passed: 46 Failed: 0" must not read as "46 Failed".
  /\b[1-9]\d* (?:failed|failing|failures?|errors?)\b/,
  /FAILED/,
  /FAIL /,
  /Error:/,
  /ERR!/,
  /Traceback/,
  /panic:/,
  /✗/, // ballot x
  /✖/, // heavy multiplication x
  /smoke run failed/i,
  /not ok /,
  // Pester ([-] lines; 3.4 "Failed: 9", 5 "Tests Passed: 45, Failed: 1"), dotnet, maven.
  /\[-\]/,
  /\bFailed:\s*[1-9]/i,
  /\bFailures?:\s*[1-9]/i,
  /\bErrors?:\s*[1-9]/i,
  /\bFailed!/, // dotnet test (not "Failed: 0", which every passing dotnet or Pester run prints)
  /BUILD FAILURE/,
  // go test ("--- FAIL:", "FAIL\tpkg"), cargo and go build ("error[E0425]:", "error:"), tsc, make, flutter.
  /--- FAIL/,
  /^FAIL\b/m,
  /\berror(?:\[\w+\])?:/i,
  /\berror TS\d+/,
  /Error \d+\s*$/m,
  /Some tests failed/i,
  // A cd that failed before a ; (bash "cd: ap: No such file", zsh "cd: no such file"): the run went
  // in the wrong folder.
  /\bcd: /,
];
export function failedSigns(text) {
  const t = String(text || '');
  return FAILED.some(r => r.test(t));
}

export const SHORT_LINES = 40, SHORT_CHARS = 3000, COUNT_LINES = 8;
const COUNTS = [
  /^\s*(?:#|ℹ)\s*(?:tests|pass|fail|skipped|todo|duration_ms)\b/,
  /\b\d+ (?:passed|passing|tests?|specs?|suites?|skipped|pending|warnings?)\b/i,
  /\bTests?:/,
  /\bTest Suites:/,
  /\bRan \d+ tests?\b/,
  /\bBuild succeeded\b/i,
  /\b0 (?:errors?|warnings?)\b/i,
  /\bbuilt in\b/i,
  /\bcompiled successfully\b/i,
];
const lineList = text => {
  const t = String(text || '').replace(/\r/g, '');
  return t === '' ? [] : t.replace(/\n$/, '').split('\n');
};

// null: print the full text (it failed, looks failed, or is short anyway). Otherwise a header
// naming the saved output, then the count lines, or the last three lines when none look like
// counts.
export function summarize({ text, code, secs, file }) {
  const t = String(text || '');
  if (code !== 0 || failedSigns(t)) return null;
  const lines = lineList(t);
  if (lines.length < SHORT_LINES && t.length < SHORT_CHARS) return null;
  const counts = lines.filter(l => COUNTS.some(r => r.test(l))).slice(-COUNT_LINES);
  const tail = counts.length ? counts : lines.filter(l => l.trim()).slice(-3);
  const s = Math.round((Number(secs) || 0) * 10) / 10;
  return [`[FocusShell] passed (exit 0) in ${s} s: ${lines.length} lines, full output in ${file}`, ...tail].join('\n');
}

// The output without the marker line, and the exit code from it; code null when the marker is
// missing (the filter then counts it as a failure: full output, exit 1).
export function splitMark(text) {
  const t = String(text || '');
  const at = t.lastIndexOf(MARK);
  const m = at < 0 ? null : markAfter(t.slice(at + MARK.length, at + MARK.length + 16));
  if (!m) return { text: t, code: null };
  return { text: t.slice(0, at) + t.slice(at + MARK.length + m.length), code: m.code };
}

// What follows the marker: its code and how many characters (one byte each) the code and its
// line end take, or null. quiet-out.mjs uses it to split the marker out of the raw bytes.
export function markAfter(rest) {
  const m = String(rest || '').match(/^(\d+)\r?\n?/);
  return m ? { code: Number(m[1]), length: m[0].length } : null;
}
