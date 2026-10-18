// The installer's seed data (#358): the lead prompt and the manager, pm and skill folders,
// copied into build/seed from git's list of tracked files only. Copying the folders from disk
// once packed untracked files too, such as a browser tool's logs in manager/.
// personal/ is the owner's private template and never ships (#390); without it Personal
// simply does not seed. Run by `npm run dist` and `npm run pack` before electron-builder.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(APP, '..');
const OUT = path.join(APP, 'build', 'seed');
// The pane scripts the CTO's rules run from the data folder, and the module they import (#388).
const SCRIPTS = ['open-pane.ps1', 'close-pane.ps1', 'ask-owner.ps1', 'src/FocusShell.psm1'];
const SEED = ['lead-prompt.md', 'manager', 'pm', 'skill', ...SCRIPTS];
// Words that name the owner's private projects or work: a seeded file holding one stops the
// build. They come from this PC's own projects.json and git identity, so the list itself never
// ships (#1063).
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const words = [];
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'projects.json'), 'utf8').replace(/^﻿/, ''));
  for (const p of cfg.projects || []) if (p.name && p.name.length >= 2 && !['FocusShell', 'Personal'].includes(p.name)) words.push(`\\b${escape(p.name)}\\b`);
} catch { /* no projects.json: a public copy */ }
try {
  const email = execFileSync('git', ['config', 'user.email'], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (email) words.push(escape(email), ...(email.split('@')[1] ? [escape(email.split('@')[1].split('.')[0])] : []));
} catch { /* no identity */ }
const PRIVATE = words.length ? new RegExp(words.join('|'), 'i') : null;

const tracked = execFileSync('git', ['ls-files', '-z', '--', ...SEED], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter(Boolean);
for (const f of ['lead-prompt.md', ...SCRIPTS]) if (!tracked.includes(f)) throw new Error(`seed: ${f} is not tracked by git`);
// Each file as the last commit has it, never the copy on disk, which may hold the owner's own
// uncommitted rules or permissions (#1063).
const committed = f => execFileSync('git', ['show', `HEAD:${f}`], { cwd: ROOT, maxBuffer: 64 << 20 });
fs.rmSync(OUT, { recursive: true, force: true });
for (const f of tracked) {
  const body = committed(f), m = PRIVATE && body.toString('utf8').match(PRIVATE);
  if (m) throw new Error(`seed: ${f} names "${m[0]}", which must not ship`);
  const to = path.join(OUT, f);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, body);
}
console.log(`seed: ${tracked.length} tracked files into build/seed`);
