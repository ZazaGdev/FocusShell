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
export const sessionName = (id, prefix = '') => prefix + (id === 'pm' || id === 'cto' || String(id).startsWith('cto-') ? id : `lead-${String(id).replace(/:([2-5])$/, '-$1')}`);

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
// cmd.exe runs every session, and a folder name such as "R&D" or "New folder - Copy (4)" used
// to be read as cmd syntax (#388), so such projects were refused. Now any argument holding
// a space or a character cmd treats specially goes in an environment variable instead, and the
// command line names it as "!FS_An!": cmd, started with /V:ON, expands those only after it has
// parsed the line, so the value is passed as it is and nothing in it runs (#1126). A folder
// name Windows itself allows always starts; only " (which Windows does not allow) is refused.
export function nameProblem(name) {
  return /"/.test(String(name)) ? `cannot start: the folder name "${name}" holds ", which Windows does not allow in a folder name.` : null;
}

// The command line for cmd.exe and the environment it needs: { line, env }. keepShell's own
// "&" separators stay bare; a plain word stays itself; anything else goes by FS_A<n>.
export function commandLine(args) {
  const env = {};
  const line = args.map((a, i) => {
    const s = String(a);
    if (s === '&' || (s !== '' && !/[\s&|<>^()!%"]/.test(s))) return s;
    if (/"/.test(s)) throw new Error(`cannot start: "${s}" holds ", which Windows does not allow in a name.`);
    env[`FS_A${i}`] = s.replace(/(\\+)$/, '$1$1'); // a trailing backslash would escape the closing quote
    return `"!FS_A${i}!"`;
  }).join(' ');
  return { line: `/V:ON ${line}`, env };
}
// What node-pty is given: a Claude session's command line (and its variables) as one string,
// anything else as is.
export const spawnArgs = args => ((args[0] === '/k' || args[0] === '/c') && args[1] === CLAUDE ? commandLine(args) : { line: args, env: {} });

// The same session on a Mac (#2562): the owner's shell runs claude with its arguments passed as
// they are ("$@", so no name is ever read as shell syntax), then, as keepShell does on Windows,
// sets the title marker and stays as an ordinary login shell. A cmd-style line the smoke run
// uses ('/k <line>' stays open, '/c <line>' ends) runs as a sh line. Returns { file, line, env }.
export function posixSpawn(args, shell = '/bin/zsh') {
  const sh = shell || '/bin/zsh';
  if ((args[0] === '/c' || args[0] === '/k') && args[1] === CLAUDE) {
    const script = `"$@"; printf '\\033]0;${CLAUDE_ENDED}\\007'; echo '[FocusShell] Claude has exited. This pane is a normal shell now.'; exec "$0" -l`;
    return { file: sh, line: ['-c', script, sh, ...args.slice(1)], env: {} };
  }
  if (args[0] === '/k') return { file: sh, line: ['-c', `${args.slice(1).join(' ')}; exec "$0"`, sh], env: {} };
  if (args[0] === '/c') return { file: sh, line: ['-c', args.slice(1).join(' '), sh], env: {} };
  return { file: sh, line: args, env: {} };
}

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

// A project runs up to MAX_LEADS leads at once (#1485). Its first runs as session id
// "<Project>"; the others as "<Project>:<n>", n from 2 to 5 (a colon is never in a folder
// name, so it cannot clash with a project), named lead-<Project>-<n> for messaging.
export const MAX_LEADS = 5;
export const EXTRA_LEADS = [2, 3, 4, 5];
export const extraId = (project, n) => `${project}:${n}`;
export const extraOf = id => { const m = String(id).match(/^(.+):([2-5])$/); return m ? { project: m[1], n: Number(m[2]) } : null; };
// The project a lead's session belongs to, and its number (1 for the first lead).
export const projectOf = id => (extraOf(id) || { project: String(id) }).project;
export const leadNumber = id => (extraOf(id) || { n: 1 }).n;
// The first lead number from 2 to 5 that is not taken, or null once all five run.
export const nextLead = taken => EXTRA_LEADS.find(n => !taken(n)) || null;

const ORDINAL = { 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth' };
// Rules added to an extra lead's prompt, after the usual lead rules.
export function extraLeadNote(project, n, worktree) {
  const me = `lead-${project}-${n}`, branch = `lead-${n}`;
  const head = [
    '', `## You are the ${ORDINAL[n]} lead`, '',
    `Your session name is \`${me}\`, not \`lead-${project}\`. \`lead-${project}\` and maybe other`,
    `leads of this project (\`lead-${project}-2\` to \`lead-${project}-${MAX_LEADS}\`) are working on it right now,`,
    'each on a different task. All of you share the one task file. Report to whoever sent',
    'your TASK, as usual.', '',
  ];
  const body = worktree ? [
    `You work in your own git worktree of ${project}, on branch \`${branch}\`, so the other leads`,
    'never see your edits until you merge. Before starting a task, run `git merge main`.',
    `When the task is done and tests pass, commit on \`${branch}\`, run \`git merge main\` again,`,
    `then fast-forward main in ${worktree.main} with`,
    `\`git -C "${worktree.main}" merge --ff-only ${branch}\` and push from there with`,
    `\`git -C "${worktree.main}" push\` when it has a remote. If the fast-forward is refused,`,
    `report BLOCKED with the reason; never force it. Do not push \`${branch}\` itself.`,
    'Do not remove this worktree or its branch: the app does that when your session closes.',
  ] : [
    `You share the project folder with the other leads of ${project}. Touch only the files your task`,
    'needs, and leave alone any file another lead is changing. Commit only your own',
    'files. Never run commands that change the whole working tree: no `git stash`,',
    '`git reset --hard`, `git checkout .`, `git clean`, branch switches or rebases.',
    'If your task turns out to need a file another lead is changing, report NEEDS YOU.',
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
export function withSettings(args, file) {
  if (!file) return args;
  const i = args.indexOf('--settings');
  return i < 0 ? [...args, '--settings', file] : args.map((a, j) => (j === i + 1 ? file : a));
}
export const settingsFileOf = args => { const i = args.indexOf('--settings'); return i < 0 ? null : args[i + 1]; };
// Classic view (#1272): Claude Code's full-screen renderer keeps the conversation inside
// itself, so a pane's scrollback, and its find bar, only ever held the visible rows. This
// session setting starts the classic renderer, on top of any session setting it already has.
export const classicSettings = (base = {}) => ({ ...base, tui: 'default' });

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
project's lead is \`demo-lead-<Project>\` and its extra leads \`demo-lead-<Project>-2\` to \`-5\`. You are
the one your session name says. Wherever your rules name \`cto\`, \`cto-<Group>\`, \`pm\`,
\`lead-<Project>\` or \`lead-<Project>-<n>\` as a session to message, use its demo- name instead.
Never message a session whose name does not start with \`demo-\`.
`;
