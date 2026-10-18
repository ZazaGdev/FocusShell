---
name: backlog
description: Use when the user asks what to work on, what's next, what's in the backlog or on the task list for the current project, wants to add a note or task for a project, or finishes a task taken from the backlog. Reads and updates the project's FocusShell task file.
---

# Project backlog (FocusShell)

Each project the user works on has one task file kept by FocusShell:
`<data>\tasks\<Project>.md`.

## Find the file

1. Read `<data>\projects.json`. Find the project whose `path` is the
   current working directory or a parent of it (case-insensitive). Use its `name`.
2. If none matches, use the current folder's name.
3. If `tasks\<Project>.md` does not exist, say there is no backlog yet and offer to
   start one. Start it only if the user agrees: the first `deck add` creates it.

## Changing the file: only with `deck`

Never edit the task file by hand, with an editor tool or with a script. Every change goes
through FocusShell's deck command, which locks the boards, re-reads the file, changes one
thing and writes it whole, so the CTO, the PM, the app and other leads never lose each
other's changes. Put text arguments in single quotes; Windows paths go in as they are:

```
node '<data>\deck.mjs' show <Project> [<n>]
node '<data>\deck.mjs' add <Project> '<title>' [--who <session>] [--detail '<text>']...
node '<data>\deck.mjs' mark <Project> <n> working|done|needs|blocked|open [--who <session>] [--result '<result>']
node '<data>\deck.mjs' detail <Project> <n> '<text>'
```

`deck help` lists every verb (tags, priority, versions, notes, moving an item to Me). If it
refuses, read its message and fix the command; never fall back to editing the file.

## Line format

```
- [<mark>] #<n> <task> (<YYYY-MM-DD>, <who>[, for owner]) -> <result>
```

Marks: ` ` open, `~` in progress, `?` needs the user, `!` blocked, `x` done. `<n>` comes
from one counter shared by every task board, from 1000 up; `deck add` picks it. A number below
1000 is an old per-board one: write it with its project. `<who>` is who is working on it, or `user`
for a note. ` -> <result>` appears once there is a result. `, for owner` after `<who>`
marks something the user has to test or do themselves; never claim or start one.

`<task>` is a **short title**, about eight words, that names the work; `<result>` is a short
result of one clause. Everything else (the user's full request, context, the long result,
a question for the user with its options) goes on **detail lines** right under the task, each
indented two spaces and starting with `> `:

```
- [x] #4 Faster export without quality loss (2026-10-02, lead-video-app) -> 12-16% faster
  > Make export/render faster without losing any quality, if possible
  > Result: 12-16% faster by decoding on the graphics card; output byte-identical; commit cc710cc
  > Done: 2026-10-03 14:20
```

The date on the task line is when it was added; `> Done:` is when it was closed (marked `x`).
A `> Tags: Research, ...` line (comma separated) tags a task; keep it when you edit the task.
An item for the user to read a research result belongs on their own board (`tasks/Me.md`),
tagged Research, not on a project as a `for owner` line.

FocusShell shows the title on the board and the details when the item is opened.
A `> Sketch: sketches/<Project>/<id>.excalidraw` line is a drawing the user attached in
FocusShell (a PNG preview sits beside it as `<id>.png`).
A `> Screenshot: <full path>` line is a screenshot from the user's screen recording: look at
it with the Read tool when the task needs it.

## "What can we work on?"

List the open (` `) lines that are not `for owner`, at most seven: those in the current
version first, then by `> Priority:` (1 highest, none last), then oldest first. A task's
version is a `> Version: <name>` detail line; the current one is the `> Version <name>:
current` line under the file's heading, else the first version not marked done. Then list
any `?` and `for owner` lines (they need the user). Suggest one, with a one-sentence reason. Do not list `x` lines.

## Taking a task

Check it right before claiming (`deck show <Project> <n>`). If the line is no longer ` `,
say who has it and suggest another. Otherwise `deck mark <Project> <n> working --who
<this session>` (`session in <folder>` if you do not know your name), then start.

## Finishing

`deck mark <Project> <n> done --result '<short result, commit hash if there is one>'` (it
writes the closed date); longer results go on a detail line with `deck detail <Project> <n>
'Result: ...'`. If you stop because you need the user, `deck mark <Project> <n> needs` and
put the question and its options on a detail line. If blocked, `deck mark <Project> <n>
blocked` and say on a detail line what would unblock it.

## Adding a note

"Add to the backlog: ..." or "note for <Project>: ..." is `deck add <Project> '<short
title>' --detail '<their words>' --detail 'What: <what it is about, and where>' --detail
'To do: <the action, and how to tell it is done>'` (`<who>` is `user`, today's date), so it
reads clearly a day later without this conversation (#236). Do not start it.

## Rules

- Change the file only with `deck`; it never reorders or deletes tasks.
- Keep titles short, about eight words. Detail goes on detail lines.
