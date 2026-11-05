// A path from text as a file on this computer (#2562), for the main process only (it uses Node):
// "~/x" on a Mac is under the home folder, and everything is normalized as the system writes it.
import os from 'node:os';
import path from 'node:path';
import { isAbsPath, expandHome } from './platform.js';

export { isAbsPath };
export const onDisk = (p, home = os.homedir()) => path.normalize(expandHome(p, home));
