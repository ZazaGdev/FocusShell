// How the app starts sessions. Same names, flags and prompt as the v1 launcher,
// plus Remote Control on from the start under the session's name (#131),
// so cross-session messaging and the manager's rules work unchanged.

// cmd resolves this through PATHEXT, so a native install's claude.exe and npm's claude.cmd
// both start (#390).
export const CLAUDE = 'claude';

const resumed = (args, resumeId) => (resumeId && /^[0-9a-f-]{36}$/i.test(resumeId) ? [...args, '--resume', resumeId] : args);

export function leadArgs(name, promptFile, resumeId) {
  return resumed(['/c', CLAUDE, '-n', `lead-${name}`, '--remote-control', `lead-${name}`, '--permission-mode', 'auto', '--append-system-prompt-file', promptFile], resumeId);
}

// The main CTO is `cto`; a group's CTO is `cto-<Group>` with its group rules appended.
export function managerArgs(name = 'cto', promptFile, resumeId) {
  const args = ['/c', CLAUDE, '-n', name, '--remote-control', name, '--permission-mode', 'auto'];
  return resumed(promptFile ? [...args, '--append-system-prompt-file', promptFile] : args, resumeId);
}

// The project manager: one `pm` over every project's board, in its own folder.
export function pmArgs(resumeId, promptFile) {
  const args = ['/c', CLAUDE, '-n', 'pm', '--remote-control', 'pm', '--permission-mode', 'auto'];
  return resumed(promptFile ? [...args, '--append-system-prompt-file', promptFile] : args, resumeId);
}

// The name a pane's session runs under, which Claude Code records in its session file.
export const sessionName = (id, prefix = '') => prefix + (id === 'pm' || id === 'cto' || String(id).startsWith('cto-') ? id : `lead-${String(id).replace(/:2$/, '-2')}`);

// The Claude model a session starts on (#142); '' or anything unknown leaves Claude's default.
export const withModel = (args, model) => (/^(fable|opus|sonnet|haiku)$/.test(model || '') ? [...args, '--model', model] : args);

