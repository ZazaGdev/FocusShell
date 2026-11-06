# FocusShell

## TL;DR

- One window for all your Claude Code projects: you talk to one CTO session, and it hands the
  work to a lead session in each project.
- Free and open source (GPL-3.0), for Windows 10 and 11. Mac support is coming soon.
- Download `FocusShell-Setup-2.0.0.exe` from [Releases](https://github.com/ZazaGdev/FocusShell/releases) and run it. Windows may show a SmartScreen warning because the app is not code-signed yet: click **More info**, then **Run anyway**.

![You talk to one CTO; it hands tasks to a lead in each project, and their reports and questions come back to you through the CTO](docs/hub.png)

More on how it works: [zazag.dev/apps/focusshell](https://zazag.dev/apps/focusshell/)

[![YouTube](docs/youtube.svg) Watch the demo](https://www.youtube.com/watch?v=t_WVO-hzF2w)

## Install

1. Download the installer from [Releases](https://github.com/ZazaGdev/FocusShell/releases).
2. Run it. It is not code-signed: if SmartScreen stops it, click **More info**, then **Run anyway**.
3. Open FocusShell and follow the short setup.

### Mac (Apple Silicon, from 2.1)

1. Download `FocusShell-<version>-arm64.dmg` from [Releases](https://github.com/ZazaGdev/FocusShell/releases), open it and drag FocusShell to Applications.
2. Open FocusShell. It is not signed by Apple, so macOS stops it the first time: open
   **System Settings > Privacy & Security**, scroll down and click **Open Anyway**. (Or run
   `xattr -dr com.apple.quarantine /Applications/FocusShell.app` in Terminal.)
3. To check the download, compare `shasum -a 256 FocusShell-<version>-arm64.dmg` with the
   SHA-256 in the release notes.

Because the Mac version is not signed:

- It cannot update itself. It tells you when a new version is out and opens its download page.
- macOS asks again, after each update, for the permissions it uses: Microphone and Screen &
  System Audio Recording (the screen recorder), Input Monitoring (talk to the CTO from any app,
  hold Ctrl to draw) and Accessibility (the microphone button on a card starts Dictation). Turn
  them on in System Settings > Privacy & Security when it asks.
- For the screen recorder, install `ffmpeg` and `whisper-cpp` (`brew install ffmpeg whisper-cpp`)
  or Editbay, and put a Whisper model file (such as `ggml-small.en.bin`) in the Whisper folder
  named in Settings.

## Requirements

- [Claude Code](https://docs.claude.com/en/docs/claude-code) 2.1.234 or newer, signed in
- [Node.js](https://nodejs.org/en/download) 18 or newer, and Git
- Optional: VS Code, for the Code pane

## Network

Sessions reach Anthropic through your own Claude Code. FocusShell has no analytics. It checks
this repo's Releases for updates, and the Code pane downloads VS Code's web build from
Microsoft once. Remote Control (your sessions on claude.ai) is off unless you turn it on.

## Build from source

`cd app`, then `npm ci` and `npm run dist` (Windows), or `npm run dist:mac` on a Mac with
Xcode's command line tools.

## Licence

Copyright (C) 2026 Zaza Gejadze. GPL-3.0-or-later: you may share and change FocusShell, and any
version you distribute must stay open under the same licence; see [LICENSE](LICENSE). Bundled
parts keep their own licences, listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
FocusShell is not affiliated with or endorsed by Anthropic.
