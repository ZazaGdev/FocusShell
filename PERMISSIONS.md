# FocusShell and Claude Code permissions

FocusShell adds no sandbox of its own. Every pane is an ordinary Claude Code session that
FocusShell starts for you, and what that session may read, change or run is decided by Claude
Code and your Claude Code settings, the same as if you had typed `claude` in that folder
yourself. This page says what that means in practice, what FocusShell itself sets, and which
Claude Code settings make it stricter.

## The short version

- **A lead starts in its project's folder.** That folder is its working directory: Claude Code
  lets it read and edit files there without asking.
- **That is a starting point, not a wall.** With Claude Code's default settings, a lead can
  still read files in other folders, and can write to them when its task asks for it. Leads run
  in auto mode, where a second model (the classifier) judges actions outside the folder, and
  Claude Code's own docs say auto mode "does not guarantee safety". We checked both directions
  with Claude Code 2.1.319: a session started in one folder read a file in another folder, and
  wrote one there when asked.
- **Every pane runs as you.** All sessions, and every program they start, run as the same
  Windows (or macOS) user as FocusShell, signed in to the same Claude account. The operating
  system sees no difference between one lead and another.
- **The lead's rules ask it to stay in its project** ("Never edit files outside this project
  folder"). That steers the model; nothing enforces it.
- **You can make it stricter with Claude Code's own settings**, per project: block the file
  tools outside the folder, deny paths, add ask rules, and on a Mac turn on Claude Code's
  sandbox. See [Making it stricter](#making-it-stricter).

## How FocusShell starts each session

| Session | Starts in | Permission mode | What FocusShell adds |
|---|---|---|---|
| `lead-<Project>` | the project's folder | auto | its rules (`lead-prompt.md`), added to the system prompt; the effort skills (`app/lead-plugin`, loaded with `--plugin-dir`) |
| `lead-<Project>-2` to `-5` (extra leads) | the project's folder, or its own git worktree in the data folder (`state\worktrees`) | auto | the same, plus a note about the other leads |
| `cto`, `cto-<Group>` | `<data>\manager` | auto | its rules; a session setting (`--settings`) that skips the developer guide `CLAUDE.md` in the folder above (`claudeMdExcludes`) |
| `pm` | `<data>\pm` | auto | the same as the CTO |
| `lead-Personal` | its own folder | auto | nothing |
| Recorder brainstorm sessions | `<data>\manager` or `<data>\pm` | auto | the CTO's or PM's setup, plus that recording's folder (`--add-dir`) |

`<data>` is FocusShell's data folder, `%APPDATA%\FocusShell\deck` unless you moved it.

Each session is started as `claude` with only these flags: its name (`-n`),
`--permission-mode auto`, its rules file (`--append-system-prompt-file`), and where they apply
`--settings` (the CTO and PM setting above, and Classic view), `--plugin-dir`, `--add-dir`,
`--model` (a model you picked in Settings), `--remote-control` (only when Remote Control is on
in Settings; it is off by default) and `--resume` on a restart. Before starting a session,
FocusShell removes environment variables whose names start with `CLAUDE`, so the session
registers for messaging; it changes nothing else in the environment.

All panes use the same mode on purpose: Claude Code can hold a message between two sessions in
different permission classes until you approve it, and the CTO and leads talk by message.

FocusShell's own small background turns (the AI helper, card summaries, catch-up, Maybe missed,
the recorder's card extraction) run `claude -p` with no tools, or with only the Read tool for
one folder, and without your settings files (`--setting-sources ""`).

## What FocusShell changes in Claude Code's files

- **The "trust this folder" question.** The first time Claude Code opens in a folder, it asks
  whether you trust it. FocusShell answers Yes for you, once, soon after the session starts, so
  the lead can join messaging. So opening a project in FocusShell means trusting it, and Claude
  Code then applies that project's own `.claude/settings.json`, including its allow rules,
  extra directories and hooks (hooks are commands that run on your PC). Only put folders you
  trust in FocusShell's projects folder.
- **The `backlog` skill.** FocusShell writes `~/.claude/skills/backlog/SKILL.md`, a global
  skill, so any Claude Code session on this PC can answer "what can we work on?" from a
  project's board.
- **Your settings files are left alone.** FocusShell never writes `~/.claude/settings.json`,
  `~/.claude.json` or a project's settings files (Claude Code itself records the trust answer
  above in `~/.claude.json`). It reads `~/.claude.json` to show which
  projects you have trusted, `~/.claude/settings.json` for your voice setting, and Claude
  Code's session logs in `~/.claude/projects` for history and token counts.
- **"Push without asking"** is the one permission change in a project, and only you can make
  it: when you type it in a lead's pane, the lead adds `Bash(git push:*)` to `permissions.allow`
  and the force-push forms to `permissions.ask` in that project's `.claude/settings.local.json`
  (a file Claude Code keeps out of git). Settings lists the projects that have it. A lead does
  not do this when the CTO asks.
- **FocusShell's own folders** have their own `.claude/settings.json`: in `manager` and `pm`, a
  hook that refuses a hand edit of a board file (boards change only through the `deck`
  command), and in `manager` a short list of commands the CTO may run without a prompt.

## What keeps a lead in its project, and what does not

What Claude Code does by default for a lead in auto mode:

