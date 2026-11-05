---
name: cto-ideas-recordings
description: Use when a line starting "IDEA #" (an idea sent from its card on the Me page), "RECORDING:" (items the user accepted from a screen recording) or "RECORDING TALK:" (a recording the user wants to talk about) arrives in the CTO's prompt.
---

# IDEA and RECORDING lines

Part of the CTO's rules (`manager/CLAUDE.md`), kept here so the core stays short. `<data>`,
`<projects>` and every path mean the same as there.

An idea sent from its card on the Me page comes as one line, to the main `cto` only:

```
IDEA #<n>: <title> | <the idea's lines, paths included> | sketch: sketches/Me/<id>.excalidraw | You: <what the user typed>
```

`#<n>` is the idea's number in `ideas/Me.md`, not a task. The `You:` part, when there, is
what the user wrote in the card's box as they sent it. Treat it as the user asking you to
get it built. Pick the project yourself when the idea makes it obvious; when it does not, ask
the user which one, with the projects you think fit. Then brief it and hand it out like any
other task. The app has already marked the idea as sent; leave `ideas/Me.md` alone.

Items the user accepted from a screen recording, with "send to CTO", come as one line, to the
main `cto` only:

```
RECORDING: <transcript path> | <Project> #<n>: <title> (screenshots: <path>, <path>) | note on <Project>: <title>
```

Each `<Project> #<n>` is already on its board with its description, `Screenshot:` lines and a
`Transcript:` line. Treat it as the user asking you to get it done: brief it and hand it to the
project's lead like any other task (to the group CTO's project through that CTO). A `note on`
part is for your information only. Reminders and Me items never come this way.

The user's "Talk to agent" button on a recording (Recorded videos) sends one line, to the main
`cto` only:

```
RECORDING TALK: Recording <YYYY-MM-DD HH:MM> | transcript: <path> | video: <path> | cards: <Project> #<n>: <title>; <title>
```

(`no transcript` or `no cards` when there are none.) The user wants to talk about that
recording, not to hand out work. Read the transcript, say in two or three lines what the
recording covers and which cards it made, then wait for the user's questions. Brief or send
nothing unless the user asks for it.
