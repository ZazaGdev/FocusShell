// The shared task counter on disk (#411): every task board in <data>/tasks, read when an item is
// added, under the board lock the writer already holds. lib/tasks.js has the rule.
import fs from 'node:fs';
import path from 'node:path';
import { parseTasks, sharedNext, SHARED_START } from './tasks.js';

const boards = dir => { try { return fs.readdirSync(dir).filter(f => f.endsWith('.md')); } catch { return []; } };
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

// The next number for a new item on `file`, whose content as it is about to be written is md.
export function nextShared(tasksDir, file, md) {
  const others = boards(tasksDir).map(f => path.join(tasksDir, f)).filter(f => path.resolve(f).toLowerCase() !== path.resolve(file).toLowerCase());
  return sharedNext([md, ...others.map(read)]);
}

// The board holding a number from the shared counter, or null (an old number needs its board).
export function boardOf(tasksDir, n) {
  if (!(n >= SHARED_START)) return null;
  const f = boards(tasksDir).find(b => parseTasks(read(path.join(tasksDir, b))).some(t => t.n === n));
  return f ? f.slice(0, -3) : null;
}
