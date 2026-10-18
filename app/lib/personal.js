// Personal (#177): a project of kind "personal" is the owner's private agent, not a code
// project. It starts as lead-<Name> with its own CLAUDE.md as its rules (no lead prompt),
// and its folder is filled from FocusShell's personal/ template the first time it opens.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CLAUDE } from './sessions.js';

export const isPersonal = p => !!p && p.kind === 'personal';

// The session's command line: like a lead's, without the lead prompt.
export function personalArgs(name, resumeId) {
  const args = ['/c', CLAUDE, '-n', `lead-${name}`, '--remote-control', `lead-${name}`, '--permission-mode', 'auto'];
  return resumeId && /^[0-9a-f-]{36}$/i.test(resumeId) ? [...args, '--resume', resumeId] : args;
}

// Copies the template into dir without overwriting a file, then makes it a local git
// repository whose pre-push hook refuses every push. Only when dir has no CLAUDE.md yet.
// Returns true when it seeded.
export function seedPersonal(template, dir, git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'ignore', windowsHide: true })) {
  if (fs.existsSync(path.join(dir, 'CLAUDE.md')) || !fs.existsSync(path.join(template, 'CLAUDE.md'))) return false;
  const copy = (from, to) => {
    if (fs.statSync(from).isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      for (const f of fs.readdirSync(from)) if (f !== 'git-hooks') copy(path.join(from, f), path.join(to, f));
    } else if (!fs.existsSync(to)) fs.copyFileSync(from, to);
  };
  copy(template, dir);
  try {
    if (!fs.existsSync(path.join(dir, '.git'))) git(['init', '-q'], dir);
    const hooks = path.join(dir, '.git', 'hooks'), hook = path.join(template, 'git-hooks', 'pre-push');
    fs.mkdirSync(hooks, { recursive: true });
    if (fs.existsSync(hook)) fs.copyFileSync(hook, path.join(hooks, 'pre-push'));
    git(['add', '-A'], dir);
    git(['commit', '-q', '-m', 'Personal, from the FocusShell template'], dir);
  } catch { /* git missing or no identity: the files are there, Personal commits later */ }
  return true;
}
