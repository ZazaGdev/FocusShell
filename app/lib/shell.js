// Child processes on either system (#2562). Windows runs a command line through cmd.exe and
// ends a stuck one with taskkill; a Mac runs it through sh and ends its process group. A Mac
// app started from the Dock or Finder gets a bare PATH (/usr/bin:/bin:...), so `claude`,
// node and git installed by the owner are found through the login shell's PATH instead.
import { execFileSync } from 'node:child_process';

export const isWin = (platform = process.platform) => platform === 'win32';

// What spawn gets for one command line: { file, args, opts }. On a Mac the child leads its own
// process group (detached), so killTree can end it with everything it started.
export function shellCommand(cmd, platform = process.platform) {
  return isWin(platform)
    ? { file: 'cmd.exe', args: ['/d', '/s', '/c', cmd], opts: { windowsHide: true, windowsVerbatimArguments: true } }
    : { file: '/bin/sh', args: ['-c', cmd], opts: { detached: true } };
}

// Ends a child and everything it started. Quiet when it is already gone.
export function killTree(pid, platform = process.platform) {
  if (!pid) return;
  if (isWin(platform)) { try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { /* gone */ } return; }
  try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
}

// The login shell's PATH, read between two markers so whatever the owner's shell files print
// around it is ignored. null when the shell gave nothing usable.
const MARK = '__FOCUSSHELL_PATH__';
export const PATH_PROBE = `printf '${MARK}%s${MARK}' "$PATH"`;
export function pathFromProbe(out) {
  const m = String(out || '').match(new RegExp(`${MARK}(.*?)${MARK}`, 's'));
  return m && m[1].trim() ? m[1].trim() : null;
}

// The login shell's PATH first, then anything of the app's own PATH it lacks.
export function mergePath(login, own) {
  const seen = new Set(), out = [];
  for (const d of [...String(login || '').split(':'), ...String(own || '').split(':')]) if (d && !seen.has(d)) { seen.add(d); out.push(d); }
  return out.join(':');
}

// Asks the owner's shell (interactive and login, so both .zprofile and .zshrc count) for its
// PATH, once at start. Windows keeps its own PATH; a failure keeps the app's.
export function loginPath(env = process.env, platform = process.platform, run = execFileSync) {
  if (isWin(platform)) return env.PATH || '';
  const sh = env.SHELL || '/bin/zsh';
  try {
    const got = pathFromProbe(run(sh, ['-ilc', PATH_PROBE], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }));
    return got ? mergePath(got, env.PATH) : env.PATH || '';
  } catch { return env.PATH || ''; }
}
