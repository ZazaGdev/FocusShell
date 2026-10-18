// The public copy of FocusShell (#358): copies the keep-list below from this repo's last
// commit into a fresh folder outside the repo and makes it a new git repository, so the
// public repo starts with one commit and none of this repo's history or private data.
// It never pushes and never touches this repo.
//
//   node tools/publish.mjs <empty folder outside this repo> [--author "Name <email>"]
//
// Without --author it stops after `git init`, so the commit identity stays the owner's choice.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// What goes public. Everything else stays here: the boards, briefs, notes, ideas,
// sketches, projects.json, groups.json, docs, mockups, the Demo, Personal, CLAUDE.md, state.
export const KEEP = ['app', 'manager', 'pm', 'skill', 'tavern', 'src', 'tests', 'tools/publish.mjs',
  'lead-prompt.md', 'install.ps1', 'launch.ps1', 'open-pane.ps1', 'close-pane.ps1', 'ask-owner.ps1',
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', '.gitignore'];
// Never public, even inside a kept folder.
const DROP = /(^|\/)(\.playwright-mcp|state|dist|node_modules)(\/|$)/;

const args = process.argv.slice(2);
const at = args.indexOf('--author'), author = at >= 0 ? args[at + 1] : '';
const target = args.find((a, i) => !a.startsWith('--') && !(at >= 0 && i === at + 1));
if (!target) { console.error('usage: node tools/publish.mjs <empty folder outside this repo> [--author "Name <email>"]'); process.exit(1); }
const out = path.resolve(target);
const rel = path.relative(ROOT, out);
if (!rel.startsWith('..') && !path.isAbsolute(rel)) { console.error(`${out} is this repo or inside it; choose a folder outside it`); process.exit(1); }
if (fs.existsSync(out) && fs.readdirSync(out).length) { console.error(`${out} is not empty`); process.exit(1); }

const git = (a, cwd = ROOT) => execFileSync('git', a, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 });
const head = git(['rev-parse', '--short', 'HEAD']).trim();
const tar = path.join(os.tmpdir(), `focusshell-publish-${process.pid}.tar`);
fs.mkdirSync(out, { recursive: true });
try {
  // git archive reads the commit, so untracked files and uncommitted edits never get in.
  git(['archive', '--format=tar', '-o', tar, 'HEAD', '--', ...KEEP]);
  // Fed on stdin: Git Bash's tar reads "C:\..." as a remote host.
  execFileSync('tar', ['-xf', '-'], { cwd: out, input: fs.readFileSync(tar), maxBuffer: 64 << 20 });
} finally { fs.rmSync(tar, { force: true }); }
let count = 0;
const sweep = dir => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name), r = path.relative(out, f).split(path.sep).join('/');
    if (DROP.test(r)) fs.rmSync(f, { recursive: true, force: true });
    else if (e.isDirectory()) sweep(f);
    else count++;
  }
};
sweep(out);

git(['init', '-q', '-b', 'main'], out);
console.log(`publish: ${count} files from ${head} into ${out}`);
if (!author) {
  console.log('No --author given: review the folder, then commit there with the identity you want:');
  console.log(`  cd "${out}"; git add -A; git commit -m "Initial public release" --author "Name <email>"`);
} else {
  git(['add', '-A'], out);
  const m = author.match(/^(.+?)\s*<(.+)>$/);
  if (!m) { console.error('--author must look like "Name <email>"'); process.exit(1); }
  execFileSync('git', ['-c', `user.name=${m[1]}`, '-c', `user.email=${m[2]}`, 'commit', '-q', '-m', 'Initial public release'], { cwd: out });
  console.log(`committed as ${author}; nothing was pushed`);
}
