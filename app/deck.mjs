// The deck command (#225): `node <data folder>/deck.mjs <verb> ...`. Sessions change boards
// only through it; the launcher in the data folder sets FOCUSSHELL_DATA and imports this.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { run } from './lib/deckcli.js';
import { guardReason } from './lib/guard.js';

const argv = process.argv.slice(2);
const at = argv.indexOf('--data');
const data = path.resolve(at >= 0 ? argv.splice(at, 2)[1] : process.env.FOCUSSHELL_DATA || process.cwd());
const git = args => execFileSync('git', ['-C', data, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
// `deck guard` is the CTO's and PM's PreToolUse hook (#349): it reads the tool call on stdin
// and exits 2 with the reason when it would edit a board by hand, so Claude Code refuses it.
if (argv[0] === 'guard') {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
  const why = guardReason(input, data);
  if (why) { console.error(why); process.exit(2); }
  process.exit(0);
}
try {
  console.log(run(argv, { data, lock: path.join(data, 'state', 'board.lock'), git }));
} catch (e) {
  console.error(`deck: ${e.message}`);
  process.exit(1);
}