| A lead tries to | What happens by default |
|---|---|
| read or edit a file in its project | Runs without a question. Writes to protected paths such as `.git`, `.claude` and `.vscode` go to the classifier. |
| read a file elsewhere with its file tools (Read, Grep, Glob) | The first time, Claude Code asks in that pane (FocusShell shows it as a card) whether to allow reads outside the working directory. The answer can keep allowing them or block them from then on. |
| read a file elsewhere with a read-only command (`cat`, `head`, `grep`, `ls`, ...) | Runs without a permission question; the classifier may review it. |
| write a file elsewhere, with its file tools or a shell command | Not approved automatically: the classifier decides. It blocks what goes beyond the request, so a task that asks for the write can get it. |
| run a program (tests, a build, a script) | That program can read and write anything your user account can. Claude Code's path rules do not follow programs that open files themselves. |
| act on a message from another session | Any Claude Code session of yours on this PC can message a lead by name. Claude Code marks the message as coming from another session: it cannot approve a prompt or make the lead change its settings, and the lead's own permission checks still apply. |

Two more things are true whatever the settings:

- **Same user, same account.** Windows file permissions do not separate one lead from another,
  because they all run as you.
- **No operating-system sandbox on Windows.** Claude Code's sandbox runs on macOS, Linux and
  WSL2; on native Windows, Claude Code runs commands unsandboxed, and FocusShell starts the
  native Windows Claude Code. On a Mac the sandbox is available but off by default.

## Making it stricter

These are Claude Code settings; FocusShell needs no change for them. Put them in the project's
own settings, so they apply to that project's leads only:

- `<project>\.claude\settings.local.json`: yours, kept out of git
- `<project>\.claude\settings.json`: shared with everyone who clones the repository

Keep them out of your user settings (`~/.claude/settings.json`) unless you mean every session:
the CTO and the PM work across folders by design (the CTO writes briefs in the data folder and
reads projects to write them), and the blocks below would refuse that.

### Block the file tools outside the project

```json
{
  "permissions": {
    "blockReadsOutsideWorkingDirectories": true,
    "blockWritesOutsideWorkingDirectories": true
  }
}
```

With these on, a lead's Read, Edit and Write tools refuse paths outside its folder in every
mode, and the read block also stops read-only commands such as `cat` that name an outside path.
They need Claude Code 2.1.257 (reads) and 2.1.314 (writes) or newer; check with
`claude --version`.

What they do not cover: the write block does not limit shell commands (in our test,
`echo hi > <other project>\file` still wrote the file), and neither block covers a script or
program that opens files itself.

A lead sometimes reads a file in the data folder: a sketch or screenshot attached to a task.
To let those through while the read block is on, add those folders as working directories,
and only those, since the data folder also holds every project's board:

```json
{
  "permissions": {
    "additionalDirectories": [
      "C:\\Users\\<you>\\AppData\\Roaming\\FocusShell\\deck\\sketches",
      "C:\\Users\\<you>\\AppData\\Roaming\\FocusShell\\deck\\screenshots",
      "C:\\Users\\<you>\\AppData\\Roaming\\FocusShell\\deck\\state\\plugins\\recorder"
    ]
  }
}
```

### Deny paths no lead should touch

```json
{
  "permissions": {
    "deny": ["Read(~/.ssh/**)", "Read(//d/Work/**)", "Edit(//d/Work/**)"]
  }
}
```

On Windows, write absolute paths in this form: `D:\Work` is `//d/Work`. A deny rule wins in
every mode. It covers the file tools and the file commands Claude Code recognizes in the shell
(`cat`, `head`, `sed`, redirects), not programs that read files themselves.

### Ask before an action

An `ask` rule forces a prompt even in auto mode, for example `"ask": ["Bash(git push *)"]` in
`permissions`. A push written another way, such as `git -C <folder> push`, does not match it.

### On a Mac: the sandbox

`"sandbox": { "enabled": true }` makes the operating system limit what shell commands write
(the working directory and a temp folder by default) and which hosts they reach (none until you
allow them, so `git push` and package installs need allowed domains). It still lets them read
most of the machine unless you add `sandbox.filesystem.denyRead`. It covers shell commands
only, not the file tools. FocusShell has not been tested with the sandbox on: a lead's `deck`
command writes in the data folder, which would need `sandbox.filesystem.allowWrite`.

### For real separation

For a project you do not trust, these settings narrow what Claude does but are not a boundary
the operating system enforces. Run that project under a different user account, or in a
virtual machine or container, outside FocusShell.

### Check what applies

In a lead's pane, `/status` lists the settings files it loaded, and `/permissions` shows its
rules.

## Claude Code's own docs

- [Configure permissions](https://code.claude.com/docs/en/permissions): modes, allow, ask and
  deny rules, working directories, the outside-folder blocks, workspace trust
- [Permission modes](https://code.claude.com/docs/en/permission-modes): auto mode, protected
  paths, the first read outside the working directories
- [Configure auto mode](https://code.claude.com/docs/en/auto-mode-config): the classifier's
  rules and how to add your own
- [Settings files and precedence](https://code.claude.com/docs/en/settings): which file a
  setting goes in, and which one wins
- [Sandboxing](https://code.claude.com/docs/en/sandboxing): what the sandbox limits, and where
  it runs
- [Message your other Claude Code sessions](https://code.claude.com/docs/en/cross-session-messaging):
  how sessions treat a message from another session
