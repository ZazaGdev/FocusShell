// Copies the tavern room (#246) into the app: the scene's code from tavern/demos (room, gemini,
// people, art) and the pictures it draws from tavern/art (sprites, props), into
// renderer/tavern/room/ with the same folders, so the code's own relative paths still work.
// The tavern folder stays the one source; this copy is ignored by git. The app runs it at every
// start in development (main.js) and npm run room / dist / pack before packaging.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export function copyRoom(app = APP) {
  const from = path.join(app, '..', 'tavern'), to = path.join(app, 'renderer', 'tavern', 'room');
  if (!fs.existsSync(path.join(from, 'demos', 'room', 'roomscene.js'))) return false;
  for (const dir of ['demos/room', 'demos/gemini', 'demos/people', 'demos/art', 'art/sprites', 'art/props']) {
    fs.cpSync(path.join(from, dir), path.join(to, dir), { recursive: true, filter: f => !/\.(html|md)$|[\/]demos[\/]room[\/]room\.js$/.test(f) });
  }
  return true;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(copyRoom() ? 'tavern room copied' : 'tavern room not found');
