# FocusShell

A Windows desktop app for running many Claude Code sessions across many projects from one
window.

- **One lead per project.** Each project gets its own Claude Code session (a "lead") in a real
  terminal, in tabs or side-by-side layouts.
- **A CTO session that hands out work.** Tell it what you want in plain words
  (`my-app: fix the login crash`, `status?`). It writes a short brief, sends it to that
  project's lead and brings back the result, or the question the lead needs you to answer.
- **Boards.** Every project has a task board, notes and a page with its recent sessions and
  commits.
- **A pixel tavern** where your sessions sit as robots, so you can see at a glance who is
  working and who is waiting.
- **Voice.** Dictate into any pane with Windows voice typing (Win+H).

FocusShell is not affiliated with or endorsed by Anthropic. It starts the Claude Code you
already have installed; it does not include Claude or talk to Anthropic itself.

## Requirements

- Windows 10 or 11.
- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed and signed in, so that
  `claude` runs in a terminal. You need a Claude plan or API access that Claude Code accepts;
  every session FocusShell starts uses it. Either install works: the native installer
  (`claude.exe`) or npm (`claude.cmd`).
- [Node.js](https://nodejs.org/en/download) 18 or later, so that `node` runs in a terminal. The
  CTO, the PM and the leads change the boards with it. FocusShell shows a card at start when
  Claude Code or Node.js is missing.
- Git, for the board history.
- Optional: the GitHub CLI (`gh`, signed in) to list a project's pull requests, and VS Code to
  open a project beside its lead.

## Install

1. Download `FocusShell-Setup-<version>.exe` from the Releases page.
2. Run it. The installer is not code-signed, so Windows SmartScreen may say it "protected your
   PC": click **More info**, then **Run anyway**. It installs for your user only and adds Start
   menu and desktop shortcuts.

## First run

1. Open **FocusShell**. It keeps its data (boards, notes, briefs, settings) in
   `%APPDATA%\FocusShell\deck`.
2. A short setup opens. At **Connect your projects**, select your project folders, as many as
   you like at once; each becomes a project, named after its folder. You can skip it and
   connect more later in **Settings**, under Projects.
3. The CTO starts on the left. The first time, accept Claude Code's "trust this folder" prompt
   in its pane.
4. Ask the CTO for something, such as `my-app: add a dark mode toggle`, or open a project from
   the Board and talk to its lead directly.

In any Claude Code session inside a project, "what can we work on?" reads that project's
task list (the `backlog` skill FocusShell installs in `~/.claude/skills`).

## What it sends over the network

FocusShell itself only sends what is listed here:

- **Claude Code sessions** (the CTO, leads and the AI helper beside the add fields) go to
  Anthropic through your own Claude Code, with whatever you and they put in them. So does the
  screen recorder's transcript, when you record and it turns what you said into cards; it
  transcribes on your PC with the whisper-cli and ffmpeg you point it to.
- **Optional, off by default** (Settings): Remote Control, which makes the CTO and PM sessions
  reachable from claude.ai; and pushing the hourly board backup to your data folder's git
  remote.
- **Only when you use them:** `gh pr list` on a project page (GitHub); the Code pane's local VS
  Code server (it downloads VS Code's web build from Microsoft once); links you open in your
  browser; Windows voice typing (Microsoft).

FocusShell has no analytics or telemetry of its own (VS Code's follows your VS Code settings).
Fonts and art ship inside the app.

## Build from source

```powershell
cd app
npm ci
npx electron .          # run from source; the data folder is this repo
node --test lib/lib.test.js
npm run dist            # writes app\dist\FocusShell-Setup-<version>.exe
```

`npx electron . --smoke` runs the app with fake sessions in a hidden window, saves screenshots
under `state\smoke\` and quits.

## Licence

MIT, see [LICENSE](LICENSE). Bundled fonts, packages and art keep their own licences, listed
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and `tavern/assets/LICENSES.md`.