// The shell outlives Claude (#353): cmd runs it with /k instead of /c, so when Claude exits
// the pane is an ordinary prompt the owner can type in. cmd sets the window title to a
// marker right after, which is how the app learns Claude ended.
export const CLAUDE_ENDED = 'focusshell-claude-ended';
export function keepShell(args) {
  if (args[0] !== '/c' || args[1] !== CLAUDE) return args;
  return ['/k', ...args.slice(1), '&', 'title', CLAUDE_ENDED, '&', 'echo', '[FocusShell]', 'Claude', 'has', 'exited.', 'This', 'pane', 'is', 'a', 'normal', 'shell', 'now.'];
}
// cmd.exe runs every session, so a project folder name holding one of these would be read as
// cmd syntax: "R&D" would start lead-R and then run D (#388). Such a project does not start.
const CMD_META = /[&|<>^%!()"]/;
export function nameProblem(name) {
  const m = String(name).match(CMD_META);
  return m ? `cannot start: the folder name "${name}" holds ${m[0]}, which the Windows command line reads as a command. Rename the folder.` : null;
}

// The command line for cmd.exe, built here rather than by node-pty, which quotes only arguments
// with spaces (#388). Every argument holding a space or a cmd special character is quoted, so a
// data folder like C:\Users\A&B\... stays one path; keepShell's own "&" separators stay bare.
// % and " cannot be quoted safely for cmd, so an argument holding one refuses to start.
export function commandLine(args) {
  return args.map(a => {
    const s = String(a);
    if (s === '&') return s;
    if (/[%"]/.test(s)) throw new Error(`cannot start: "${s}" holds ${s.match(/[%"]/)[0]}, which cannot be passed safely to the Windows command line. Rename that folder.`);
    if (!/[\s&|<>^()!]/.test(s) && s !== '') return s;
    return `"${s.replace(/(\\+)$/, '$1$1')}"`; // a trailing backslash would escape the closing quote
  }).join(' ');
}
// What node-pty is given: a Claude session's command line as one string, anything else as is.
export const spawnArgs = args => ((args[0] === '/k' || args[0] === '/c') && args[1] === CLAUDE ? commandLine(args) : args);

// The last title cmd set in this output: exactly the marker once Claude has exited (and at
// each prompt after), "marker - <command>" while a typed command runs. A claude typed there
// is Claude back; anything else leaves it ended. null when no title of that shell is in it.
export function shellTitle(text) {
  let last = null;
  for (const m of String(text).matchAll(/\x1b\]0;([^\x07\x1b]*)(?:\x07|\x1b\\)/g)) {
    const t = m[1].trim();
    if (t === CLAUDE_ENDED) last = 'ended';
    else if (t.startsWith(`${CLAUDE_ENDED} `)) last = /^-\s+claude(\.cmd|\.exe)?(\s|$)/i.test(t.slice(CLAUDE_ENDED.length).trim()) ? 'back' : 'ended';
  }
  return last;
}

// A session that inherits these from a parent Claude Code session never
// registers for messaging, so other sessions cannot reach it.
export function cleanEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('CLAUDE')));
}

// Closing the app warns only about sessions someone has used. A session is used once Enter
// is sent to it (the terminal's own replies and a dropped path carry none) or once Claude
// Code starts working, which also catches a task that arrived by message.
export const submits = data => typeof data === 'string' && data.includes('\r');
export const working = text => /esc to interrupt/i.test(String(text)
  .replace(/\x1b\[\d*C/g, ' ').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''));

// A pane's id outlives its session: a closed session can still send output or end after a
// new one took the same id (#197), and its exit then marked the new pane ended. Only the
// session the id now holds speaks for the pane.
export const owns = (sessions, id, s) => sessions.get(id) === s;

const fill = (template, tokens) => Object.entries(tokens).reduce((s, [k, v]) => s.split(`{{${k}}}`).join(v), template);

// deckFile is the data folder's deck command (#225), quoted so Git Bash keeps its backslashes.
export function renderLeadPrompt(template, project, taskFile, test, manager = 'cto', deckFile = 'deck.mjs') {
  const t = test || "the project's usual test command, if it has one";
  return fill(template, { PROJECT: project, TASKFILE: taskFile, TEST: t, MANAGER: manager, DECKCMD: `'${deckFile}'` });
}

export function renderGroupPrompt(template, group, groupsFile) {
  return fill(template, { GROUP: group, MANAGER: `cto-${group}`, GROUPSFILE: groupsFile });
}

// A project's second lead runs as session id "<Project>:2" (a colon is never in a folder
// name, so it cannot clash with a project) and is named lead-<Project>-2 for messaging.
export const secondId = project => `${project}:2`;
export const secondOf = id => { const m = /^(.+):2$/.exec(String(id)); return m ? m[1] : null; };

// Rules added to the second lead's prompt, after the usual lead rules.
export function secondLeadNote(project, worktree) {
  const head = [
    '', '## You are the second lead', '',
    `Your session name is \`lead-${project}-2\`, not \`lead-${project}\`. \`lead-${project}\` is`,
    'also working on this project right now, on a different task. Both of you share the',
    'one task file. Report to whoever sent your TASK, as usual.', '',
  ];
  const body = worktree ? [
    `You work in your own git worktree of ${project}, on branch \`lead-2\`, so the first lead`,
    'never sees your edits until you merge. Before starting a task, run `git merge main`.',
    'When the task is done and tests pass, commit on `lead-2`, run `git merge main` again,',
    `then fast-forward main in ${worktree.main} with`,
    `\`git -C "${worktree.main}" merge --ff-only lead-2\` and push from there with`,
    `\`git -C "${worktree.main}" push\` when it has a remote. If the fast-forward is refused,`,
    'report BLOCKED with the reason; never force it. Do not push `lead-2` itself.',
    'Do not remove this worktree or its branch: the app does that when your session closes.',
  ] : [
    `You share the project folder with \`lead-${project}\`. Touch only the files your task`,
    'needs, and leave alone any file the other lead is changing. Commit only your own',
    'files. Never run commands that change the whole working tree: no `git stash`,',
    '`git reset --hard`, `git checkout .`, `git clean`, branch switches or rebases.',
    'If your task turns out to need a file the other lead is changing, report NEEDS YOU.',
  ];
  return [...head, ...body, ''].join('\n');
}

// A model the CTO names when it opens a lead (#202): a "model=<name>" line in the open
// request, one of the short names withModel takes; anything else is ''.
export const MODELS = ['fable', 'opus', 'sonnet', 'haiku'];
export function requestModel(body) {
  const m = String(body || '').match(/^model=(\w+)\s*$/im);
  return m && MODELS.includes(m[1].toLowerCase()) ? m[1].toLowerCase() : '';
}

// The CTO and the PM start in folders inside the data folder, and Claude Code reads every
// CLAUDE.md above its start folder, so in the owner's layout they would load the developer
// guide (<data>/CLAUDE.md). This session setting skips exactly that file (#349). The paths
// are given with both slash styles, as the docs only show forward slashes.
export function ownSetupSettings(data) {
  const base = String(data).replace(/[\\/]+$/, ''), fwd = base.split('\\').join('/');
  const files = ['CLAUDE.md', 'CLAUDE.local.md'];
  return { claudeMdExcludes: [...new Set([...files.map(f => `${fwd}/${f}`), ...files.map(f => `${base}\\${f}`)])] };
}
export const withSettings = (args, file) => (file ? [...args, '--settings', file] : args);

// Remote Control off in Settings (#346): the same session without it. Messaging between
// sessions on this PC works either way, as the Demo shows; Remote Control adds claude.ai's access.
export function withoutRemote(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) { if (args[i] === '--remote-control') { i++; continue; } out.push(args[i]); }
  return out;
}

// The FocusShell Demo's sessions (#135) run beside the real ones under names of their own,
// demo-cto, demo-pm, demo-lead-<Project>, and without Remote Control, so no message sent by
// name can cross between the two: the Demo signs in to the same Claude account.
export function demoArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--remote-control') { i++; continue; }
    out.push(args[i]);
    if (args[i] === '-n' && i + 1 < args.length) out.push(`demo-${args[++i]}`);
  }
  return out;
}
export const DEMO_NOTE = `# Session names in the FocusShell Demo

This is the FocusShell Demo. Every session name here starts with \`demo-\`: the CTO is
\`demo-cto\`, a group's CTO is \`demo-cto-<Group>\`, the project manager is \`demo-pm\`, a
project's lead is \`demo-lead-<Project>\` and its second lead \`demo-lead-<Project>-2\`. You are
the one your session name says. Wherever your rules name \`cto\`, \`cto-<Group>\`, \`pm\`,
\`lead-<Project>\` or \`lead-<Project>-2\` as a session to message, use its demo- name instead.
Never message a session whose name does not start with \`demo-\`.
`;
