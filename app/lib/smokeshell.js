// The smoke run's typed lines on a Mac (#2562): its fake sessions run sh there, not cmd, so a
// line in cmd's words is said in sh's. "cls" clears, " & " runs the next command, and each
// "echo <text>" prints its text as cmd would (^> is a plain >, spaces kept). Anything else
// (a key, text typed into a prompt) goes as it is.
export function shLine(s) {
  const str = String(s), end = /\r$/.test(str) ? '\r' : '';
  const body = end ? str.slice(0, -1) : str;
  if (!/^(cls|echo )/.test(body)) return str;
  const q = t => `'${t.replace(/\^>/g, '>').replace(/'/g, "'\\''")}'`;
  // printf, not echo: zsh's echo reads backslashes, cmd's prints them. cmd leaves a blank line
  // after a command's output, before its prompt, which ends a prompt's option list; so does this.
  const parts = body.split(' & ').map(p => (p === 'cls' ? 'clear' : p.startsWith('echo ') ? `printf '%s\\n' ${q(p.slice(5))}` : p));
  return parts.join('; ') + (/(^|& )echo /.test(body) ? "; printf '\\n'" : '') + end;
}
