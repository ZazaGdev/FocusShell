// The lead plugin's PreToolUse hook for Bash (#3073): a foreground test run or build is
// rewritten to pipe its output through quiet-out.mjs, so a pass reaches Claude short and a
// failure complete. It only ever returns updatedInput, never a permissionDecision, so the
// owner's permission checks run as usual. Any error: no output and exit 0, so a bug never
// blocks or changes a tool call.
import { fileURLToPath } from 'node:url';

async function main() {
  let raw = '';
  process.stdin.setEncoding('utf8'); // a character split across two chunks stays whole
  for await (const chunk of process.stdin) raw += chunk;
  const hook = JSON.parse(raw);
  if (hook.tool_name !== 'Bash') return;
  const input = hook.tool_input || {};
  if (input.run_in_background === true) return;
  const { isRun, wrap } = await import('../../lib/quietrun.js');
  if (typeof input.command !== 'string' || !isRun(input.command)) return;
  const outScript = fileURLToPath(new URL('./quiet-out.mjs', import.meta.url));
  const updatedInput = { ...input, command: wrap(input.command, outScript) };
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput } }));
}

main().catch(() => {}).finally(() => { process.exitCode = 0; });
